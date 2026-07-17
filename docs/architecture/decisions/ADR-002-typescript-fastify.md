# ADR-002: TypeScript everywhere; Node 24 LTS + Fastify 5

**Status**: accepted (2026-07-16)

## Context

Backend must serve REST + MCP + Slack from one service layer. Python (FastAPI + mcp SDK) was a
credible runner-up. The frontend is necessarily TypeScript.

## Decision

- One language: **TypeScript** across backend and frontend. The same Zod schemas drive REST
  validation, OpenAPI generation, MCP tool inputSchemas, and frontend forms — a single source
  of truth no two-language stack can match.
- **Node 24 LTS**, npm workspaces monorepo.
- **Fastify 5** as HTTP host: schema-first validation, first-class plugin encapsulation,
  best-in-class Node perf, mature security plugins (@fastify/helmet, rate-limit, cors).
  NestJS rejected (framework gravity fights the framework-free core; DI container unneeded at
  this size). Hono rejected (thinner plugin/security ecosystem for a server-ful app).
- **TypeScript pinned 6.0.3** monorepo-wide: TS 7.0 ships without a stable programmatic API
  until 7.1, which breaks type-aware typescript-eslint. Microsoft's documented side-by-side
  path (`@typescript/typescript6` alias for lint, tsc 7 for builds) is the later upgrade route;
  6.0.x and 7.0 are semantics-identical by design.

## Consequences

Zod schemas live in `core` and are imported by every adapter and the SPA. The July-2026
fresh-major churn (TS 7, Bolt 5, Vitest 5 beta) is handled by exact pins and deliberate
upgrades rather than floating ranges.
