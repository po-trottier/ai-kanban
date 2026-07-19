import { Text } from '@mantine/core'
import { type ReactNode } from 'react'
import { EMPHASIS_FONT_WEIGHT } from '../theme.ts'

/**
 * Render a comment body with `@Display Name` runs shown as styled inline tags.
 *
 * The composer inserts the mentioned user's FULL display name verbatim
 * (`MentionTextarea` → `@Display Name `), so we match the literal text against
 * the known display names from the roster — no schema change, purely visual
 * (docs/architecture/notifications.md → @-mentions). An `@run` that matches no
 * known name stays plain text. We prefer the LONGEST matching name so a
 * multi-word "Terry Tech" wins over a bare "Terry" that also happens to exist.
 */
export function renderCommentBody(body: string, displayNames: Iterable<string>): ReactNode {
  // Longest-first so a multi-word name is tried before any shorter prefix.
  const names = [...displayNames].filter((name) => name !== '').sort((a, b) => b.length - a.length)
  const nodes: ReactNode[] = []
  let plain = ''
  let index = 0
  // Flush accumulated plain text as one node so run order is preserved.
  const flushPlain = () => {
    if (plain !== '') {
      nodes.push(plain)
      plain = ''
    }
  }
  while (index < body.length) {
    if (body[index] === '@') {
      const after = body.slice(index + 1)
      const match = names.find((name) => after.startsWith(name))
      if (match !== undefined) {
        flushPlain()
        nodes.push(
          <Text key={index} span c="indigo" fw={EMPHASIS_FONT_WEIGHT} inherit>
            @{match}
          </Text>,
        )
        index += 1 + match.length
        continue
      }
    }
    plain += body.slice(index, index + 1)
    index += 1
  }
  flushPlain()
  return nodes
}
