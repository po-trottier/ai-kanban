# Frontend (SPA) Architecture

React 19 + Vite single-page app in `packages/web`, served by the backend in production
([overview.md](overview.md)); in dev, Vite proxies `/api` to `:3000`. UI framework is
**Mantine 9** with token-only styling rules ([ADR-016](decisions/ADR-016-ui-framework.md));
the board's drag-and-drop is **Pragmatic drag-and-drop**
([ADR-007](decisions/ADR-007-pragmatic-drag-and-drop.md)).

## Module layout (`packages/web/src`)

| Module           | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`           | Typed REST layer: `ApiClient` (fetch + If-Match + problem+json), response schemas composed from core, TanStack Query hooks per resource, query-key catalog, SSE hint → invalidation mapping, optimistic board-cache updates                                                                                                                                                                                                                                                                                          |
| `auth/`          | Login page, `RequireAuth` session gate, must-change-password interstitial, session context                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `board/`         | Board page, lanes, cards, ⋯ menu, Move to… modal, waiting/cancel/block modals, the **filter bar + presets** (`FilterBar`/`FilterPresets`, driving `POST /board/query`), policy affordance logic (`move-options.ts`), the one thin DnD adapter (`dnd.ts`)                                                                                                                                                                                                                                                             |
| `card/`          | Card detail drawer (deep-linked at `/cards/:id`): a **State dropdown** to change the card's lane without dragging (reuses the board's move funnel — `move-options.ts` + the waiting-lane modal — so UI/server can't drift), fields form (dirty edits survive refetches), markdown editor/preview, attachments, threaded comments, **typed relations** (a quiet list + an "Add relationship" button opening `AddRelationModal`, see card-relations.md), history; archived cards render read-only with a Reopen action |
| `settings/`      | Tabbed settings page: a **Preferences** tab (timezone + theme) every role can open, plus the manage\*-gated admin tabs (users, lanes/WIP, permission policy editor, location tree, service tokens) shown only when the caller's role grants each `manage*` permission — there is no admins-only wall                                                                                                                                                                                                                 |
| `undo/`          | Global undo/redo stack for board moves + card actions (`use-undo-redo-keys.ts`, `use-undoable-board.ts`) — see Data flow                                                                                                                                                                                                                                                                                                                                                                                             |
| `shell/`         | AppShell header, SSE bridge, error boundary/alerts, skeleton loaders, disabled-reason `HintButton` + field-label `FieldLabel` tooltip helpers                                                                                                                                                                                                                                                                                                                                                                        |
| `strings.ts`     | Every user-facing English string (i18n deferral rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `theme.ts`       | The one Mantine theme file — all design values (ADR-016 rule 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `core-domain.ts` | Domain-only view of `@rivian-kanban/core` (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Data flow

- **Single-schema rule**: every response body is parsed with Zod schemas composed from
  `@rivian-kanban/core` (`api/schemas.ts`); request bodies are the core command schemas minus
  `expectedVersion`, which rides as `If-Match: "<version>"` (ADR-012).
- **TanStack Query** owns all server state; `api/keys.ts` is the one query-key vocabulary.
- **User pickers are async, never the whole roster.** The assignee/reporter pickers
  (`shell/AsyncUserPicker.tsx`, used by the board `FilterBar` and the card `CardFieldInputs`)
  search the server as the user types instead of loading every user, so they scale to a 10k-user
  roster. `useUserSearch(q)` debounces the input (~275 ms) and hits `GET /users/search?q=` (empty
  `q` returns the first page so the dropdown shows something before typing); `useResolveUsers(ids)`
  hits `GET /users/search?ids=` to resolve the already-selected ids (a card's assignee/reporter, a
  filter pill) to their names — including deactivated users the free-text search omits. Both are
  merged into the Mantine `Select`/`MultiSelect` controlled `data` (we own fetching, so a
  pass-through `filter` shows every returned option; `searchValue`/`onSearchChange` drive the query).
  The read-only Reporter field resolves its id the same way. `useUsers()` (the full `GET /users`
  roster) survives only for name/avatar lookups on already-rendered data — board card avatars and the
  comment/history author maps — never for a picker.
- **Moves** send only `{ toLane, prevCardId, nextCardId }` (ADR-006) with the official
  optimistic pattern: `onMutate` snapshot (`api/board-cache.ts` recomputes lanes + soft WIP) →
  rollback `onError` → invalidate `onSettled`. A 409 rolls back, refetches, and shows the
  non-blocking "card was just updated" toast (ADR-012).
- **Undo/redo** (`undo/`, mounted on `shell/AppLayout`): global **Ctrl/Cmd+Z** (undo) and
  **Ctrl/Cmd+Y** (redo) drive one action stack. `use-undoable-board.ts` wraps the move + card
  action mutations (cancel/block/unblock/archive — reopen is a recovery action, deliberately not
  undoable) so each performed action records its inverse; the inverse re-derives from the
  PRE-mutation board snapshot and **re-checks permission at undo time** (RBAC can change), toasting
  "can't undo" if it no longer holds or the card left the board. The hotkey handler bails while
  focus is in a text field so native in-field undo survives (`is-editable-target.ts`).
- **SSE** (`api/sse.ts`, mounted by `shell/SseBridge`): native `EventSource` on
  `/api/v1/stream`; hints validated with core's `sseHintSchema` map to targeted query
  invalidations; the board refetches after a reconnect (ADR-008). Native reconnect only
  covers drops of an established stream — a CLOSED readyState (401/5xx on connect) is
  terminal, so the client recreates the source with capped backoff and invalidates
  `/auth/me` so an expired session lands on login promptly.
- **Mutation errors are always surfaced**: card/comment/attachment/admin mutations toast the
  problem+json title (`api/notify.ts`); card mutations special-case 409 with the calm
  "just updated" message (ADR-012). The comment composer clears only on a successful POST.
- **Auth**: `/auth/me` drives `RequireAuth`; any 401 (query or mutation) resets the session
  query and lands on the login page; `mustChangePassword` interposes the change-password page.

## Policy-driven affordances (ADR-013)

`GET /policy` is cached and consulted by pure functions in `board/move-options.ts`:
drag `canDrop`, Move to… lane options (disabled ≠ hidden), cancel/reopen/archive menu gating,
and the `deleteOthersComments`/`deleteOthersAttachments` affordances in the card panel all
derive from one evaluation path (`canPerformAction` covers every action gate). The
server re-validates every action regardless.

## Drag-and-drop (ADR-007)

All Pragmatic DnD wiring lives in `board/dnd.ts` (one thin adapter): card draggables with
`setCustomNativeDragPreview`, closest-edge card targets + lane targets (a card remains a
valid target of itself so an in-place drop resolves to a no-op, not a lane-bottom move),
auto-scroll on the plain `overflow-y: auto` lane containers (never Mantine ScrollArea), and
a drop monitor that resolves targets through pure `move-options.ts` helpers. The
keyboard/touch/AT path is the card's **⋯ → Move to…** modal driving the same neighbor-id
move API; both the modal and drag paths announce successful moves through
`pragmatic-drag-and-drop-live-region`.

## Known limitations (deferred, tracked)

- **User reactivation is API-only**: `GET /users` returns active users, so a deactivated
  user disappears from the admin table and `PATCH /users/:id { isActive: true }` has no UI.
  The Deactivate button therefore requires an explicit confirmation. Revisit when the server
  grows an include-inactive listing.
- `PUT /policy` carries no If-Match; the editor remounts on every refetch (SSE
  `policy.updated` or its own save) so it never PUTs a stale snapshot, but two admins saving
  in the same instant is still last-write-wins (recoverable via the append-only history).

## Forms

react-hook-form + `standardSchemaResolver` (`@hookform/resolvers`) consuming the core Zod
schemas directly (Zod 4 implements Standard Schema). Deviation from ADR-016's
`@mantine/form` + `mantine-form-zod-resolver` line: the task pinned react-hook-form, and
carrying both form libraries would fail knip's unused-dependency gate — one form stack,
same single-schema guarantee. Card field edits submit only dirty fields so the audit trail
gets one event per real change.

### Card-form layout (detail panel + New Card modal)

The 7-field roster is one component (`card/CardFieldInputs`) driven by the core schema, so
the detail panel's edit form and the New Card modal stay in lockstep — adding a field is a
one-file edit both pick up. Both wrap it in the SAME scroll-and-pin layout:

- **Order (top to bottom).** Detail panel's Details tab: the **State** dropdown
  (`card/CardStateSelect`, moved out of the panel header and INTO the tab), then the editable
  fields (`card/CardDetailsForm`), then Attachments, then Relations, then the Created/Updated
  timestamps. The New Card modal: fields, then its attachments.
- **Sticky footer.** The action bar — the detail panel's full-width **Save changes**, the
  modal's **Cancel / Create** — is `card/StickyFooter` (one `.stickyFooter` CSS-module class,
  `position: sticky; bottom: 0` with a top border + `--mantine-color-body` background). It
  stays visible while the body scrolls: the panel's own `.panelBody` is the scroll container;
  the modal caps its `body` slot (`.modalScrollBody`, `classNames={{ body }}`) so it scrolls
  too. Save sits OUTSIDE the scrolling `<form>` and submits it via the native `form={id}`
  association (the form owns its own dirty state — nothing is lifted); the "unsaved changes"
  warning rides just above it.
- **Status color.** The State dropdown is tinted with the SAME theme hue the board card
  badges paint (`board/card-status.ts` → `cardStatusColor`: blocked=grape, waiting=yellow,
  overdue=pink, cancelled=dark, archived=gray) so the panel echoes its board card; a plain
  on-track card keeps the default border.

## `core-domain.ts` and coverage isolation

The SPA needs only core's **domain** modules (schemas/constants/types). `vite.config.ts`
aliases `@rivian-kanban/core` to `src/core-domain.ts`, which re-exports the domain files —
so the browser bundle never ships core's services, and the web test pipeline never executes
them (a second, Vite-transformed instrumentation of service sources skews the merged
V8 coverage of the native-Node backend runs, ADR-014). Web tests additionally load core
natively via `server.deps.external`. Type checking still resolves the real package, so the
alias cannot drift from the published schema shapes.

## React Compiler

`@vitejs/plugin-react`'s `reactCompilerPreset` runs through `@rolldown/plugin-babel` +
`babel-plugin-react-compiler` for dev/build. It is **excluded under Vitest**
(`process.env.VITEST` guard): compiler memoization defeats react-hook-form's `formState`
proxy subscriptions in the happy-dom pipeline (forms stop re-rendering on
dirty/error changes).

## Testing (docs/dev/testing.md)

`*.unit.test.tsx` on happy-dom, AAA comments, Testing Library by role/label, no mocking
libraries. Components take data via props/context; where a page needs a network, tests inject
a hand-written fake `fetch` (route table → real `Response` objects) through `ApiContext` —
dependency injection, not interception; the real network path belongs to Playwright.
`src/test/setup.ts` carries hand-written happy-dom polyfills (`document.fonts`,
`EventSource`) and drains the singleton notifications store between tests. The DnD adapter's
native drag events cannot fire in happy-dom; that path is e2e-only by design (ADR-007).

## Mantine (UI library) — conventions & AI resources

Decision rationale lives in [ADR-016](decisions/ADR-016-ui-framework.md); the enforced
conventions:

- **Styles import order** in `main.tsx`: `@mantine/core/styles.css` first, then the extension
  packages (`dates`, `notifications`, `tiptap`), then `index.css`. Later imports win on equal
  specificity — that is how `index.css` offsets the notifications container without `!important`.
- **PostCSS**: `postcss-preset-mantine` (`packages/web/postcss.config.cjs`) supplies the `rem()`,
  `light-dark()`, and `smaller-than`/`larger-than` mixins the CSS modules use.
- **One theme file**: `src/theme.ts` (`createTheme`) is the only home for design values (ADR-016
  rule 1); component overrides go through the Styles API, never inline pixel literals.
- **Icons via `lucide-react`** — Mantine ships none. NEVER hand-roll `<svg>`/`<path>` icon
  components; use lucide glyphs (inside `ActionIcon`/`ThemeIcon`, sized on the icon, not the
  button — mantine.dev/core/action-icon). `shell/icons.tsx` only aliases lucide glyphs to app
  names for a shared vocabulary + default size. Save actions use the lucide `Save` (floppy) glyph
  (`aria-hidden`, always beside a text label).
- **Every control is labelled and hinted.** Icon-only controls carry an `aria-label`; interactive
  controls carry a `Tooltip` (its accessible name, and the keyboard shortcut where one exists).
  Two shared helpers centralize the patterns: `shell/HintButton` — a `Button` that ALWAYS has a
  tooltip and, when passed a `disabledReason`, renders visually disabled (Mantine's `data-disabled`
  so the reason tooltip still shows on hover/focus, unlike a native `disabled`) with a guarded
  click; and `shell/FieldLabel` — a form-field label with a trailing info glyph whose tooltip
  explains the field (what P0/P1/P2 mean, etc.), the help text doubling as the icon's accessible
  name. Pass `FieldLabel` as a Mantine input's `label`.
- **Loading UI is skeletons, not spinners.** The board (`shell/BoardSkeleton`) and the settings
  tables (`shell/SkeletonRows`) render skeleton placeholders while their first fetch resolves; per-
  row mutations (comment add/edit/delete, saves) show inline loading state on the acting control.

**AI-assisted UI work should use Mantine's own agent resources** — Mantine 9 postdates most model
training cutoffs, so recalling APIs from memory drifts. Prefer:

- **`https://mantine.dev/llms-full.txt`** — the whole docs as one file (per-page markdown indexed
  by `/llms.txt`); fetch it for exact v9 component props/behavior rather than guessing.
- **Skills** — [`mantinedev/skills`](https://github.com/mantinedev/skills) (`mantine-form`,
  `mantine-combobox`, `mantine-custom-components`), added via `npx skills add`.
- **MCP server** — `@mantine/mcp-server` (experimental): `list_items`, `get_item_doc`,
  `get_item_props`, `search_docs` for any MCP client.
