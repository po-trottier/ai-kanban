import {
  EMPTY_BOARD_FILTER,
  PRIORITIES,
  type BoardFilter,
  type FilterScope,
  type Location,
  type Priority,
} from '@rivian-kanban/core'
import {
  ActionIcon,
  Button,
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
import { RotateCcw } from 'lucide-react'
import { locationPath } from '../lib/location-tree.ts'
import { AsyncUserMultiSelect } from '../shell/AsyncUserPicker.tsx'
import { CloseIcon, SearchIcon } from '../shell/icons.tsx'
import { strings } from '../strings.ts'
import { FilterPresets } from './FilterPresets.tsx'
import classes from './filter-bar.module.css'

export interface FilterBarProps {
  filter: BoardFilter
  onChange: (filter: BoardFilter) => void
  /** A filtered board fetch is pending or in flight (incl. the debounce window):
   *  shows a spinner in the search box so an edit reads as "working" immediately. */
  busy?: boolean
  tags: string[]
  locations: Location[]
  /** The current user's id — fills the "My Cards" built-in preset. */
  currentUserId: string
}

/**
 * The board filter bar (below the header, above the board): every facet of the
 * shared `BoardFilter` on one wrapping row laid out in THREE zones — the search
 * input (left), the facet group centered in the flexible middle, and the presets
 * + Reset-filters control (right). The bar is placeholder-only — no visible field
 * labels — so each control carries an `aria-label` for its accessible name
 * (convention #104). The any-of facets (Priority, assignee, reporter, tags,
 * location) are `MultiSelect` pill comboboxes with a FIXED footprint (a fixed
 * width + single-row pills) so selecting/clearing values never resizes the
 * control or reflows the bar; the single-value facets (scope, overdue) are
 * `SegmentedControl`s. Facets are grouped by kind (attributes · people ·
 * classification · scope) with vertical `Divider`s between groups. Presentational
 * + controlled: it holds no state, just renders `filter` and calls `onChange`
 * with the next `BoardFilter`.
 */
export function FilterBar({
  filter,
  onChange,
  busy = false,
  tags,
  locations,
  currentUserId,
}: FilterBarProps) {
  const set = <K extends keyof BoardFilter>(key: K, value: BoardFilter[K]) => {
    onChange({ ...filter, [key]: value })
  }

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
      {/* Three zones on one wrapping row: search (left) · facets (centered in the
          flexible middle) · presets + Reset (right). align="center" vertically
          centers every zone. */}
      <Group gap="sm" align="center" wrap="wrap">
        {/* LEFT: the text query. */}
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

        {/* CENTER: the facet group, horizontally centered in the space between
            the search box and the presets (classes.center is flex:1 +
            justify-content:center). Wraps gracefully on narrow widths. */}
        <div className={classes.center}>
          <Group gap="sm" align="center" wrap="wrap" justify="center">
            {/* Card attributes: priority. */}
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

            {/* People: assignee · reporter — ASYNC searchable (never load the
                whole roster); selected ids stay resolved so pills show names. */}
            <UserPillFacet
              label={strings.filterBar.assigneeLabel}
              placeholder={strings.filterBar.assigneePlaceholder}
              tooltip={strings.filterBar.tooltips.assignee}
              value={filter.assigneeIds}
              onChange={(next) => {
                set('assigneeIds', next)
              }}
              currentUserId={currentUserId}
            />

            <UserPillFacet
              label={strings.filterBar.reporterLabel}
              placeholder={strings.filterBar.reporterPlaceholder}
              tooltip={strings.filterBar.tooltips.reporter}
              value={filter.reporterIds}
              onChange={(next) => {
                set('reporterIds', next)
              }}
              currentUserId={currentUserId}
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
          </Group>
        </div>

        {/* RIGHT: presets + the Reset-filters control. */}
        <Group gap="sm" align="center" wrap="nowrap">
          <FilterPresets filter={filter} onApply={onChange} currentUserId={currentUserId} />

          <Tooltip label={strings.filterBar.tooltips.clearAll} withArrow>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              leftSection={<RotateCcw size={16} aria-hidden />}
              aria-label={strings.filterBar.clearAll}
              onClick={() => {
                onChange(EMPTY_BOARD_FILTER)
              }}
            >
              {strings.filterBar.clearAll}
            </Button>
          </Tooltip>
        </Group>
      </Group>
      {/* An indeterminate progress bar along the bar's bottom edge whenever ANY
          filter change is applying (the debounce window + the fetch), so every
          filter — search or facet — reads as "working" immediately, not only
          once the debounced request fires ~300ms later. */}
      {busy ? (
        <div
          role="progressbar"
          aria-label={strings.filterBar.filterBusy}
          className={classes.progress}
        />
      ) : null}
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

/** The async assignee/reporter facet: an `AsyncUserMultiSelect` with the same
 *  fixed footprint (pill width + single-row pills) and section tooltip the
 *  enumerable `PillFacet`s carry, so the bar never reflows as chips are added. */
function UserPillFacet({
  label,
  placeholder,
  tooltip,
  value,
  onChange,
  currentUserId,
}: {
  label: string
  placeholder: string
  tooltip: string
  value: string[]
  onChange: (next: string[]) => void
  currentUserId: string
}) {
  return (
    <Tooltip label={tooltip} withArrow>
      <AsyncUserMultiSelect
        value={value}
        onChange={onChange}
        ariaLabel={label}
        placeholder={placeholder}
        className={classes.pill}
        classNames={{ pillsList: classes.pillsList }}
        currentUserId={currentUserId}
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
        // Fixed footprint: `pillsList` (the pills + input container) is pinned to
        // one row with clipped overflow so selected values never grow the control
        // beyond its fixed width/height — the bar can't reflow as chips are added.
        classNames={{ pillsList: classes.pillsList }}
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
