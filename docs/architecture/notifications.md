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
