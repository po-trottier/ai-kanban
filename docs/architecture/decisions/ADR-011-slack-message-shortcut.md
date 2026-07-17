# ADR-011: Slack thread capture via message shortcut (+ @-mention), not a slash command

**Status**: accepted (2026-07-16)

## Context

Requirement: "in a Slack thread about a job, invoke the bot to create a ticket from the thread."
Slack platform facts (verified against Slack docs, July 2026): custom slash commands **cannot be
invoked inside threads** and carry no `thread_ts`; `response_url` from a threaded interaction
cannot post into the thread; `trigger_id` is short-lived and interactions must be ack'd < 3 s.

## Decision

- **Primary**: message shortcut ("Create facilities ticket") — the only surface that works in
  threads and carries `thread_ts`. Flow: ack → loading modal → fetch `conversations.replies` →
  optional AI summary → editable draft modal → create on submit → confirm in-thread via
  `chat.postMessage({ thread_ts })`.
- **Secondary**: `app_mention` for zero-click creation (grammar in slack.md; the summarizer
  never runs on this path — no review step exists, so no AI output is created).
- No slash command: they cannot run in threads, and out-of-thread quick creation is the web
  UI's job. No HTTP receiver is wired — Socket Mode only (no inbound endpoint), matching the
  single-node internal deployment.
- `@slack/bolt` pinned **4.7.3** — the request-signature-verification security-patch floor
  (AIKIDO-2026-10973); Bolt 5.0.0 (days old) is a deliberate later upgrade.

## Consequences

Users must learn the shortcut lives in the message ⋮ menu (documented in the user guide).
Slack-created tickets always land in Intake (PO decision) — the AI never injects work into the
prioritized queue. After the invoker reviews/edits the modal, values are stored as ordinary
card fields; nothing marks them as AI-suggested — the triager sees them as the card's initial
priority/tags.
