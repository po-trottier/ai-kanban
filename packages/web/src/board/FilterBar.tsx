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
  Divider,
  Group,
  MultiSelect,
  type MultiSelectProps,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { locationPath } from '../lib/location-tree.ts'
import { type PickerUser } from '../api/schemas.ts'
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
 * shared `BoardFilter` as one centered, section-grouped row. The bar is
 * placeholder-only — no visible field labels — so each control carries an
 * `aria-label` for its accessible name (convention #104). The any-of facets
 * (Status, Priority, assignee, reporter, tags, location) are `MultiSelect` pill
 * comboboxes (compact selected pills); the single-value facets (scope, overdue)
 * are `SegmentedControl`s; plus the text query, the presets combobox, and a
 * Clear reset. Facets are grouped by kind (attributes · people · classification
 * · scope) with vertical `Divider`s between groups. Presentational + controlled:
 * it holds no state, just renders `filter` and calls `onChange` with the next
 * `BoardFilter`.
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

  // Each priority option shows its code + plain-language name + description (the
  // same content the card priority Select renders) so a non-technical user
  // understands what P0/P1/P2 mean, not just the codes.
  const renderPriorityOption: MultiSelectProps['renderOption'] = ({ option }) => {
    const priority = option.value as Priority
    return (
      <Stack gap={0}>
        <Text size="sm">{`${priority} — ${strings.priorityOptions[priority].name}`}</Text>
        <Text size="xs" c="dimmed">
          {strings.priorityOptions[priority].description}
        </Text>
      </Stack>
    )
  }

  return (
    <div className={classes.bar} role="region" aria-label={strings.filterBar.regionLabel}>
      {/* align="center" vertically centers every control incl. Clear (ITEM 4);
          Dividers separate the facet groups (ITEM 1). */}
      <Group gap="sm" align="center" wrap="wrap">
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

        <Divider orientation="vertical" className={classes.divider} />

        {/* Card attributes: status · priority. */}
        <PillFacet
          label={strings.filterBar.laneLabel}
          placeholder={strings.filterBar.lanePlaceholder}
          tooltip={strings.filterBar.tooltips.lane}
          data={LANE_KEYS.map((key) => ({ value: key, label: strings.laneNames[key] }))}
          value={filter.laneKeys}
          onChange={(next) => {
            set('laneKeys', next as LaneKey[])
          }}
        />

        <PillFacet
          label={strings.filterBar.priorityLabel}
          placeholder={strings.filterBar.priorityPlaceholder}
          tooltip={strings.filterBar.tooltips.priority}
          data={PRIORITIES.map((p) => ({ value: p, label: strings.priorities[p] }))}
          value={filter.priorities}
          onChange={(next) => {
            set('priorities', next as Priority[])
          }}
          renderOption={renderPriorityOption}
        />

        <Divider orientation="vertical" className={classes.divider} />

        {/* People: assignee · reporter. */}
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

        <Divider orientation="vertical" className={classes.divider} />

        {/* Classification: tags · location. */}
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

        <Divider orientation="vertical" className={classes.divider} />

        {/* Scope + overdue toggles. */}
        <SegmentedFacet
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
          groupLabel={strings.filterBar.overdueLabel}
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

        {/* Right-aligned: presets + clear (ITEM 1). */}
        <Group gap="sm" align="center" wrap="nowrap" ml="auto">
          <FilterPresets filter={filter} onApply={onChange} currentUserId={currentUserId} />

          <Tooltip label={strings.filterBar.tooltips.clearAll} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={strings.filterBar.clearAll}
              onClick={() => {
                onChange(EMPTY_BOARD_FILTER)
              }}
            >
              <CloseIcon size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </div>
  )
}

/** A single-value segmented facet (scope, overdue). Placeholder-only bar, so the
 *  visible label is dropped and the group's accessible name rides on aria-label. */
function SegmentedFacet({
  groupLabel,
  tooltip,
  value,
  data,
  onChange,
}: {
  groupLabel: string
  tooltip: string
  value: string
  data: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  return (
    <Tooltip label={tooltip} withArrow>
      <SegmentedControl
        size="sm"
        value={value}
        data={data}
        onChange={onChange}
        aria-label={groupLabel}
      />
    </Tooltip>
  )
}

/** An any-of facet as a multi-select pill combobox (compact selected pills).
 *  Label-less: `label` is the control's accessible name (aria-label). */
function PillFacet({
  label,
  placeholder,
  tooltip,
  data,
  value,
  onChange,
  renderOption,
}: {
  label: string
  placeholder: string
  tooltip: string
  data: { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  renderOption?: MultiSelectProps['renderOption']
}) {
  return (
    <Tooltip label={tooltip} withArrow>
      <MultiSelect
        className={classes.pill}
        aria-label={label}
        placeholder={value.length === 0 ? placeholder : undefined}
        data={data}
        value={value}
        onChange={onChange}
        // Only spread renderOption when set — exactOptionalPropertyTypes rejects
        // an explicit `renderOption={undefined}`.
        {...(renderOption ? { renderOption } : {})}
        searchable
        clearable
        hidePickedOptions
        comboboxProps={{ withinPortal: true }}
      />
    </Tooltip>
  )
}
