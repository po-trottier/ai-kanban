# Slack Integration

Slack is the third inbound adapter: Bolt listeners contain zero business logic and call the same
core services as REST and MCP, with `Actor { kind: 'slack' }` resolved from the Slack user's
email. Fully implemented and contract-tested without a live workspace (PO decision); connecting
a real workspace is configuration, not code.

## Surfaces

| Surface                                                         | Trigger                         | Why                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message shortcut** "Create facilities ticket" (primary)       | `message_action` on any message | The only Slack surface that works inside threads and carries `thread_ts`. Custom slash commands _cannot_ be invoked in threads (platform limitation) — socialize this early. |
| **@-mention** `@FacilitiesBot create ticket P1 ...` (secondary) | `app_mention` event             | Zero-click in-thread creation for power users; replies in-thread with the created card link.                                                                                 |

Two surfaces exactly match the requirement; there is deliberately no slash command (it cannot
work in threads, and out-of-thread quick creation is the web UI's job).

## Message-shortcut flow

1. `ack()` within 3 s, immediately `views.open` a loading modal (the `trigger_id` is short-lived).
2. Fetch the thread: `conversations.replies(channel, thread_ts ?? ts)`.
3. If `SUMMARIZER_ENABLED`: SummarizerPort → the **configured LLM provider** with
   schema-constrained structured output → `{ title, description, suggestedPriority, tags[] }`.
   If disabled or on failure: prefill the raw thread text. Either way the human reviews.
4. `views.update` the modal with the prefilled, editable draft (title, description, priority,
   tags, assignee, location).
5. On `view_submission`: `cardService.create(actor, draft)` — card lands in **Intake** with
   `origin: 'slack'`, AI values stored as ordinary draft field values, Slack permalink +
   `{channel, thread_ts}` recorded.
6. Confirm into the thread via `chat.postMessage({ thread_ts })` with the card link.
   (`response_url` cannot target a thread.)

Thread **files are not imported** in v1 (PO-ratified deferral); the permalink preserves access.

## @-mention grammar

Mention text must match `create ticket [P0|P1|P2] <title>` (case-insensitive). Priority
defaults to `P2`; the remaining text becomes the title (truncated to 200 chars); the raw thread
text becomes the description. **The summarizer never runs on this path** — there is no review
step, and the "human always reviews AI output" invariant holds because no AI output exists
here. Non-matching mentions get an in-thread usage hint; a mention outside a thread captures
just that message.

## Delivery semantics & abuse controls

- Socket Mode redelivers unacknowledged events: listeners `ack()` immediately and the adapter
  dedupes on Slack's event id, so redelivery cannot double-create tickets (modal
  `view_submission` is effectively once-only anyway).
- HTTP rate limiting does not cover Socket Mode, so the Bolt adapter enforces its own
  throttles as the compensating control: per-Slack-user card creation (10/min) and summarizer
  invocations (5/min per user, plus a global budget when `SUMMARIZER_ENABLED`), with a
  friendly in-thread rejection beyond them.

## Slack app configuration

- **Socket Mode** (`xapp-` app token + `xoxb-` bot token): outbound WebSocket, no inbound
  endpoint to secure — right shape for a single-node internal tool. No HTTP receiver is wired;
  adding one later is a deliberate configuration change with its own security review.
- `@slack/bolt` pinned **4.7.3** — the floor version containing the request-signature
  verification patch (AIKIDO-2026-10973); v5.0.0 is days old, upgrade deliberately later.
- Scopes: `app_mentions:read`, `channels:history`, `groups:history`, `chat:write`,
  `users:read`, `users:read.email` (maps Slack user → reporter by email).
- The expected workspace `team_id` is pinned in config (`SLACK_TEAM_ID`); events from any other
  workspace are rejected.
- The bot must be invited to any channel it serves; workspace-admin approval is needed for
  installation and `users:read.email`.

## Identity mapping

The acting Slack user is resolved to a board user by verified email **once**, on first use;
the binding (`users.slack_user_id`) is logged, and subsequent events match on the stored id —
never re-resolved by email (guards against corporate email reassignment). The resolved user
must have `is_active = 1`; deactivated users are rejected via Slack too, with the same
friendly "ask an admin" message shown to unknown users.

## Notifications (outbound)

`chat.postMessage` DMs are also the first NotifierPort adapter: waiting-lane aging alerts and
Review→Done requester notifications. Users are matched by email; unmatched users simply get no
DM (logged, not fatal). SMTP becomes a second adapter later.

## Summarization & data handling

The summarizer is **provider-agnostic by requirement** (product-owner direction, 2026-07-16):
the SummarizerPort adapter must make the concrete LLM a pure configuration choice — Anthropic,
OpenAI, Google Gemini, NVIDIA (build.nvidia.com), or any OpenAI-compatible endpoint — via
`SUMMARIZER_PROVIDER`, `SUMMARIZER_MODEL`, `SUMMARIZER_API_KEY`, and `SUMMARIZER_BASE_URL`
(for compatible/self-hosted endpoints). The default remains `anthropic` /
`claude-haiku-4-5` (the PO-approved cost/quality pick), but swapping models must never touch
code outside the adapter and its config. The concrete abstraction library vs hand-rolled
multi-adapter decision is recorded in its own ADR at implementation time.

Thread content is sent to the configured provider **only** when `SUMMARIZER_ENABLED=true`. The
invoking user already sees the full content in the review modal, so no information reaches the
ticket unseen. Enabling the flag org-wide should follow a data-handling sign-off (per
provider); a redaction step can be inserted in the SummarizerPort adapter if required.

## Testing without a workspace

- **Contract tests**: drive the real Bolt `App` through a ~30-line `TestReceiver`
  (`app.processEvent`) with recorded `message_action`, `app_mention`, and `view_submission`
  fixture payloads; assert the resulting core-service effects (card created in intake with
  origin slack) and the Web API calls the app attempted.
- **Integration tests**: point `WebClient`'s `slackApiUrl` and the summarizer provider's
  `baseURL` at local fixture HTTP servers serving recorded JSON — real HTTP, no mocking of our
  code; the provider-swap config is itself exercised by running the same test against two
  fixture providers.
- **Manual smoke test** (dev-only, not CI): one Socket Mode run against a staging workspace
  when credentials arrive.
