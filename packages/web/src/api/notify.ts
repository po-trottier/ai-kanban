import { notifications } from '@mantine/notifications'
import { type ReactNode } from 'react'
import { strings } from '../strings.ts'
import { isConflictError } from './problem.ts'

/** Confirms a successful mutation — a green, clearly-visible toast (not a plain
 * white card that blends into the app background). Accepts rich content so a
 * message can bold its subject (e.g. the destination lane). */
export function notifySuccess(message: ReactNode): void {
  notifications.show({ message, color: 'teal' })
}

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
