# ADR-016: Mantine 9 as the UI framework; token-only styling rules

**Status**: accepted (2026-07-16)

## Context

The product owner asked for a framework with **pre-built components** and a **styling system
that makes consistent apps easy**; consistency will be screenshot-audited page by page
(spacing, padding, font sizes, hierarchy), so a real design-token system is a hard requirement.
The earlier plan-of-record was shadcn/ui + Tailwind 4 (already pinned in `packages/web`).

Components the app needs pre-built: app shell/nav, side panel (card detail), dialog,
dropdown/context menus, forms with validation display, badges, avatar, toast, tabs, tooltip,
skeletons, select/combobox/date input (waiting-lane resume date), tree view (location tree),
table (admin lists). The kanban board itself stays custom regardless
([ADR-007](ADR-007-pragmatic-drag-and-drop.md) — Pragmatic drag-and-drop is headless and
framework-agnostic).

## Decision

**Mantine 9** (`@mantine/core` + `hooks`, `form`, `dates`, `notifications`,
`mantine-form-zod-resolver`) replaces the shadcn/ui + Tailwind plan-of-record.

Verified July 2026: 9.4.1 published 2026-06-28 (v9.0 on 2026-03-31, monthly cadence since),
peer `react ^19.2.0` (we run 19.2.7), styling is plain CSS + CSS variables (no runtime
CSS-in-JS since v7), Vite is the officially recommended SPA setup, Vitest + Testing Library is
the documented testing path.

Why it wins for this product-owner ask specifically:

- **Every required component exists pre-built and is imported from node_modules** — including
  the two that eliminate whole build tasks elsewhere: a keyboard-navigable `Tree` (location
  tree) and `DatePickerInput` (`@mantine/dates`). Zero vendored component source in
  `packages/web`, so our strict ESLint, knip, and the web 80/75 coverage gates measure only
  code we wrote.
- **Consistency is the default, not a discipline.** One theme object defines the spacing,
  font-size, radius, shadow, and heading scales, exported as `--mantine-*` CSS variables;
  component `size`/spacing props accept only named tokens (`xs…xl`). The Tailwind
  arbitrary-value class of inconsistency (`p-[13px]`, `text-[15px]`) is structurally
  unavailable unless someone writes raw CSS — which the rules below ban.
- **Forms**: `@mantine/form` + `zod4Resolver` (mantine-form-zod-resolver 1.3.0) validates with
  the Zod 4 schemas imported from `@rivian-kanban/core` — the single-schema rule
  (dev/standards.md) holds with no adapter code.
- **Dark mode** is built in (`data-mantine-color-scheme` + variables), satisfying theming
  without a second styling system.

### Alternatives (all versions/maintenance verified on npm, July 2026)

| Candidate              | Verified state                                                          | Verdict                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui + Tailwind 4 | CLI 4.13.0 (2026-07-03), radix-ui 1.6.2 (2026-07-06), tailwindcss 4.3.3 | **Rejected.** No tree view; combobox/date-picker/data-table are assemblies, not components; every component is vendored into `packages/web` and must pass our strict lint + coverage gates; arbitrary utility values make consistency a review problem, not a system |
| Mantine 9              | @mantine/core 9.4.1 (2026-06-28), monthly releases                      | **Accepted** — see above                                                                                                                                                                                                                                             |
| Chakra UI v3           | 3.36.0 (2026-06-10), built on Ark UI 5.37.2                             | **Runner-up.** Excellent semantic-token/recipe system; has TreeView and DatePicker. Rejected for the Emotion peer/runtime, no first-party form + Zod bridge, and a heavier test-environment story than Mantine's documented Vitest path                              |
| MUI (Material UI)      | @mui/material 9.2.0 (2026-07-03)                                        | **Rejected.** Tree view and date pickers live in `@mui/x` (separate versioning, tiered licensing); Emotion runtime by default; strongly Material aesthetic is expensive to neutralize; `sx` accepts arbitrary values — same consistency hole as utilities            |
| HeroUI v3              | @heroui/react 3.2.2 (2026-07-06), React Aria + Tailwind 4               | **Rejected.** Best-in-class a11y primitives, but v3 GA only since ~2026-03 (young API), no tree view (Table row-nesting only), smallest ecosystem/track record of the field                                                                                          |
| Ark UI + Park UI       | @ark-ui/react 5.37.2 (2026-06-08); Park UI is a styling registry        | **Rejected.** Headless-plus-registry means the most assembly work of any option and the thinnest maintenance behind the styled layer — the opposite of the batteries-included brief                                                                                  |

