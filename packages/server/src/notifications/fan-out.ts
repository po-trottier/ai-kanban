import { type NotificationService } from '@rivian-kanban/core'
import { type InProcessEventBus } from '../adapters/event-bus.ts'

/**
 * Fans committed card events out to watcher notifications (docs/architecture/
 * notifications.md). A post-commit, best-effort EventBus subscriber: on each
 * CARD hint it creates notifications for the card's watchers (except the actor)
 * in its own transaction. A fan-out failure never affects the mutation that
 * already committed. The web inbox picks the rows up on its poll + card-hint
 * refetch, so no extra SSE frame is emitted here. Returns the unsubscribe fn.
 */
export function subscribeNotificationFanOut(
  eventBus: InProcessEventBus,
  notifications: NotificationService,
): () => void {
  return eventBus.subscribe((hint) => {
    // Only card events carry the cardId + eventId a notification needs; board
    // hints are ignored (nothing to fan out).
    if (!('cardId' in hint)) return
    void notifications.fanOutForEvent(hint.cardId, hint.eventId).catch(() => undefined)
  })
}
