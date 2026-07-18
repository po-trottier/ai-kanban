import dayjs from './dayjs.ts'

/**
 * Work burn-down: how much of a card's estimate has elapsed since it first
 * entered In Progress, counted in BUSINESS time only — 09:00–17:00, Monday to
 * Friday (workflow.md: 1 working day = 8 hours). Waiting does not pause it
 * (simple elapsed). Business hours are the VIEWER's own time zone (their
 * account setting), so the bar reflects each person's working day; dayjs.tz
 * builds each local 09:00–17:00 window, which also gets DST transitions right
 * (a local business day is 7h or 9h of real time across a shift, not always 8).
 */

const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 17
const MS_PER_MINUTE = 60_000
/** Loop backstop (~3 years of weekdays): a stale start just reads as overdue. */
const MAX_DAYS = 800

/** Business minutes (local 09:00–17:00, Mon–Fri in `timezone`) between two instants; 0 if end ≤ start. */
export function businessMinutesBetween(start: Date, end: Date, timezone: string): number {
  if (end.getTime() <= start.getTime()) return 0
  let total = 0
  // Walk local calendar days in the viewer's zone from the day containing `start`.
  let cursor = dayjs(start).tz(timezone).startOf('day')
  for (let day = 0; day < MAX_DAYS; day += 1) {
    const weekday = cursor.day() // 0 = Sunday, 6 = Saturday, in the local zone
    if (weekday !== 0 && weekday !== 6) {
      const windowStart = cursor.hour(BUSINESS_START_HOUR).valueOf()
      const windowEnd = cursor.hour(BUSINESS_END_HOUR).valueOf()
      const from = Math.max(start.getTime(), windowStart)
      const to = Math.min(end.getTime(), windowEnd)
      if (to > from) total += (to - from) / MS_PER_MINUTE
    }
    cursor = cursor.add(1, 'day')
    if (cursor.valueOf() > end.getTime()) break
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
  timezone: string,
): WorkProgress {
  const elapsed = businessMinutesBetween(new Date(workStartedAt), now, timezone)
  const ratio = estimateMinutes <= 0 ? 1 : elapsed / estimateMinutes
  return {
    percent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    overdue: ratio >= 1,
    elapsedMinutes: Math.round(elapsed),
  }
}
