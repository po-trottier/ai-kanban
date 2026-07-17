import {
  createCardInputSchema,
  PRIORITIES,
  type CreateCardInput,
  type Location,
} from '@rivian-kanban/core'
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  TextInput,
} from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Controller, useForm } from 'react-hook-form'
import { type z } from 'zod'
import { type PickerUser } from '../api/schemas.ts'
import { DescriptionEditor } from '../card/DescriptionEditor.tsx'
import { LocationPicker } from '../card/LocationPicker.tsx'
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
    <Modal opened onClose={onClose} title={strings.newCard.modalTitle} size="lg">
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event)
        }}
      >
        <Stack gap="md">
          <TextInput
            label={strings.newCard.titleLabel}
            withAsterisk
            error={form.formState.errors.title?.message}
            {...form.register('title')}
          />
          <Controller
            control={form.control}
            name="description"
            render={({ field }) => (
              <DescriptionEditor value={field.value ?? ''} onChange={field.onChange} />
            )}
          />
          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <Select
                label={strings.detail.priorityLabel}
                data={PRIORITIES.map((priority) => ({
                  value: priority,
                  label: strings.priorities[priority],
                }))}
                value={field.value ?? 'P2'}
                allowDeselect={false}
                onChange={(value) => {
                  if (value !== null) field.onChange(value)
                }}
              />
            )}
          />
          <Controller
            control={form.control}
            name="estimateMinutes"
            render={({ field }) => (
              <NumberInput
                label={strings.detail.estimateLabel}
                min={1}
                value={field.value ?? ''}
                error={form.formState.errors.estimateMinutes?.message}
                onChange={(value) => {
                  field.onChange(typeof value === 'number' ? value : undefined)
                }}
              />
            )}
          />
          <Controller
            control={form.control}
            name="assigneeId"
            render={({ field }) => (
              <Select
                label={strings.detail.assigneeLabel}
                data={users.map((user) => ({ value: user.id, label: user.displayName }))}
                value={field.value ?? null}
                clearable
                onChange={(value) => {
                  field.onChange(value ?? undefined)
                }}
              />
            )}
          />
          <Controller
            control={form.control}
            name="locationId"
            render={({ field }) => (
              <LocationPicker
                locations={locations}
                value={field.value ?? null}
                onChange={(value) => {
                  field.onChange(value ?? undefined)
                }}
              />
            )}
          />
          <Controller
            control={form.control}
            name="tags"
            render={({ field }) => (
              <TagsInput
                label={strings.detail.tagsLabel}
                data={knownTags}
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
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
