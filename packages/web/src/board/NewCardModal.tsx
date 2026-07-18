import { createCardInputSchema, type CreateCardInput, type Location } from '@rivian-kanban/core'
import { Group, Modal, Stack } from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { type z } from 'zod'
import { cardFieldsControl } from '../card/card-fields.ts'
import { CardFieldInputs } from '../card/CardFieldInputs.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { NewCardAttachments } from './NewCardAttachments.tsx'

type NewCardValues = z.input<typeof createCardInputSchema>

export interface NewCardModalProps {
  locations: Location[]
  knownTags: string[]
  submitting: boolean
  /** Files are uploaded to the card after it's created (it has no id until then). */
  onSubmit: (input: CreateCardInput, files: File[]) => void
  onClose: () => void
}

/** "New card" — lands in Intake; validated by the shared core schema. */
export function NewCardModal({
  locations,
  knownTags,
  submitting,
  onSubmit,
  onClose,
}: NewCardModalProps) {
  const form = useForm<NewCardValues, unknown, CreateCardInput>({
    resolver: standardSchemaResolver(createCardInputSchema),
    defaultValues: { title: '', description: '', priority: 'P2', tags: [] },
  })
  const [files, setFiles] = useState<File[]>([])

  return (
    <Modal opened onClose={onClose} title={strings.newCard.modalTitle} size="lg" centered>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((input) => {
            onSubmit(input, files)
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
          <NewCardAttachments
            files={files}
            onAdd={(file) => {
              setFiles((current) => [...current, file])
            }}
            onRemove={(index) => {
              setFiles((current) => current.filter((_, position) => position !== index))
            }}
          />
          <Group justify="flex-end" gap="sm">
            <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
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
        </Stack>
      </form>
    </Modal>
  )
}
