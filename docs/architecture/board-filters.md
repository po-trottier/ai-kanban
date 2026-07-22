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
| `assigneeIds` | `string[]` (user ids)             | `[]`        | any-of                                                                       |
| `reporterIds` | `string[]` (user ids)             | `[]`        | any-of                                                                       |
| `tags`        | `string[]` (tag names)            | `[]`        | any-of, case-insensitive — a card with at least one of the tags              |
| `locationIds` | `string[]` (location ids)         | `[]`        | any-of, each **subtree-inclusive** (a building matches its floors and rooms) |
| `scope`       | `'active' \| 'archived' \| 'all'` | `'active'`  | archived selector: live cards only / archived only / both                    |
| `q`           | `string`                          | `''`        | free-text, case-insensitive substring over title + description               |
| `overdue`     | `boolean`                         | `false`     | computed time facet: elapsed business-minutes ≥ estimate (see below)         |

Within a facet the values are OR-ed (any-of); across facets they are AND-ed (a card must satisfy
every non-empty facet). This is the natural "narrow by each control" behavior of a filter bar.

In the assignee and reporter pickers the **current user's** option and selected pill are marked
"(you)" so filtering to your own cards is one glance away (`AsyncUserPicker`). This is display-only —
`assigneeIds`/`reporterIds` stay plain user-id arrays, never a `me` sentinel.

