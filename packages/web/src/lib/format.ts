import dayjs from 'dayjs'

/** Hours in a working day (docs/product/workflow.md#priorities-and-estimates). */
const WORKING_HOURS_PER_DAY = 8

/**
 * Renders estimate minutes as hours/days with 1 day = 8 working hours
 * (90 → "1.5h", 960 → "2d").
 */
export function formatEstimate(minutes: number): string {
  const hours = minutes / 60
  if (hours >= WORKING_HOURS_PER_DAY) {
    return `${trimTrailingZero(hours / WORKING_HOURS_PER_DAY)}d`
  }
  if (hours >= 1) return `${trimTrailingZero(hours)}h`
  return `${String(minutes)}m`
}

function trimTrailingZero(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return String(rounded)
}

/** Today as `YYYY-MM-DD` in UTC (waiting-lane overdue comparisons). */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * A card counts as overdue starting the UTC day after `expectedResumeAt`
 * (docs/product/workflow.md#waiting-on-parts--vendor-discipline).
 */
export function isOverdueResume(expectedResumeAt: string | null, today: string): boolean {
  return expectedResumeAt !== null && expectedResumeAt < today
}

export function formatDateTime(iso: string): string {
  return dayjs(iso).format('MMM D, YYYY HH:mm')
}

/** Initials for avatar fallbacks: "Ada Lovelace" → "AL". */
export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => (part[0] ?? '').toUpperCase())
    .join('')
}
