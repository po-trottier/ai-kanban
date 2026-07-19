import {
  RELATION_TYPES,
  type CardRelationView,
  type CreateCardRelationInput,
  type RelationType,
} from '@rivian-kanban/core'
import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Tooltip,
  type OptionsFilter,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  useCardRelations,
  useCardSearch,
  useCreateRelation,
  useDeleteRelation,
} from '../api/relations.ts'
import { type CardSearchItem } from '../api/schemas.ts'
import { formatTicketNumber } from '../lib/format.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'

/** Debounce keystrokes so a burst of typing collapses into one card search. */
const SEARCH_DEBOUNCE_MS = 275

/** We own fetching (the server returned the matches), so show every option as-is. */
const passthroughFilter: OptionsFilter = ({ options }) => options

/**
 * The card's typed relations in the detail panel (docs/architecture/card-relations.md).
 * Lists each related card with the relationship as seen from THIS card (Blocks /
 * Blocked by / Duplicates / Duplicated by / Relates to), links through to it,
 * and — unless the card is archived (read-only) — offers an add row: a
 * relationship type + an async card search for the target. Relations never
 * appear on board card previews, only here.
 */
export function RelationsSection({
  cardId,
  readOnly = false,
}: {
  cardId: string
  readOnly?: boolean
}) {
  const relationsQuery = useCardRelations(cardId)
  const deleteRelation = useDeleteRelation(cardId)
  const createRelation = useCreateRelation(cardId)
  const navigate = useNavigate()
  const location = useLocation()

  const relations = relationsQuery.data ?? []

  const openCard = (otherId: number) => {
    // Preserve the board filter query (URL state) when jumping between cards.
    void navigate({ pathname: `/cards/${String(otherId)}`, search: location.search })
  }

  return (
    <Stack gap="sm">
      <Text fw={EMPHASIS_FONT_WEIGHT} size="sm">
        {strings.relations.sectionTitle}
      </Text>
      {/* Only claim "none" once the list has actually loaded, so it doesn't flash
          the empty state over relations that are still arriving. */}
      {relationsQuery.isPending ? null : relations.length === 0 ? (
        <Text size="sm" c="dimmed">
          {strings.relations.empty}
        </Text>
      ) : (
        <Stack gap="xs">
          {relations.map((relation) => (
            <RelationRow
              key={relation.id}
              relation={relation}
              readOnly={readOnly}
              removing={deleteRelation.isPending && deleteRelation.variables === relation.id}
              onOpen={() => {
                openCard(relation.card.id)
              }}
              onRemove={() => {
                deleteRelation.mutate(relation.id)
              }}
            />
          ))}
        </Stack>
      )}
      {readOnly ? null : (
        <AddRelationForm
          currentCardId={Number(cardId)}
          existingIds={relations.map((relation) => relation.card.id)}
          saving={createRelation.isPending}
          onAdd={(input) => {
            createRelation.mutate(input)
          }}
        />
      )}
    </Stack>
  )
}

/** One relation: the label as seen from this card + a link to the other card. */
function RelationRow({
  relation,
  readOnly,
  removing,
  onOpen,
  onRemove,
}: {
  relation: CardRelationView
  readOnly: boolean
  removing: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const label = strings.relations.labels[relation.type][relation.direction]
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Badge size="sm" variant="light" color="gray">
          {label}
        </Badge>
        <Anchor component="button" type="button" size="sm" lineClamp={1} onClick={onOpen}>
          {`${formatTicketNumber(relation.card.id)} — ${relation.card.title}`}
        </Anchor>
      </Group>
      {readOnly ? null : (
        <Tooltip label={strings.relations.tooltips.remove} withArrow>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={strings.relations.remove(relation.card.title)}
            loading={removing}
            onClick={onRemove}
          >
            <Trash2 size={16} aria-hidden />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  )
}

/** The add-a-relation row: a relationship type + an async card-search target. */
function AddRelationForm({
  currentCardId,
  existingIds,
  saving,
  onAdd,
}: {
  currentCardId: number
  existingIds: number[]
  saving: boolean
  onAdd: (input: CreateCardRelationInput) => void
}) {
  const [type, setType] = useState<RelationType>('blocks')
  const [target, setTarget] = useState<CardSearchItem | null>(null)
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const searchQuery = useCardSearch(debounced)

  // Never offer this card or one already related; pin the selected card so its
  // label always resolves even after the search text moves on.
  const exclude = new Set<number>([currentCardId, ...existingIds])
  const byId = new Map<number, CardSearchItem>()
  if (target !== null) byId.set(target.id, target)
  for (const card of searchQuery.data?.items ?? []) {
    if (!exclude.has(card.id) && !byId.has(card.id)) byId.set(card.id, card)
  }
  const cardOption = (card: CardSearchItem) => ({
    value: String(card.id),
    label: `${formatTicketNumber(card.id)} — ${card.title}`,
  })
  const options = [...byId.values()].map(cardOption)
  const typeOptions = RELATION_TYPES.map((value) => ({
    value,
    label: strings.relations.labels[value].outgoing,
  }))
  const loading = searchQuery.isFetching

  const submit = () => {
    if (target === null) return
    onAdd({ toCardId: target.id, type })
    setTarget(null)
    setSearch('')
  }

  return (
    <Group align="flex-end" gap="sm" wrap="nowrap">
      <Select
        label={strings.relations.typeLabel}
        data={typeOptions}
        value={type}
        allowDeselect={false}
        onChange={(value) => {
          if (value !== null) setType(value)
        }}
      />
      <Select
        label={strings.relations.targetLabel}
        placeholder={strings.relations.targetPlaceholder}
        data={options}
        value={target === null ? null : String(target.id)}
        onChange={(value) => {
          setTarget(value === null ? null : (byId.get(Number(value)) ?? null))
        }}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        filter={passthroughFilter}
        nothingFoundMessage={
          loading ? strings.common.loading : strings.relations.targetNothingFound
        }
        rightSection={
          loading ? <Loader size="xs" aria-label={strings.common.loading} /> : undefined
        }
        comboboxProps={{ withinPortal: true }}
        style={{ flex: 1 }}
      />
      <HintButton
        tooltip={strings.relations.tooltips.add}
        loading={saving}
        disabledReason={target === null ? strings.relations.tooltips.disabledNoTarget : false}
        onClick={submit}
      >
        {strings.relations.add}
      </HintButton>
    </Group>
  )
}
