import {
  BUILTIN_FILTER_PRESETS,
  EMPTY_BOARD_FILTER,
  type BoardFilter,
  type FilterPreset,
} from '@rivian-kanban/core'
import { ActionIcon, Group, Modal, Select, Stack, TextInput, Tooltip } from '@mantine/core'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  useCreateFilterPreset,
  useDeleteFilterPreset,
  useFilterPresets,
  useUpdateFilterPreset,
} from '../api/filter-presets.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'

export interface FilterPresetsProps {
  /** The current filter — saved verbatim when the user creates/overwrites a preset. */
  filter: BoardFilter
  /** Applies a preset: SETS THE COMPLETE filter state (never a partial overlay). */
  onApply: (filter: BoardFilter) => void
  /** Fills the "My Cards" built-in preset's assignee at render time. */
  currentUserId: string
}

/** Prefix distinguishing a built-in option value from a custom preset id. */
const BUILTIN_PREFIX = 'builtin:'

/**
 * Sentinel value for the trailing "Create new preset" dropdown entry. Selecting
 * it opens the save-preset flow instead of applying a filter (ITEM 3) — the
 * save trigger lives inside the dropdown, not as a separate icon button.
 */
const CREATE_VALUE = 'action:create'

/**
 * Display-only combobox value shown when a preset is applied but the live filter
 * has since drifted from it (an edited facet, #120). It is a synthetic option
 * that never appears in the dropdown — only in the value — so the box reads
 * "Custom" instead of falling back to the placeholder or lying with a name.
 */
const CUSTOM_VALUE = 'state:custom'

const BUILTIN_LABELS: Record<(typeof BUILTIN_FILTER_PRESETS)[number]['key'], string> = {
  my_cards: strings.filterBar.builtinMyCards,
  overdue: strings.filterBar.builtinOverdue,
}

/**
 * Field-wise equality for a `BoardFilter` (flat scalars + string arrays, no
 * nesting), order-insensitive on the any-of arrays. Used to tell whether the
 * live filter still matches the applied preset. ponytail: hand-rolled over a
 * deep-equal dep — the shape is fixed and flat.
 */
function boardFilterEquals(a: BoardFilter, b: BoardFilter): boolean {
  const sameSet = (x: string[], y: string[]) => {
    if (x.length !== y.length) return false
    const sx = [...x].sort()
    const sy = [...y].sort()
    return sx.every((value, index) => value === sy[index])
  }
  return (
    a.q === b.q &&
    a.scope === b.scope &&
    a.overdue === b.overdue &&
    sameSet(a.priorities, b.priorities) &&
    sameSet(a.assigneeIds, b.assigneeIds) &&
    sameSet(a.reporterIds, b.reporterIds) &&
    sameSet(a.tags, b.tags) &&
    sameSet(a.locationIds, b.locationIds)
  )
}

/**
 * The effective `BoardFilter` an applied preset value maps to — the SAME filter
 * `applyValue` handed to `onApply` (a built-in resolved to its constant, "My
 * Cards" with the current user filled in; a custom preset to its saved filter).
 * Null when nothing is applied, or an applied custom preset no longer exists
 * (deleted) — its context is gone, so the box falls back to the placeholder.
 */
function resolveAppliedFilter(
  appliedValue: string | null,
  customPresets: FilterPreset[],
  currentUserId: string,
): BoardFilter | null {
  if (appliedValue === null) return null
  if (appliedValue.startsWith(BUILTIN_PREFIX)) {
    const key = appliedValue.slice(BUILTIN_PREFIX.length)
    const builtin = BUILTIN_FILTER_PRESETS.find((preset) => preset.key === key)
    if (builtin === undefined) return null
    return key === 'my_cards' ? { ...builtin.filter, assigneeIds: [currentUserId] } : builtin.filter
  }
  return customPresets.find((preset) => preset.id === appliedValue)?.filter ?? null
}

