# ADR-010: MCP on @modelcontextprotocol/sdk 1.29.x via a raw Fastify mount

**Status**: accepted (2026-07-16)

## Context

(Verified July 2026.) The MCP spec revision scheduled for final publication on 2026-07-28
(RC locked 2026-05-21) changes Streamable HTTP (GET stream endpoint and protocol-level
sessions removed, SEP-2567). The TypeScript SDK v2
(`@modelcontextprotocol/server` package split) is **beta with no announced stable date**; SDK
1.29.0 is the stable line, officially supported ≥ 6 months post-v2. The third-party
`fastify-mcp-server` plugin is stale (no publish since 2025-12).

## Decision

- Pin **@modelcontextprotocol/sdk 1.29.x** (exact), Streamable HTTP transport in **stateless
  mode** (`sessionIdGenerator: undefined` — one transport per request, POST-only, matching
  SEP-2567's direction; clients needing notifications poll).
- Mount at `POST /mcp` with a **hand-written ~50-line raw mount** on Fastify (no third-party
  wrapper): translate Fastify's raw req/res to the SDK transport, attach the authenticated
  `Actor`, delegate.
- Migrate to SDK v2 and its official `createMcpHandler` Fastify adapter **when v2 is stable**.
  The mount file and tool-registration glue are the entire expected blast radius — tool
  handlers themselves only call core services and don't touch the transport.

## Consequences

We own 50 lines of transport glue instead of depending on an unmaintained wrapper. A tracked
follow-up exists for the v2 migration; MCP e2e tests (SDK client, in-process) gate it.
