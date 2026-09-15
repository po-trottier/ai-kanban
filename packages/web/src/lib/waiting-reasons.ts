import { type WaitingReasonDefinition } from '@rivian-kanban/core'

/** Keep a card's retired choice visible for date-only edits, but not selectable anew. */
export function waitingReasonOptions(reasons: WaitingReasonDefinition[], current?: string | null) {
  return reasons
    .filter((reason) => reason.active || reason.key === current)
    .map((reason) => ({
      value: reason.key,
      label: reason.label,
      disabled: !reason.active,
    }))
}
