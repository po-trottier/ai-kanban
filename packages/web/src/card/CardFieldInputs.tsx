import { PRIORITIES, type Location } from '@rivian-kanban/core'
import { Select, Stack, TagsInput, Text, TextInput } from '@mantine/core'
import { Controller, type Control, type UseFormRegisterReturn } from 'react-hook-form'
import { AsyncUserSelect, ResolvedUserSelect } from '../shell/AsyncUserPicker.tsx'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { strings } from '../strings.ts'
import { type CardFieldValues } from './card-fields.ts'
import { DescriptionEditor } from './DescriptionEditor.tsx'
import { EstimateInput } from './EstimateInput.tsx'
import { LocationPicker } from './LocationPicker.tsx'

export interface CardFieldInputsProps {
  /** The owning form's control, widened via `cardFieldsControl`. */
  control: Control<CardFieldValues>
  /** `form.register('title')` — registration props are not form-generic. */
  titleField: UseFormRegisterReturn
  errors: { title?: string | undefined; estimateMinutes?: string | undefined }
  /**
   * When set (the edit form), a disabled Reporter picker renders directly below
   * Assignee — identical to it, showing who filed the card (never editable here).
   * Its name resolves via `?ids=` (deactivated reporters still render). Omitted
   * by the create modal (a new card's reporter is the current user).
   */
  reporterId?: string | undefined
  locations: Location[]
  knownTags: string[]
  /**
   * What "cleared" means for the optional fields — the ONLY semantic
   * difference between the two forms: the update command clears explicitly
   * with `null` (core schema `.nullable()`), the create command simply omits
   * the field (`undefined`, core schema `.optional()`).
   */
  cleared: null | undefined
  /** Archived cards are read-only except reopen (workflow.md#terminal-states). */
  disabled?: boolean
}

/**
 * The seven-field card roster (title, description, priority, estimate,
 * assignee, location, tags), rendered once for both the create modal and the
 * edit form. Validation always comes from the owning form's core-schema
 * resolver; this component only owns presentation and value normalization —
 * adding a card field is a one-file edit that both forms pick up.
 */
export function CardFieldInputs({
  control,
  titleField,
  errors,
  reporterId,
  locations,
  knownTags,
  cleared,
  disabled = false,
}: CardFieldInputsProps) {
  return (
    // Generous vertical rhythm so the fields are easy to scan (both the detail
    // panel and the create panel render this same roster).
    <Stack gap="lg">
      <TextInput
        label={
          <FieldLabel label={strings.detail.titleLabel} help={strings.fieldHelp.title} required />
        }
        disabled={disabled}
        error={errors.title}
        {...titleField}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <DescriptionEditor
            value={field.value ?? ''}
            disabled={disabled}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="priority"
        render={({ field }) => (
          <Select
            label={
              <FieldLabel label={strings.detail.priorityLabel} help={strings.fieldHelp.priority} />
            }
            data={PRIORITIES.map((priority) => ({
              value: priority,
              label: `${priority} — ${strings.priorityOptions[priority].name}`,
            }))}
            // A short plain-language description under each code (ITEM 3) so a
            // non-technical user understands P0/P1/P2, not just the labels.
            renderOption={({ option }) => {
              const priority = option.value
              return (
                <Stack gap={0}>
                  <Text size="sm">{`${priority} — ${strings.priorityOptions[priority].name}`}</Text>
                  <Text size="xs" c="dimmed">
                    {strings.priorityOptions[priority].description}
                  </Text>
                </Stack>
              )
            }}
            // Both forms default priority (schema default / current card),
            // so the fallback is belt-and-braces for the never-unset field.
            value={field.value ?? 'P2'}
            allowDeselect={false}
            disabled={disabled}
            onChange={(value) => {
              if (value !== null) field.onChange(value)
            }}
          />
        )}
      />
      <Controller
        control={control}
        name="estimateMinutes"
        render={({ field }) => (
          <EstimateInput
            minutes={field.value ?? null}
            disabled={disabled}
            error={errors.estimateMinutes}
            cleared={cleared}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="assigneeId"
        render={({ field }) => (
          // Async searchable: searches the server as the user types and keeps the
          // current assignee id resolved to a name (never loads the whole roster).
          <AsyncUserSelect
            label={
              <FieldLabel label={strings.detail.assigneeLabel} help={strings.fieldHelp.assignee} />
            }
            value={field.value ?? null}
            disabled={disabled}
            onChange={(value) => {
              field.onChange(value ?? cleared)
            }}
          />
        )}
      />
      {reporterId === undefined ? null : (
        // Identical to Assignee but always disabled: who filed the card, shown
        // here and never editable. Its name resolves via `?ids=` so even a
        // deactivated reporter (absent from search) still renders.
        <ResolvedUserSelect
          userId={reporterId}
          label={
            <FieldLabel label={strings.detail.reporterLabel} help={strings.fieldHelp.reporter} />
          }
        />
      )}
      <Controller
        control={control}
        name="locationId"
        render={({ field }) => (
          <LocationPicker
            locations={locations}
            value={field.value ?? null}
            disabled={disabled}
            onChange={(value) => {
              field.onChange(value ?? cleared)
            }}
          />
        )}
      />
      <Controller
        control={control}
        name="tags"
        render={({ field }) => (
          <TagsInput
            label={<FieldLabel label={strings.detail.tagsLabel} help={strings.fieldHelp.tags} />}
            data={knownTags}
            value={field.value ?? []}
            disabled={disabled}
            onChange={field.onChange}
          />
        )}
      />
    </Stack>
  )
}
