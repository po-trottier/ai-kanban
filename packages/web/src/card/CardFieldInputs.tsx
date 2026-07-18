import { PRIORITIES, type Location } from '@rivian-kanban/core'
import { Select, Stack, TagsInput, Text, TextInput } from '@mantine/core'
import { Controller, type Control, type UseFormRegisterReturn } from 'react-hook-form'
import { type PickerUser } from '../api/schemas.ts'
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
  users: PickerUser[]
  /**
   * When set (the edit form), a disabled Reporter picker renders directly below
   * Assignee — identical to it, showing who filed the card (never editable here).
   * Omitted by the create modal (a new card's reporter is the current user).
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

/** Assignee-style options guaranteed to include the reporter, so the disabled
 *  Reporter picker resolves a name even if the reporter is no longer assignable. */
function reporterOptions(users: PickerUser[], reporterId: string) {
  const options = users.map((user) => ({ value: user.id, label: user.displayName }))
  return options.some((option) => option.value === reporterId)
    ? options
    : [...options, { value: reporterId, label: strings.history.unknownUser }]
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
  users,
  reporterId,
  locations,
  knownTags,
  cleared,
  disabled = false,
}: CardFieldInputsProps) {
  return (
    <>
      <TextInput
        label={strings.detail.titleLabel}
        withAsterisk
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
            label={strings.detail.priorityLabel}
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
          <Select
            label={strings.detail.assigneeLabel}
            data={users.map((user) => ({ value: user.id, label: user.displayName }))}
            value={field.value ?? null}
            clearable
            disabled={disabled}
            onChange={(value) => {
              field.onChange(value ?? cleared)
            }}
          />
        )}
      />
      {reporterId === undefined ? null : (
        <Select
          label={strings.detail.reporterLabel}
          // Identical to Assignee but always disabled: who filed the card, shown
          // here and never editable. The reporter is guaranteed an option (even
          // if no longer an assignable user) so the name resolves.
          data={reporterOptions(users, reporterId)}
          value={reporterId}
          disabled
          onChange={() => undefined}
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
            label={strings.detail.tagsLabel}
            data={knownTags}
            value={field.value ?? []}
            disabled={disabled}
            onChange={field.onChange}
          />
        )}
      />
    </>
  )
}
