import { createCardInputSchema, type CreateCardInput, type Location } from '@rivian-kanban/core'
import { Button, Group, Modal, Stack } from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { type z } from 'zod'
import { type PickerUser } from '../api/schemas.ts'
import { cardFieldsControl } from '../card/card-fields.ts'
import { CardFieldInputs } from '../card/CardFieldInputs.tsx'
import { strings } from '../strings.ts'

type NewCardValues = z.input<typeof createCardInputSchema>

export interface NewCardModalProps {
  users: PickerUser[]
  locations: Location[]
  knownTags: string[]
  submitting: boolean
  onSubmit: (input: CreateCardInput) => void
  onClose: () => void
}

/** "New card" — lands in Intake; validated by the shared core schema. */
export function NewCardModal({
  users,
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

  return (
    <Modal opened onClose={onClose} title={strings.newCard.modalTitle} size="lg" centered>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event)
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
            users={users}
            locations={locations}
            knownTags={knownTags}
            // The create command omits cleared optionals (core schema `.optional()`).
            cleared={undefined}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" loading={submitting}>
              {strings.common.create}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
