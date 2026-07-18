import {
  createTheme,
  MultiSelect,
  Notification,
  Select,
  type CSSVariablesResolver,
  type MantineColor,
  type MantineThemeOther,
} from '@mantine/core'
import { type Priority } from '@rivian-kanban/core'

/**
 * The single source of design values (ADR-016 token rule 1). Every color,
 * spacing, radius, and size in the app resolves through this theme — no
 * literals elsewhere.
 */

/** App-specific constants exposed as `--app-*` CSS variables below. */
const other: MantineThemeOther = {
  laneWidth: '18rem',
  boardColumnMinHeight: '10rem',
  thumbnailHeight: '6rem',
  /** Header logo height, consumed by shell.module.css. */
  headerLogoHeight: '2rem',
  /** Grab width of the card-panel resize handle (shell.module.css). */
  panelResizeHandleWidth: '0.375rem',
  /** Filter-bar field widths (filter-bar.module.css). */
  filterQueryWidth: '16rem',
  filterPillWidth: '11rem',
}

/** The one emphasis weight (card titles, comment authors, history actors) — matches headings. */
export const EMPHASIS_FONT_WEIGHT = 600

/** One-off component dimensions (ADR-016 rule 1: defined here, consumed by import). */
export const SIZES = {
  headerHeight: 56,
  authCardWidth: '24rem',
  /** Brand logo height inside the sign-in / setup cards (a touch larger than the header mark). */
  authLogoHeight: '2.75rem',
  skeletonLaneHeaderHeight: '1.5rem',
  skeletonCardHeight: '5rem',
  /** Fixed lanes-admin inputs so the grid aligns regardless of label length. */
  laneLabelInputWidth: '16rem',
  laneWipLimitInputWidth: '6.5rem',
  /** The docked card-detail Aside default width (matches the old Drawer `size="lg"`). */
  cardPanelWidth: 620,
  /** Resizable-panel bounds: a readable minimum, a fallback max when the
   * viewport width is unknown, and the sliver of board kept visible when the
   * panel is dragged to its (viewport-relative) maximum. */
  cardPanelMinWidth: 450,
  cardPanelMaxWidth: 900,
  cardPanelMinBoardVisible: 140,
} as const

/** The viewport below which the card panel goes full-screen (matches <=62em). */
export const CARD_PANEL_FULLSCREEN_BREAKPOINT = '62em'

export const theme = createTheme({
  primaryColor: 'indigo',
  // Mantine 9 defaults, pinned explicitly as the screenshot-audit baseline.
  defaultRadius: 'md',
  headings: { fontWeight: String(EMPHASIS_FONT_WEIGHT) },
  // Every option dropdown shows the selected row's checkmark on the RIGHT of the
  // label, not the left — one place so all comboboxes read the same.
  components: {
    Select: Select.extend({ defaultProps: { checkIconPosition: 'right' } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { checkIconPosition: 'right' } }),
    // Toasts get a visible border + shadow so they stand out from the white app
    // background instead of blending into it.
    Notification: Notification.extend({ defaultProps: { withBorder: true } }),
  },
  other,
})

/** Maps `theme.other` constants to CSS variables consumable from CSS Modules. */
export const cssVariablesResolver: CSSVariablesResolver = (resolved) => ({
  variables: {
    '--app-lane-width': String(resolved.other.laneWidth),
    '--app-board-column-min-height': String(resolved.other.boardColumnMinHeight),
    '--app-thumbnail-height': String(resolved.other.thumbnailHeight),
    '--app-header-logo-height': String(resolved.other.headerLogoHeight),
    '--app-panel-resize-handle-width': String(resolved.other.panelResizeHandleWidth),
    '--app-filter-query-width': String(resolved.other.filterQueryWidth),
    '--app-filter-pill-width': String(resolved.other.filterPillWidth),
  },
  light: {},
  dark: {},
})

/**
 * Severity/status color roles (theme color names, not literals — token rule 4).
 * Every state has a DISTINCT hue so no two badges read as the same color:
 * priorities red/orange/gray, then blocked=grape, waiting=yellow, overdue=pink,
 * cancelled=dark, archived=gray (the lone outline badge). The former shared
 * reds (P0 / blocked / overdue) and grays (P2 / cancelled) are gone.
 */
export const PRIORITY_COLORS: Record<Priority, MantineColor> = {
  P0: 'red',
  P1: 'orange',
  P2: 'gray',
}

export const BLOCKED_COLOR: MantineColor = 'grape'
export const WAITING_COLOR: MantineColor = 'yellow'
export const OVERDUE_COLOR: MantineColor = 'pink'
export const CANCELLED_COLOR: MantineColor = 'dark'
export const ARCHIVED_COLOR: MantineColor = 'gray'
