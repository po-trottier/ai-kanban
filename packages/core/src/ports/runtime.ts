import { type Priority } from '../domain/constants.ts'
import { type Card, type User } from '../domain/entities.ts'
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

/**
 * Structured ticket draft produced by the summarizer — always reviewed by a
 * human in the Slack modal before a card exists (docs/architecture/slack.md).
 */
export interface SummaryDraft {
  title: string
  description: string
  suggestedPriority: Priority
  tags: string[]
}

/**
 * LLM summarization (provider-agnostic adapter in the server package,
 * ADR-017). Returns null on any failure — provider error, malformed output,
 * timeout — so callers fall back to the raw thread text; summarization must
 * never block ticket creation.
 */
export interface SummarizerPort {
  summarize(threadText: string): Promise<SummaryDraft | null>
}

/**
 * User-facing notifications. Completion notifies the card's requester
 * (docs/product/workflow.md#terminal-states); cancellation deliberately
 * notifies no one. Notifications are best-effort: callers invoke this after
 * the mutation has committed and swallow rejections — an adapter failure
 * (e.g. Slack outage) must never surface a committed command as failed.
 */
export interface NotifierPort {
  cardCompleted(card: Card): Promise<void>
  /**
   * Waiting-lane aging alert (docs/product/workflow.md#waiting-on-parts--vendor-discipline):
   * the card is past its `expectedResumeAt`. `recipients` are the resolved
   * users to DM — the assignee (if any) plus every active supervisor, deduped
   * by the caller (the hourly job). Fired at most once per overdue episode:
   * the job marks `resumeAlertedAt` in the same transaction that claims the
   * card, so this is best-effort like `cardCompleted` — a delivery failure
   * never re-fires the episode.
   */
  waitingOverdue(card: Card, recipients: User[]): Promise<void>
}
