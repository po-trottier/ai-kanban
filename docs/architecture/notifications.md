# Notifications & watching

Users stay informed about the cards they care about through a **watch** subscription model plus an
in-app **notification inbox**, and can pull colleagues in with **@-mentions** in comments. This
document is the human-first spec. It is built up in layers — this section covers **watching** (the
foundation: who gets notified about a card); the notification inbox and @-mentions build on it.

## Watching a card

A **watch** is a per-user-per-card subscription: while a user watches a card, its changes reach their
notifications. Watching is deliberately low-ceremony — a single toggle in the card detail panel — and
the row's PRESENCE is the whole state (no "muted" middle ground).

### Who watches, and when

- **Auto-watch on create.** The **reporter** and (if set) the **assignee** of a new card watch it by
  default — the two people most likely to care.
- **Auto-watch on assignment.** When a card is (re)assigned, the **new assignee** starts watching.
  Reassigning away does not force-unwatch the previous assignee (they may still care); they can
  unwatch themselves.
- **Auto-watch on mention.** Being @-mentioned in a comment auto-watches you (see the mentions
  section, added with that feature).
- **Manual.** Any user can **watch or unwatch any card they can see** from the detail panel. Unwatch
  wins: if you unwatch, you stay unwatched until something re-subscribes you (a fresh assignment or
  mention).

All auto-watch writes are **idempotent** (the `(card, user)` row is unique), so re-triggering a watch
never duplicates or errors.

### Data model

`card_watchers` (`packages/db`), one row per `(card, user)` subscription:

| Column       | Type         | Notes                             |
| ------------ | ------------ | --------------------------------- |
| `card_id`    | integer FK   | part of the composite primary key |
| `user_id`    | text FK      | part of the composite primary key |
| `created_at` | ISO-8601 UTC |                                   |

The composite `PRIMARY KEY(card_id, user_id)` is both the uniqueness constraint (idempotent `add`
via insert-or-ignore) and, leading with `card_id`, the index behind the `listWatcherIds(cardId)`
fan-out read that the notification system consumes.

### API

Managing your own watch is an identity right (no `manage*` gate); every route is scoped to the acting
user. Both writes are idempotent and return the resulting state so the client reflects the toggle
without a refetch.

| Method & path             | Response                  | Description                 |
| ------------------------- | ------------------------- | --------------------------- |
| `GET /cards/:id/watch`    | `200 { watching }`        | the caller's watch state    |
| `PUT /cards/:id/watch`    | `200 { watching: true }`  | start watching (idempotent) |
| `DELETE /cards/:id/watch` | `200 { watching: false }` | stop watching (idempotent)  |

### Frontend

The card detail panel header carries a **bell toggle** (`packages/web/src/card/CardPanel.tsx`,
`WatchToggle`): a filled bell when watching, an outline (`BellOff`) when not; the label/tooltip name
the action ("Watch this card" / "Stop watching this card"). Clicking flips the state via the API and
toasts the result. Auto-watched cards (yours to report or assigned to you) show as already watching.

## The notification inbox

A **notification** is one row per _(recipient, triggering card event)_. When a watched card changes,
every watcher **except the actor** (you never notify yourself) gets a notification.

### Fan-out

Fan-out is a **post-commit, best-effort** step, decoupled from the mutation: the server subscribes a
listener to the in-process EventBus (`packages/server/src/notifications/fan-out.ts`) that, on each
card hint, reads the committed event, looks up the card's watchers, and inserts a notification for
each recipient (`NotificationService.fanOutForEvent`). A fan-out failure never undoes the mutation
that already happened. Only **notifiable** events fan out — a within-lane reorder, a PII redaction,
and comment edits/deletes are skipped (`NOTIFIABLE_EVENT_TYPES`); everything else (a move, field
edit, block / cancel / reopen, a new comment or attachment, and card creation — which reaches a
freshly-assigned assignee) does. A notification stores only the triggering `eventType` + the card and
actor ids; the human message is rendered client-side, so there is no denormalized copy to keep in
sync.

### Data model

`notifications` (`packages/db`):

| Column       | Type          | Notes                                               |
| ------------ | ------------- | --------------------------------------------------- |
| `id`         | UUIDv7        |                                                     |
| `user_id`    | text FK       | the RECIPIENT                                       |
| `card_id`    | integer FK    | the card the event was on                           |
| `actor_id`   | text          | who acted; **no FK** — may be a service-token id    |
| `event_type` | text          | `NotificationKind` (a `CardEventType` or `mention`) |
| `created_at` | ISO-8601 UTC  |                                                     |
| `read_at`    | ISO-8601 UTC? | null while unread                                   |

