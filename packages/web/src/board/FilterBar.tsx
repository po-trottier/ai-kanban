import {
  EMPTY_BOARD_FILTER,
  LANE_KEYS,
  PRIORITIES,
  type BoardFilter,
  type FilterScope,
  type LaneKey,
  type Location,
  type Priority,
} from '@rivian-kanban/core'
import {
  ActionIcon,
  Chip,
  Group,
  MultiSelect,
  SegmentedControl,
  Stack,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { locationPath } from '../lib/location-tree.ts'
import { type PickerUser } from '../api/schemas.ts'
import { FieldLabel } from '../shell/FieldLabel.tsx'
import { HintButton } from '../shell/HintButton.tsx'
import { CloseIcon, SearchIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'
import { FilterPresets } from './FilterPresets.tsx'
import classes from './filter-bar.module.css'

export interface FilterBarProps {
  filter: BoardFilter
  onChange: (filter: BoardFilter) => void
  users: PickerUser[]
  tags: string[]
  locations: Location[]
  /** The current user's id — fills the "My Cards" built-in preset. */
  currentUserId: string
}

/**
 * The board filter bar (below the header, above the board): every facet of the
 * shared `BoardFilter` as one row of controls. Enumerable facets (priority,
 * status, scope, overdue) are split segmented controls; high-cardinality ones
 * (assignee, reporter, tags, location) are multi-select pill comboboxes; plus a
 * text query and the presets combobox. Presentational + controlled: it holds no
 * state, just renders `filter` and calls `onChange` with the next `BoardFilter`.
 */
export function FilterBar({
  filter,
  onChange,
  users,
  tags,
  locations,
  currentUserId,
}: FilterBarProps) {
  const set = <K extends keyof BoardFilter>(key: K, value: BoardFilter[K]) => {
    onChange({ ...filter, [key]: value })
  }

  const userOptions = users.map((user) => ({ value: user.id, label: user.displayName }))
  const tagOptions = tags.map((tag) => ({ value: tag, label: tag }))
  const locationOptions = locations
    .map((location) => ({ value: location.id, label: locationPath(locations, location.id) }))
    .toSorted((a, b) => a.label.localeCompare(b.label))

  return (
    <div className={classes.bar} role="region" aria-label={strings.filterBar.regionLabel}>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <FilterPresets filter={filter} onApply={onChange} currentUserId={currentUserId} />

        <Tooltip label={strings.filterBar.tooltips.query} withArrow>
          <TextInput
            className={classes.query}
            aria-label={strings.filterBar.queryLabel}
            placeholder={strings.filterBar.queryPlaceholder}
            value={filter.q}
            leftSection={<SearchIcon size={16} />}
            rightSection={
              filter.q === '' ? null : (
                <Tooltip label={strings.filterBar.queryClear}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={strings.filterBar.queryClear}
                    onClick={() => {
                      set('q', '')
                    }}
                  >
                    <CloseIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              )
            }
            onChange={(event) => {
              set('q', event.currentTarget.value)
            }}
          />
        </Tooltip>

        <ChipFacet
          label={strings.filterBar.priorityLabel}
          groupLabel={strings.filterBar.priorityGroupLabel}
          tooltip={strings.filterBar.tooltips.priority}
          value={filter.priorities}
          options={PRIORITIES.map((p) => ({ value: p, label: strings.priorities[p] }))}
          onChange={(next) => {
            set('priorities', next as Priority[])
          }}
        />

        <ChipFacet
          label={strings.filterBar.laneLabel}
          groupLabel={strings.filterBar.laneGroupLabel}
          tooltip={strings.filterBar.tooltips.lane}
          value={filter.laneKeys}
          options={LANE_KEYS.map((key) => ({ value: key, label: strings.laneNames[key] }))}
          onChange={(next) => {
            set('laneKeys', next as LaneKey[])
          }}
        />

        <SegmentedFacet
          label={strings.filterBar.scopeLabel}
          groupLabel={strings.filterBar.scopeGroupLabel}
          tooltip={strings.filterBar.tooltips.scope}
          value={filter.scope}
          data={[
            { value: 'active', label: strings.filterBar.scopeActive },
            { value: 'archived', label: strings.filterBar.scopeArchived },
            { value: 'all', label: strings.filterBar.scopeAll },
          ]}
          onChange={(next) => {
            set('scope', next as FilterScope)
          }}
        />

        <SegmentedFacet
          label={strings.filterBar.overdueLabel}
          groupLabel={strings.filterBar.tooltips.overdue}
          tooltip={strings.filterBar.tooltips.overdue}
          value={filter.overdue ? 'overdue' : 'any'}
          data={[
            { value: 'any', label: strings.filterBar.overdueAny },
            { value: 'overdue', label: strings.filterBar.overdueOnly },
          ]}
          onChange={(next) => {
            set('overdue', next === 'overdue')
          }}
        />

        <PillFacet
          label={strings.filterBar.assigneeLabel}
          placeholder={strings.filterBar.assigneePlaceholder}
          tooltip={strings.filterBar.tooltips.assignee}
          data={userOptions}
          value={filter.assigneeIds}
          onChange={(next) => {
            set('assigneeIds', next)
          }}
        />

        <PillFacet
          label={strings.filterBar.reporterLabel}
          placeholder={strings.filterBar.reporterPlaceholder}
          tooltip={strings.filterBar.tooltips.reporter}
          data={userOptions}
          value={filter.reporterIds}
          onChange={(next) => {
            set('reporterIds', next)
          }}
        />

        <PillFacet
          label={strings.filterBar.tagsLabel}
          placeholder={strings.filterBar.tagsPlaceholder}
          tooltip={strings.filterBar.tooltips.tags}
          data={tagOptions}
          value={filter.tags}
          onChange={(next) => {
            set('tags', next)
          }}
        />

        <PillFacet
          label={strings.filterBar.locationsLabel}
          placeholder={strings.filterBar.locationsPlaceholder}
          tooltip={strings.filterBar.tooltips.locations}
          data={locationOptions}
          value={filter.locationIds}
          onChange={(next) => {
            set('locationIds', next)
          }}
        />

        <HintButton
          tooltip={strings.filterBar.tooltips.clearAll}
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={() => {
            onChange(EMPTY_BOARD_FILTER)
          }}
        >
          {strings.filterBar.clearAll}
        </HintButton>
      </Group>
    </div>
  )
}

/** An any-of segmented facet rendered as a Chip.Group of split toggle segments. */
function ChipFacet({
  label,
  groupLabel,
  tooltip,
  value,
  options,
  onChange,
}: {
  label: string
  groupLabel: string
  tooltip: string
  value: string[]
  options: { value: string; label: string }[]
  onChange: (next: string[]) => void
}) {
  return (
    <Stack gap={4}>
      <FieldLabel label={label} help={tooltip} />
      <Chip.Group multiple value={value} onChange={onChange}>
        <Group gap={4} wrap="nowrap" role="group" aria-label={groupLabel}>
          {options.map((option) => (
            <Chip key={option.value} value={option.value} size="sm" variant="outline">
              {option.label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </Stack>
  )
}

/** A single-value segmented facet (scope, overdue). */
function SegmentedFacet({
  label,
  groupLabel,
  tooltip,
  value,
  data,
  onChange,
}: {
  label: string
  groupLabel: string
  tooltip: string
  value: string
  data: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  return (
    <Stack gap={4}>
      <FieldLabel label={label} help={tooltip} />
      <Tooltip label={tooltip} withArrow>
        <SegmentedControl
          size="sm"
          value={value}
          data={data}
          onChange={onChange}
          aria-label={groupLabel}
        />
      </Tooltip>
    </Stack>
  )
}

/** A high-cardinality any-of facet rendered as a multi-select pill combobox. */
function PillFacet({
  label,
  placeholder,
  tooltip,
  data,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  tooltip: string
  data: { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <Tooltip label={tooltip} withArrow>
      <MultiSelect
        className={classes.pill}
        label={label}
        aria-label={label}
        placeholder={value.length === 0 ? placeholder : undefined}
        data={data}
        value={value}
        onChange={onChange}
        searchable
        clearable
        hidePickedOptions
        comboboxProps={{ withinPortal: true }}
      />
    </Tooltip>
  )
}
