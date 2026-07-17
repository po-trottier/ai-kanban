# Workflow: Lanes, Transitions, and Policies

The lane set was derived from how CMMS/work-order systems (UpKeep, MaintainX, Brightly,
Facilitron, Maintenance Connection) model work-order lifecycles, adapted to kanban practice.
Lanes are **seeded data rows** with stable machine keys and editable display labels — never a DB
enum — so renames need no migration and the audit trail stays queryable.

## Lanes (in board order)

| # | Key | Default label | Meaning |
| --- | --- | --- | --- |
| 1 | `intake` | Intake | Freshly reported work awaiting human triage: validate, dedupe, classify, set priority, set location. |
| 2 | `waiting_approval` | Waiting for Approval | Triaged work gated on supervisor sign-off. **Every** card passes through here (product-owner decision — no skip). |
| 3 | `ready` | Ready | Approved, prioritized queue. Vertical order is the execution order: top = address first. |
| 4 | `in_progress` | In Progress | Technician or vendor actively performing the work. WIP-limited. |
| 5 | `waiting_parts_vendor` | Waiting on Parts / Vendor | Paused on a structural external dependency. Entry **requires** a waiting reason and an expected-resume date. |
| 6 | `review` | Review | Physical work done; awaiting verification and close-out documentation. |
| 7 | `done` | Done | Terminal: verified, fully documented, permanent history. |

**Cancelled is a terminal status, not a lane.** Cancelling is an explicit card action (never a
drag target) that sets `resolution` to `cancelled`, `declined`, or `duplicate`. Cancelled cards
render at the end of Done with a badge and are excluded from throughput metrics.

## Transition matrix

Enforced by the service-layer policy module for every actor (web, MCP, Slack). Any transition
not listed is rejected.

| From | To | Minimum role | Notes |
| --- | --- | --- | --- |
| intake | waiting_approval | technician | Triage complete |
| waiting_approval | ready | supervisor | Approval |
| waiting_approval | intake | technician | Send back for more triage |
| ready | in_progress | technician | Work starts |
| in_progress | ready | technician | Deprioritized / handed back |
| in_progress | waiting_parts_vendor | technician | Requires `waiting_reason` + `expected_resume_at` |
| waiting_parts_vendor | in_progress | technician | Dependency resolved |
| in_progress | review | technician | Work physically complete |
| review | done | **supervisor** | Verification + close-out; requester notified |
| review | in_progress | technician | Failed verification / rework |
| done | ready | supervisor | Reopen |
| *any non-terminal* | *(cancel action)* | supervisor | Sets `resolution`; requesters may cancel their own card while it is in intake or waiting_approval |

Drag-and-drop in the UI offers only the legal targets for the current user's role; the server
re-validates every move regardless.

## Blocked flag (any lane)

Exceptional impediments do **not** get a lane (a generic Blocked column is a documented kanban
anti-pattern: it loses the context of where work stalled and distorts cycle time). Instead any
card can carry a blocked flag: `blocked` + free-text reason + timestamp. The card stays in its
lane, counts against that lane's WIP, and renders with a prominent badge. Block/unblock are
audit events, so time-blocked is queryable per card and per lane.

Distinction from `waiting_parts_vendor`: the lane models a *normal, expected* stage of facilities
work (parts on order, vendor lead time) with its own WIP limit and aging alerts; the flag models
*exceptions* anywhere.

## Waiting on Parts / Vendor discipline

To keep the lane from becoming a black hole:

- Entry requires `waiting_reason` ∈ `parts | vendor | access | info | funding` and
  `expected_resume_at` (date).
- A scheduled job alerts (Slack DM to assignee + supervisor) when `expected_resume_at` passes
  without the card moving.
- The lane has its own WIP limit.

## WIP limits

Each lane has an optional numeric WIP limit (seeded: In Progress and Review get limits; others
null). Limits are **soft** in v1: exceeding one highlights the lane header, it does not reject
the move. The service layer records limit-exceeded state on the move's audit event so agents can
report on it.

## Ordering

Within a lane, order is a persisted, meaningful ranking (top = first). Cards carry a fractional
position key; moving a card sends only its intended neighbors and the server computes the new
key transactionally (see [ADR-006](../architecture/decisions/ADR-006-fractional-ordering.md)).
Reordering Ready is restricted to supervisors; reorders are distinct audit events
(`card.reordered`) so they never pollute status-change history.

## Priorities and estimates

- `priority` ∈ `P0 | P1 | P2` (P0 = drop everything). Priority is set at triage and is
  independent of order — order is the operational sequence, priority is the severity signal.
  The UI badges P0 cards; agents may flag order/priority mismatches.
- `estimate_minutes` — integer minutes, rendered as hours/days in the UI. Optional until the
  card reaches Ready; the approval step nags for it.

## Archival

Done cards auto-archive (`archived_at` set) 90 days after entering Done. Archived cards leave
the board query but remain in the database, the audit trail, and MCP/REST history queries.