Indexed on `(user_id, created_at)` — the per-user newest-first page.

### API

Every route is scoped to the acting user — you only ever list or mark your OWN notifications.

| Method & path                     | Response                 | Description                                                 |
| --------------------------------- | ------------------------ | ----------------------------------------------------------- |
| `GET /notifications`              | `200 NotificationView[]` | inbox, newest-first (`?unreadOnly=true` filters, `?limit=`) |
| `GET /notifications/unread-count` | `200 { unread }`         | the bell badge                                              |
| `POST /notifications/:id/read`    | `200 { unread }`         | mark one read (returns the fresh count)                     |
| `POST /notifications/read-all`    | `200 { unread: 0 }`      | bulk: mark the whole inbox read                             |
| `DELETE /notifications/:id`       | `200 { unread }`         | clear (delete) one — removes it from the inbox              |
| `DELETE /notifications`           | `200 { unread: 0 }`      | bulk: clear the whole inbox (read + unread)                 |

Reading and clearing are distinct: **read** dims a notice but keeps it in the inbox; **clear**
deletes it outright. Notifications are ephemeral inbox rows — the permanent record is the card's
audit events (ADR-005) — so clearing hard-deletes and loses nothing auditable.

A `NotificationView` resolves the row for display:
`{ id, cardId, cardTitle, eventType, actorName | null, createdAt, read }`.

### Frontend

The header carries a **bell with an unread badge** (`packages/web/src/shell/NotificationBell.tsx`).
Clicking opens a popover: a filter toggle (**All / Unread**), the notifications newest-first (each
reading "_actor_ _verb_" and the card; while unread it is bold, carries a **primary-colour dot**
(`--mantine-primary-color-filled`), and sits on a quiet **slate** row tint — a scheme-aware theme
`gray` shade via `light-dark()` (pale grey in light mode, `gray-8` in dark, the palette's closest
to a neutral blue-tinted slate). The bell's count badge stays **red** as the strong at-a-glance
signal; the row itself is only lightly tinted so a full-width coloured block doesn't read as
alarming), a per-row **✕ to clear** that notification, and — on a **read** row — an **envelope to
mark it unread again** (come back to it later; `POST /notifications/:id/unread` sets `read_at` back
to null), plus the **"Clear all"** and **"Mark all as read"** bulk actions. Opening a notification
marks it read and navigates to the card (preserving the URL filter). The inbox **polls every 30s**
and refetches on card SSE hints, so new notifications appear without a reload; targeting the SSE
refresh to only the recipients (rather than a broadcast) is a deliberate follow-up.

**Deep-link to the comment.** A `mention` (and a watcher `comment.added`) notification stores the
triggering `comment_id` on the row (nullable, FK-free like `actor_id` — a soft reference that
no-ops if the comment is later purged). Opening such a notification navigates to
`/cards/:id?tab=comments&comment=<id>`: `CardPanelBody` reads the params (controlled tabs) to open
the **Comments** tab, and `CommentsThread` jumps to that comment and briefly **flashes** it — reusing
the same scroll + highlight the "Replied to…" jump uses — then the caller drops the params so
re-opening the card doesn't keep re-jumping. Every other event type stores a null `comment_id`.

**Not spam.** Watch defaults keep the set relevant (your reported/assigned cards); you never notify
yourself; noise events (reorders, comment edits) are filtered out; and unwatching or "mark all read"
are one click.

## @-mentions in comments

A comment can **@-mention** another user. The composer (`packages/web/src/card/MentionTextarea.tsx`)
has an inline autocomplete: typing `@name` opens a dropdown backed by the **async user search**
(`GET /users/search` — never the whole roster, gated so it only fires while an `@token` is active),
and picking a user inserts `@Display Name` and records their id. The composer sends the mentioned ids
alongside the comment.

When a comment is displayed, each `@Display Name` run that matches a known user's display name is
rendered as a **styled inline tag** (`renderCommentBody`, `packages/web/src/card/renderMentions.tsx`)
— purely presentational, matched against the loaded roster (longest name wins so multi-word names
aren't clipped); the stored body text is unchanged and an unknown `@handle` stays plain.

Server-side (`CommentService.add`), each mentioned user (de-duped, must exist, never the author):

- **auto-watches** the card (they now follow it), and
- gets a dedicated **`mention`** notification (a distinct `NotificationKind`, rendered "mentioned you
  in a comment") — higher signal than the generic comment notice.

To avoid a double notification, the mentioned ids ride on the `comment.added` event payload
(`mentionedUserIds`), and the watcher fan-out **skips** them for that event (they already got the
mention). So a mentioned watcher gets exactly one notification — the mention.
