import { utcDayOf } from '@rivian-kanban/core'
import dayjs from './dayjs.ts'

/** Hours in a working day (docs/product/workflow.md#priorities-and-estimates). */
const WORKING_HOURS_PER_DAY = 8
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = MINUTES_PER_HOUR * WORKING_HOURS_PER_DAY

/** The units a user may enter an estimate in (stored as integer minutes). */
export const ESTIMATE_UNITS = ['minutes', 'hours', 'days'] as const
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number]

export function isEstimateUnit(value: string): value is EstimateUnit {
  return (ESTIMATE_UNITS as readonly string[]).includes(value)
}

/**
 * Renders estimate minutes as hours/days with 1 day = 8 working hours
 * (90 → "1.5h", 960 → "2d").
 */
export function formatEstimate(minutes: number): string {
  const hours = minutes / MINUTES_PER_HOUR
  if (hours >= WORKING_HOURS_PER_DAY) {
    return `${trimTrailingZero(hours / WORKING_HOURS_PER_DAY)}d`
  }
  if (hours >= 1) return `${trimTrailingZero(hours)}h`
  return `${String(minutes)}m`
}

/**
 * Splits stored minutes into the largest whole-ish unit for the editor: a
 * multiple of a working day → days, of an hour → hours, else minutes. Round
 * trips exactly with `estimateToMinutes` (960 → 2 days → 960).
 */
export function estimateToParts(minutes: number): { value: number; unit: EstimateUnit } {
  if (minutes % MINUTES_PER_DAY === 0) return { value: minutes / MINUTES_PER_DAY, unit: 'days' }
  if (minutes % MINUTES_PER_HOUR === 0) return { value: minutes / MINUTES_PER_HOUR, unit: 'hours' }
  return { value: minutes, unit: 'minutes' }
}

/**
 * Converts an entered value + unit to integer minutes (1 day = 8 working
 * hours). Fractions are allowed on entry (1.5 days → 720) then rounded to a
 * whole minute — the stored unit (core schema: positive integer minutes).
 */
export function estimateToMinutes(value: number, unit: EstimateUnit): number {
  const factor = unit === 'days' ? MINUTES_PER_DAY : unit === 'hours' ? MINUTES_PER_HOUR : 1
  return Math.round(value * factor)
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

/** Today as `YYYY-MM-DD` in the given IANA zone — the minimum for resume-date pickers. */
export function todayInTimezone(timezone: string): string {
  return dayjs().tz(timezone).format('YYYY-MM-DD')
}

/** An absolute timestamp rendered in the viewer's own time zone (IANA id). */
export function formatDateTime(iso: string, timezone: string): string {
  return dayjs(iso).tz(timezone).format('MMM D, YYYY HH:mm')
}

/**
 * A short date ("Jul 20") for the board's resume cue and compact rows. Its
 * input is a calendar date (`YYYY-MM-DD`, no time), which carries no zone — so
 * it is rendered as-is and NOT converted to the viewer's time zone (that would
 * shift the day for some viewers).
 */
export function formatDate(iso: string): string {
  return dayjs(iso).format('MMM D')
}

/** The human-readable ticket number ("#42") shown on cards, the panel, and search. */
export function formatTicketNumber(cardNumber: number): string {
  return `#${String(cardNumber)}`
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
