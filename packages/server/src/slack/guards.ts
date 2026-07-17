import { type AllMiddlewareArgs, type AnyMiddlewareArgs } from '@slack/bolt'
import { z } from 'zod'
import { type AdapterLogger } from '../types.ts'
import { type BoundedLruSet } from './dedup.ts'

/**
 * Cross-cutting delivery guards, registered as global Bolt middleware ahead
 * of every listener (docs/architecture/slack.md):
 *
 * - **team pinning**: the expected workspace `team_id` comes from config;
 *   events from any other workspace are rejected.
 * - **dedup**: Socket Mode redelivers unacknowledged events; the bounded LRU
 *   swallows redeliveries so they cannot double-create tickets.
 */

const envelopeSchema = z.looseObject({
  type: z.string().optional(),
  team_id: z.string().optional(),
  event_id: z.string().optional(),
  trigger_id: z.string().optional(),
  team: z.looseObject({ id: z.string().optional() }).nullish(),
})

type Envelope = z.infer<typeof envelopeSchema>

function dedupKeyOf(envelope: Envelope): string | null {
  if (envelope.type === 'event_callback' && envelope.event_id !== undefined) {
    return `event:${envelope.event_id}`
  }
  if (envelope.type === 'message_action' && envelope.trigger_id !== undefined) {
    // Shortcut invocations carry no event_id; the trigger_id is unique per
    // invocation and identical across Socket Mode redeliveries.
    return `shortcut:${envelope.trigger_id}`
  }
  return null
}

type GuardArgs = AnyMiddlewareArgs & AllMiddlewareArgs

/** Interactive payloads carry an ack; events do not. Swallowed deliveries ack when they can. */
function ackOf(args: GuardArgs): (() => Promise<void>) | undefined {
  const ack: unknown = (args as { ack?: unknown }).ack
  return typeof ack === 'function' ? (ack as () => Promise<void>) : undefined
}

export interface DeliveryGuardOptions {
  teamId: string
  dedup: BoundedLruSet
  logger: AdapterLogger
}

export function createDeliveryGuard(
  options: DeliveryGuardOptions,
): (args: GuardArgs) => Promise<void> {
  return async (args) => {
    const parsed = envelopeSchema.safeParse(args.body)
    const envelope: Envelope = parsed.success ? parsed.data : {}
    const teamId = envelope.team_id ?? envelope.team?.id ?? null
    if (teamId !== options.teamId) {
      options.logger.warn({ teamId }, 'rejected Slack event from foreign workspace')
      await ackOf(args)?.()
      return
    }
    const key = dedupKeyOf(envelope)
    if (key !== null && !options.dedup.addIfAbsent(key)) {
      options.logger.info({ key }, 'duplicate Slack delivery ignored')
      await ackOf(args)?.()
      return
    }
    await args.next()
  }
}
