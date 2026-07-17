import { ActionIcon, Group, TextInput } from '@mantine/core'
import { SlidersHorizontal } from 'lucide-react'
import { strings } from '../strings.ts'
import { SIZES } from '../theme.ts'
import { useBoardSearchQuery } from './board-search-param.ts'
import { useSearchModal } from './search-modal-param.ts'
import { CloseIcon, SearchIcon } from './icons.tsx'

/**
 * The always-visible header filter (ITEM 1): a centred input that LIVE-filters
 * the loaded board as the user types — no request, no second page. The query
 * lives in the URL (`?q=`, `useBoardSearchQuery`) so the board subscribes to
 * the same value. A clear (✕) resets it, and a right-aligned sliders icon opens
 * the advanced-search modal on demand (archived + facet search over every card).
 */
export function HeaderSearch() {
  const [query, setQuery] = useBoardSearchQuery()
  const { open } = useSearchModal()
  return (
    <TextInput
      aria-label={strings.header.searchLabel}
      placeholder={strings.header.searchPlaceholder}
      value={query}
      leftSection={<SearchIcon size={16} />}
      // Two trailing controls: the clear (only with text) and the always-present
      // advanced-search trigger; widen the section so both fit without clipping.
      rightSectionWidth={query === '' ? undefined : SIZES.headerSearchActionsWidth}
      rightSection={
        <Group gap={4} wrap="nowrap">
          {query === '' ? null : (
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
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={strings.search.advancedButton}
            onClick={open}
          >
            <SlidersHorizontal size={16} aria-hidden />
          </ActionIcon>
        </Group>
      }
      onChange={(event) => {
        setQuery(event.currentTarget.value)
      }}
    />
  )
}
