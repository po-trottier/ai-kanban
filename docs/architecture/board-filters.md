# Board filters

The board can be narrowed to a subset of cards by a **filter bar** whose state is one flat object
— the `BoardFilter`. This document is the human-first spec for that shape, the rules that govern it,
and where filtering happens (always the database, never the client). The frontend renders the bar
and the presets; the server owns the query.

## Principles

- **API-level filtering.** Every facet is pushed into the SQL query (drizzle, `packages/db`). The
  server never fetches the whole board and filters in memory, and neither does the client. The one
  facet SQLite cannot express — `overdue`, which needs a business-hours clock — is evaluated in the
  core service over a DB-narrowed candidate set (never the whole board); see
  [The `overdue` facet](#the-overdue-facet).
- **A preset always sets the COMPLETE filter state.** Applying a preset replaces the entire
  `BoardFilter`, never overlays a few keys onto the current one. Because every facet has a
  well-defined empty value (`[]` for multi-selects, `''` for text, `false`/`'active'` for the
  scalars), a preset is a full `BoardFilter` value — there is no partial-preset merge to reason
  about, and "clear filters" is just the empty filter.
- **One schema, everywhere.** `boardFilterSchema` (core) is the single definition the REST request
  body, the preset storage, and the frontend form all share (the single-schema rule,
  [standards.md](../dev/standards.md)).
- **The empty filter is today's board.** An empty `BoardFilter` (all facets at their empty value,
  `scope: 'active'`) returns exactly the current unfiltered board — the existing `GET /board`
  behavior is the `boardFilter()` empty case, so nothing regresses.

## The filter-state shape

`boardFilterSchema` — every facet is present so a preset can set them all. Multi-selects default to
`[]` (matches everything on that facet); the scalars carry their neutral default.

| Facet         | Type                              | Empty value | Meaning                                                                      |
| ------------- | --------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `priorities`  | `Priority[]` (`P0`/`P1`/`P2`)     | `[]`        | any-of; a card matches if its priority is in the set                         |
| `laneKeys`    | `LaneKey[]`                       | `[]`        | any-of over lane/status                                                      |
| `assigneeIds` | `string[]` (user ids)             | `[]`        | any-of                                                                       |
| `reporterIds` | `string[]` (user ids)             | `[]`        | any-of                                                                       |
| `tags`        | `string[]` (tag names)            | `[]`        | any-of, case-insensitive — a card with at least one of the tags              |
| `locationIds` | `string[]` (location ids)         | `[]`        | any-of, each **subtree-inclusive** (a building matches its floors and rooms) |
| `scope`       | `'active' \| 'archived' \| 'all'` | `'active'`  | archived selector: live cards only / archived only / both                    |
| `q`           | `string`                          | `''`        | free-text, case-insensitive substring over title + description               |
| `overdue`     | `boolean`                         | `false`     | computed time facet: elapsed business-minutes ≥ estimate (see below)         |

Within a facet the values are OR-ed (any-of); across facets they are AND-ed (a card must satisfy
every non-empty facet). This is the natural "narrow by each control" behavior of a filter bar.

`export type BoardFilter = z.infer<typeof boardFilterSchema>`.

## The `overdue` facet

`overdue` is the burn-down verdict, not the waiting-lane resume date. A card is **overdue** when the
business-time elapsed since it first entered In Progress (`work_started_at`) meets or exceeds its
`estimate_minutes` — the same rule the web work-progress bar paints red
([ADR-019](decisions/ADR-019-per-user-timezone.md), `packages/web/src/lib/work-progress.ts`).

