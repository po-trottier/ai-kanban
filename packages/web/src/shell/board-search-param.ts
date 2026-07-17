import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * The header live-filter query lives in the URL (`?q=…`) so a single source of
 * truth is shared by the header input (which writes it) and the board (which
 * subscribes to it) without a bespoke context — and the filtered view is
 * shareable and survives the deep-linked card panel. Distinct from the
 * `/search` page's own `q` state (that page owns its input); this param only
 * drives the board's client-side filter.
 */
const QUERY_PARAM = 'q'

export function useBoardSearchQuery(): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const query = params.get(QUERY_PARAM) ?? ''
  const setQuery = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next === '') updated.delete(QUERY_PARAM)
          else updated.set(QUERY_PARAM, next)
          return updated
        },
        // Typing must not stack history entries — replace so Back leaves the board.
        { replace: true },
      )
    },
    [setParams],
  )
  return [query, setQuery]
}
