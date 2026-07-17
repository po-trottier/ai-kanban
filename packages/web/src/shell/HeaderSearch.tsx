import { ActionIcon, TextInput } from '@mantine/core'
import { strings } from '../strings.ts'
import { useBoardSearchQuery } from './board-search-param.ts'
import { CloseIcon, SearchIcon } from './icons.tsx'

/**
 * The always-visible header filter (ITEM 1): a centred input that LIVE-filters
 * the loaded board as the user types — no request, no second page. The query
 * lives in the URL (`?q=`, `useBoardSearchQuery`) so the board subscribes to
 * the same value. A clear (✕) resets it. The `/search` page stays the home of
 * archived + description-scoped global search.
 */
export function HeaderSearch() {
  const [query, setQuery] = useBoardSearchQuery()
  return (
    <TextInput
      aria-label={strings.header.searchLabel}
      placeholder={strings.header.searchPlaceholder}
      value={query}
      leftSection={<SearchIcon size={16} />}
      rightSection={
        query === '' ? null : (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={strings.header.searchClear}
            onClick={() => {
              setQuery('')
            }}
          >
            <CloseIcon size={16} />
          </ActionIcon>
        )
      }
      onChange={(event) => {
        setQuery(event.currentTarget.value)
      }}
    />
  )
}