/**
 * The presets combobox + the rename / delete affordances. Built-ins (My Cards,
 * Overdue) render from core constants; custom presets come from
 * `GET /filter-presets`. Selecting any preset applies its COMPLETE `BoardFilter`
 * — every facet, not an overlay. "My Cards" fills its assignee with the current
 * user id client-side (only the client knows "me"). A trailing "Create new
 * preset" entry at the bottom of the dropdown opens the save-preset flow
 * (ITEM 3) — there is no separate Save icon button.
 *
 * The combobox value REFLECTS state (#120): it shows the APPLIED preset's name
 * while the live filter still equals it, "Custom" once any facet drifts from
 * that preset, and the placeholder when no preset is the current context (fresh,
 * or "Reset filters"). `appliedValue` is the last applied option value (a
 * built-in `builtin:<key>` or a custom preset id); equality against the applied
 * preset's effective filter decides name-vs-Custom, and re-picking the SAME
 * preset changes the value away from Custom and re-fires onApply.
 */
export function FilterPresets({ filter, onApply, currentUserId }: FilterPresetsProps) {
  const presets = useFilterPresets()
  const createPreset = useCreateFilterPreset()
  const updatePreset = useUpdateFilterPreset()
  const deletePreset = useDeleteFilterPreset()

  // The last applied preset option value (built-in `builtin:<key>` or custom id),
  // the "preset context". Cleared on "Reset filters" (a null selection) and on
  // create; drives whether the box shows a name, "Custom", or the placeholder.
  const [appliedValue, setAppliedValue] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    { kind: 'save' } | { kind: 'rename'; preset: FilterPreset } | null
  >(null)

  const customPresets = presets.data ?? []

  // The effective filter for the applied preset value, resolving a built-in's
  // client-side fill ("My Cards" → me) exactly as `applyValue` did on apply, or a
  // custom preset's saved filter. Null when no preset is applied or an applied
  // custom preset has since been deleted (its context is gone).
  const appliedFilter = resolveAppliedFilter(appliedValue, customPresets, currentUserId)
  // Does the live filter still match the applied preset? Yes → show its name; the
  // preset drifted → "Custom"; no applied preset at all → placeholder.
  const matchesApplied = appliedFilter !== null && boardFilterEquals(appliedFilter, filter)
  // The empty filter is "no preset context" — the placeholder, never "Custom".
  // "Reset filters" lives in the bar (it calls onChange directly, not through
  // this combobox), so an empty live filter is how a reset reads here (#120).
  const isEmpty = boardFilterEquals(filter, EMPTY_BOARD_FILTER)
  const selectedValue =
    appliedFilter === null || isEmpty ? null : matchesApplied ? appliedValue : CUSTOM_VALUE

  // The rename/delete affordances belong to an APPLIED CUSTOM preset the box is
  // currently showing by name (a built-in has neither; a drifted preset reads
  // "Custom", the empty filter reads the placeholder — neither is it).
  const selectedPreset =
    selectedValue !== null && selectedValue === appliedValue
      ? (customPresets.find((preset) => preset.id === appliedValue) ?? null)
      : null

  const builtinData = BUILTIN_FILTER_PRESETS.map((preset) => ({
    value: `${BUILTIN_PREFIX}${preset.key}`,
    label: BUILTIN_LABELS[preset.key],
  }))
  const customData = customPresets.map((preset) => ({ value: preset.id, label: preset.name }))
  const data = [
    { group: strings.filterBar.presetsBuiltInGroup, items: builtinData },
    ...(customData.length > 0
      ? [{ group: strings.filterBar.presetsCustomGroup, items: customData }]
      : []),
    // The trailing "Create new preset" action (its own group renders as a
    // separated footer entry) opens the save dialog (ITEM 3).
    {
      group: strings.filterBar.presetsCreateGroup,
      items: [{ value: CREATE_VALUE, label: strings.filterBar.presetsCreate }],
    },
    // "Custom" is a display-only value (never in a real group so it can't be
    // picked), included ONLY when it's the current value so the Select resolves
    // its label instead of blanking (#120).
    ...(selectedValue === CUSTOM_VALUE
      ? [{ group: '', items: [{ value: CUSTOM_VALUE, label: strings.filterBar.presetsCustom }] }]
      : []),
  ]

  const applyValue = (value: string | null) => {
    if (value === null) {
      // "Reset filters" / clearing the box: drop the preset context entirely.
      setAppliedValue(null)
      return
    }
    if (value === CREATE_VALUE || value === CUSTOM_VALUE) {
      // Create opens the save flow; Custom is display-only. Neither applies a
      // filter or changes the preset context.
      if (value === CREATE_VALUE) setDialog({ kind: 'save' })
      return
    }
    if (value.startsWith(BUILTIN_PREFIX)) {
      const key = value.slice(BUILTIN_PREFIX.length)
      const builtin = BUILTIN_FILTER_PRESETS.find((preset) => preset.key === key)
      if (builtin === undefined) return
      setAppliedValue(value)
      // "My Cards" carries an empty assigneeIds the client fills with "me".
      onApply(
        key === 'my_cards' ? { ...builtin.filter, assigneeIds: [currentUserId] } : builtin.filter,
      )
      return
    }
    const custom = customPresets.find((preset) => preset.id === value)
    if (custom === undefined) return
    setAppliedValue(custom.id)
    onApply(custom.filter)
  }

  return (
    <>
      <Group gap={4} align="center" wrap="nowrap">
        <Tooltip label={strings.filterBar.tooltips.presets} withArrow>
          <Select
            aria-label={strings.filterBar.presetsLabel}
            placeholder={strings.filterBar.presetsPlaceholder}
            data={data}
            value={selectedValue}
            onChange={applyValue}
            clearable
            comboboxProps={{ withinPortal: true }}
          />
        </Tooltip>
        {selectedPreset !== null ? (
          <>
            <Tooltip label={strings.filterBar.tooltips.renamePreset} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={strings.filterBar.renamePreset}
                onClick={() => {
                  setDialog({ kind: 'rename', preset: selectedPreset })
                }}
              >
                <Pencil size={16} aria-hidden />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={strings.filterBar.tooltips.deletePreset} withArrow>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={strings.filterBar.deletePreset}
                loading={deletePreset.isPending}
                onClick={() => {
                  deletePreset.mutate(selectedPreset.id, {
                    onSuccess: () => {
                      setAppliedValue(null)
                    },
                  })
                }}
              >
                <Trash2 size={16} aria-hidden />
              </ActionIcon>
            </Tooltip>
          </>
        ) : null}
      </Group>

      {dialog?.kind === 'save' ? (
        <PresetNameDialog
          title={strings.filterBar.savePresetTitle}
          confirmLabel={strings.filterBar.saveConfirm}
          confirmTooltip={strings.filterBar.tooltips.savePreset}
          loading={createPreset.isPending}
          onClose={() => {
            setDialog(null)
          }}
          onSubmit={(name) => {
            createPreset.mutate(
              { name, filter },
              {
                onSuccess: (created) => {
                  setAppliedValue(created.id)
                  setDialog(null)
                },
              },
            )
          }}
        />
      ) : null}

      {dialog?.kind === 'rename' ? (
        <PresetNameDialog
          title={strings.filterBar.renamePresetTitle}
          confirmLabel={strings.filterBar.renameConfirm}
          confirmTooltip={strings.filterBar.tooltips.renamePreset}
          initialName={dialog.preset.name}
          loading={updatePreset.isPending}
          onClose={() => {
            setDialog(null)
          }}
          onSubmit={(name) => {
            updatePreset.mutate(
              { id: dialog.preset.id, patch: { name } },
              {
                onSuccess: () => {
                  setDialog(null)
                },
              },
            )
          }}
        />
      ) : null}
    </>
  )
}

/** The name-entry modal shared by save and rename. */
function PresetNameDialog({
  title,
  confirmLabel,
  confirmTooltip,
  initialName = '',
  loading,
  onClose,
  onSubmit,
}: {
  title: string
  confirmLabel: string
  confirmTooltip: string
  initialName?: string
  loading: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()
  return (
    <Modal opened onClose={onClose} title={title} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed !== '') onSubmit(trimmed)
        }}
      >
        <Stack gap="md">
          <TextInput
            label={strings.filterBar.presetNameLabel}
            placeholder={strings.filterBar.presetNamePlaceholder}
            value={name}
            data-autofocus
            maxLength={60}
            onChange={(event) => {
              setName(event.currentTarget.value)
            }}
          />
          <Group justify="flex-end">
            <HintButton tooltip={strings.tooltips.cancelDialog} variant="default" onClick={onClose}>
              {strings.common.cancel}
            </HintButton>
            <HintButton
              tooltip={confirmTooltip}
              type="submit"
              loading={loading}
              disabledReason={
                trimmed === '' ? strings.filterBar.tooltips.disabledEmptyPresetName : false
              }
            >
              {confirmLabel}
            </HintButton>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
