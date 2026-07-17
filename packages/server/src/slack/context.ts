import {
  type Actor,
  type CardService,
  type SummarizerPort,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'
import { type SlidingWindowLimiter } from './throttle.ts'

/**
 * Everything the Slack listeners share, assembled once by createSlackApp.
 * Listeners hold zero business logic — they translate Slack payloads into
 * core-service calls through this context (docs/architecture/slack.md).
 */

export interface SlackLimits {
  /** Per-Slack-user card creations per minute. */
  cardsPerUserPerMinute: number
  /** Per-Slack-user summarizer invocations per minute. */
  summariesPerUserPerMinute: number
  /** Global summarizer budget per hour (LLM spend cap). */
  summariesGlobalPerHour: number
  /** Bounded LRU capacity for delivery dedup. */
  dedupCapacity: number
}

export const DEFAULT_SLACK_LIMITS: SlackLimits = {
  cardsPerUserPerMinute: 10,
  summariesPerUserPerMinute: 5,
  summariesGlobalPerHour: 60,
  dedupCapacity: 2_048,
}

export interface SlackContext {
  cards: CardService
  uow: UnitOfWork
  summarizer: SummarizerPort | null
  logger: AdapterLogger
  teamId: string
  publicBaseUrl: string
  cardLimiter: SlidingWindowLimiter
  summaryUserLimiter: SlidingWindowLimiter
  summaryGlobalLimiter: SlidingWindowLimiter
}

/** The audited identity for every Slack-surface mutation (ADR-005). */
export function slackActorOf(user: User): Actor {
  return { kind: 'slack', id: user.id, role: user.role }
}

/**
 * Consumes summarizer budget (per-user, then global) — true when this event
 * may invoke the LLM. Exhausted budgets degrade to the raw-text prefill; they
 * never block the flow.
 */
export function acquireSummaryBudget(ctx: SlackContext, slackUserId: string): boolean {
  return (
    ctx.summarizer !== null &&
    ctx.summaryUserLimiter.tryAcquire(slackUserId) &&
    ctx.summaryGlobalLimiter.tryAcquire('global')
  )
}
