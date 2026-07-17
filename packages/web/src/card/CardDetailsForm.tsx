import { updateCardInputSchema, type Location, type UpdateCardInput } from '@rivian-kanban/core'
import { Button, Group, Stack, Text } from '@mantine/core'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { type z } from 'zod'
import { type CardDetailResponse, type PickerUser } from '../api/schemas.ts'
import { formatDateTime } from '../lib/format.ts'
import { strings } from '../strings.ts'
import { cardFieldsControl } from './card-fields.ts'
import { CardFieldInputs } from './CardFieldInputs.tsx'

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

  // formState is a subscription Proxy: dirtyFields must be read during
  // render or its per-field tracking is skipped, and the submit handler then
  // sees a stale map (observed live: edit title, then priority — priority
  // silently dropped from the PATCH). Reading it here subscribes it.
  const { dirtyFields } = form.formState

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
          onSave(pickDirty(values, dirtyFields))
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
          users={users}
          locations={locations}
          knownTags={knownTags}
          // The update command clears optionals explicitly (core schema `.nullable()`).
          cleared={null}
          disabled={disabled}
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
