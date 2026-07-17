import { CARD_DESCRIPTION_MAX, CARD_TITLE_MAX, type SummaryDraft } from '@rivian-kanban/core'

/**
 * Thread-text assembly shared by both Slack surfaces: the raw thread text is
 * the card description (and the summarizer input), truncated to the card
 * schema caps owned by core.
 */

interface ThreadMessage {
  text?: string
}

/** Joins the thread's message texts oldest-first, truncated to the card cap. */
export function threadTextOf(messages: readonly ThreadMessage[] | undefined): string {
  return (messages ?? [])
    .map((message) => message.text ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .slice(0, CARD_DESCRIPTION_MAX)
}

/**
 * The no-AI prefill (summarizer disabled, throttled, or failed): first line of
 * the thread as the title, the raw text as the description, P2 default.
 */
export function rawDraftOf(threadText: string): SummaryDraft {
  const firstLine = (threadText.split('\n', 1)[0] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CARD_TITLE_MAX)
  return {
    title: firstLine.length > 0 ? firstLine : 'Slack thread ticket',
    description: threadText,
    suggestedPriority: 'P2',
    tags: [],
  }
}

/**
 * Canonical archive permalink, built locally: it needs no extra API call or
 * scope, and Slack redirects it to the workspace domain.
 */
export function slackPermalink(channelId: string, ts: string): string {
  return `https://slack.com/archives/${channelId}/p${ts.replace('.', '')}`
}
