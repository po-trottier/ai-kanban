import { type Card } from '../domain/entities.ts'
import { type SseHint } from '../domain/sse.ts'

/**
 * Runtime ports (ADR-004): time, ids, realtime hints, blobs, and outbound
 * integrations. Each has one production adapter; unit tests inject fakes.
 */

/** Time is a port so tests inject fixed values instead of faking globals. */
export interface Clock {
  now(): Date
}

/** Id generation is a port for the same reason (UUIDv7 in production). */
export interface IdGenerator {
  newId(): string
}

/**
 * Publishes SSE invalidation hints. Services publish after the unit of work
 * commits — a hint for an uncommitted mutation must never be observable.
 */
export interface EventBus {
  publish(hint: SseHint): void
}

/** Binary storage for attachment blobs; keys are server-generated UUIDs. */
export interface BlobStorePort {
  put(key: string, content: Uint8Array): Promise<void>
  /** The stored bytes, or null when the key is unknown (download route). */
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
}

/** LLM summarization (Anthropic adapter in the server package). */
export interface SummarizerPort {
  summarize(text: string): Promise<string>
}

/** Thin Slack Web API surface for outbound messages (Bolt adapter implements). */
export interface SlackClientPort {
  sendDirectMessage(slackUserId: string, text: string): Promise<void>
}

/**
 * User-facing notifications. Completion notifies the card's requester
 * (docs/product/workflow.md#terminal-states); cancellation deliberately
 * notifies no one. Notifications are best-effort: services call this after
 * the mutation has committed and swallow rejections — an adapter failure
 * (e.g. Slack outage) must never surface a committed command as failed.
 */
export interface NotifierPort {
  cardCompleted(card: Card): Promise<void>
}
