import {
  RELATION_TYPES,
  type CreateCardRelationInput,
  type RelationType,
} from '@rivian-kanban/core'
import { Group, Loader, Modal, Select, Stack, type OptionsFilter } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { Link2 } from 'lucide-react'
import { useState } from 'react'
import { useCardSearch } from '../api/relations.ts'
import { type CardSearchItem } from '../api/schemas.ts'
import { formatTicketNumber } from '../lib/format.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

/** Debounce keystrokes so a burst of typing collapses into one card search. */
const SEARCH_DEBOUNCE_MS = 275

/** We own fetching (the server returned the matches), so show every option as-is. */
const passthroughFilter: OptionsFilter = ({ options }) => options

/**
 * The "Add relationship" modal (docs/architecture/card-relations.md): the two
 * required fields — a relationship type + an async card-search target — plus
 * Cancel/Add. Split out of RelationsSection so the section stays a quiet list.
 */
export function AddRelationModal({
  currentCardId,
  existingIds,
  saving,
  onAdd,
  onClose,
}: {
  currentCardId: number
  existingIds: number[]
  saving: boolean
  onAdd: (input: CreateCardRelationInput) => void
  onClose: () => void
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
  }

  return (
    <Modal opened onClose={onClose} title={strings.relations.modalTitle} centered>
      <Stack gap="md">
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
        />
        <Group justify="flex-end" gap="sm">
          <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
            {strings.common.cancel}
          </HintButton>
          <HintButton
            tooltip={strings.relations.tooltips.add}
            leftSection={<Link2 size={16} aria-hidden />}
            loading={saving}
            disabledReason={target === null ? strings.relations.tooltips.disabledNoTarget : false}
            onClick={submit}
          >
            {strings.relations.add}
          </HintButton>
        </Group>
      </Stack>
    </Modal>
  )
}
