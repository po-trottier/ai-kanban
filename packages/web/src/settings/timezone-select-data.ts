import { DEFAULT_TIMEZONE } from '@rivian-kanban/core'

/**
 * The IANA zones the runtime knows — the exact list core's `timezoneSchema`
 * validates against (`Intl.supportedValuesOf`), so the picker can never offer,
 * and auto-detect can never send, a value the server would reject.
 */
const SUPPORTED_TIME_ZONES = Intl.supportedValuesOf('timeZone')
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_TIME_ZONES)

/** Mantine Select data for the profile picker; labels read with spaces ("America/Los Angeles"). */
export const TIMEZONE_SELECT_DATA = SUPPORTED_TIME_ZONES.map((zone) => ({
  value: zone,
  label: zone.replace(/_/g, ' '),
}))

/** The browser's own IANA zone at signup, or PST if it isn't one we recognize. */
export function detectBrowserTimezone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  return SUPPORTED_SET.has(detected) ? detected : DEFAULT_TIMEZONE
}
