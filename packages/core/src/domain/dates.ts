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
