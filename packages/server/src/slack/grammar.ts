import { CARD_TITLE_MAX, type Priority } from '@rivian-kanban/core'

/**
 * The @-mention grammar (docs/architecture/slack.md#-mention-grammar):
 * `create ticket [P0|P1|P2] <title>`, case-insensitive. Priority defaults to
 * P2; the remaining text becomes the title (truncated to 200 chars). The
 * summarizer never runs on this path.
 */

export interface MentionCommand {
  priority: Priority
  title: string
}

/** Usage hint replied in-thread when a mention does not match the grammar. */
export const MENTION_USAGE_HINT =
  'I did not understand that. Usage: `@FacilitiesBot create ticket [P0|P1|P2] <title>` ' +
  '(priority is optional and defaults to P2).'

const PRIORITY_BY_TOKEN = new Map<string, Priority>([
  ['P0', 'P0'],
  ['P1', 'P1'],
  ['P2', 'P2'],
])

/**
 * Parses the mention text (bot mention tokens stripped, whitespace
 * collapsed) by tokens — a priority must stand alone (`P2000 units` is a
 * title). Returns null when the text does not match the grammar — callers
 * reply with the usage hint.
 */
export function parseMentionCommand(rawText: string): MentionCommand | null {
  const tokens = rawText
    .replace(/<@[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
  if (tokens[0]?.toLowerCase() !== 'create' || tokens[1]?.toLowerCase() !== 'ticket') return null
  const priority = PRIORITY_BY_TOKEN.get(tokens[2]?.toUpperCase() ?? '')
  const title = tokens
    .slice(priority === undefined ? 2 : 3)
    .join(' ')
    .slice(0, CARD_TITLE_MAX)
    .trim()
  if (title.length === 0) return null
  return { priority: priority ?? 'P2', title }
}
