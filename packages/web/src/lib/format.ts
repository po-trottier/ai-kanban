import { utcDayOf } from '@rivian-kanban/core'
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

/**
 * Today as `YYYY-MM-DD` in UTC — core's `utcDayOf` (the domain UTC-day rule;
 * `isOverdueResume` comparisons import it from core directly) over the wall
 * clock, since components have no Clock port.
 */
export function utcToday(): string {
  return utcDayOf(new Date())
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
