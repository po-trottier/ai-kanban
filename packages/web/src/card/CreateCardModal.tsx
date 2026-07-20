import {
  createCardInputSchema,
  type CreateCardInput,
  type CreateCardRelationInput,
  type Location,
} from '@rivian-kanban/core'
import { ActionIcon, Badge, Group, Modal, Stack, Text, Title, Tooltip } from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Link2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { type z } from 'zod'
import { useCardDetail } from '../api/card.ts'
import { formatTicketNumber } from '../lib/format.ts'
import { NewCardAttachments } from '../board/NewCardAttachments.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'
import { AddRelationModal } from './AddRelationModal.tsx'
import { cardFieldsControl } from './card-fields.ts'
import { CardFieldInputs } from './CardFieldInputs.tsx'
import { StickyFooter } from './StickyFooter.tsx'
import classes from './card.module.css'

type NewCardValues = z.input<typeof createCardInputSchema>

export interface CreateCardModalProps {
  locations: Location[]
  knownTags: string[]
  submitting: boolean
  /** Relations + files are applied AFTER the work order is created (it has no id
   * until then); errors on one never block the others or the created card. */
  onSubmit: (input: CreateCardInput, relations: CreateCardRelationInput[], files: File[]) => void
  onClose: () => void
}

/**
 * "New work order" — a real create FORM in a modal: nothing exists on the board
 * until **Create** is clicked, so Cancel / ✕ / Escape / reload can never leave a
 * stray draft. It gathers the shared card fields (`CardFieldInputs`, lands in
 * Intake, no State picker), plus staged relations and staged attachments that
 * are applied to the freshly created work order on submit. Reuses the detail
 * panel's scroll-body + sticky Cancel / Create layout.
 */
export function CreateCardModal({
  locations,
  knownTags,
  submitting,
  onSubmit,
  onClose,
}: CreateCardModalProps) {
  const form = useForm<NewCardValues, unknown, CreateCardInput>({
    resolver: standardSchemaResolver(createCardInputSchema),
    defaultValues: { title: '', description: '', priority: 'P2', tags: [] },
  })
  const [files, setFiles] = useState<File[]>([])
  const [relations, setRelations] = useState<CreateCardRelationInput[]>([])
  const [addingRelation, setAddingRelation] = useState(false)

  return (
    // Share the detail panel's layout: the body scrolls (capped height) while
    // the Cancel / Create bar stays sticky at the bottom.
    <Modal
      opened
      onClose={onClose}
      closeButtonProps={{ 'aria-label': strings.common.close }}
      title={strings.newCard.modalTitle}
      size="lg"
      centered
      classNames={{ body: classes.modalScrollBody }}
    >
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((input) => {
            onSubmit(input, relations, files)
          })(event)
        }}
      >
        <Stack gap="md">
          <CardFieldInputs
            control={cardFieldsControl(form.control)}
            titleField={form.register('title')}
            errors={{
              title: form.formState.errors.title?.message,
              estimateMinutes: form.formState.errors.estimateMinutes?.message,
            }}
            locations={locations}
            knownTags={knownTags}
            // The create command omits cleared optionals (core schema `.optional()`).
            cleared={undefined}
          />
          <StagedRelations
            relations={relations}
            onAdd={() => {
              setAddingRelation(true)
            }}
            onRemove={(index) => {
              setRelations((current) => current.filter((_, position) => position !== index))
            }}
          />
          <NewCardAttachments
            files={files}
            onAdd={(file) => {
              setFiles((current) => [...current, file])
            }}
            onRemove={(index) => {
              setFiles((current) => current.filter((_, position) => position !== index))
            }}
          />
          <StickyFooter>
            <Group justify="flex-end" gap="sm">
              <HintButton
                tooltip={strings.tooltips.cancelDialog}
                variant="default"
                onClick={onClose}
              >
                {strings.common.cancel}
              </HintButton>
              <HintButton
                tooltip={strings.tooltips.createCard}
                type="submit"
                loading={submitting}
                leftSection={<Plus size={16} aria-hidden />}
              >
                {strings.common.create}
              </HintButton>
            </Group>
          </StickyFooter>
        </Stack>
      </form>
      {addingRelation ? (
        <AddRelationModal
          // The work order does not exist yet: nothing to exclude as self/existing.
          currentCardId={0}
          existingIds={[]}
          saving={false}
          onAdd={(input) => {
            setRelations((current) => [...current, input])
            setAddingRelation(false)
          }}
          onClose={() => {
            setAddingRelation(false)
          }}
        />
      ) : null}
    </Modal>
  )
}

/** The relations staged for the not-yet-created work order (applied on Create). */
function StagedRelations({
  relations,
  onAdd,
  onRemove,
}: {
  relations: CreateCardRelationInput[]
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <Stack gap="sm">
      <Title order={4} size="sm">
        {strings.relations.sectionTitle}
      </Title>
      {relations.length === 0 ? null : (
        <Stack gap="xs">
          {relations.map((relation, index) => (
            <StagedRelationRow
              key={`${relation.type}-${String(relation.toCardId)}`}
              relation={relation}
              onRemove={() => {
                onRemove(index)
              }}
            />
          ))}
        </Stack>
      )}
      <Group>
        <HintButton
          tooltip={strings.relations.tooltips.addButton}
          variant="default"
          size="xs"
          leftSection={<Link2 size={16} aria-hidden />}
          onClick={onAdd}
        >
          {strings.relations.addButton}
        </HintButton>
      </Group>
    </Stack>
  )
}

/**
 * One staged relation: the outgoing-sense type badge + `#number — title`. The
 * title resolves from the target's cached detail (the picker just fetched it).
 */
function StagedRelationRow({
  relation,
  onRemove,
}: {
  relation: CreateCardRelationInput
  onRemove: () => void
}) {
  const detailQuery = useCardDetail(String(relation.toCardId))
  const title = detailQuery.data?.card.title
  const label = `${formatTicketNumber(relation.toCardId)}${title === undefined ? '' : ` — ${title}`}`
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Badge size="sm" variant="light" color="gray">
          {strings.relations.labels[relation.type].outgoing}
        </Badge>
        <Text size="sm" fw={EMPHASIS_FONT_WEIGHT} lineClamp={1}>
          {label}
        </Text>
      </Group>
      <Tooltip label={strings.relations.tooltips.remove} withArrow>
        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          aria-label={strings.relations.remove(title ?? formatTicketNumber(relation.toCardId))}
          onClick={onRemove}
        >
          <X size={16} aria-hidden />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
