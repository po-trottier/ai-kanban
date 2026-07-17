import { createContext, useContext } from 'react'

/**
 * Bridges the deep-linked `/cards/:cardId` route element (rendered inside the
 * board's Outlet) to the AppShell's docked Aside (rendered by AppLayout). The
 * route element publishes the open card id here; AppLayout reads it to reserve
 * and render the Aside so the panel docks BELOW the full-width header and the
 * board (Main) shrinks and scrolls independently under it — never an overlay.
 */
export interface CardPanelSlotValue {
  /** The card id currently deep-linked, or null when the panel is closed. */
  openCardId: string | null
  /** Called by the route element on mount/unmount to publish/clear the id. */
  setOpenCardId: (cardId: string | null) => void
}

export const CardPanelSlotContext = createContext<CardPanelSlotValue | null>(null)

export function useCardPanelSlot(): CardPanelSlotValue {
  const value = useContext(CardPanelSlotContext)
  if (value === null) throw new Error('useCardPanelSlot must be used within AppLayout')
  return value
}
