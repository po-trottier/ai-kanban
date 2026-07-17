import { type ReactNode } from 'react'
import { strings } from '../strings.ts'

/** "Card moved to **Lane**" — the destination lane bolded so the toast reads at
 * a glance (rich content, unlike the plain-string confirmations). */
export function movedToMessage(laneLabel: string): ReactNode {
  return (
    <>
      {strings.board.movedToPrefix}
      <strong>{laneLabel}</strong>
    </>
  )
}
