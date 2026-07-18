import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

/**
 * The one place the `utc` + `timezone` plugins are wired, so every `.tz(zone)`
 * call in the app (date rendering in format.ts, the work-progress burn-down)
 * shares a single configured dayjs. Extending is a global, idempotent side
 * effect — importing this module guarantees it happened before any `.tz(...)`.
 */
dayjs.extend(utc)
dayjs.extend(timezone)

export default dayjs
