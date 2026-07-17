# Slack Integration

Slack is the third inbound adapter: Bolt listeners contain zero business logic and call the same
core services as REST and MCP, with `Actor { kind: 'slack' }` resolved from the Slack user's
email. Fully implemented and contract-tested without a live workspace (PO decision); connecting
a real workspace is configuration, not code.

## Surfaces

| Surface | Trigger | Why |
| --- | --- | --- |
| **Message shortcut** "Create facilities ticket" (primary) | `message_action` on any message | The only Slack surface that works inside threads and carries `thread_ts`. Custom slash commands *cannot* be invoked in threads (platform limitation) — socialize this early. |
| **@-mention** `@FacilitiesBot create ticket P1 ...` (secondary) | `app_mention` event | Zero-click in-thread creation for power users; replies in-thread with the created card link. |
| `/facilities` (optional) | slash command | Global quick-create with a modal, outside threads only. |

## Message-shortcut flow

1. `ack()` within 3 s, immediately `views.open` a loading modal (the `trigger_id` is short-lived).
2. Fetch the thread: `conversations.replies(channel, thread_ts ?? ts)`.
3. If `SUMMARIZER_ENABLED`: SummarizerPort → Anthropic `claude-haiku-4-5` with **structured
   outputs** → `{ title, description, suggestedPriority, tags[] }`. If disabled or on failure:
   prefill the raw thread text. Either way the human reviews.
4. `views.update` the modal with the prefilled, editable draft (title, description, priority,
   tags, assignee, location).
5. On `view_submission`: `cardService.create(actor, draft)` — card lands in **Intake** with
   `origin: 'slack'`, AI values stored as ordinary draft field values, Slack permalink +
   `{channel, thread_ts}` recorded.
6. Confirm into the thread via `chat.postMessage({ thread_ts })` with the card link.
   (`response_url` cannot target a thread.)

Thread **files are not imported** in v1 (PO-ratified deferral); the permalink preserves access.

## Slack app configuration

- **Socket Mode** (`xapp-` app token + `xoxb-` bot token): outbound WebSocket, no inbound
  endpoint to secure — right shape for a single-node internal tool. The HTTP receiver path is
  retained but disabled.
- `@slack/bolt` pinned **4.7.3** — the floor version containing the request-signature
  verification patch (AIKIDO-2026-10973); v5.0.0 is days old, upgrade deliberately later.
- Scopes: `commands`, `app_mentions:read`, `channels:history`, `groups:history`, `chat:write`,
  `users:read`, `users:read.email` (maps Slack user → reporter by email).
- The bot must be invited to any channel it serves; workspace-admin approval is needed for
  installation and `users:read.email`.

## Notifications (outbound)

`chat.postMessage` DMs are also the first NotifierPort adapter: waiting-lane aging alerts and
Review→Done requester notifications. Users are matched by email; unmatched users simply get no
DM (logged, not fatal). SMTP becomes a second adapter later.

## Summarization & data handling

Thread content is sent to the Anthropic API **only** when `SUMMARIZER_ENABLED=true`. The
invoking user already sees the full content in the review modal, so no information reaches the
ticket unseen. Enabling the flag org-wide should follow a data-handling sign-off; a redaction
step can be inserted in the SummarizerPort adapter if required.

## Testing without a workspace

- **Contract tests**: drive the real Bolt `App` through a ~30-line `TestReceiver`
  (`app.processEvent`) with recorded `message_action`, `app_mention`, and `view_submission`
  fixture payloads; assert the resulting core-service effects (card created in intake with
  origin slack) and the Web API calls the app attempted.
- **Integration tests**: point `WebClient`'s `slackApiUrl` and the Anthropic SDK's `baseURL` at
  local fixture HTTP servers serving recorded JSON — real HTTP, no mocking of our code.
- **Manual smoke test** (dev-only, not CI): one Socket Mode run against a staging workspace
  when credentials arrive.
