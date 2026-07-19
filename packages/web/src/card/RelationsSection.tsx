import { type CardRelationView } from '@rivian-kanban/core'
import { ActionIcon, Anchor, Badge, Group, Stack, Text, Tooltip } from '@mantine/core'
import { Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useCardRelations, useCreateRelation, useDeleteRelation } from '../api/relations.ts'
import { formatTicketNumber } from '../lib/format.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { AddRelationModal } from './AddRelationModal.tsx'

/**
 * The card's typed relations in the detail panel (docs/architecture/card-relations.md).
 * A quiet LIST of related cards, each labelled with the relationship as seen from
 * THIS card (Blocks / Blocked by / Duplicates / Duplicated by / Relates to) and
 * linking through to it, plus — unless the card is archived (read-only) — a single
 * "Add relationship" button that opens a modal with the required fields. Relations
 * never appear on board card previews, only here.
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
  const [adding, setAdding] = useState(false)

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
        <Group>
          <HintButton
            tooltip={strings.relations.tooltips.addButton}
            variant="default"
            size="xs"
            leftSection={<Link2 size={16} aria-hidden />}
            onClick={() => {
              setAdding(true)
            }}
          >
            {strings.relations.addButton}
          </HintButton>
        </Group>
      )}
      {adding ? (
        <AddRelationModal
          currentCardId={Number(cardId)}
          existingIds={relations.map((relation) => relation.card.id)}
          saving={createRelation.isPending}
          onAdd={(input) => {
            createRelation.mutate(input, {
              onSuccess: () => {
                setAdding(false)
              },
            })
          }}
          onClose={() => {
            setAdding(false)
          }}
        />
      ) : null}
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
