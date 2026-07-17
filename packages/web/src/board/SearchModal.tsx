import { LANE_KEYS, PRIORITIES, type Card } from '@rivian-kanban/core'
import {
  Accordion,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useBoard } from '../api/board.ts'
import { useCardSearch } from '../api/card.ts'
import { useLocations, useTags, useUsers } from '../api/meta.ts'
import { LocationPicker } from '../card/LocationPicker.tsx'
import { formatEstimate, utcToday } from '../lib/format.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { PinIcon, SearchIcon } from '../shell/icons.tsx'
import { useBoardSearchQuery } from '../shell/board-search-param.ts'
import { useSearchModal } from '../shell/search-modal-param.ts'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT, SIZES } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'
import classes from './search.module.css'

/**
 * The advanced-search modal: the one place archived and closed cards are
 * reachable (the header live-filter only narrows the loaded board). Opened
 * on demand from the header field's filter icon or the board's no-matches
 * link, it searches `GET /cards` across every card — including archived by
 * default — with a collapsible facet panel (priority, column, tag, location,
 * archived scope) and lists matches as compact, kanban-styled rows that
 * deep-link into the card panel.
 *
 * Search is asynchronous and cursor-paginated: a changed term or facet fires a
 * fresh query while the previous results stay on screen (a spinner marks the
 * in-flight fetch), and long result sets load a page at a time. Open state and
 * the seed query live in the URL (`?search=1`, `?q=`), so the body remounts
 * fresh on each open, seeded with whatever the board was being filtered by.
 */
export function SearchModal() {
  const { opened, close } = useSearchModal()
  const [seedQuery] = useBoardSearchQuery()
  return (
    <Modal opened={opened} onClose={close} title={strings.search.modalTitle} size="xl" centered>
      {/* Remount per open (Modal unmounts children when closed) so the body
          re-seeds from the current board query and resets its filters. */}
      {opened ? <SearchModalBody seedQuery={seedQuery} onClose={close} /> : null}
    </Modal>
  )
}

