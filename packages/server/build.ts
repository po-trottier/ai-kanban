import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Production server bundle (docs/architecture/deployment.md#image): esbuild
 * bundles the process entrypoint and the operational CLI into self-contained
 * ESM files under dist/, plus a copy of the drizzle migrations the entrypoint
 * applies at boot (the image sets MIGRATIONS_DIR=<dist>/migrations because
 * bundling relocates packages/db away from its checked-in ./migrations).
 *
 * Externals — verified by booting the bundle:
 * - better-sqlite3, argon2: native addons; they load their compiled .node
 *   binaries relative to their own package directories, so they must stay
 *   real node_modules (the image ships exactly these two plus their deps).
 * - @scalar/fastify-api-reference: the dev-only docs UI, dynamically imported
 *   only when NODE_ENV !== 'production'; it is a devDependency and absent
 *   from the runtime image on purpose.
 */

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

await rm(here('./dist'), { recursive: true, force: true })

await build({
  entryPoints: [here('./src/main.ts'), here('./src/cli.ts')],
  outdir: here('./dist'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['better-sqlite3', 'argon2', '@scalar/fastify-api-reference'],
  // CJS dependencies inside an ESM bundle still call require()/__dirname at
  // module scope; give them the standard interop shims.
  banner: {
    js: [
      "import { createRequire as __cjsCreateRequire } from 'node:module';",
      "import { fileURLToPath as __cjsFileURLToPath } from 'node:url';",
      "import { dirname as __cjsDirname } from 'node:path';",
      'const require = __cjsCreateRequire(import.meta.url);',
      'const __filename = __cjsFileURLToPath(import.meta.url);',
      'const __dirname = __cjsDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
})

await cp(here('../db/migrations'), here('./dist/migrations'), { recursive: true })
