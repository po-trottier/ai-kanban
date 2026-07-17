import { type CardEvent } from '@rivian-kanban/core'
import { strings } from '../strings.ts'

export interface HistoryContext {
  /** displayName by user id, for actor and field-value rendering. */
  userNames: Map<string, string>
  /** Current lane labels by key (falls back to the seeded names). */
  laneLabels?: Partial<Record<string, string>>
}

/** The actor part of a history line ("Dana", "Slack", "AI agent", "System"). */
export function describeActor(event: CardEvent, context: HistoryContext): string {
  switch (event.actorKind) {
    case 'system':
      return strings.history.actorSystem
    case 'mcp':
      return strings.history.actorAgent
    case 'slack':
    case 'user': {
      const name = event.actorId === null ? undefined : context.userNames.get(event.actorId)
      if (name !== undefined) return name
      return event.actorKind === 'slack' ? strings.history.actorSlack : strings.history.unknownUser
    }
  }
}

/** Human-readable audit line per event type (docs/user/guide.md#history). */
export function describeEvent(event: CardEvent, context: HistoryContext): string {
  const lane = (key: string): string => context.laneLabels?.[key] ?? laneFallback(key)
  switch (event.eventType) {
    case 'card.created':
      return strings.history.event.created
    case 'card.status_changed':
      return strings.history.event.statusChanged(
        lane(event.payload.fromLane),
        lane(event.payload.toLane),
      )
    case 'card.reordered':
      return strings.history.event.reordered(lane(event.payload.lane))
    case 'card.field_changed':
      return strings.history.event.fieldChanged(event.payload.field)
    case 'card.blocked':
      return strings.history.event.blocked(event.payload.reason ?? strings.common.notAvailable)
    case 'card.unblocked':
      return strings.history.event.unblocked
    case 'card.cancelled':
      return strings.history.event.cancelled(strings.resolutions[event.payload.resolution])
    case 'card.reopened':
      return strings.history.event.reopened(lane(event.payload.toLane))
    case 'card.archived':
      return strings.history.event.archived
    case 'comment.added':
      return strings.history.event.commentAdded
    case 'comment.edited':
      return strings.history.event.commentEdited
    case 'comment.deleted':
      return strings.history.event.commentDeleted
    case 'attachment.added':
      return strings.history.event.attachmentAdded(event.payload.filename)
    case 'attachment.removed':
      return strings.history.event.attachmentRemoved(event.payload.filename)
    case 'card.pii_deleted':
      return strings.history.event.piiDeleted
  }
}

function laneFallback(key: string): string {
  return key in strings.laneNames ? strings.laneNames[key as keyof typeof strings.laneNames] : key
}
