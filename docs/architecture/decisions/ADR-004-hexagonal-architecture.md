# ADR-004: Hexagonal architecture — one framework-free core, three thin inbound adapters

**Status**: accepted (2026-07-16); service roster amended by
[ADR-015](ADR-015-core-service-roster.md)

## Context

Three consumer surfaces (REST, MCP, Slack) must behave identically: same rules, same permission
policy, same audit trail. Storage, blob store, LLM, Slack client, clock, ids, notifications, and event bus
must all be swappable (SQLite→Postgres, disk→S3, none→SMTP, local→OIDC).

## Decision

Ports-and-adapters:

- `packages/core` holds entities, Zod schemas, the policy engine (configurable permissions +
  opt-in transition rules — see ADR-013),
  services (CardService, CommentService, BoardQueryService, AttachmentService) — plus
  PolicyService, WatchService, NotificationService, and CardRelationService,
  and **ports** (interfaces): CardRepository, CommentRepository, UserRepository, UnitOfWork,
  EventBus, Clock, IdGenerator, BlobStorePort, SummarizerPort, NotifierPort. (Outbound Slack
  needs no dedicated port beyond NotifierPort: the SlackNotifier adapter consumes the Slack
  SDK directly — the DM flow is lookup-and-bind plus post, not a reusable client surface.)
  Core imports no framework or IO library — enforced by dependency-cruiser.
- Inbound adapters (REST routes, MCP tool handlers, Bolt listeners) translate protocol ↔
  service calls and construct an `Actor`; they contain no business logic. "Thin" is reviewable:
  an adapter that branches on domain state is a rule violation.
- Outbound adapters implement ports: Drizzle repositories (db package), local-disk blob store,
  the `openai`-SDK summarizer over any OpenAI-compatible endpoint (ADR-017), Slack WebClient,
  croner scheduler, in-process EventBus.
- `packages/server` is the composition root: it wires adapters to ports and owns startup order.

## Consequences

Unit tests exercise services against in-memory port fakes (hand-written, not mocking-library
constructs). Every infrastructure swap named in the requirements is a new adapter, not a core
change. The cost — interface indirection — is accepted as the price of the swap guarantees and
of the three-surface identical-behavior requirement.
