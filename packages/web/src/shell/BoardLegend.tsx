import { ActionIcon, Badge, Group, Modal, Stack, Text, Tooltip } from '@mantine/core'
import { HelpCircle } from 'lucide-react'
import { useState } from 'react'
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
 * The trigger is a small help icon in the header cluster; the guide opens as a
 * centered modal so its rows never clip at the viewport edge (the old bottom-
 * end popover pushed them off-screen).
 */
export function BoardLegend() {
  const [opened, setOpened] = useState(false)
  return (
    <>
      <Tooltip label={strings.board.legendButton}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          aria-label={strings.board.legendButton}
          onClick={() => {
            setOpened(true)
          }}
        >
          <HelpCircle size="1.25rem" aria-hidden />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => {
          setOpened(false)
        }}
        title={strings.board.legendTitle}
        centered
      >
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
      </Modal>
    </>
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
      {/* The badge sizes to its own content and never shrinks, so every status
          word stays whole (a fixed-width column clipped the longer ones to
          BLOCK…, PAR…, CANCELL…). */}
      <Badge
        color={color}
        size="sm"
        variant={variant ?? (filled ? 'filled' : 'light')}
        style={{ flexShrink: 0 }}
      >
        {label}
      </Badge>
      <Text size="xs">{text}</Text>
    </Group>
  )
}
