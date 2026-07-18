import { LANE_KEYS, PRIORITIES, type Card } from '@rivian-kanban/core'
import {
  Accordion,
  ActionIcon,
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
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useBoard } from '../api/board.ts'
import { useCardSearch } from '../api/card.ts'
import { useLocations, useTags, useUsers } from '../api/meta.ts'
import { LocationPicker } from '../card/LocationPicker.tsx'
import { cx } from '../lib/cx.ts'
import { formatEstimate, formatTicketNumber, utcToday } from '../lib/format.ts'
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
 * default — with a collapsible facet panel (priority, column, tags, location,
 * archived scope) and lists matches as compact, kanban-styled rows that
 * deep-link into the card panel.
 *
 * Nothing queries until the user presses Search (or Enter): the fields are a
 * DRAFT, applied as one snapshot, so several facets can be set without a
 * request per change. Search is asynchronous and cursor-paginated — the
 * previous results stay on screen while the next applied query loads (a spinner
 * marks it), and long result sets load a page at a time. Open state and the
 * seed query live in the URL (`?search=1`, `?q=`), so the body remounts fresh
 * on each open, seeded (and pre-applied) with the board's current query.
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

interface AppliedFilters {
  q: string
  priority: (typeof PRIORITIES)[number] | null
  lane: (typeof LANE_KEYS)[number] | null
  tags: string[]
  locationId: string | null
  archivedScope: ArchivedScope
}

type ArchivedScope = 'both' | 'active' | 'archived'
/** Archived scope defaults to "both" — this modal is the only place archived
 * cards surface, so they're in scope by default. Clearing resets here. */
const DEFAULT_SCOPE: ArchivedScope = 'both'

