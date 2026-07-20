import {
  BUILTIN_FILTER_PRESETS,
  EMPTY_BOARD_FILTER,
  type BoardFilter,
  type FilterPreset,
} from '@rivian-kanban/core'
import {
  ActionIcon,
  Combobox,
  Group,
  Input,
  InputBase,
  Modal,
  Stack,
  Switch,
  TextInput,
  Tooltip,
  useCombobox,
} from '@mantine/core'
import { Pencil, Save, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  useCreateFilterPreset,
  useDeleteFilterPreset,
  useFilterPresets,
  useUpdateFilterPreset,
} from '../api/filter-presets.ts'
import { HintButton } from '../shell/HintButton.tsx'
import { strings } from '../strings.ts'
import classes from './filter-bar.module.css'

export interface FilterPresetsProps {
  /** The current filter — saved verbatim when the user creates/overwrites a preset. */
  filter: BoardFilter
  /** Applies a preset: SETS THE COMPLETE filter state (never a partial overlay). */
  onApply: (filter: BoardFilter) => void
  /** Fills the "Mine" built-in preset's assignee, and tells own vs shared presets apart. */
  currentUserId: string
}

/** Prefix distinguishing a built-in option value from a custom preset id. */
const BUILTIN_PREFIX = 'builtin:'

/**
 * Sentinel value for the trailing "Save preset" dropdown entry. Selecting it
 * opens the save-preset flow instead of applying a filter (ITEM 3) — the save
 * trigger lives inside the dropdown, not as a separate icon button.
 */
const CREATE_VALUE = 'action:create'

/**
 * Display-only sentinel for the combobox's COLLAPSED label when a preset is
 * applied but the live filter has since drifted from it (an edited facet, #120).
 * It is never a dropdown option — the target renders the word "Custom" directly
 * (Combobox lets the collapsed display differ from the option list), so "Custom"
 * shows when collapsed but is never a pickable row. To keep a drifted filter, the
 * user saves it as a named preset ("Save preset").
 */
const CUSTOM_VALUE = 'state:custom'

const BUILTIN_LABELS: Record<(typeof BUILTIN_FILTER_PRESETS)[number]['key'], string> = {
  all: strings.filterBar.builtinAll,
  my_cards: strings.filterBar.builtinMyCards,
  overdue: strings.filterBar.builtinOverdue,
}

/** The "All" built-in's option value — the unfiltered board (the empty filter). */
const ALL_VALUE = `${BUILTIN_PREFIX}all`

/** A dropdown option; `shared` renders a small share glyph so shared presets read as shared. */
interface PresetOption {
  value: string
  label: string
  shared: boolean
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
 * The presets combobox + the rename / share / delete affordances. Built-ins (My
 * Cards, Overdue) render from core constants; custom presets come from
 * `GET /filter-presets` — the caller's OWN presets plus any teammate's shared
 * ones. Selecting any preset applies its COMPLETE `BoardFilter` (every facet,
 * not an overlay). "Mine" fills its assignee with the current user id
 * client-side (only the client knows "me"). A trailing "Save preset" entry (a
 * floppy-disk glyph) opens the save flow.
 *
 * Presets are **per-user private by default**; the owner can share one with the
 * whole team. Own presets sit under "My presets" (a share glyph marks the ones
 * you've shared); teammates' shared presets sit under "Shared with you" and are
 * apply-only — the rename / share / delete affordances show only for an APPLIED
 * preset you OWN (a shared preset is editable only by its owner).
 *
 * The combobox value REFLECTS state (#120): the APPLIED preset's name while the
 * live filter still equals it, "Custom" once any facet drifts, the placeholder
 * when no preset is the current context.
 */
export function FilterPresets({ filter, onApply, currentUserId }: FilterPresetsProps) {
  const presets = useFilterPresets()
  const createPreset = useCreateFilterPreset()
  const updatePreset = useUpdateFilterPreset()
  const deletePreset = useDeleteFilterPreset()
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption()
    },
  })

  // The last applied preset option value (built-in `builtin:<key>` or custom id),
  // the "preset context". Cleared on "Reset filters" (a null selection) and on
  // create; drives whether the box shows a name, "Custom", or the placeholder.
  const [appliedValue, setAppliedValue] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    { kind: 'save' } | { kind: 'rename'; preset: FilterPreset } | null
  >(null)

  const customPresets = presets.data ?? []
  // Own presets vs teammates' shared ones (the server only returns another
  // user's preset when it is shared, so any non-owned row here is a shared one).
  const myPresets = customPresets.filter((preset) => preset.ownerId === currentUserId)
  const sharedPresets = customPresets.filter((preset) => preset.ownerId !== currentUserId)

