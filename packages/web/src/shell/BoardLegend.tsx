import { ActionIcon, Badge, Modal, Text, Tooltip } from '@mantine/core'
import { HelpCircle } from 'lucide-react'
import { useState } from 'react'
import { strings } from '../strings.ts'
import {
  BLOCKED_COLOR,
  CANCELLED_COLOR,
  EMPHASIS_FONT_WEIGHT,
  OVERDUE_COLOR,
  PRIORITY_COLORS,
  WAITING_COLOR,
} from '../theme.ts'
import classes from './legend.module.css'

/** Priority descriptions come from the SAME source the priority dropdown uses
 * (strings.priorityOptions) so the two can never disagree. */
function priorityText(priority: 'P0' | 'P1' | 'P2'): string {
  const meaning = strings.priorityOptions[priority]
  return `${meaning.name} — ${meaning.description}`
}

/**
 * A compact, plain-language key to the board's colored badges — a first-time
 * facilities user should never have to guess what P0/P1/P2 or BLOCKED mean.
 * The trigger is a small help icon in the header cluster; the guide opens as a
 * centered modal laid out as an aligned two-column table (a fixed-width column
 * clipped the longer status words; a ragged one was hard to scan).
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
        <div className={classes.grid}>
          <Text className={classes.section} size="sm" fw={EMPHASIS_FONT_WEIGHT}>
            {strings.board.legendPriorities}
          </Text>
          <LegendRow
            color={PRIORITY_COLORS.P0}
            filled
            label={strings.priorities.P0}
            text={priorityText('P0')}
          />
          <LegendRow
            color={PRIORITY_COLORS.P1}
            filled
            label={strings.priorities.P1}
            text={priorityText('P1')}
          />
          <LegendRow
            color={PRIORITY_COLORS.P2}
            filled
            label={strings.priorities.P2}
            text={priorityText('P2')}
          />
          <Text className={classes.section} size="sm" fw={EMPHASIS_FONT_WEIGHT}>
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
        </div>
      </Modal>
    </>
  )
}

/** One table row: a badge in the left column, its meaning in the right — each
 * a direct grid child so the columns align (see legend.module.css). */
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
    <>
      <Badge color={color} size="sm" variant={variant ?? (filled ? 'filled' : 'light')}>
        {label}
      </Badge>
      <Text size="xs">{text}</Text>
    </>
  )
}
