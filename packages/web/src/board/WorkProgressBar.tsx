import { Progress, Tooltip } from '@mantine/core'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatEstimate } from '../lib/format.ts'
import { useNow } from '../lib/use-now.ts'
import { workProgress } from '../lib/work-progress.ts'
import { strings } from '../strings.ts'
import { OVERDUE_COLOR } from '../theme.ts'

/** How often the bar re-computes so it stays live without a board refetch. */
const TICK_MS = 60_000

/**
 * A burn-down bar for a card that's in the work lanes: how much of its estimate
 * has elapsed in business hours since it first entered In Progress. It fills as
 * time is spent and turns red once it passes the estimate (overdue). Ticks on
 * its own minute timer so it stays current.
 */
export function WorkProgressBar({
  workStartedAt,
  estimateMinutes,
}: {
  workStartedAt: string
  estimateMinutes: number
}) {
  const now = useNow(TICK_MS)
  const timezone = useUserTimezone()
  const { percent, overdue, elapsedMinutes } = workProgress(
    workStartedAt,
    estimateMinutes,
    now,
    timezone,
  )
  const elapsed = formatEstimate(elapsedMinutes)
  const estimate = formatEstimate(estimateMinutes)
  return (
    <Tooltip
      label={
        overdue
          ? strings.card.workOverdueTooltip(elapsed, estimate)
          : strings.card.workProgressTooltip(elapsed, estimate)
      }
    >
      {/* Root + Section (not the single <Progress>) so the section — which
          Mantine gives role="progressbar" + aria-valuenow — carries our label. */}
      <Progress.Root mt="xs" size="sm" radius="xl">
        <Progress.Section
          value={percent}
          color={overdue ? OVERDUE_COLOR : 'indigo'}
          aria-label={strings.card.workProgressLabel(percent)}
        />
      </Progress.Root>
    </Tooltip>
  )
}
