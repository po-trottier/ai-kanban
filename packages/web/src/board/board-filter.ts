import { type BoardCard } from '@rivian-kanban/core'
import { type BoardResponse } from '../api/schemas.ts'

/**
 * The header live-search over the already-loaded board payload (no request):
 * a case-insensitive substring match on the fields the summary carries —
 * title, tag names, and the location label. The board summary deliberately
 * omits descriptions (envelopes.ts), so a description-scoped or archived search
 * still belongs to the `/search` page; this filter is the instant board view.
 */
export interface FilteredBoard {
  /** The board with non-matching cards removed; the SAME reference when idle. */
  board: BoardResponse
  /** Whether a query is actually filtering (a non-blank, trimmed query). */
  active: boolean
}

/** True when the query is a case-insensitive substring of any searchable field. */
function cardMatches(card: BoardCard, needle: string): boolean {
  if (card.title.toLowerCase().includes(needle)) return true
  if (card.locationLabel?.toLowerCase().includes(needle) === true) return true
  return card.tags.some((tag) => tag.toLowerCase().includes(needle))
}

/**
 * Filters the board to the cards matching `query`. Lanes always survive (an
 * empty lane still shows its header + hint); `wipLimitExceeded` recomputes off
 * the visible subset so a filtered lane never shows a spurious over-limit cue.
 * A blank query returns the input board untouched (same reference) so an idle
 * search does no work and re-renders nothing.
 */
export function filterBoard(board: BoardResponse, query: string): FilteredBoard {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { board, active: false }
  return {
    active: true,
    board: {
      lanes: board.lanes.map((snapshot) => {
        const cards = snapshot.cards.filter((card) => cardMatches(card, needle))
        return {
          ...snapshot,
          cards,
          wipLimitExceeded:
            snapshot.lane.wipLimit !== null && cards.length > snapshot.lane.wipLimit,
        }
      }),
    },
  }
}
