import {
  PRIORITIES,
  updateCardInputSchema,
  type Location,
  type UpdateCardInput,
} from '@rivian-kanban/core'
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { type z } from 'zod'
import { type CardDetailResponse, type PickerUser } from '../api/schemas.ts'
import { formatDateTime } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { DescriptionEditor } from './DescriptionEditor.tsx'
import { LocationPicker } from './LocationPicker.tsx'

/** Editable fields = the core PATCH command minus the If-Match version. */
const cardFieldsSchema = updateCardInputSchema.omit({ expectedVersion: true })
type CardFieldsValues = z.input<typeof cardFieldsSchema>
export type CardFieldChanges = Omit<UpdateCardInput, 'expectedVersion'>

export interface CardDetailsFormProps {
  detail: CardDetailResponse
  users: PickerUser[]
  locations: Location[]
  knownTags: string[]
  saving: boolean
  /** Archived cards are read-only except reopen (workflow.md#terminal-states). */
  disabled?: boolean
  onSave: (changes: CardFieldChanges) => void
}

/** In-place field editing with the shared core schema as the resolver. */
export function CardDetailsForm({
  detail,
  users,
  locations,
  knownTags,
  saving,
  disabled = false,
  onSave,
}: CardDetailsFormProps) {
  const { card } = detail
  const form = useForm<CardFieldsValues, unknown, CardFieldChanges>({
    resolver: standardSchemaResolver(cardFieldsSchema),
    defaultValues: valuesOf(detail),
  })

  // A fresh server state (SSE refetch, save) updates the non-dirty fields;
  // keepDirtyValues preserves whatever the user is typing mid-edit.
  useEffect(() => {
    form.reset(valuesOf(detail), { keepDirtyValues: true })
  }, [form, detail])

  const reporter = users.find((user) => user.id === card.reporterId)

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          onSave(pickDirty(values, form.formState.dirtyFields))
        })(event)
      }}
    >
      <Stack gap="md">
        <TextInput
          label={strings.detail.titleLabel}
          withAsterisk
          disabled={disabled}
          error={form.formState.errors.title?.message}
          {...form.register('title')}
        />
        <Controller
          control={form.control}
          name="description"
          render={({ field }) => (
            <DescriptionEditor
              value={field.value ?? ''}
              disabled={disabled}
              onChange={field.onChange}
            />
          )}
        />
        <Group grow align="flex-start">
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
                value={field.value ?? card.priority}
                allowDeselect={false}
                disabled={disabled}
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
                value={field.value ?? ''}
                disabled={disabled}
                error={form.formState.errors.estimateMinutes?.message}
                onChange={(value) => {
                  field.onChange(typeof value === 'number' ? value : null)
                }}
              />
            )}
          />
        </Group>
        <Controller
          control={form.control}
          name="assigneeId"
          render={({ field }) => (
            <Select
              label={strings.detail.assigneeLabel}
              data={users.map((user) => ({ value: user.id, label: user.displayName }))}
              value={field.value ?? null}
              clearable
              disabled={disabled}
              onChange={field.onChange}
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
              disabled={disabled}
              onChange={field.onChange}
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
              disabled={disabled}
              onChange={field.onChange}
            />
          )}
        />
        <Group gap="lg">
          <Text size="xs" c="dimmed">
            {strings.detail.reporterLabel}: {reporter?.displayName ?? strings.history.unknownUser}
          </Text>
          <Text size="xs" c="dimmed">
            {strings.detail.createdLabel}: {formatDateTime(card.createdAt)}
          </Text>
        </Group>
        {disabled ? null : (
          <Group justify="flex-end">
            <Button type="submit" loading={saving} disabled={!form.formState.isDirty}>
              {strings.detail.saveFields}
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  )
}

function valuesOf(detail: CardDetailResponse): CardFieldsValues {
  const { card } = detail
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    estimateMinutes: card.estimateMinutes,
    assigneeId: card.assigneeId,
    locationId: card.locationId,
    tags: detail.tags.map((tag) => tag.name),
  }
}

/** Sends only edited fields so the audit trail gets one event per real change. */
function pickDirty(
  values: CardFieldChanges,
  dirtyFields: Partial<Record<keyof CardFieldsValues, unknown>>,
): CardFieldChanges {
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(values) as (keyof CardFieldChanges)[]) {
    if (dirtyFields[key] !== undefined && dirtyFields[key] !== false) {
      changes[key] = values[key]
    }
  }
  return changes
}