- **Business minutes** are Monday–Friday 09:00–17:00 (1 working day = 8 hours,
  [workflow.md](../product/workflow.md#priorities-and-estimates)). Core owns a framework-free
  `businessMinutesBetween(start, end)` in `dates.ts` (no dayjs — core imports no libraries).
- **Time zone.** The web burn-down counts business hours in the _viewer's_ zone (ADR-019). A
  server-side board filter has no single viewer, so — exactly like the overdue-resume date rule,
  which ADR-019 keeps a global UTC business rule for precisely this reason — the filter counts
  business minutes in **UTC**. This keeps the org-wide filter deterministic; the per-viewer bar is a
  separate, cosmetic render.
- **Where it runs.** SQLite cannot count business hours, so `overdue` is the one facet not pushed
  into raw SQL. The service first narrows to cards that _can_ be overdue — `work_started_at IS NOT
NULL AND estimate_minutes IS NOT NULL` (a DB predicate) plus every other facet — then evaluates
  `businessMinutesBetween(workStartedAt, now) >= estimateMinutes` in TypeScript over that bounded
  set. It is never a whole-board in-memory scan.

## Presets

A **filter preset** is a named, saved `BoardFilter`, stored per user server-side.

### Built-in presets

Two built-ins are core constants (`BUILTIN_FILTER_PRESETS`) the frontend renders, NOT rows in the
database — they have no owner and are the same for everyone:

- **My Cards** — `assigneeIds` = `[current user]` (the frontend fills in the id at render time,
  since "current user" is only known client-side; the constant carries an empty `assigneeIds` the
  bar fills in).
- **Overdue** — `overdue: true`, everything else empty.

Built-ins can't be edited or deleted. They exist so the two most common views need no setup.

### Custom presets (the CRUD ones)

`filterPresetSchema` — a stored, user-owned preset:

| Field       | Type          | Notes                                |
| ----------- | ------------- | ------------------------------------ |
| `id`        | UUIDv7        |                                      |
| `ownerId`   | user id       | the only user who can see or edit it |
| `name`      | string ≤ 60   | display label                        |
| `filter`    | `BoardFilter` | the complete saved filter state      |
| `createdAt` | ISO-8601 UTC  |                                      |
| `updatedAt` | ISO-8601 UTC  |                                      |

Stored in a new `filter_presets` table (`packages/db`), one row per custom preset, scoped by
`owner_id`. Presets are **per-user private**: the list/create/rename/delete surface only ever
touches the caller's own rows — a user can neither see nor mutate another user's presets. No special
admin permission is required (managing your own presets is an identity right, like editing your own
comment); a read-scoped MCP actor still can't reach the routes because they sit behind the normal
session gate (these are web-session surfaces).

## API

### Filtered board

`POST /api/v1/board/query` — the board grouped by lane, narrowed by a `BoardFilter`.

- **Why POST, not GET query params.** The filter has ten facets, several of them arrays; encoding
  that in a query string (and keeping it in sync with the shared Zod schema) is far more brittle
  than sending the canonical `BoardFilter` JSON body. The route is a read (idempotent, no side
  effects) that happens to take a body — the same pattern search-heavy APIs use.
- **Request body**: `boardFilterSchema` (all facets optional on the wire, defaulted to their empty
  value — so `{}` is the full board).
- **Response** (`200`): the same `BoardSnapshot` envelope `GET /board` returns —
  `{ lanes: [{ lane, cards, wipLimitExceeded }] }` — with each lane's `cards` filtered. Lanes with
  no matching cards are still present (empty), so the board keeps its shape. `wipLimitExceeded`
  reflects the FULL active lane count (the WIP marker is a property of the lane, not of a filtered
  view), so filtering never hides a WIP breach.
- `GET /board` is unchanged and remains the hot, cached, unfiltered read.

### Custom-preset CRUD

All scoped to the current user; a user only ever sees and edits their own presets.

| Method & path                | Body                 | Response               | Description                        |
| ---------------------------- | -------------------- | ---------------------- | ---------------------------------- |
| `GET /filter-presets`        | —                    | `200` `FilterPreset[]` | the caller's presets, newest-first |
| `POST /filter-presets`       | `{ name, filter }`   | `201` `FilterPreset`   | create                             |
| `PATCH /filter-presets/:id`  | `{ name?, filter? }` | `200` `FilterPreset`   | rename and/or replace the filter   |
| `DELETE /filter-presets/:id` | —                    | `204`                  | delete                             |

A `:id` that exists but belongs to another user is a `404` (same as unknown) — the server never
confirms another user's preset exists.

## Frontend (the filter bar)

The SPA renders the filter as a **filter bar** below the header and above the board
(`packages/web/src/board/FilterBar.tsx`), replacing the former advanced-search modal and the
`/search` page (both removed). It holds no server state of its own — it is a controlled view of one
`BoardFilter` in `BoardPage` state.

- **Controls.** Enumerable, any-of facets (priority, status/lane) are `Chip.Group multiple` split
  toggles; the single-value facets (`scope`, the `overdue` toggle) are `SegmentedControl`s; the
  high-cardinality facets (assignee, reporter, tags, location) are `MultiSelect` pill comboboxes; a
  text `q` input and a "Clear filters" reset complete the bar. Every control carries a tooltip
  (`FieldLabel`/`Tooltip`), per the repo convention.
- **Fetching.** `BoardPage` debounces the live filter (`useDebouncedValue`, 300 ms) and drives
  `useBoard(filter)` (`api/board.ts`): the empty filter takes the hot `GET /board` path, any non-empty
  filter posts to `POST /board/query`. Each filter is its own TanStack query, keyed
  `['board', filter]` under the shared `board` prefix, so every board invalidation (SSE, a move)
  refetches whichever filter is mounted, and `keepPreviousData` keeps the prior board on screen
  (dimmed, `aria-busy`) during the round-trip. The optimistic drag/move cache targets the exact
  mounted `['board', filter]` key, so filtering never breaks optimistic moves.
- **Presets** (`FilterPresets.tsx`). The combobox lists the two core built-ins
  (`BUILTIN_FILTER_PRESETS` — "My Cards" fills `assigneeIds` with the current user id client-side,
  "Overdue" sets `overdue:true`) plus the user's custom presets from `GET /filter-presets`. Selecting
  any preset applies its COMPLETE `BoardFilter` (never a partial overlay). Save/rename/delete wire to
  the CRUD API with loading states and toasts.