function SearchModalBody({ seedQuery, onClose }: { seedQuery: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [text, setText] = useState(seedQuery)
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number] | null>(null)
  const [lane, setLane] = useState<(typeof LANE_KEYS)[number] | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  // Archived scope is a 3-way choice, defaulting to "both" — this modal is the
  // only place archived cards surface, so they're in scope by default.
  const [archivedScope, setArchivedScope] = useState<'both' | 'active' | 'archived'>('both')
  // Debounce the free-text so each keystroke doesn't fire a (potentially slow,
  // archive-wide) request; facet selects apply immediately.
  const [debouncedText] = useDebouncedValue(text.trim(), 300)

  const includeArchived = archivedScope !== 'active'
  const archivedOnly = archivedScope === 'archived'
  const search = useCardSearch({
    q: debouncedText,
    includeArchived,
    archivedOnly,
    priority,
    lane,
    tags: selectedTags,
    locationId,
  })
  const board = useBoard()
  const users = useUsers()
  const locations = useLocations()
  const tags = useTags()

  const laneLabelById = new Map(
    (board.data?.lanes ?? []).map((snapshot) => [snapshot.lane.id, snapshot.lane.label]),
  )
  const userNameById = new Map((users.data ?? []).map((user) => [user.id, user.displayName]))
  const locationNameById = new Map(
    (locations.data ?? []).map((location) => [location.id, location.name]),
  )
  const cards = (search.data?.pages ?? []).flatMap((page) => page.items)
  const today = utcToday()
  // A running search over the whole archive: mark it so the user sees progress
  // even while the previous results stay on screen (keepPreviousData).
  const searching = search.isFetching && !search.isFetchingNextPage
  const activeFacetCount =
    [priority, lane, locationId].filter((value) => value !== null).length +
    (selectedTags.length > 0 ? 1 : 0) +
    (archivedScope === 'both' ? 0 : 1)

  const openCard = (cardId: string) => {
    // Navigating to the card drops `?search=1`, which closes this modal, and
    // opens the detail panel over the board.
    void navigate(`/cards/${cardId}`)
  }

  return (
    <Stack gap="md">
      <TextInput
        aria-label={strings.search.queryAriaLabel}
        placeholder={strings.search.queryPlaceholder}
        value={text}
        leftSection={<SearchIcon size={16} />}
        data-autofocus
        onChange={(event) => {
          setText(event.currentTarget.value)
        }}
      />
      <Accordion variant="separated" chevronPosition="right" defaultValue="filters">
        <Accordion.Item value="filters">
          <Accordion.Control icon={<SlidersHorizontal size={16} aria-hidden />}>
            <Group gap="xs" wrap="nowrap" component="span">
              {strings.search.filtersToggle}
              {activeFacetCount > 0 ? (
                <Badge size="sm" circle variant="filled">
                  {activeFacetCount}
                </Badge>
              ) : null}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <Select
                label={strings.search.priorityFilter}
                placeholder={strings.search.anyPriority}
                data={PRIORITIES.map((value) => ({
                  value,
                  label: `${value} — ${strings.priorityOptions[value].name}`,
                }))}
                value={priority}
                clearable
                onChange={(value) => {
                  setPriority(value)
                }}
              />
              <Select
                label={strings.search.columnFilter}
                placeholder={strings.search.anyColumn}
                data={LANE_KEYS.map((value) => ({ value, label: strings.laneNames[value] }))}
                value={lane}
                clearable
                onChange={(value) => {
                  setLane(value)
                }}
              />
              <MultiSelect
                label={strings.search.tagFilter}
                placeholder={selectedTags.length === 0 ? strings.search.anyTag : undefined}
                data={(tags.data ?? []).map((option) => option.name)}
                value={selectedTags}
                clearable
                searchable
                onChange={setSelectedTags}
              />
              <LocationPicker
                locations={locations.data ?? []}
                value={locationId}
                onChange={setLocationId}
                label={strings.search.locationFilter}
                placeholder={strings.search.anyLocation}
              />
              <Select
                label={strings.search.archivedFilter}
                data={[
                  { value: 'both', label: strings.search.archivedBoth },
                  { value: 'active', label: strings.search.activeOnly },
                  { value: 'archived', label: strings.search.archivedOnly },
                ]}
                value={archivedScope}
                allowDeselect={false}
                onChange={(value) => {
                  if (value !== null) setArchivedScope(value)
                }}
              />
            </SimpleGrid>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {search.error !== null ? (
        <ErrorAlert error={search.error} fallbackMessage={strings.search.loadFailed} />
      ) : search.isPending ? (
        <Skeleton height={SIZES.skeletonCardHeight} radius="md" />
      ) : (
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              {strings.search.resultCount(cards.length)}
            </Text>
            {searching ? <Loader size="xs" /> : null}
          </Group>
          {cards.length === 0 ? (
            <Text size="sm" c="dimmed">
              {strings.search.noResults}
            </Text>
          ) : (
            <Stack gap="xs" role="list" aria-label={strings.search.resultsLabel}>
              {cards.map((card) => (
                <div role="listitem" key={card.id}>
                  <SearchResultCard
                    card={card}
                    laneLabel={laneLabelById.get(card.laneId)}
                    assigneeName={
                      card.assigneeId === null ? null : (userNameById.get(card.assigneeId) ?? null)
                    }
                    locationName={
                      card.locationId === null
                        ? null
                        : (locationNameById.get(card.locationId) ?? null)
                    }
                    today={today}
                    onOpen={openCard}
                  />
                </div>
              ))}
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
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {strings.search.backToBoard}
        </Button>
      </Group>
    </Stack>
  )
}

/**
 * One search result, styled to read like a compact board card: a title +
 * badge line and a single dimmed meta line (location · estimate · assignee).
 * A filled, bordered surface with hover feedback so results stand out against
 * the modal instead of blending in. Uses the full `Card` the search endpoint
 * returns, with the lane/assignee/location names resolved by the modal.
 */
function SearchResultCard({
  card,
  laneLabel,
  assigneeName,
  locationName,
  today,
  onOpen,
}: {
  card: Card
  laneLabel: string | undefined
  assigneeName: string | null
  locationName: string | null
  today: string
  onOpen: (cardId: string) => void
}) {
  return (
    <UnstyledButton
      className={classes.result}
      onClick={() => {
        onOpen(card.id)
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
        <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} truncate className={classes.grow}>
          {card.title}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <CardBadges card={card} today={today} />
          {laneLabel === undefined ? null : (
            <Badge color="gray" size="sm" variant="light">
              {laneLabel}
            </Badge>
          )}
        </Group>
      </Group>
      <Group gap="md" wrap="nowrap" mt={4} c="dimmed">
        <Group gap={4} wrap="nowrap" className={classes.grow}>
          <PinIcon size={14} />
          <Text size="xs" truncate>
            {locationName ?? strings.card.noLocation}
          </Text>
        </Group>
        <Text size="xs">
          {card.estimateMinutes === null
            ? strings.card.noEstimate
            : formatEstimate(card.estimateMinutes)}
        </Text>
        <Text size="xs" truncate>
          {assigneeName ?? strings.card.unassigned}
        </Text>
      </Group>
    </UnstyledButton>
  )
}
