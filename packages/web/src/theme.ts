import {
  createTheme,
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
}

/** The one emphasis weight (card titles, comment authors, history actors) — matches headings. */
export const EMPHASIS_FONT_WEIGHT = 600

/** One-off component dimensions (ADR-016 rule 1: defined here, consumed by import). */
export const SIZES = {
  headerHeight: 56,
  authCardWidth: '24rem',
  skeletonLaneHeaderHeight: '1.5rem',
  skeletonCardHeight: '5rem',
  /** Fixed lanes-admin inputs so the grid aligns regardless of label length. */
  laneLabelInputWidth: '16rem',
  laneWipLimitInputWidth: '6.5rem',
} as const

export const theme = createTheme({
  primaryColor: 'indigo',
  // Mantine 9 defaults, pinned explicitly as the screenshot-audit baseline.
  defaultRadius: 'md',
  headings: { fontWeight: String(EMPHASIS_FONT_WEIGHT) },
  other,
})

/** Maps `theme.other` constants to CSS variables consumable from CSS Modules. */
export const cssVariablesResolver: CSSVariablesResolver = (resolved) => ({
  variables: {
    '--app-lane-width': String(resolved.other.laneWidth),
    '--app-board-column-min-height': String(resolved.other.boardColumnMinHeight),
    '--app-thumbnail-height': String(resolved.other.thumbnailHeight),
  },
  light: {},
  dark: {},
})

/** Severity color roles (theme color names, not literals — token rule 4). */
export const PRIORITY_COLORS: Record<Priority, MantineColor> = {
  P0: 'red',
  P1: 'orange',
  P2: 'gray',
}

export const BLOCKED_COLOR: MantineColor = 'red'
export const WAITING_COLOR: MantineColor = 'yellow'
export const OVERDUE_COLOR: MantineColor = 'red'
export const CANCELLED_COLOR: MantineColor = 'gray'
