import { Combobox, Textarea, type TextareaProps, useCombobox } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import { useUserSearch } from '../api/meta.ts'
import { type PickerUser } from '../api/schemas.ts'

/** Debounce the @-token search so a burst of typing collapses into one request. */
const MENTION_DEBOUNCE_MS = 200
const MAX_SUGGESTIONS = 6

/**
 * The in-progress `@token` ending at the cursor (from a `@` preceded by
 * start-of-text or whitespace, up to the cursor with no space/@). Null when the
 * cursor isn't in a mention token. `at` is the index of the `@`.
 */
function activeMentionToken(text: string, cursor: number): { query: string; at: number } | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (match === null) return null
  const query = match[1] ?? ''
  return { query, at: cursor - query.length - 1 }
}

export interface MentionTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  /** Fired when a user is picked from the @-autocomplete. */
  onMention: (user: PickerUser) => void
}

/**
 * A comment textarea with an inline **@-mention autocomplete** backed by the
 * async user search (docs/architecture/notifications.md) — never the whole
 * roster. Typing `@name` opens a dropdown of matching users; picking one
 * inserts `@Display Name ` at the cursor and reports the user via `onMention`,
 * so the composer can send the id alongside the text.
 */
export function MentionTextarea({
  value,
  onChange,
  onMention,
  ...textareaProps
}: MentionTextareaProps) {
  const combobox = useCombobox()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [token, setToken] = useState<{ query: string; at: number } | null>(null)
  const [debounced] = useDebouncedValue(token?.query ?? '', MENTION_DEBOUNCE_MS)
  // Only hit the user-search endpoint while an @-token is being typed.
  const searchQuery = useUserSearch(debounced, token !== null)
  const suggestions = token === null ? [] : (searchQuery.data ?? []).slice(0, MAX_SUGGESTIONS)
  const open = token !== null && suggestions.length > 0

  // Highlight the first match so Enter picks it without an explicit ArrowDown.
  useEffect(() => {
    if (open) combobox.selectFirstOption()
  }, [open, debounced, combobox])

  const syncToken = (text: string, cursor: number) => {
    const next = activeMentionToken(text, cursor)
    setToken(next)
    if (next === null) combobox.closeDropdown()
    else combobox.openDropdown()
  }

  const insert = (user: PickerUser) => {
    const element = ref.current
    if (element === null || token === null) return
    const cursor = element.selectionStart
    const before = value.slice(0, token.at)
    const after = value.slice(cursor)
    const inserted = `@${user.displayName} `
    onChange(before + inserted + after)
    onMention(user)
    setToken(null)
    combobox.closeDropdown()
    // Restore focus + place the cursor after the inserted mention.
    requestAnimationFrame(() => {
      element.focus()
      const position = before.length + inserted.length
      element.setSelectionRange(position, position)
    })
  }

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(id) => {
        const user = suggestions.find((candidate) => candidate.id === id)
        if (user !== undefined) insert(user)
      }}
    >
      <Combobox.Target
        withAriaAttributes={false}
        withKeyboardNavigation={false}
        withExpandedAttribute={false}
      >
        <Textarea
          ref={ref}
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value)
            syncToken(event.currentTarget.value, event.currentTarget.selectionStart)
          }}
          onClick={(event) => {
            syncToken(value, event.currentTarget.selectionStart)
          }}
          onKeyDown={(event) => {
            if (!open) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              combobox.selectNextOption()
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              combobox.selectPreviousOption()
            } else if (event.key === 'Enter') {
              event.preventDefault()
              combobox.clickSelectedOption()
            } else if (event.key === 'Escape') {
              setToken(null)
              combobox.closeDropdown()
            }
          }}
          {...textareaProps}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={!open}>
        <Combobox.Options>
          {suggestions.map((user) => (
            <Combobox.Option value={user.id} key={user.id}>
              {user.displayName}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