function SearchModalBody({ seedQuery, onClose }: { seedQuery: string; onClose: () => void }) {
  const navigate = useNavigate()
  // Draft fields the user edits freely; nothing queries until they press Search
  // (or Enter) — so several facets can be set in one pass without a request, and
  // wait, per change.
  const [text, setText] = useState(seedQuery)
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number] | null>(null)
  const [lane, setLane] = useState<(typeof LANE_KEYS)[number] | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const [archivedScope, setArchivedScope] = useState<ArchivedScope>(DEFAULT_SCOPE)
  const [filtersOpen, setFiltersOpen] = useState(true)
  // The applied snapshot actually drives the query — seeded (and pre-applied)
  // from the board query so opening pre-populated shows results at once.
  const [applied, setApplied] = useState<AppliedFilters>(() => ({
    q: seedQuery.trim(),
    priority: null,
    lane: null,
    tags: [],
    locationId: null,
    archivedScope: DEFAULT_SCOPE,
  }))

  const search = useCardSearch({
    q: applied.q,
    includeArchived: applied.archivedScope !== 'active',
    archivedOnly: applied.archivedScope === 'archived',
    priority: applied.priority,
    lane: applied.lane,
    tags: applied.tags,
    locationId: applied.locationId,
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
    (archivedScope === DEFAULT_SCOPE ? 0 : 1)
  const hasDraftFilters = text.trim() !== '' || activeFacetCount > 0

  const applyFilters = () => {
    setApplied({ q: text.trim(), priority, lane, tags: selectedTags, locationId, archivedScope })
  }
  const clearAll = () => {
    setText('')
    setPriority(null)
    setLane(null)
    setSelectedTags([])
    setLocationId(null)
    setArchivedScope(DEFAULT_SCOPE)
    setApplied({
      q: '',
      priority: null,
      lane: null,
      tags: [],
      locationId: null,
      archivedScope: DEFAULT_SCOPE,
    })
  }

  const openCard = (cardId: string) => {
    // Navigating to the card drops `?search=1`, which closes this modal, and
    // opens the detail panel over the board.
    void navigate(`/cards/${cardId}`)
  }

  return (
    <Stack gap="md">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters()
        }}
      >
        <Group gap="sm" align="flex-end" wrap="nowrap">
          <TextInput
            className={classes.grow}
            aria-label={strings.search.queryAriaLabel}
            placeholder={strings.search.queryPlaceholder}
            value={text}
            data-autofocus
            onChange={(event) => {
              setText(event.currentTarget.value)
            }}
          />
          <Button type="submit" leftSection={<SearchIcon size={16} />}>
            {strings.search.searchButton}
          </Button>
        </Group>
      </form>
      <Accordion
        variant="separated"
        // Controlled so the caret can live OUTSIDE the control (rendered after
        // Clear all, on its right) — the built-in chevron is hidden below.
        value={filtersOpen ? 'filters' : null}
        onChange={(value) => {
          setFiltersOpen(value === 'filters')
        }}
        classNames={{ chevron: classes.hiddenChevron }}
      >
        <Accordion.Item value="filters">
          <Group gap="xs" wrap="nowrap" align="center" pr="xs">
            <Accordion.Control
              className={classes.grow}
              icon={<SlidersHorizontal size={16} aria-hidden />}
            >
              <Group gap="xs" wrap="nowrap" component="span">
                {strings.search.filtersToggle}
                {activeFacetCount > 0 ? (
                  <Badge size="sm" circle variant="filled">
                    {activeFacetCount}
                  </Badge>
                ) : null}
              </Group>
            </Accordion.Control>
            {hasDraftFilters ? (
              <Button variant="subtle" color="gray" size="compact-sm" onClick={clearAll}>
                {strings.search.clearFilters}
              </Button>
            ) : null}
            <Tooltip
              label={filtersOpen ? strings.search.collapseFilters : strings.search.expandFilters}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={
                  filtersOpen ? strings.search.collapseFilters : strings.search.expandFilters
                }
                onClick={() => {
                  setFiltersOpen((open) => !open)
                }}
              >
                <ChevronDown
                  size={16}
                  aria-hidden
                  className={cx(classes.caret, filtersOpen && classes.caretOpen)}
                />
              </ActionIcon>
            </Tooltip>
          </Group>
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
                // Works like every other facet: the empty/cleared state is the
                // default "Active and archived" (shown as the placeholder), and
                // the two options narrow it. Clearing returns to that default.
                placeholder={strings.search.archivedBoth}
                data={[
                  { value: 'active', label: strings.search.activeOnly },
                  { value: 'archived', label: strings.search.archivedOnly },
                ]}
                value={archivedScope === DEFAULT_SCOPE ? null : archivedScope}
                clearable
                onChange={(value) => {
                  setArchivedScope(value ?? DEFAULT_SCOPE)
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
 * one dense line (title · badges · lane · estimate · location · assignee),
 * matching the compact board card. A filled, bordered surface with hover
 * feedback so results stand out against the modal instead of blending in. Uses
 * the full `Card` the search endpoint returns, with lane/assignee/location
 * names resolved by the modal.
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
        onOpen(String(card.id))
      }}
    >
      {/* One dense line: #number, title (ellipsized), badges, lane, dimmed meta. */}
      <Group wrap="nowrap" align="center" gap="sm">
        <Group gap={6} wrap="nowrap" className={classes.grow}>
          <Text size="xs" c="dimmed" fw={EMPHASIS_FONT_WEIGHT}>
            {formatTicketNumber(card.id)}
          </Text>
          <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} truncate className={classes.grow}>
            {card.title}
          </Text>
        </Group>
        <CardBadges card={card} today={today} />
        {laneLabel === undefined ? null : (
          <Badge color="gray" size="sm" variant="light">
            {laneLabel}
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          {card.estimateMinutes === null
            ? strings.card.noEstimate
            : formatEstimate(card.estimateMinutes)}
        </Text>
        <Group gap={4} wrap="nowrap" c="dimmed" maw="11rem">
          <PinIcon size={14} />
          <Text size="xs" truncate>
            {locationName ?? strings.card.noLocation}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" maw="8rem" truncate>
          {assigneeName ?? strings.card.unassigned}
        </Text>
      </Group>
    </UnstyledButton>
  )
}