  // The effective filter for the applied preset value, resolving a built-in's
  // client-side fill ("Mine" → me) exactly as `applyValue` did on apply, or a
  // custom preset's saved filter. Null when no preset is applied or an applied
  // custom preset has since been deleted (its context is gone).
  const appliedFilter = resolveAppliedFilter(appliedValue, customPresets, currentUserId)
  // Does the live filter still match the applied preset? Yes → show its name; the
  // preset drifted → "Custom"; no applied preset at all → placeholder.
  const matchesApplied = appliedFilter !== null && boardFilterEquals(appliedFilter, filter)
  // The empty (unfiltered) filter IS the "All" built-in — it's the default and
  // what "Reset filters" restores (the bar calls onChange directly, so an empty
  // live filter is how a reset reads here, #120). A non-empty filter shows the
  // applied preset's name while it still matches, "Custom" once it drifts.
  const isEmpty = boardFilterEquals(filter, EMPTY_BOARD_FILTER)
  const selectedValue = isEmpty
    ? ALL_VALUE
    : appliedFilter === null
      ? null
      : matchesApplied
        ? appliedValue
        : CUSTOM_VALUE

  // The rename/share/delete affordances belong to an APPLIED preset you OWN that
  // the box is currently showing by name (a built-in has none; a teammate's
  // shared preset is apply-only; a drifted preset reads "Custom"; the empty
  // filter reads the placeholder — none of those is editable here).
  const editablePreset =
    selectedValue !== null && selectedValue === appliedValue
      ? (myPresets.find((preset) => preset.id === appliedValue) ?? null)
      : null
  // Scope the share affordance's spinner to a share toggle specifically, so a
  // rename in flight doesn't also spin the share icon (both use `updatePreset`).
  const sharePending =
    updatePreset.isPending &&
    editablePreset !== null &&
    updatePreset.variables.id === editablePreset.id &&
    updatePreset.variables.patch.shared !== undefined

  const builtinData: PresetOption[] = BUILTIN_FILTER_PRESETS.map((preset) => ({
    value: `${BUILTIN_PREFIX}${preset.key}`,
    label: BUILTIN_LABELS[preset.key],
    shared: false,
  }))
  const myData: PresetOption[] = myPresets.map((preset) => ({
    value: preset.id,
    label: preset.name,
    shared: preset.shared,
  }))
  const sharedData: PresetOption[] = sharedPresets.map((preset) => ({
    value: preset.id,
    label: preset.name,
    shared: true,
  }))

  // The COLLAPSED display label. A drifted preset reads "Custom" (a sentinel that
  // is never a dropdown option — the whole point of using Combobox over Select),
  // an applied preset reads its own name, and no context reads the placeholder.
  const displayLabel =
    selectedValue === null
      ? null
      : selectedValue === CUSTOM_VALUE
        ? strings.filterBar.presetsCustom
        : ([...builtinData, ...myData, ...sharedData].find(
            (option) => option.value === selectedValue,
          )?.label ?? null)

