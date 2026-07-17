import { Badge, Button, Group, Popover, Stack, Text } from '@mantine/core'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import {
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  OVERDUE_COLOR,
  PRIORITY_COLORS,
  WAITING_COLOR,
} from '../theme.ts'

/**
 * A compact, plain-language key to the board's colored badges — a first-time
 * facilities user should never have to guess what P0/P1/P2 or BLOCKED mean.
 * Lives in the header as a help popover (dismissible by clicking away).
 */
export function BoardLegend() {
  return (
    <Popover position="bottom-end" withArrow shadow="md" width={340}>
      <Popover.Target>
        <Button variant="subtle" color="gray" size="sm" aria-label={strings.board.legendButton}>
          {strings.board.legendButton}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
            {strings.board.legendPriorities}
          </Text>
          <LegendRow
            color={PRIORITY_COLORS.P0}
            filled
            label={strings.priorities.P0}
            text={strings.board.legendPriorityP0}
          />
          <LegendRow
            color={PRIORITY_COLORS.P1}
            filled
            label={strings.priorities.P1}
            text={strings.board.legendPriorityP1}
          />
          <LegendRow
            color={PRIORITY_COLORS.P2}
            filled
            label={strings.priorities.P2}
            text={strings.board.legendPriorityP2}
          />
          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} mt="xs">
            {strings.board.legendStates}
          </Text>
          <LegendRow
            color={BLOCKED_COLOR}
            label={strings.card.blockedBadge}
            text={strings.board.legendBlocked}
          />
          <LegendRow
            color={WAITING_COLOR}
            label={strings.waiting.reasons.parts}
            text={strings.board.legendWaiting}
          />
          <LegendRow
            color={OVERDUE_COLOR}
            label={strings.board.legendOverdueBadge}
            text={strings.board.legendOverdue}
          />
          <LegendRow
            color={CANCELLED_COLOR}
            label={strings.resolutions.cancelled}
            text={strings.board.legendCancelled}
          />
          <LegendRow
            color={CANCELLED_COLOR}
            variant="outline"
            label={strings.card.archivedBadge}
            text={strings.board.legendArchived}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

function LegendRow({
  color,
  filled = false,
  variant,
  label,
  text,
}: {
  color: string
  filled?: boolean
  /** Overrides the light/filled default to mirror a specific board badge
   * (e.g. the Archived badge renders `outline`). */
  variant?: 'light' | 'filled' | 'outline'
  label: string
  text: string
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Badge color={color} size="sm" variant={variant ?? (filled ? 'filled' : 'light')}>
        {label}
      </Badge>
      <Text size="xs">{text}</Text>
    </Group>
  )
}
