import { Group, Progress, Text, Tooltip } from '@mantine/core'
import { Pause, Play } from 'lucide-react'
import { useBusinessHours } from '../api/meta.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatEstimate } from '../lib/format.ts'
import { useNow } from '../lib/use-now.ts'
import { timerState, workProgress } from '../lib/work-progress.ts'
import { strings } from '../strings.ts'
import { OVERDUE_COLOR } from '../theme.ts'

/** How often the bar re-computes so it stays live without a board refetch. */
const TICK_MS = 60_000

/**
 * A burn-down bar for a card that's in the work lanes: how much of its estimate
 * has elapsed in business hours since it first entered In Progress. It fills as
 * time is spent and turns red once it passes the estimate (overdue), and shows
 * whether the clock is RUNNING or PAUSED right now and why (paused off-hours;
 * running while working / waiting / blocked — since the clock counts business
 * time only, off-hours is the only real pause). Ticks on its own minute timer.
 */
export function WorkProgressBar({
  workStartedAt,
  estimateMinutes,
  waiting = false,
  blocked = false,
}: {
  workStartedAt: string
  estimateMinutes: number
  /** Card is in Waiting on Parts / Vendor — surfaced as the running reason. */
  waiting?: boolean
  /** Card carries the blocked flag — surfaced as the running reason. */
  blocked?: boolean
}) {
  const now = useNow(TICK_MS)
  const timezone = useUserTimezone()
  const hours = useBusinessHours()
  const { percent, overdue, elapsedMinutes } = workProgress(
    workStartedAt,
    estimateMinutes,
    now,
    timezone,
    hours,
  )
  const timer = timerState(now, timezone, { waiting, blocked }, hours)
  const elapsed = formatEstimate(elapsedMinutes)
  const estimate = formatEstimate(estimateMinutes)
  const stateLabel = timer.running ? strings.card.timerRunning : strings.card.timerPaused
  const reason = strings.card.timerReason[timer.reason]
  // One line the chip, the tooltip, and the aria-label all share.
  const stateText = `${stateLabel} — ${reason}`
  return (
    <Tooltip
      label={
        overdue
          ? strings.card.workOverdueTooltip(stateText, elapsed, estimate)
          : strings.card.workProgressTooltip(stateText, elapsed, estimate)
      }
      multiline
      w={260}
    >
      <div>
        <Group gap={4} wrap="nowrap" mt="xs" c="dimmed">
          {timer.running ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
          <Text size="xs">{stateText}</Text>
        </Group>
        {/* Root + Section (not the single <Progress>) so the section — which
            Mantine gives role="progressbar" + aria-valuenow — carries our label. */}
        <Progress.Root mt={4} size="sm" radius="xl">
          <Progress.Section
            value={percent}
            color={overdue ? OVERDUE_COLOR : 'indigo'}
            aria-label={`${strings.card.workProgressLabel(percent)}. ${stateText}`}
          />
        </Progress.Root>
      </div>
    </Tooltip>
  )
}
