# User Guide

## The board

The board shows every open facilities work order as a card in one of seven columns, left to
right: **Intake** (new, being triaged) → **Waiting for Approval** → **Ready** (approved queue)
→ **In Progress** → **Waiting on Parts / Vendor** → **Review** → **Done**. Within a column,
**order matters: the top card is the next one to address.**

Everyone can see everything; by default everyone can also move and edit everything — the
workflow columns describe the process, they don't police it (an admin can turn on enforcement
later if the team wants it).

## Cards

Create a card with **New card** (it lands in Intake) — title, description, priority, optional
location, tags, assignee. Fields:

- **Priority**: P0 (drop everything), P1, P2 — the severity badge. Independent from column
  order, which is the operational "what's next".
- **Estimate**: expected time to execute.
- **Reporter / Assignee**: who asked / who's doing it.
- **Tags**: free-form labels for filtering.
- **Location**: building/floor/room from the site tree (optional).

Click a card to open the **detail panel** (collapsible, from the right; full-screen on
tablets). Everything about the card lives there: all fields (editable in place), attachments,
the comment thread, and the full history.

## Moving cards

Drag cards between columns and up/down within a column. Alternatively — keyboard or touch —
use the card's **⋯ → Move to…** menu to pick a column and position.

- Moving into **Waiting on Parts / Vendor** always asks _why_ (parts, vendor, access, info,
  funding) and _when work should resume_. When that date passes, the assignee gets a Slack
  nudge automatically.
- **Cancelling** is not a drag: use **⋯ → Cancel** and pick a reason (cancelled / declined /
  duplicate). Cancelled cards show at the end of Done with a badge.
- **Blocked** (⋯ → Block, with a reason) flags a card without moving it — the red badge tells
  everyone it needs help wherever it is.
- If someone edited a card while you were dragging it, your change is safely rejected and the
  board refreshes — you'll see a "card was just updated" note; redo your move if it still
  applies.

## Comments

Each card has a discussion thread. Comment at the bottom, or **Reply** on any comment to keep
sub-discussions together. You can edit your own comments; deleted comments leave a
"deleted" placeholder so replies keep their context.

## History

The **History** tab on the card shows every change ever made — status moves, field edits,
comments, attachments, blocks — with who did it (including the Slack bot and AI agents) and
when. Nothing is ever silently changed.

## Attachments

Drop images (photos) or PDFs (quotes, invoices) onto the card panel — up to 25 MB each,
10 per card. Before/after photos of completed work are encouraged and can be added from a
phone/tablet camera roll.

## Done and archived

Cards in Done stay visible for 90 days, then auto-archive. Archived cards remain searchable
and their history intact — use the "include archived" filter.

## Admin settings (admins only)

The gear icon opens the app-wide settings: user accounts and roles, column names and WIP
limits, the location tree, MCP service tokens for AI agents, and the **permissions policy** —
including turning on workflow enforcement (cards must then follow the
Intake → Approval → Ready → … flow, with optional role requirements per step).

See [slack.md](slack.md) for creating tickets from Slack.
