import {
  Loader,
  MultiSelect,
  type MultiSelectProps,
  type OptionsFilter,
  Select,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { type ReactNode, useMemo, useState } from 'react'
import { useResolveUsers, useUserSearch } from '../api/meta.ts'
import { type PickerUser } from '../api/schemas.ts'
import { strings } from '../strings.ts'

/** Debounce keystrokes so a burst of typing collapses into one search request. */
const SEARCH_DEBOUNCE_MS = 275

interface Option {
  value: string
  label: string
}

/**
 * The async data + search state shared by the assignee/reporter pickers: the
 * debounced `?q=` search plus the `?ids=` resolve of the already-selected ids,
 * merged into ONE deduped option list. Mantine resolves a selected value's pill
 * / label from `data`, so the resolved selections must always be present — a
 * card's assignee (even a deactivated one, absent from search) still renders its
 * name. Selected options come first so the picker shows them even before typing.
 */
function useAsyncUserOptions(
  selectedIds: readonly string[],
  currentUserId?: string,
): {
  options: Option[]
  search: string
  setSearch: (value: string) => void
  loading: boolean
} {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const searchQuery = useUserSearch(debounced)
  const resolveQuery = useResolveUsers(selectedIds)

  const options = useMemo(() => {
    const byId = new Map<string, Option>()
    // Selected first so they head the list; search results fill the rest.
    for (const user of [...(resolveQuery.data ?? []), ...(searchQuery.data ?? [])]) {
      if (!byId.has(user.id)) byId.set(user.id, toOption(user, currentUserId))
    }
    return [...byId.values()]
  }, [resolveQuery.data, searchQuery.data, currentUserId])

  // Spin during the initial `?ids=` resolve too, not just free-text search, so
  // opening a card with an assignee shows progress instead of a blank field.
  return { options, search, setSearch, loading: searchQuery.isFetching || resolveQuery.isFetching }
}

// Mark the current user's option/pill so "me" is easy to find and pick — the
// same label drives both the dropdown option and the selected pill.
function toOption(user: PickerUser, currentUserId?: string): Option {
  const label =
    user.id === currentUserId
      ? `${user.displayName}${strings.userPicker.youSuffix}`
      : user.displayName
  return { value: user.id, label }
}

// We own fetching (the server already returned the matches for the current
// query), so short-circuit Mantine's client-side filter and show every option
// as-is — otherwise a resolved-but-unmatched selection would drop from the list.
const passthroughFilter: OptionsFilter = ({ options }) => options

/** Shared async-search props for both the Select and MultiSelect variants. */
function asyncProps(loading: boolean, search: string, setSearch: (value: string) => void) {
  return {
    searchable: true as const,
    searchValue: search,
    onSearchChange: setSearch,
    nothingFoundMessage: loading ? strings.common.loading : strings.userPicker.nothingFound,
    filter: passthroughFilter,
    // A spinner in the input while a server search is in flight — the previous
    // matches stay listed (keepPreviousData), so without this there'd be no cue
    // that typing is fetching new results.
    rightSection: loading ? <Loader size="xs" aria-label={strings.common.loading} /> : undefined,
  }
}

export interface AsyncUserMultiSelectProps {
  value: string[]
  onChange: (next: string[]) => void
  ariaLabel: string
  placeholder: string
  // Explicit `| undefined`: CSS-module class values are `string | undefined`,
  // which `exactOptionalPropertyTypes` won't assign to a bare `?:` optional.
  className?: string | undefined
  classNames?: MultiSelectProps['classNames']
  /** The "me" id: its option/pill label gets a "(you)" suffix so it's easy to pick. */
  currentUserId?: string
}

/**
 * The any-of assignee/reporter facet on the filter bar as an ASYNC searchable
 * pill combobox: it never loads the whole roster, searching the server as the
 * user types and keeping the selected ids' options resolved so their pills carry
 * names even when off the current search page.
 */
export function AsyncUserMultiSelect({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
  classNames,
  currentUserId,
}: AsyncUserMultiSelectProps) {
  const { options, search, setSearch, loading } = useAsyncUserOptions(value, currentUserId)
  return (
    <MultiSelect
      {...(className === undefined ? {} : { className })}
      {...(classNames === undefined ? {} : { classNames })}
      aria-label={ariaLabel}
      placeholder={value.length === 0 ? placeholder : undefined}
      data={options}
      value={value}
      onChange={onChange}
      clearable
      hidePickedOptions
      comboboxProps={{ withinPortal: true }}
      {...asyncProps(loading, search, setSearch)}
    />
  )
}

export interface ResolvedUserSelectProps {
  userId: string
  label: ReactNode
}

/**
 * A read-only single-select showing one user's NAME, resolved via `?ids=` (so
 * it works for a deactivated user too). Used for the card-detail Reporter field,
 * which is always disabled — who filed the card, never editable here.
 */
export function ResolvedUserSelect({ userId, label }: ResolvedUserSelectProps) {
  const resolveQuery = useResolveUsers([userId])
  const resolved = resolveQuery.data?.find((user) => user.id === userId)
  // Until the name resolves (or if the id is unknown), fall back to a neutral
  // placeholder rather than showing the raw id.
  const data = [{ value: userId, label: resolved?.displayName ?? strings.history.unknownUser }]
  return <Select label={label} data={data} value={userId} disabled onChange={() => undefined} />
}

export interface AsyncUserSelectProps {
  value: string | null
  onChange: (next: string | null) => void
  label: ReactNode
  disabled?: boolean
}

/**
 * The card-detail Assignee picker as an ASYNC searchable single-select: same
 * server search + selected-id resolve, so the current assignee resolves to a
 * name without the full roster.
 */
export function AsyncUserSelect({
  value,
  onChange,
  label,
  disabled = false,
}: AsyncUserSelectProps) {
  const { options, search, setSearch, loading } = useAsyncUserOptions(value === null ? [] : [value])
  return (
    <Select
      label={label}
      data={options}
      value={value}
      onChange={onChange}
      clearable
      disabled={disabled}
      {...asyncProps(loading, search, setSearch)}
    />
  )
}
