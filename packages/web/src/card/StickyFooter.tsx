import { type ReactNode } from 'react'
import classes from './card.module.css'

/**
 * The action bar shared by the card detail panel (Save) and the New Card modal
 * (Cancel / Create): pinned to the bottom of its scroll container so it stays
 * visible while the body scrolls. All styling lives in `.stickyFooter`; this is
 * just the shared element so both call sites read the same, and adjusting the
 * pinned bar is a one-file edit. Children lay themselves out (a full-width Save,
 * or a right-aligned Cancel/Create Group).
 */
export function StickyFooter({ children }: { children: ReactNode }) {
  return <div className={classes.stickyFooter}>{children}</div>
}