There is **no lane/status facet** (#121). Filtering by lane only hid board columns — not a useful
narrowing — so the field is gone from the schema, the query, and the bar. The **`scope`** facet
(active / archived / all) stays: reaching archived cards is genuinely useful. (v0/no-legacy: the
removed `laneKeys` field simply stops being written; existing `filter_presets` JSON that lacks it
parses fine, since every facet defaults to its empty value.)

Every any-of array facet is capped at **50 entries** (`.max(50)` on the schema — a trust-boundary
bound shared by the REST body, preset storage, and the form). 50 dwarfs any real UI selection; the
cap exists to reject a pathological body (tens of thousands of ids) that would otherwise fan out
into a per-element subtree scan and stall the event loop (see security.md#input--output). `q` is
capped at 200 chars.

`export type BoardFilter = z.infer<typeof boardFilterSchema>`.

## The `overdue` facet

`overdue` is the burn-down verdict, not the waiting-lane resume date. A card is **overdue** when the
business-time elapsed since it first entered In Progress (`work_started_at`) meets or exceeds its
`estimate_minutes` — the same rule the web work-progress bar paints red
([ADR-019](decisions/ADR-019-per-user-timezone.md), `packages/web/src/lib/work-progress.ts`).

- **Business minutes** are Monday–Friday within the working day the policy configures — the
  `businessHours` start/end pair, default 09:00–17:00 (1 working day = 8 hours,
  [workflow.md](../product/workflow.md#priorities-and-estimates), editable under Settings → Hours,
  [ADR-013](decisions/ADR-013-configurable-permissions.md)). Core owns a framework-free
  `businessMinutesBetween(start, end, hours)` in `dates.ts` (no dayjs — core imports no libraries);
  the board query passes the active policy's hours in.
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

A **filter preset** is a named, saved `BoardFilter`, stored server-side. Presets are **per-user by
default** (private to their owner); an owner can **share** one with the whole team, and there are
three built-ins everyone always has.

### Built-in presets

Three built-ins are core constants (`BUILTIN_FILTER_PRESETS`) the frontend renders, NOT rows in the
database — they have no owner and are the same for everyone:

- **All** (key `all`) — the empty (unfiltered) `BoardFilter`: every work order, no facets. It is the
  **default selection** and exactly what **"Reset filters"** restores, so an empty bar reads as "All"
  rather than a bare placeholder. (Labels stay terse — the whole board is work orders, so an
  "All Work Orders" / "My Work Orders" suffix reads as redundant.)
- **Mine** (key `my_cards`) — `assigneeIds` = `[current user]` (the frontend fills in the id at render time,
  since "current user" is only known client-side; the constant carries an empty `assigneeIds` the
  bar fills in).
- **Overdue** — `overdue: true`, everything else empty.

Built-ins can't be edited or deleted. They exist so the most common views need no setup.

### Custom presets (the CRUD ones)

`filterPresetSchema` — a stored, user-owned preset:

| Field       | Type          | Notes                                                   |
| ----------- | ------------- | ------------------------------------------------------- |
| `id`        | UUIDv7        |                                                         |
| `ownerId`   | user id       | the only user who can EDIT it                           |
| `name`      | string ≤ 60   | display label                                           |
| `filter`    | `BoardFilter` | the complete saved filter state                         |
| `shared`    | boolean       | `false` = private (default); `true` = visible team-wide |
| `createdAt` | ISO-8601 UTC  |                                                         |
| `updatedAt` | ISO-8601 UTC  |                                                         |

Stored in a `filter_presets` table (`packages/db`), one row per custom preset. Presets are
**per-user by default** — `shared: false`, visible only to their owner. An owner can flip `shared` to
make a preset visible **team-wide**. The visibility rule is split from the mutation rule:

- **Reads** return the caller's own presets **plus every shared one** (`listVisibleTo` — `WHERE
owner_id = ? OR shared = 1`).
- **Writes** (rename, replace-filter, (un)share, delete) stay **owner-scoped**: a preset owned by
  another user is indistinguishable from a missing one (both `404`), so a **shared preset is
  applyable by everyone but editable only by its owner**.

No special admin permission is required (managing your own presets is an identity right, like editing
your own comment); a read-scoped MCP actor still can't reach the routes because they sit behind the
normal session gate (these are web-session surfaces).

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

Reads return the caller's own presets **plus every shared one**; every write is **owner-scoped**.

| Method & path                | Body                          | Response               | Description                              |
| ---------------------------- | ----------------------------- | ---------------------- | ---------------------------------------- |
| `GET /filter-presets`        | —                             | `200` `FilterPreset[]` | own + shared presets, newest-first       |
| `POST /filter-presets`       | `{ name, filter, shared? }`   | `201` `FilterPreset`   | create (`shared` defaults `false`)       |
| `PATCH /filter-presets/:id`  | `{ name?, filter?, shared? }` | `200` `FilterPreset`   | rename, replace the filter, and/or share |
| `DELETE /filter-presets/:id` | —                             | `204`                  | delete                                   |

A **write** to a `:id` owned by another user is a `404` (same as unknown) — the server never confirms
another user's preset exists, and a shared preset is editable only by its owner. Reads, by contrast,
surface shared presets to everyone.

## Frontend (the filter bar)

The SPA renders the filter as a **filter bar** below the header and above the board
(`packages/web/src/board/FilterBar.tsx`), replacing the former advanced-search modal and the
`/search` page (both removed). It holds no server state of its own — it is a controlled view of one
`BoardFilter` that lives in the **URL query string**.

- **Shareable via the URL (the live filter IS URL state).** The filter isn't React state — it's
  derived from the URL query string (`board/filter-url.ts`), and every edit writes it back via
  `useSearchParams` (`replace: true`, so a burst of keystrokes doesn't flood back-history). So
  **sharing a filtered board is just sharing the link** — no preset needed — and a deep link opens
  pre-filtered. Each facet is its own param, arrays as **repeated** params
  (`?priority=P0&priority=P1&q=pump&scope=archived&overdue=1`) so a tag or free-text value with
  commas/spaces round-trips with nothing to escape; empty facets are omitted (an unfiltered board is a
  clean `/`). Decoding re-validates through `boardFilterSchema` (the URL is a trust boundary), so a
  hand-edited or stale link that no longer parses falls back to the empty filter rather than throwing.
  Drilling into a card (`/cards/:id`) and closing the panel both **preserve** the query, so the same
  filtered board is restored.
- **Placement (#128).** The bar sits in a **full-width strip ABOVE the board+detail-panel row**, not
  inside the region the resizable detail panel squeezes. The shell (`shell/AppLayout.tsx`) lays
  `AppShell.Main` out as a column: a fixed `filterSlot` strip on top, then a flex row of the board
  (flexible) + the docked detail panel (a fixed, draggable-width `aside`). `BoardPage` renders its
  `<FilterBar>` into that strip via a **React portal** (`shell/filter-bar-slot.ts` bridges the mount
  node; the bar stays in `BoardPage`'s render tree so `filter` state flows normally). Because only the
  board row is a flex sibling of the panel, opening or resizing the panel squeezes the board — the
  filter bar above never shrinks or reflows. The panel goes full-screen below the `62em` breakpoint
  (CSS media query on `.panelColumn`).
- **Layout.** The bar is a single wrapping row laid out in **three zones**: the text search (left) ·
  the facet group **centered** in the flexible middle (a `flex:1` wrapper with `justify-content:center`
  and `min-width:0` so it wraps rather than overflows) · right-aligned **presets + Reset**. The
  centered facet group keeps its deliberately ordered, `Divider`-separated sections: **attributes**
  (Priority) · **people** (Assignee, Reporter) · **classification** (Tags, Location) · **scope**
  (Scope, Overdue). The section-divider height is a theme token (`filterSectionHeight`), the field
  widths are `filterQueryWidth`/`filterPillWidth` (ADR-016 rule 1). Each pill facet uses a **fixed**
  width (plus a single-row, overflow-clipped `pillsList` via the Styles API) so selecting or clearing
  values never resizes the control or reflows the bar. The bar is **responsive** across desktop
  widths: the inner `Group` wraps (`wrap="wrap"`) and the strip caps to `max-inline-size:100%`, so
  there is no horizontal overflow/clipping at common resolutions (1280–2560); mobile is out of scope.
- **Controls.** Every any-of facet — Priority and the high-cardinality assignee / reporter / tags /
  location — is a `MultiSelect` pill combobox (selected values render as compact pills, keeping the
  bar dense); the Priority options render each code + plain-language name + P0/P1/P2 description via
  `renderOption` (the same `strings.priorityOptions` the card priority Select shows). The single-value
  facets (`scope`, the `overdue` toggle) are `SegmentedControl`s; a text `q` input and a text **"Reset
  filters"** `Button` (subtle, leading `RotateCcw` glyph, at the far right after the presets) complete
  the bar. The bar is **placeholder-only** — no visible field labels — so every control carries a
  `placeholder` for the visible cue and an `aria-label` for its accessible name (convention #104),
  plus a `Tooltip`, per the repo convention.
- **Fetching.** `BoardPage` debounces the live filter (`useDebouncedValue`, 300 ms) and drives
  `useBoard(filter)` (`api/board.ts`): the empty filter takes the hot `GET /board` path, any non-empty
  filter posts to `POST /board/query`. Each filter is its own TanStack query, keyed
  `['board', filter]` under the shared `board` prefix, so every board invalidation (SSE, a move)
  refetches whichever filter is mounted, and `keepPreviousData` keeps the prior board on screen
  (dimmed, `aria-busy`) during the round-trip. The optimistic drag/move cache targets the exact
  mounted `['board', filter]` key, so filtering never breaks optimistic moves.
- **Facet-option freshness.** The dynamic facet vocabularies stay live in both directions. **Tags**
  (`GET /tags`, an insert-only table — a tag is only ever _added_, on card create or a tag-field edit):
  the local `useCreateCard` and `invalidateCard` (card edit / action) both invalidate `['tags']`, and
  the SSE bridge (`sse.ts`) appends `['tags']` for exactly the `card.created` / `card.field_changed`
  hints, so a tag another user just introduced shows up here too — never on a move (`card.status_changed`)
  or any other card event. **Locations** (`GET /locations`): the admin create/rename/delete mutations
  invalidate `['locations']`, and the SSE `location.updated` hint does the same cross-user. **Assignee /
  Reporter** need no cached vocabulary — they search the server per keystroke (`#119`,
  `AsyncUserPicker`), so a 10k-user roster is never loaded or cached to go stale. Priority and Scope are
  static enums.
- **Presets** (`FilterPresets.tsx`). The combobox lists the three core built-ins
  (`BUILTIN_FILTER_PRESETS` — "All" is the empty/unfiltered filter, "Mine" fills `assigneeIds`
  with the current user id client-side, "Overdue" sets `overdue:true`) plus the user's custom presets
  from `GET /filter-presets`. Selecting any preset applies its COMPLETE `BoardFilter` (never a partial
  overlay). The combobox **reflects state** (#120): it shows the **applied preset's NAME** as its
  value while the live filter still equals that preset's (effective) filter; once any facet **drifts**
  (an edit) it shows **"Custom"** (`strings.filterBar.presetsCustom`); and the **empty/unfiltered
  board** — the default and what "Reset filters" restores — reads as the **"All"** built-in (never a
  bare placeholder). The component tracks the last applied
  option value (`appliedValue`, a built-in `builtin:<key>` or a custom id) and derives name-vs-Custom
  from field-wise `boardFilterEquals`. It is built on Mantine's **`Combobox`** primitive (not `Select`)
  precisely so the collapsed display can differ from the option list: **"Custom" is a display-only
  label that is NEVER a dropdown row** (`strings.filterBar.presetsCustom`) — to persist a drifted
  filter the user saves it as a named preset. Every click fires `onOptionSubmit`, so re-picking the
  SAME preset always re-applies it. Creating a preset is a trailing **"Save preset"** entry (a lucide
  floppy-disk `Save` glyph) at the bottom of the dropdown (there is no separate Save icon button):
  selecting it opens the name dialog and `POST`s the live filter.
- **Sharing** (per-user by default). The dropdown groups presets as **"My presets"** (your own) and
  **"Shared with you"** (teammates' shared presets); a `Share2` glyph marks any shared row. The save
  dialog carries a **"Share with the team"** switch (off = private, the default). For an applied
  preset **you own**, three icon affordances sit beside the combobox — **rename** (`Pencil`), a
  **share toggle** (`Share2`, filled when shared — one click `PATCH`es `shared`), and **delete**
  (`Trash2`) — shown only while that owned preset is the applied, name-shown selection. A teammate's
  shared preset is **apply-only**: it carries no affordances (writes are owner-only, else `404`). All
  wire to the CRUD API with loading states and toasts.
