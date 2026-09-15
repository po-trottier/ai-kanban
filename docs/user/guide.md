# User Guide

> **First boot**: when the app has no users yet, it shows a one-time setup page that creates
> the first administrator account, then offers an optional step to add your locations
> (buildings/floors/rooms) — skip it to go straight to the board, or set some up now; either
> way you can add or manage them later in **Settings → Locations**. Afterwards everyone lands
> on the sign-in page as usual.

## The board

The board shows every open facilities work order as a card in one of seven columns, left to
right: **Intake** (new, being triaged) → **Waiting for Approval** → **Ready** (approved queue)
→ **In Progress** → **Waiting on Parts / Vendor** → **Review** → **Done**. Within a column,
**order matters: the top card is the next one to address.**

The header's board selector lists the boards you can access. Each board has its own work orders,
columns, working hours, and waiting reasons. Your role controls which actions you can perform.
The original board remains visible to everyone until an admin restricts it.

### Boards and groups

Everyone can open **Settings → Boards** (or **Board preferences** in the board selector) and
choose **My default board**. This saves immediately for your account across devices. Non-admins
can view their accessible boards and change this preference, but cannot create, edit, or delete boards.
Choose **Use assigned default** to follow administrator defaults. The chosen board opens when
the app starts; changing boards during a session does not change your saved preference.

Admins set **Default board assignments** when creating or editing a board: choose the global
default and/or roles and groups. Each role or group has one default; assigning a new one replaces
its previous choice. Priority is **User → Group → Role → Global**. Groups pointing to the same board
agree; groups pointing to different accessible boards fall back to the role default. Inaccessible
or archived choices are skipped. With no usable configured default, the app opens the first
accessible board. If none are accessible, it asks you to contact an administrator for access.
Defaults never grant board access.

Admins open **Settings → Boards**, or choose **Manage boards** at the bottom of the board selector,
to create, rename, restrict, or delete a board. Choose everyone, or grant access to any combination
of roles, individual users, and groups. A match in any selected category grants visibility;
membership does not grant additional editing or administration permissions.

Use **Settings → Groups** to create a named group and add or remove people. Group membership changes
apply immediately to its boards. Remove a group's board assignments before deleting the group.
Board and group management use the existing `managePolicy` permission; admins with this grant can
access every active board. Roles, users, groups, and locations are shared across the application.

Deleting a board removes it from use while preserving its work orders and history in storage.
The final active board cannot be deleted. New boards start with the standard columns and workflow
settings. Switching boards closes the details panel and resets the current filter selection.

## Cards

Hover over a card's title to read the full title when it is shortened on the board.
Hover over the assignee and reporter filters for a description of what each one matches.

Create a card with **New card** (it lands in Intake) — title, description, priority, optional
location, tags, assignee. Fields:

- **Priority**: P0 (drop everything), P1, P2 — the severity badge. Independent from column
  order, which is the operational "what's next".
- **Estimate**: expected time to execute.
- **Reporter / Assignee**: who asked / who's doing it.
- **Tags**: free-form labels for filtering.
- **Location**: building/floor/room from the site tree (optional).

Click a card to open the **detail panel**. On desktop it docks to the right and can be resized.
On phones and tablets it fills the board area above the columns; close it to return to the same
board position. The header and filters stay accessible. The compact mobile header shows the
logo and action icons; **+** creates a new work order. Everything about the card lives in its
panel: all fields (editable in place), attachments, the comment thread, and the full history.

## Moving cards

Drag cards between columns and up/down within a column. On touch devices, hold a card briefly
before dragging; a quick swipe scrolls the board instead. Hold near an edge while dragging to
scroll toward more columns or cards. Alternatively — keyboard or touch —
use the card's **⋯ → Move to…** menu to pick a column and position. From a card's detail panel
you can also change its column with the **State** dropdown (it drops the card at the bottom of
the chosen column).

- Moving into **Waiting on Parts / Vendor** always asks _why_ (from the configured waiting
  reasons) and _when work should resume_. When that date passes, the assignee gets a Slack
  nudge automatically. To change the reason or push the resume date out later, open the card
  and edit them right in the yellow **Waiting** banner, then **Save** — no need to move the
  card off the board.
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

Cards in Done stay visible until they are archived. To clear a finished card off the board
right away, open its **⋯** menu and choose **Archive** — you'll see a "Card archived"
confirmation. Anything you don't archive by hand auto-archives 90 days after reaching Done.
Archived cards remain searchable and their history intact — use the "include archived" filter —
and you can bring one back at any time with **Reopen**.

## Admin settings (admins only)

The gear icon opens the app-wide settings: user accounts and roles, column names and WIP
limits, the location tree, MCP service tokens for AI agents, and the **permissions policy** —
including turning on workflow enforcement (cards must then follow the
Intake → Approval → Ready → … flow, with optional role requirements per step).

See [slack.md](slack.md) for creating tickets from Slack.

### Waiting reasons

Open **Settings → Waiting reasons** to add a reason, edit its name, or remove it with the trash
icon, then choose **Save reasons**. The defaults are **Parts**, **Vendor**, **Access**,
**Information**, and **Funding**. Names must be unique and contain 1–80 characters. Keep at least
one reason; add a replacement before removing the last one. This tab requires `managePolicy`,
which administrators have by default.

Renaming updates the displayed name on existing cards. Removing hides the reason from new
selections without changing cards already using it or erasing history. Those cards can still
have their resume date edited, or be cancelled and reopened. After changing away from a removed
reason, it cannot be selected again (including by undoing a move into Waiting).
