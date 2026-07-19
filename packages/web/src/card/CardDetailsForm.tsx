import { updateCardInputSchema, type Location, type UpdateCardInput } from '@rivian-kanban/core'
import { Group, Stack, Text } from '@mantine/core'
import { useDebouncedCallback } from '@mantine/hooks'
import { Save } from 'lucide-react'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect, useId, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { type z } from 'zod'
import { type CardDetailResponse } from '../api/schemas.ts'
import { useUserTimezone } from '../auth/session-context.ts'
import { formatDateTime } from '../lib/format.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import { cardFieldsControl } from './card-fields.ts'
import { CardFieldInputs } from './CardFieldInputs.tsx'
import { StickyFooter } from './StickyFooter.tsx'

/** Editable fields = the core PATCH command minus the If-Match version. */
const cardFieldsSchema = updateCardInputSchema.omit({ expectedVersion: true })
type CardFieldsValues = z.input<typeof cardFieldsSchema>
export type CardFieldChanges = Omit<UpdateCardInput, 'expectedVersion'>

export interface CardDetailsFormProps {
  detail: CardDetailResponse
  locations: Location[]
  knownTags: string[]
  saving: boolean
  /** Archived cards are read-only except reopen (workflow.md#terminal-states). */
  disabled?: boolean
  /**
   * The create view has no Save button: instead of the sticky footer, a
   * debounced watcher PATCHes edited fields automatically (the card already
   * exists). The detail panel leaves this false and keeps explicit Save.
   */
  autoSave?: boolean
  /**
   * Sections that belong to the Details tab but NOT the edit form — Attachments
   * and Relations. They render between the fields and the timestamps so the tab
   * reads fields → relations → attachments → timestamps → (sticky Save), while
   * the form element still wraps only the editable fields.
   */
  children?: ReactNode
  onSave: (changes: CardFieldChanges) => void
}

/**
 * The Details tab: the editable fields (a real `<form>`), then the caller's
 * Attachments/Relations, then the Created/Updated timestamps, then a sticky
 * full-width Save pinned to the bottom of the scrolling panel. Save lives
 * OUTSIDE the scrolling flow but still submits the fields form via the native
 * `form={id}` association, so the form owns its own dirty state (no lifting).
 */
export function CardDetailsForm({
  detail,
  locations,
  knownTags,
  saving,
  disabled = false,
  autoSave = false,
  children,
  onSave,
}: CardDetailsFormProps) {
  const { card } = detail
  const timezone = useUserTimezone()
  const formId = useId()
  const form = useForm<CardFieldsValues, unknown, CardFieldChanges>({
    resolver: standardSchemaResolver(cardFieldsSchema),
    defaultValues: valuesOf(detail),
  })

  // formState is a subscription Proxy: dirtyFields must be read during
  // render or its per-field tracking is skipped, and the submit handler then
  // sees a stale map (observed live: edit title, then priority — priority
  // silently dropped from the PATCH). Reading it here subscribes it — which
  // also keeps the auto-save callback's `form.formState.dirtyFields` read fresh.
  const { dirtyFields, isDirty } = form.formState

  // A fresh server state (SSE refetch, save) updates the non-dirty fields;
  // keepDirtyValues preserves whatever the user is typing mid-edit.
  useEffect(() => {
    form.reset(valuesOf(detail), { keepDirtyValues: true })
  }, [form, detail])

  // Create view: no Save button, so save the edited fields automatically once
  // typing pauses. Same submit path as the manual Save — validate, then send
  // ONLY the dirty subset — just triggered by a debounced field watcher instead
  // of a click. Invalid input (e.g. a title cleared to empty) fails validation
  // and is simply not sent, exactly like the manual path.
  const autoSaveDirty = useDebouncedCallback(() => {
    void form.handleSubmit((values) => {
      const changes = pickDirty(values, form.formState.dirtyFields)
      if (Object.keys(changes).length > 0) onSave(changes)
    })()
  }, 700)
  useEffect(() => {
    if (!autoSave) return
    // form.subscribe (not form.watch): watch() returns a non-memoizable function
    // that makes the React Compiler bail on this component; subscribe is the
    // compiler-safe API and returns its own unsubscribe.
    return form.subscribe({
      formState: { values: true },
      callback: () => {
        autoSaveDirty()
      },
    })
  }, [autoSave, form, autoSaveDirty])

  return (
    <>
      <form
        id={formId}
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
            reporterId={card.reporterId}
            locations={locations}
            knownTags={knownTags}
            // The update command clears optionals explicitly (core schema `.nullable()`).
            cleared={null}
            disabled={disabled}
          />
        </Stack>
      </form>
      {children}
      {/* Timestamps sit LAST in the scrollable content, just above the sticky
          Save (per the panel layout). */}
      <Group gap="lg">
        <Text size="xs" c="dimmed">
          {strings.detail.createdLabel}: {formatDateTime(card.createdAt, timezone)}
        </Text>
        <Text size="xs" c="dimmed">
          {strings.detail.updatedLabel}: {formatDateTime(card.updatedAt, timezone)}
        </Text>
      </Group>
      {disabled || autoSave ? null : (
        <StickyFooter>
          <Stack gap="xs">
            {/* Warns a user who edited a field not to switch tabs/close before
                saving — the change persists only on this explicit click. */}
            {isDirty ? (
              <Text size="xs" c="dimmed">
                {strings.detail.unsavedWarning}
              </Text>
            ) : null}
            <HintButton
              type="submit"
              form={formId}
              fullWidth
              tooltip={strings.tooltips.saveCard}
              disabledReason={isDirty ? undefined : strings.tooltips.disabledNoChanges}
              loading={saving}
              leftSection={<Save size={16} aria-hidden />}
            >
              {strings.detail.saveFields}
            </HintButton>
          </Stack>
        </StickyFooter>
      )}
    </>
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
