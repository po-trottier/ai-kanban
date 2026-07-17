import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * The advanced-search modal's open state lives in the URL (`?search=1`) so it
 * is shareable, survives a refresh, and closes on browser Back — the same
 * pattern the board filter uses for `?q=`. Any surface can open it (the header
 * field's filter icon, the board's no-matches link) by setting the param, and
 * the modal reads the sibling `?q=` value to pre-populate its query field.
 */
const SEARCH_PARAM = 'search'

export function useSearchModal(): { opened: boolean; open: () => void; close: () => void } {
  const [params, setParams] = useSearchParams()
  const opened = params.get(SEARCH_PARAM) === '1'
  const open = useCallback(() => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.set(SEARCH_PARAM, '1')
        return updated
      },
      // Opening is a discrete navigation, so Back should close it (push, not replace).
      { replace: false },
    )
  }, [setParams])
  const close = useCallback(() => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.delete(SEARCH_PARAM)
        return updated
      },
      { replace: true },
    )
  }, [setParams])
  return { opened, open, close }
}
