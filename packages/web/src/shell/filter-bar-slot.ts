import { createContext, useContext } from 'react'

/**
 * Bridges the board's filter bar (rendered by BoardPage, which owns the filter
 * state + the roster/tags/locations it needs) up to a FULL-WIDTH strip AppLayout
 * places ABOVE the board+detail-panel row (#128). BoardPage portals its
 * `<FilterBar>` into this mount node, so the bar spans the whole width and never
 * shrinks or reflows when the resizable detail-panel opens or is dragged — the
 * panel only squeezes the board row BELOW the bar, never the bar itself.
 *
 * The node is `null` on AppLayout's first render (the ref callback has not run
 * yet); BoardPage renders nothing until it arrives, then portals into it.
 */
export const FilterBarSlotContext = createContext<HTMLElement | null>(null)

export function useFilterBarSlot(): HTMLElement | null {
  return useContext(FilterBarSlotContext)
}
