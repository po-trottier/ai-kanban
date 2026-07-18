import { BUILTIN_FILTER_PRESETS, type BoardFilter, type FilterPreset } from '@rivian-kanban/core'
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
    sameSet(a.laneKeys, b.laneKeys) &&
    sameSet(a.assigneeIds, b.assigneeIds) &&
    sameSet(a.reporterIds, b.reporterIds) &&
    sameSet(a.tags, b.tags) &&
    sameSet(a.locationIds, b.locationIds)
  )
}

/**
 * The presets combobox + the rename / delete affordances. Built-ins (My Cards,
 * Overdue) render from core constants; custom presets come from
 * `GET /filter-presets`. Selecting any preset applies its COMPLETE `BoardFilter`
 * — every facet, not an overlay. "My Cards" fills its assignee with the current
 * user id client-side (only the client knows "me"). A trailing "Create new
 * preset" entry at the bottom of the dropdown opens the save-preset flow
 * (ITEM 3) — there is no separate Save icon button.
 */
export function FilterPresets({ filter, onApply, currentUserId }: FilterPresetsProps) {
  const presets = useFilterPresets()
  const createPreset = useCreateFilterPreset()
  const updatePreset = useUpdateFilterPreset()
  const deletePreset = useDeleteFilterPreset()

  // The currently selected custom preset (built-ins are stateless applies).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    { kind: 'save' } | { kind: 'rename'; preset: FilterPreset } | null
  >(null)

  const customPresets = presets.data ?? []
  // The combobox reflects the selected preset ONLY while the live filter still
  // equals its saved filter. Once any facet drifts (an edit, or "Clear filters"
  // resetting the bar), the selection clears — so the combobox never lies, and
  // re-picking the SAME preset changes the Select value and re-fires onApply
  // (Mantine's Select no-ops when re-selecting the already-current value).
  const selectedPreset =
    customPresets.find(
      (preset) => preset.id === selectedId && boardFilterEquals(preset.filter, filter),
    ) ?? null
  const selectedValue = selectedPreset?.id ?? null

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
  ]

  const applyValue = (value: string | null) => {
    if (value === null) {
      setSelectedId(null)
      return
    }
    if (value === CREATE_VALUE) {
      // Open the save flow; do NOT change the applied preset/selection.
      setDialog({ kind: 'save' })
      return
    }
    if (value.startsWith(BUILTIN_PREFIX)) {
      const key = value.slice(BUILTIN_PREFIX.length)
      const builtin = BUILTIN_FILTER_PRESETS.find((preset) => preset.key === key)
      if (builtin === undefined) return
      setSelectedId(null)
      // "My Cards" carries an empty assigneeIds the client fills with "me".
      onApply(
        key === 'my_cards' ? { ...builtin.filter, assigneeIds: [currentUserId] } : builtin.filter,
      )
      return
    }
    const custom = customPresets.find((preset) => preset.id === value)
    if (custom === undefined) return
    setSelectedId(custom.id)
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
                      setSelectedId(null)
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
                  setSelectedId(created.id)
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