  // onOptionSubmit only ever fires for a real dropdown row (a preset or the
  // "Save preset" action) — "Custom" is display-only and never submitted.
  const applyValue = (value: string) => {
    if (value === CREATE_VALUE) {
      setDialog({ kind: 'save' })
      return
    }
    if (value.startsWith(BUILTIN_PREFIX)) {
      const key = value.slice(BUILTIN_PREFIX.length)
      const builtin = BUILTIN_FILTER_PRESETS.find((preset) => preset.key === key)
      if (builtin === undefined) return
      setAppliedValue(value)
      // "Mine" carries an empty assigneeIds the client fills with "me".
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
        <Combobox
          store={combobox}
          onOptionSubmit={(value) => {
            applyValue(value)
            combobox.closeDropdown()
          }}
        >
          <Tooltip label={strings.filterBar.tooltips.presets} withArrow>
            <Combobox.Target targetType="button" withExpandedAttribute>
              <InputBase
                component="button"
                type="button"
                pointer
                className={classes.preset}
                // The visible control is the inner `input` button, and it sizes
                // to its label (64px "All" vs 101px "Overdue") — a top-level
                // width never reaches it. Pin the button itself via the Styles API.
                classNames={{ input: classes.presetControl }}
                aria-label={strings.filterBar.presetsLabel}
                rightSection={<Combobox.Chevron />}
                rightSectionPointerEvents="none"
                onClick={() => {
                  combobox.toggleDropdown()
                }}
              >
                {displayLabel ?? (
                  <Input.Placeholder>{strings.filterBar.presetsPlaceholder}</Input.Placeholder>
                )}
              </InputBase>
            </Combobox.Target>
          </Tooltip>
          <Combobox.Dropdown className={classes.presetDropdown}>
            <Combobox.Options>
              <Combobox.Group label={strings.filterBar.presetsBuiltInGroup}>
                {builtinData.map((option) => (
                  <PresetOptionRow key={option.value} option={option} />
                ))}
              </Combobox.Group>
              {myData.length > 0 ? (
                <Combobox.Group label={strings.filterBar.presetsCustomGroup}>
                  {myData.map((option) => (
                    <PresetOptionRow key={option.value} option={option} />
                  ))}
                </Combobox.Group>
              ) : null}
              {sharedData.length > 0 ? (
                <Combobox.Group label={strings.filterBar.presetsSharedGroup}>
                  {sharedData.map((option) => (
                    <PresetOptionRow key={option.value} option={option} />
                  ))}
                </Combobox.Group>
              ) : null}
              {/* The trailing "Save preset" action opens the save dialog. A
                  floppy-disk glyph marks it as the save affordance; nowrap keeps
                  the icon + label on one line. */}
              <Combobox.Group label={strings.filterBar.presetsCreateGroup}>
                <Combobox.Option value={CREATE_VALUE}>
                  <Group gap="xs" wrap="nowrap">
                    <Save size={16} aria-hidden />
                    {strings.filterBar.presetsCreate}
                  </Group>
                </Combobox.Option>
              </Combobox.Group>
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
        {editablePreset !== null ? (
          <>
            <Tooltip label={strings.filterBar.tooltips.renamePreset} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={strings.filterBar.renamePreset}
                onClick={() => {
                  setDialog({ kind: 'rename', preset: editablePreset })
                }}
              >
                <Pencil size={16} aria-hidden />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={
                editablePreset.shared
                  ? strings.filterBar.tooltips.unsharePreset
                  : strings.filterBar.tooltips.sharePreset
              }
              withArrow
            >
              <ActionIcon
                variant={editablePreset.shared ? 'light' : 'subtle'}
                color={editablePreset.shared ? 'blue' : 'gray'}
                aria-label={
                  editablePreset.shared
                    ? strings.filterBar.unsharePreset
                    : strings.filterBar.sharePreset
                }
                aria-pressed={editablePreset.shared}
                loading={sharePending}
                onClick={() => {
                  updatePreset.mutate({
                    id: editablePreset.id,
                    patch: { shared: !editablePreset.shared },
                  })
                }}
              >
                <Share2 size={16} aria-hidden />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={strings.filterBar.tooltips.deletePreset} withArrow>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={strings.filterBar.deletePreset}
                loading={deletePreset.isPending}
                onClick={() => {
                  deletePreset.mutate(editablePreset.id, {
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
          withShare
          loading={createPreset.isPending}
          onClose={() => {
            setDialog(null)
          }}
          onSubmit={({ name, shared }) => {
            createPreset.mutate(
              { name, filter, shared },
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
          onSubmit={({ name }) => {
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

/** One dropdown row; a shared preset carries a share glyph before its name. */
function PresetOptionRow({ option }: { option: PresetOption }) {
  return (
    <Combobox.Option value={option.value}>
      {option.shared ? (
        <Group gap="xs" wrap="nowrap">
          <Share2 size={14} aria-hidden />
          {option.label}
        </Group>
      ) : (
        option.label
      )}
    </Combobox.Option>
  )
}

/** The name-entry modal shared by save and rename; save also offers a share toggle. */
function PresetNameDialog({
  title,
  confirmLabel,
  confirmTooltip,
  initialName = '',
  withShare = false,
  loading,
  onClose,
  onSubmit,
}: {
  title: string
  confirmLabel: string
  confirmTooltip: string
  initialName?: string
  withShare?: boolean
  loading: boolean
  onClose: () => void
  onSubmit: (values: { name: string; shared: boolean }) => void
}) {
  const [name, setName] = useState(initialName)
  const [shared, setShared] = useState(false)
  const trimmed = name.trim()
  return (
    <Modal opened onClose={onClose} title={title} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed !== '') onSubmit({ name: trimmed, shared })
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
          {withShare ? (
            <Switch
              label={strings.filterBar.shareToggle}
              description={strings.filterBar.shareToggleHint}
              checked={shared}
              onChange={(event) => {
                setShared(event.currentTarget.checked)
              }}
            />
          ) : null}
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
