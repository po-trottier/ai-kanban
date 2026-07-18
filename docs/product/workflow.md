# Workflow: Lanes, Transitions, and Policies

The lane set was derived from how CMMS/work-order systems (UpKeep, MaintainX, Brightly,
Facilitron, Maintenance Connection) model work-order lifecycles, adapted to kanban practice.
Lanes are **seeded data rows** with stable machine keys and editable display labels — never a DB
enum — so renames need no migration and the audit trail stays queryable.

## Lanes (in board order)

| #   | Key                    | Default label             | Meaning                                                                                                                                                    |
| --- | ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `intake`               | Intake                    | Freshly reported work awaiting human triage: validate, dedupe, classify, set priority, set location.                                                       |
| 2   | `waiting_approval`     | Waiting for Approval      | Triaged work gated on sign-off. The seeded workflow graph routes **every** card through here — there is no Intake → Ready shortcut when enforcement is on. |
| 3   | `ready`                | Ready                     | Approved, prioritized queue. Vertical order is the execution order: top = address first.                                                                   |
| 4   | `in_progress`          | In Progress               | Technician or vendor actively performing the work. WIP-limited.                                                                                            |
| 5   | `waiting_parts_vendor` | Waiting on Parts / Vendor | Paused on a structural external dependency. Entry **requires** a waiting reason and an expected-resume date.                                               |
| 6   | `review`               | Review                    | Physical work done; awaiting verification and close-out documentation.                                                                                     |
| 7   | `done`                 | Done                      | Terminal: verified, fully documented, permanent history.                                                                                                   |

