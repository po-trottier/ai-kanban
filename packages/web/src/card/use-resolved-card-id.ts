import { useBoard } from '../api/board.ts'
import { useCardByNumber } from '../api/card.ts'

/**
 * Deep-link URLs carry the human ticket NUMBER (`/cards/1`), but the panel and
 * SSE key every query by the card UUID. Resolve number → uuid here so the rest
 * of the panel stays uuid-based (and SSE invalidation keeps working):
 *
 * - a bare uuid passes straight through (legacy links / internal navigation);
 * - an active card's number resolves from the board snapshot with NO fetch;
 * - an archived card (or a cold reload before the board loads) falls back to a
 *   by-number fetch;
 * - an unknown number returns the raw param so the panel's detail fetch 404s and
 *   shows the not-found error, rather than hanging blank.
 *
 * Returns `null` only while genuinely resolving (board or fetch in flight).
 */
export function useResolvedCardId(param: string): string | null {
  const numeric = /^\d+$/.test(param)
  const board = useBoard()
  const boardCards = board.data?.lanes.flatMap((lane) => lane.cards)
  const fromBoard =
    numeric && boardCards !== undefined
      ? (boardCards.find((card) => card.number === Number(param))?.id ?? null)
      : null
  // Only reach for the network once the board has loaded and confirmed the card
  // is not on it (archived) — otherwise wait for the board to resolve it.
  const needFetch = numeric && board.data !== undefined && fromBoard === null
  const byNumber = useCardByNumber(needFetch ? Number(param) : null)

  if (!numeric) return param
  if (fromBoard !== null) return fromBoard
  if (byNumber.data !== undefined) return byNumber.data.card.id
  if (byNumber.isError) return param
  return null
}