## Consequences

- `packages/web` **drops the Tailwind stack** (`tailwindcss`, `@tailwindcss/vite`,
  `tw-animate-css`, the `tailwindcss()` Vite plugin and `@import 'tailwindcss'` CSS) in the
  same change that adds Mantine — two styling systems would reintroduce inconsistency, and
  knip fails unused dependencies anyway.
- PostCSS setup (`postcss-preset-mantine` + `postcss-simple-vars`) is added to
  `packages/web`; Vite picks up `postcss.config.cjs` automatically.
- Bundle: ~8.8 MB unpacked but fully tree-shakable ESM + one static stylesheet (~30 kB gz);
  acceptable for an internal tool served by its own backend, and no runtime CSS-in-JS cost.

### Design-token usage rules (review-blocking; the screenshot audit baseline)

1. **One theme file** — `packages/web/src/theme.ts` (`createTheme`) is the only place design
   values (colors, `primaryColor`, `defaultRadius`, heading sizes, spacing overrides,
   `theme.other` constants) are defined.
2. **Spacing only via the theme scale**: component props (`p="md"`, `gap="sm"`, `mt="xl"`) or
   `var(--mantine-spacing-*)` in CSS Modules. No pixel/rem literals for
   margin/padding/gap anywhere outside `theme.ts`.
3. **Typography only via presets**: `<Text size="…">`, `<Title order={…}>` and theme heading
   styles. `font-size`/`font-weight`/`line-height` literals are banned outside `theme.ts`.
4. **Colors only via theme roles**: `c="dimmed"`, `color="red.6"`, or
   `var(--mantine-color-*)`. No hex/rgb literals outside `theme.ts`.
5. **Radii and shadows via tokens** (`radius="md"`, `shadow="sm"` /
   `var(--mantine-radius-*)`, `var(--mantine-shadow-*)`).
6. **Component sizes from the preset set** (`xs…xl`); never hand-set heights/paddings on
   inputs, buttons, badges.
7. **Custom CSS lives in CSS Modules** (board layout, drop indicators) and may consume only
   `--mantine-*` variables for the properties above; inline `style={{ … }}` with design
   values is banned (dynamic positional values from drag-and-drop excepted).
8. **Dark mode**: never author parallel dark styles by hand; use color-scheme-aware tokens and
   the `light-dark()` function only.

### Testing & integration consequences

- Unit tests render through a shared `renderWithProviders` util wrapping
  `MantineProvider` (`env="test"` disables transitions/portals timing). happy-dom 20 ships
  `matchMedia` and `ResizeObserver` natively; if a gap appears, add a **hand-written
  polyfill** in `src/test/setup.ts` — `vi.fn`/`vi.stubGlobal` are banned repo-wide
  (dev/testing.md). Overlay components render in portals: query via `screen` (document
  scope), by role/label as usual.
- Pragmatic drag-and-drop (headless) is unaffected by Mantine, with two board-adapter rules:
  lane scroll containers are **plain `overflow-y: auto` elements** (not Mantine `ScrollArea`,
  whose wrapped viewport complicates `auto-scroll` registration), and card drag previews use
  `setCustomNativeDragPreview` so styled cards don't produce clipped native previews.
- `@mantine/dates` requires the `dayjs` peer (exact-pinned like everything else).
- Docs deviation rule applies: this ADR supersedes the shadcn/Tailwind pins currently in
  `packages/web/package.json`; the swap lands with the first UI commit.