**Cancelled is a terminal status, not a lane.** Cancelling is an explicit card action (never a
drag target). See [Terminal states](#terminal-states) for the exact semantics.

## Terminal states

- **Cancel** (any non-terminal card): moves the card to the `done` lane at the **bottom**, sets
  `resolution` to `cancelled | declined | duplicate`, bumps `version`, and emits a single
  `card.cancelled` event (no `card.status_changed`). Cancelled cards render with a badge and
  are excluded from throughput metrics. No requester notification is sent on cancellation.
- **Completion**: any non-cancel entry into the `done` lane sets `resolution = 'completed'`
  (system-set — clients never write `completed`) and notifies the requester by Slack DM,
  regardless of which lane the card came from.
- **Reopen** (any card in `done`, including cancelled and archived): clears `resolution` and
  `archived_at`, emits `card.reopened`, and places the card at the **bottom** of Ready.
  Dragging a non-archived card out of `done` is reopen semantics too: it consults the same
  `reopen` action gate and clears `resolution`, but honors the drag's target lane/position and
  is recorded as an ordinary `card.status_changed` event. Archived cards can only be reopened
  through the explicit action.
- **Archival**: applies to every card in `done` (completed or cancelled) 90 days after entering
  it. Archived cards are **read-only except reopen**; any other mutation returns
  `409` (`card-archived`).

## Movement policy: permissive by default

**By default, any authenticated user can move any card to any lane and reorder freely** — the
team is trusted to follow the process socially (product-owner decision, 2026-07-16). Hierarchy
is _supported, not imposed_: an admin can turn on **transition enforcement** in the app-wide
settings view, which activates the seeded workflow graph below and (optionally) per-transition
role gates. See [ADR-013](../architecture/decisions/ADR-013-configurable-permissions.md).

Two kinds of rules apply regardless of the policy setting, because they are data integrity, not
hierarchy:

- Entering `waiting_parts_vendor` always requires `waiting_reason` + `expected_resume_at`.
- Cancelling is always an explicit action (never a drag), and terminal fields (`resolution`)
  are only writable through it.

## Seeded workflow graph (active when transition enforcement is on)

| From                 | To                   | Suggested role gate | Notes                                        |
| -------------------- | -------------------- | ------------------- | -------------------------------------------- |
| intake               | waiting_approval     | —                   | Triage complete                              |
| waiting_approval     | ready                | admin               | Approval                                     |
| waiting_approval     | intake               | —                   | Send back for more triage                    |
| ready                | in_progress          | —                   | Work starts                                  |
| in_progress          | ready                | —                   | Deprioritized / handed back                  |
| in_progress          | waiting_parts_vendor | —                   |                                              |
| waiting_parts_vendor | in_progress          | —                   | Dependency resolved                          |
| in_progress          | review               | —                   | Work physically complete                     |
| review               | done                 | admin               | Verification + close-out; requester notified |
| review               | in_progress          | —                   | Failed verification / rework                 |
| done                 | ready                | admin               | Reopen                                       |

Role gates are per-transition and individually configurable; the "suggested" column is what the
seeded graph proposes when an admin flips enforcement on, not a default restriction. With
enforcement on, drag-and-drop offers only legal targets for the current user, and the server
re-validates every move regardless of what the UI allowed.

## Blocked flag (any lane)

Exceptional impediments do **not** get a lane (a generic Blocked column is a documented kanban
anti-pattern: it loses the context of where work stalled and distorts cycle time). Instead any
card can carry a blocked flag: `blocked` + free-text reason + timestamp. The card stays in its
lane, counts against that lane's WIP, and renders with a prominent badge. Block/unblock are
audit events, so time-blocked is queryable per card and per lane.

Distinction from `waiting_parts_vendor`: the lane models a _normal, expected_ stage of facilities
work (parts on order, vendor lead time) with its own WIP limit and aging alerts; the flag models
_exceptions_ anywhere.

## Waiting on Parts / Vendor discipline

To keep the lane from becoming a black hole:

- Entry requires `waiting_reason` ∈ `parts | vendor | access | info | funding` and
  `expected_resume_at` (a date, `YYYY-MM-DD`; a card counts as overdue starting the following
  UTC day).
- On any move **out** of the lane, both fields are cleared inside the move transaction
  (recorded in the `card.status_changed` payload, not as separate field events); re-entry
  requires fresh values. Staleness queries therefore only ever match cards currently waiting.
- Both fields are **editable in place** while the card sits in the lane (via `PATCH /cards/:id`,
  surfaced by the waiting banner on the card panel): correct the reason or push the expected
  resume date out without moving the card off the board. Each change is a `card.field_changed`
  audit event. Editing the date clears `resume_alerted_at` so the hourly overdue alert re-arms
  for the new date and the episode is not double-fired.
- A scheduled job sends one Slack DM per overdue episode (tracked via `resume_alerted_at`,
  cleared on lane exit or on an in-place date edit) to the assignee (if any) and to all active
  users with the admin role (the system automation user is excluded).
- The lane has its own seeded WIP limit.

## WIP limits

Each lane has an optional numeric WIP limit (seeded: In Progress, Waiting on Parts / Vendor,
and Review get limits; others null). Limits are **soft** in v1: exceeding one highlights the
lane header, it does not reject the move. When a move pushes the destination lane over its
limit, the `card.status_changed` event carries `wipLimitExceeded: true` so agents can report on
it (within-lane reorders never change lane counts and never carry it).

## Ordering

Within a lane, order is a persisted, meaningful ranking (top = first). Cards carry a fractional
position key; moving a card sends only its intended neighbors and the server computes the new
key transactionally (see [ADR-006](../architecture/decisions/ADR-006-fractional-ordering.md)).
Reordering is open to everyone by default (a policy gate for the Ready lane is available);
reorders are distinct audit events (`card.reordered`) so they never pollute status-change
history.

## Priorities and estimates

- `priority` ∈ `P0 | P1 | P2` (P0 = drop everything). Priority is set at triage and is
  independent of order — order is the operational sequence, priority is the severity signal.
  The UI badges P0 cards; agents may flag order/priority mismatches.
- `estimate_minutes` — integer minutes, rendered in the UI as hours/days with 1 day = 8 working
  hours (90 → "1.5h", 960 → "2d"). Optional until the card reaches Ready; the approval step
  nags for it.

## Archival

Done cards (completed and cancelled) can be archived (`archived_at` set) two ways:

- **Manually**, from the card's ⋯ menu (`POST /cards/:id/archive`) — the primary path for a
  team that wants to clear a finished job off the board immediately. Allowed only for a card
  currently in Done (409 otherwise); emits a `card.archived` audit event (actor = the user).
  A permissive-by-default `archive` policy gate can restrict it to a minimum role.
- **Automatically**, as a backstop: the daily `doneArchival` job archives every Done card 90
  days after it entered Done, so nothing lingers if no one archives it by hand.

Archived cards leave the board query but remain in the database, the audit trail, and MCP/REST
history queries; they still surface in Search under **Include archived**. They are read-only
except reopen — which clears `archived_at` and returns the card to Ready (see
[Terminal states](#terminal-states)).
