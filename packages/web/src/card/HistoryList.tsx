import { List, Stack, Text } from '@mantine/core'
import { type CardEventResponse } from '../api/schemas.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatDateTime } from '../lib/format.ts'
import { describeActor, describeEvent, type HistoryContext } from '../lib/history.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'

export interface HistoryListProps {
  events: CardEventResponse[]
  context: HistoryContext
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/** Audit trail, oldest-first, one human-readable line per event (ADR-005). */
export function HistoryList({
  events,
  context,
  hasMore,
  loadingMore,
  onLoadMore,
}: HistoryListProps) {
  const timezone = useUserTimezone()
  if (events.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {strings.history.empty}
      </Text>
    )
  }
  return (
    <Stack gap="sm">
      {/* An unnumbered stacked timeline — ordinal markers added no meaning. */}
      <List listStyleType="none" spacing="xs" aria-label={strings.detail.tabHistory}>
        {events.map((event) => (
          <List.Item key={event.id}>
            <Text size="sm" component="span" fw={EMPHASIS_FONT_WEIGHT}>
              {describeActor(event, context)}
            </Text>{' '}
            <Text size="sm" component="span">
              {describeEvent(event, context)}
            </Text>{' '}
            <Text size="xs" c="dimmed" component="span">
              {formatDateTime(event.createdAt, timezone)}
            </Text>
          </List.Item>
        ))}
      </List>
      {hasMore ? (
        <HintButton
          variant="subtle"
          size="xs"
          tooltip={strings.tooltips.loadMore}
          loading={loadingMore}
          onClick={onLoadMore}
        >
          {strings.common.loadMore}
        </HintButton>
      ) : null}
    </Stack>
  )
}
