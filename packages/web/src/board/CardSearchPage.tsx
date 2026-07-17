import {
  Badge,
  Button,
  Checkbox,
  Container,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useBoard } from '../api/board.ts'
import { useCardSearch } from '../api/card.ts'
import { useLocations, useUsers } from '../api/meta.ts'
import { formatEstimate, utcToday } from '../lib/format.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT, SIZES } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'

/**
 * The card list/search view over `GET /cards`: substring query plus the
 * include-archived filter (docs/user/guide.md) — the one place archived cards
 * are reachable so they can be reopened from their detail panel.
 */
export function CardSearchPage() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const search = useCardSearch({ q, includeArchived })
  // Lane labels for the per-row column chip (shared board query, cached).
  const board = useBoard()
  const users = useUsers()
  const locations = useLocations()
  const laneLabelById = new Map(
    (board.data?.lanes ?? []).map((snapshot) => [snapshot.lane.id, snapshot.lane.label]),
  )
  const userNameById = new Map((users.data ?? []).map((user) => [user.id, user.displayName]))
  const locationNameById = new Map(
    (locations.data ?? []).map((location) => [location.id, location.name]),
  )
  const cards = (search.data?.pages ?? []).flatMap((page) => page.items)
  const today = utcToday()
  // Distinguish "not searched yet" from "no results" (see the empty branch).
  const searched = q !== ''

  return (
    <Container size="md" w="100%">
      <Stack gap="md">
        <Title order={2} size="h3">
          {strings.search.pageTitle}
        </Title>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setQ(draft.trim())
          }}
        >
          <Group align="flex-end" gap="sm">
            <TextInput
              label={strings.search.queryLabel}
              aria-label={strings.search.queryAriaLabel}
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value)
              }}
            />
            <Button type="submit">{strings.search.submit}</Button>
          </Group>
        </form>
        <Checkbox
          label={strings.search.includeArchived}
          checked={includeArchived}
          onChange={(event) => {
            setIncludeArchived(event.currentTarget.checked)
          }}
        />
        {search.error !== null ? (
          <ErrorAlert error={search.error} fallbackMessage={strings.search.loadFailed} />
        ) : search.isPending ? (
          <Skeleton height={SIZES.skeletonCardHeight} radius="md" />
        ) : cards.length === 0 ? (
          <Text size="sm" c="dimmed">
            {/* Untouched box → gentle guidance; a run query with no hits → a
                clear no-results message (distinct from an error). */}
            {searched ? strings.search.noResults : strings.search.initialHint}
          </Text>
        ) : (
          <Stack gap="xs" role="list" aria-label={strings.search.resultsLabel}>
            {cards.map((card) => {
              const laneLabel = laneLabelById.get(card.laneId)
              const assigneeName =
                card.assigneeId === null ? null : (userNameById.get(card.assigneeId) ?? null)
              const locationName =
                card.locationId === null ? null : (locationNameById.get(card.locationId) ?? null)
              return (
                <div role="listitem" key={card.id}>
                  <UnstyledButton
                    w="100%"
                    onClick={() => {
                      void navigate(`/cards/${card.id}`)
                    }}
                  >
                    <Paper withBorder p="sm" radius="md">
                      <Stack gap="xs">
                        <Group justify="space-between" gap="xs">
                          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
                            {card.title}
                          </Text>
                          <Group gap="xs">
                            {laneLabel === undefined ? null : (
                              <Badge color="gray" size="sm" variant="light">
                                {laneLabel}
                              </Badge>
                            )}
                            <CardBadges card={card} today={today} />
                          </Group>
                        </Group>
                        {/* Same fields and placeholders as the board card so a
                            user can tell near-identical results apart. */}
                        <Group gap="lg">
                          <Text size="xs" c="dimmed">
                            {assigneeName ?? strings.card.unassigned}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {locationName ?? strings.card.noLocation}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {card.estimateMinutes === null
                              ? strings.card.noEstimate
                              : formatEstimate(card.estimateMinutes)}
                          </Text>
                        </Group>
                      </Stack>
                    </Paper>
                  </UnstyledButton>
                </div>
              )
            })}
            {search.hasNextPage ? (
              <Button
                variant="subtle"
                size="xs"
                loading={search.isFetchingNextPage}
                onClick={() => {
                  void search.fetchNextPage()
                }}
              >
                {strings.common.loadMore}
              </Button>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
