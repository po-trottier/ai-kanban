# syntax=docker/dockerfile:1
# Production image (docs/architecture/deployment.md#image), three stages:
#   build   — node:24 full: npm ci (scripts disabled) + explicit native rebuild
#             for linux, Vite SPA bundle, esbuild server bundle, and a minimal
#             runtime node_modules holding ONLY the two native externals.
#   test    — build + dev deps; `docker run` executes the full integration
#             suite INSIDE the production build context (testing.md CI step 4:
#             catches native-module drift between Windows dev and Linux prod).
#   runtime — node:24-slim, non-root, production artifacts only.

FROM node:24 AS build
WORKDIR /app

# Workspace manifests first: npm ci layer caches until a manifest changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY e2e/package.json e2e/
# Scripts disabled: no supply-chain install hooks; natives are rebuilt
# explicitly below (same policy as the repo's own `npm run setup`).
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm rebuild --ignore-scripts=false --foreground-scripts better-sqlite3 argon2
# SPA bundle + esbuild server bundle (dist/main.js, dist/cli.js, dist/migrations).
RUN npm run build

# The server bundle keeps exactly two runtime externals — the native addons —
# so the runtime image needs a node_modules with only them. The pair lives in
# a committed lockfile (deploy/runtime) so every transitive dependency is
# pinned: two builds of the same commit produce the same runtime tree. The
# guard fails the build if those pins drift from the workspace manifests (one
# source of truth), and scripts stay disabled except the explicit rebuild of
# the two audited natives — the same policy as the build stage above.
RUN mkdir /runtime && cp deploy/runtime/package.json deploy/runtime/package-lock.json /runtime/ \
    && node -e 'const want = { "better-sqlite3": require("/app/packages/db/package.json").dependencies["better-sqlite3"], argon2: require("/app/packages/server/package.json").dependencies.argon2 }; const have = require("/runtime/package.json").dependencies; for (const [name, version] of Object.entries(want)) { if (have[name] !== version) { console.error(`runtime pin drift: deploy/runtime pins ${name}@${have[name]}, workspace wants ${version}`); process.exit(1); } }' \
    && cd /runtime && npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild --ignore-scripts=false --foreground-scripts better-sqlite3 argon2 \
    && node -e "require('fs').writeFileSync('/runtime/app-package.json', JSON.stringify({ name: 'rivian-kanban', private: true, type: 'module', scripts: { start: 'node dist/main.js', cli: 'node dist/cli.js' } }, null, 2))"

FROM build AS test
ENV NODE_ENV=test CI=true
CMD ["npx", "vitest", "run", "--project", "integration"]

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    METRICS_PORT=9464 \
    # Scrapable over the internal Docker network; Compose never publishes it.
    METRICS_HOST=0.0.0.0 \
    DATABASE_PATH=/data/app.sqlite \
    BLOB_DIR=/data/blobs \
    SNAPSHOT_DIR=/data/snapshots \
    # The bundle is relocated from the source tree: pin migrations + SPA.
    MIGRATIONS_DIR=/app/dist/migrations \
    SPA_DIR=/app/web

# Build identity, surfaced by GET /version and the logs (deployment.md#upgrade--rollback).
ARG APP_VERSION=dev
ARG GIT_SHA=dev
ARG BUILT_AT=dev
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA} BUILT_AT=${BUILT_AT}

COPY --from=build --chown=node:node /runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /runtime/app-package.json ./package.json
COPY --from=build --chown=node:node /app/packages/server/dist ./dist
COPY --from=build --chown=node:node /app/packages/web/dist ./web
# /data pre-created and node-owned so the named volume inherits the ownership.
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 3000

# node:24-slim ships no curl; node's global fetch does the readiness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
