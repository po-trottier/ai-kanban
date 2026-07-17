import { type CardEvent } from '@rivian-kanban/core'
import { Button, Stack, Text } from '@mantine/core'
import { formatDateTime } from '../lib/format.ts'
import { describeActor, describeEvent, type HistoryContext } from '../lib/history.ts'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'

export interface HistoryListProps {
  events: CardEvent[]
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
  if (events.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {strings.history.empty}
      </Text>
    )
  }
  return (
    <Stack gap="sm">
      <Stack gap="xs" component="ol" aria-label={strings.detail.tabHistory}>
        {events.map((event) => (
          <li key={event.id}>
            <Text size="sm" component="span" fw={EMPHASIS_FONT_WEIGHT}>
              {describeActor(event, context)}
            </Text>{' '}
            <Text size="sm" component="span">
              {describeEvent(event, context)}
            </Text>{' '}
            <Text size="xs" c="dimmed" component="span">
              {formatDateTime(event.createdAt)}
            </Text>
          </li>
        ))}
      </Stack>
      {hasMore ? (
        <Button variant="subtle" size="xs" loading={loadingMore} onClick={onLoadMore}>
          {strings.common.loadMore}
        </Button>
      ) : null}
    </Stack>
  )
}
