# ADR-019: Per-user display time zone

## Status

Accepted.

## Context

Timestamps were rendered in whatever time zone the viewer's browser happened to
be in (dayjs with no zone = machine-local), and the work-progress burn-down
counted business hours in **UTC**. Neither is a real user setting: two people on
the same machine can't differ, and a UTC 09:00–17:00 "business day" is 7–8 hours
off the wall clock for a Pacific-coast facilities team.

The product ask was a **per-user time zone**, defaulting to PST, ideally
auto-detected.

## Decision

Store an IANA time-zone id on the user (`users.timezone`, `TEXT NOT NULL DEFAULT
'America/Los_Angeles'`) as a required field on the single `userSchema` — no
optional/nullable legacy field. It is:

- **Auto-detected at signup** — the web setup form pre-fills
  `Intl.DateTimeFormat().resolvedOptions().timeZone` (falling back to PST if the
  detected value isn't a zone the runtime recognizes) and POSTs it with `/setup`.
  Admin- and CLI-created accounts default to PST; the user re-picks their own
  from **Preferences** (the avatar-menu item, reachable by every role — unlike
  the admin-only Settings page) which `PATCH /auth/me`.
- **Validated at the trust boundary** — `timezoneSchema` refines against
  `Intl.supportedValuesOf('timeZone')`, so a hand-crafted API body can't slip an
  unknown zone through to `dayjs.tz`, which would throw on every render.

### Scope — what follows the viewer's zone, and what deliberately does not

- **Interactive timestamp display** (card created, comment/history times, token
  last-used) → the viewer's zone, via the single `format.ts` choke point
  (dayjs `utc`+`timezone` plugins).
- **The work-progress burn-down** → the viewer's zone: business hours are each
  person's local 09:00–17:00, and building the windows with `dayjs.tz` also gets
  DST transitions right (a local business day is 7 h or 9 h of real time across a
  shift, not always 8).
- **Calendar dates** (the waiting-lane resume cue, `expectedResumeAt`, a
  `YYYY-MM-DD` with no time) → rendered **as-is**, NOT zone-converted: a calendar
  date has no zone, and converting it would shift the day for some viewers.
- **The overdue-resume date rule stays a global UTC business rule** (core
  `dates.ts` `isOverdueResume` / `utcDayOf`). It is shared by the web OVERDUE
  badge, the `overdueResume` search facet, and the server-side aging alerts;
  making only the web side per-viewer would let the badge and the server filter
  disagree by a day near midnight. Interactive rendering is per-user; this
  organization-wide business rule is not.

## Consequences

- One migration column + a required `userSchema` field; the DB default backfills
  existing rows to PST, and every User-construction site sets it explicitly.
- `PATCH /auth/me` is a new self-service surface: a `strictObject` of only
  `timezone`, writing the caller's own row (id from the session, never a path
  param), no `ensureAdmin`, no session revocation — so it can't escalate
  privilege or be used for IDOR (see rest-api.md and the auth audit).
- The timezone lives on the `['me']` user in `SessionContext`; a `useUserTimezone()`
  hook is the single source every date render reads, so login/logout/change keep
  it correct with no second store.
- Rendered output now changes with the user's setting rather than the CI/host
  machine's zone — the date helpers take an explicit zone, which is strictly
  more deterministic than the previous machine-local behavior.
