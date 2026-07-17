import { notifications } from '@mantine/notifications'
import { strings } from '../strings.ts'
import { isConflictError } from './problem.ts'

/** Toasts a failed mutation with the problem+json title (generic fallback). */
export function notifyError(error: unknown): void {
  notifications.show({
    message: error instanceof Error ? error.message : strings.common.genericError,
    color: 'red',
  })
}

/** 409 → the calm "someone else got there first" toast (ADR-012); anything else → problem title. */
export function notifyCardError(error: unknown): void {
  if (isConflictError(error)) {
    notifications.show({ message: strings.card.cardJustUpdated, color: 'yellow' })
    return
  }
  notifyError(error)
}
