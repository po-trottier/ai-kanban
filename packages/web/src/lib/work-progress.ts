/**
 * Work burn-down: how much of a card's estimate has elapsed since it first
 * entered In Progress, counted in BUSINESS time only — 09:00–17:00, Monday to
 * Friday (workflow.md: 1 working day = 8 hours). Waiting does not pause it
 * (simple elapsed). Computed in UTC so the result is deterministic regardless
 * of the viewer's timezone.
 */

const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 17
const MS_PER_MINUTE = 60_000
/** Loop backstop (~3 years of weekdays): a stale start just reads as overdue. */
const MAX_DAYS = 800

/** Business minutes (09:00–17:00 UTC, Mon–Fri) between two instants; 0 if end ≤ start. */
export function businessMinutesBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0
  let total = 0
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  for (let day = 0; day < MAX_DAYS; day += 1) {
    const weekday = cursor.getUTCDay() // 0 = Sunday, 6 = Saturday
    if (weekday !== 0 && weekday !== 6) {
      const windowStart = new Date(cursor.getTime())
      windowStart.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0)
      const windowEnd = new Date(cursor.getTime())
      windowEnd.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0)
      const from = Math.max(start.getTime(), windowStart.getTime())
      const to = Math.min(end.getTime(), windowEnd.getTime())
      if (to > from) total += (to - from) / MS_PER_MINUTE
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (cursor.getTime() > end.getTime()) break
  }
  return total
}

export interface WorkProgress {
  /** Elapsed / estimate as a 0–100 (capped) percentage for the bar. */
  percent: number
  /** True once elapsed business time meets or exceeds the estimate. */
  overdue: boolean
  /** Raw elapsed business minutes (rounded) — for the tooltip. */
  elapsedMinutes: number
}

/** The burn-down for one card: business-time elapsed since `workStartedAt` vs `estimateMinutes`. */
export function workProgress(
  workStartedAt: string,
  estimateMinutes: number,
  now: Date,
): WorkProgress {
  const elapsed = businessMinutesBetween(new Date(workStartedAt), now)
  const ratio = estimateMinutes <= 0 ? 1 : elapsed / estimateMinutes
  return {
    percent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    overdue: ratio >= 1,
    elapsedMinutes: Math.round(elapsed),
  }
}
