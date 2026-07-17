# Product Vision

## Purpose

A web-based kanban board for a facilities team to manage work orders (repairs, installations,
vendor jobs, inspections). Humans work the board through a drag-and-drop web UI and through
Slack; AI agents work the same data through an MCP server to produce summaries, prioritization
advice, and follow-up nudges.

## Goals

1. **One queue of truth** — every facilities work order is a card on one board, in exactly one
   lane, with a meaningful top-to-bottom order (top = address first).
2. **Full accountability** — every state change, field change, comment, attachment, and reorder
   is recorded in an append-only audit trail, regardless of whether a human (web/Slack) or an AI
   agent (MCP) made the change.
3. **AI-ready by construction** — the MCP server is a first-class consumer of the same service
   layer as the REST API. Anything a human can see, an agent can see; agents write through
   task-shaped tools covering creation, edits, moves, and comments — terminal actions
   (cancel/reopen) are deliberately human-only in v1 (see
   [mcp.md](../architecture/mcp.md)).
4. **Slack-native intake** — a ticket can be created from any Slack thread via a message
   shortcut or bot @-mention, with optional AI summarization of the thread into a draft ticket
   that the invoker reviews before creation.
5. **Production-ready design** — SQLite today, but no hard dependency on it; every
   infrastructure choice sits behind a port so Postgres, S3, SMTP, and SSO swap in without
   touching business logic.

## Non-goals (v1)

| Deferred                                           | Why                                     | Door left open by                                                     |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| Preventive/recurring maintenance schedules         | Large scope step toward a full CMMS     | `origin` field reserves `pm`; in-process scheduler exists             |
| Asset registry (equipment tags, per-asset history) | Scope step-change                       | optional `location_id` dimension already normalized                   |
| Multiple boards                                    | Single facilities team                  | cards already reference `board_id`                                    |
| Corporate SSO (OIDC)                               | Pilot uses local accounts               | auth behind a port; session design unchanged by OIDC                  |
| High availability / multi-instance                 | Single-node is fine for the pilot scale | EventBus/scheduler/DB behind ports; Postgres migration is the trigger |
| i18n                                               | Internal English-speaking team          | UI strings centralized; lane labels are seeded data                   |
| CSV import of incumbent work orders                | No incumbent system identified          | `origin` field reserves `import`                                      |
| Email notifications                                | Slack DMs cover the pilot               | NotifierPort; SMTP is a second adapter                                |
| Slack thread file import                           | Enlarges data-handling surface          | stored Slack permalink preserves access                               |

## Personas

- **Requester** — any employee reporting an issue. Creates cards (they land in Intake), comments,
  watches progress, gets notified on close.
- **Technician** — executes work. Pulls from Ready, moves cards through execution lanes, logs
  estimates, flags blocks, attaches photos.
- **Supervisor** — owns the queue. Triages Intake, approves work, sets priority and order,
  verifies completed work (Review → Done), cancels.
- **Admin** — manages users, locations, lane labels, MCP service tokens, and configuration.
- **AI agent** — connects via MCP with a service token (`read` or `read_write` scope). Sees the
  full board like any authenticated actor; writes (comments, triage suggestions) are audited
  like any other actor and subject to the same configurable policy gates.

## v1 scope decisions (product-owner record, 2026-07-16)

| Decision                | Choice                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication          | Local accounts (email + password), OIDC-ready design                                                                                                                                                                                                |
| Approval policy         | The seeded workflow graph routes **all** work through Waiting for Approval (no Intake → Ready shortcut when transition enforcement is enabled)                                                                                                      |
| Permissions             | **Permissive by default** — any authenticated user can move/edit any card; transition enforcement and role gates are opt-in, admin-configurable policy ([ADR-013](../architecture/decisions/ADR-013-configurable-permissions.md))                   |
| Admin view              | App-wide settings UI: users, lane labels/WIP limits, permission policy, locations, service tokens                                                                                                                                                   |
| Board shape             | 7 lanes (see [workflow.md](workflow.md)), single board                                                                                                                                                                                              |
| Slack integration       | Fully implemented and contract-tested in CI without a live workspace; credentials connected later                                                                                                                                                   |
| AI thread summarization | Implemented, enabled per-deployment by config flag; **provider-agnostic** — Anthropic/OpenAI/Gemini/NVIDIA or any OpenAI-compatible endpoint by configuration (default `anthropic`/`claude-haiku-4-5`); invoker always reviews the draft in a modal |
| Deployment              | Single-node Docker Compose; SQLite (WAL) + Litestream backups                                                                                                                                                                                       |
| Attachments             | Images + PDF, 25 MB/file, 10 files/card, local blob volume behind a port                                                                                                                                                                            |
| Location                | Optional per card, from a seeded building/floor/room tree                                                                                                                                                                                           |
| Review → Done           | Requester auto-notified with reopen path; supervisor gate available via policy, off by default                                                                                                                                                      |
| Slack-created tickets   | Always land in Intake; the invoker reviews/edits AI-suggested values in the modal, after which they are stored as ordinary card fields                                                                                                              |
| Done-card archival      | Auto-archive off the board after 90 days; retained and queryable                                                                                                                                                                                    |

## Non-functional requirements

- **Security**: OWASP-aware throughout — argon2id password hashing, server-side sessions,
  strict input validation on every route, parameterized queries only, rate limiting, MIME-verified
  uploads, secrets only via environment. See [security.md](../architecture/security.md).
- **Scale**: 100+ concurrent users on a single node. Kanban traffic is read-dominant; SSE keeps
  polling off the write path; SQLite WAL handles the write rate with a single Node process.
- **Quality**: every rule in [dev/standards.md](../dev/standards.md) and
  [dev/testing.md](../dev/testing.md) is machine-enforced in CI, not advisory.
