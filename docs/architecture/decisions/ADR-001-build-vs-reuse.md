# ADR-001: Build custom with mature libraries; do not fork an OSS kanban tool

**Status**: accepted (2026-07-16)

## Context

Strong preference existed for adopting an open-source kanban tool. Seven candidates were
evaluated against the four hard requirements: (1) REST + MCP sharing one service layer,
(2) per-field audit trail, (3) threaded comments, (4) Slack thread → AI-summarized ticket.

## Decision

Build a custom application; reuse mature libraries for every commodity concern (drag-and-drop,
ORM, MCP SDK, Slack SDK, backup tooling).

## Findings (verified against primary sources, July 2026)

| Candidate  | Disqualifier                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| Focalboard | Unmaintained — repo states it; open call for maintainers since 2024                          |
| Planka     | Postgres-only (fails SQLite-now); fair-code license (non-OSI); flat comments; no field audit |
| Kanboard   | Maintenance mode; JSON-RPC-only PHP; UI would be replaced wholesale anyway                   |
| Vikunja    | No custom fields (open request); flat comments; audit logging paywalled                      |
| Plane      | Audit logs and Slack behind commercial editions; heavy infra (PG+Redis+RabbitMQ+MinIO)       |
| WeKan      | Meteor + MongoDB — fails DB-portability outright                                             |
| Taiga      | Postgres-only, scrum-suite heavy, Django/Angular                                             |

No candidate provides _any_ of the four hard requirements; each provides exactly the commodity
parts (board CRUD, drag UI) that libraries make cheap. Adopting one still means building all
four hard features inside a foreign codebase plus a permanent fork burden.

## Consequences

We own more code but every line serves a requirement; the quality bar (TDD, no-mock
integration tests, enforced architecture) is achievable because we control the codebase.
Domain-model ideas (priority/estimate/position semantics) are borrowed from Kanboard's schema,
not its code.
