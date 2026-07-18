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

/** Is `at` inside a business-hours window (weekday 09:00–17:00 in `timezone`)? */
export function isBusinessHours(at: Date, timezone: string): boolean {
  const local = dayjs(at).tz(timezone)
  const weekday = local.day() // 0 = Sunday, 6 = Saturday, in the local zone
  if (weekday === 0 || weekday === 6) return false
  return local.hour() >= BUSINESS_START_HOUR && local.hour() < BUSINESS_END_HOUR
}

/**
 * Whether the burn-down clock is accruing right now. Accrual counts business
 * time ONLY (09:00–17:00 Mon–Fri in the viewer's zone), so the clock runs in
 * that window and pauses outside it — the ONLY thing that stops it. Waiting on
 * parts/vendor and the blocked flag do NOT pause accrual (the simple-elapsed
 * rule above), so they are `running` states carrying a `reason` for context,
 * never a fake pause — the label stays honest about what the number counts.
 */
export type TimerState =
  | { running: true; reason: 'working' | 'waiting' | 'blocked' }
  | { running: false; reason: 'off_hours' }

/** The timer's state at `now`, given the card's waiting/blocked context. */
export function timerState(
  now: Date,
  timezone: string,
  context: { waiting: boolean; blocked: boolean },
): TimerState {
  if (!isBusinessHours(now, timezone)) return { running: false, reason: 'off_hours' }
  // Blocked is the stronger exception signal, so it wins the label over waiting.
  if (context.blocked) return { running: true, reason: 'blocked' }
  if (context.waiting) return { running: true, reason: 'waiting' }
  return { running: true, reason: 'working' }
}

/**
 * Business minutes of work between `now` and the end of the target day's
 * business window (17:00 local in `timezone`) — the estimate a user is
 * committing to when they pick a target completion DATE instead of typing
 * minutes. Uses the same `businessMinutesBetween` accrual as the burn-down, so
 * a date-derived estimate burns down to exactly 0 at end-of-business on that
 * day. Rounds to a whole minute (the stored unit); a target with no business
 * time left (e.g. today after 17:00) yields 0, which the form flags as invalid.
 */
export function minutesUntilTargetDate(targetDate: string, now: Date, timezone: string): number {
  const end = dayjs.tz(targetDate, timezone).hour(BUSINESS_END_HOUR).minute(0).second(0).toDate()
  return Math.round(businessMinutesBetween(now, end, timezone))
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
