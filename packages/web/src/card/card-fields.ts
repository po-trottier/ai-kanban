import { type Priority } from '@rivian-kanban/core'
import { type Control, type FieldValues } from 'react-hook-form'

/**
 * The card form's shared field values, as BOTH card forms see them: the
 * create modal's values (`z.input` of core's `createCardInputSchema`) and the
 * edit form's (`updateCardInputSchema` minus `expectedVersion`) are each
 * field-by-field subsets of this widened shape — create never holds null,
 * edit marks every field optional/nullable. `CardFieldInputs` renders the
 * seven-field roster once against this shape so the two forms cannot drift.
 */
export interface CardFieldValues {
  // Explicit `| undefined` everywhere: the zod `.optional()` inputs carry it,
  // and exactOptionalPropertyTypes would otherwise reject them.
  title?: string | undefined
  description?: string | undefined
  priority?: Priority | undefined
  estimateMinutes?: number | null | undefined
  assigneeId?: string | null | undefined
  locationId?: string | null | undefined
  tags?: string[] | undefined
}

/**
 * Widens a form control to the shared field shape. Safe by construction: the
 * `T extends CardFieldValues` constraint proves every shared field's value
 * type fits, and `CardFieldInputs` only reads/writes those fields — the cast
 * exists because react-hook-form's `Control` is invariant in its generic, so
 * no common `Control` type exists for two different form-value shapes.
 */
export function cardFieldsControl<T extends CardFieldValues & FieldValues>(
  control: Control<T>,
): Control<CardFieldValues> {
  return control as unknown as Control<CardFieldValues>
}
