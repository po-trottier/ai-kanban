/**
 * UTC-day rules shared by every surface. The waiting-lane overdue predicate
 * styles the OVERDUE badge in the web, drives `overdueResume` filters and the
 * stale-cards feed, and gates the hourly aging alerts — one definition here so
 * the rule can never drift between surfaces (the same reasoning as ADR-013
 * shipping `evaluatePolicy` to the web).
 */

/** The `YYYY-MM-DD` UTC date of an instant. */
export function utcDayOf(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

/**
 * A card counts as overdue starting the UTC day AFTER `expectedResumeAt`
 * (docs/product/workflow.md#waiting-on-parts--vendor-discipline). `today` is
 * a `YYYY-MM-DD` UTC date from `utcDayOf`.
 */
export function isOverdueResume(expectedResumeAt: string | null, today: string): boolean {
  return expectedResumeAt !== null && expectedResumeAt < today
}

/** A business day is 09:00–17:00 (1 working day = 8h, workflow.md#priorities-and-estimates). */
const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 17
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/**
 * Business minutes between two instants, counting only Monday–Friday
 * 09:00–17:00 in **UTC** — the org-wide, viewer-independent analog of the web
 * burn-down's per-viewer count (`packages/web/src/lib/work-progress.ts`). Core
 * imports no dayjs, so this walks UTC calendar days directly; the board-filter
 * `overdue` facet counts business time in UTC for the same reason the
 * overdue-resume date rule is a global UTC rule (ADR-019,
 * docs/architecture/board-filters.md#the-overdue-facet). 0 when `end <= start`.
 */
export function businessMinutesBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0
  let total = 0
  // Walk from UTC midnight of the day containing `start` to the day of `end`.
  let dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  while (dayStart <= end.getTime()) {
    const weekday = new Date(dayStart).getUTCDay() // 0 = Sunday, 6 = Saturday
    if (weekday !== 0 && weekday !== 6) {
      const windowStart = dayStart + BUSINESS_START_HOUR * 60 * MS_PER_MINUTE
      const windowEnd = dayStart + BUSINESS_END_HOUR * 60 * MS_PER_MINUTE
      const from = Math.max(start.getTime(), windowStart)
      const to = Math.min(end.getTime(), windowEnd)
      if (to > from) total += (to - from) / MS_PER_MINUTE
    }
    dayStart += MS_PER_DAY
  }
  return total
}

/**
 * The board-filter `overdue` verdict: the business-time elapsed since the card
 * first entered In Progress (`workStartedAt`) meets or exceeds its
 * `estimateMinutes` (docs/architecture/board-filters.md#the-overdue-facet).
 * A card with no start or no estimate can never be overdue.
 */
export function isWorkOverdue(
  workStartedAt: string | null,
  estimateMinutes: number | null,
  now: Date,
): boolean {
  if (workStartedAt === null || estimateMinutes === null) return false
  return businessMinutesBetween(new Date(workStartedAt), now) >= estimateMinutes
}
