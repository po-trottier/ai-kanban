/**
 * User-facing Slack copy in one place: friendly rejections
 * (docs/architecture/slack.md#delivery-semantics--abuse-controls), the
 * unknown/deactivated-user message (#identity-mapping), and confirmations.
 */

export const ASK_ADMIN_MESSAGE =
  'I could not match your Slack account to an active board user. ' +
  'Ask an admin to add you (your board email must match your Slack email).'

export const CARD_RATE_LIMIT_MESSAGE =
  'You are creating tickets faster than the limit (10 per minute). ' +
  'Give it a moment and try again.'

export const CREATE_FAILED_MESSAGE =
  'Sorry — creating that ticket failed. Try again, or use the board directly.'

/**
 * Deliberately non-distinguishing (like core's uniform NotFoundError for
 * assignees): confirming "no active board user has that email" would make the
 * draft modal an account-membership oracle for arbitrary emails — a fact no
 * other surface exposes (GET /users strips emails).
 */
export const ASSIGNEE_UNRESOLVED_MESSAGE =
  "Couldn't resolve that assignee — leave the field blank and the card can be assigned on the board."

/** Where a card lives in the web UI (PUBLIC_BASE_URL is the SPA origin). */
function cardUrl(publicBaseUrl: string, cardId: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/cards/${cardId}`
}

/**
 * Slack interprets `&`/`<`/`>` control sequences in message text regardless
 * of the `parse` setting (`<!channel>` mass-pings, `<url|label>` spoofs a
 * link under the bot's identity), so user-controlled text is escaped before
 * it is echoed into channels or DMs — Slack's documented escaping rules.
 * Stored card fields stay raw; only the outbound echo is escaped.
 */
function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createdMessage(publicBaseUrl: string, card: { id: string; title: string }): string {
  return `Created ticket in Intake: "${escapeSlackText(card.title)}" — ${cardUrl(publicBaseUrl, card.id)}`
}

/** The Review→Done completion DM (docs/architecture/slack.md#notifications-outbound). */
export function completedMessage(
  publicBaseUrl: string,
  card: { id: string; title: string },
): string {
  return `Your facilities ticket "${escapeSlackText(card.title)}" is done: ${cardUrl(publicBaseUrl, card.id)}`
}

/** The waiting-lane overdue DM (docs/product/workflow.md#waiting-on-parts--vendor-discipline). */
export function waitingOverdueMessage(
  publicBaseUrl: string,
  card: { id: string; title: string; expectedResumeAt: string | null },
): string {
  const since =
    card.expectedResumeAt === null ? '' : ` (expected to resume ${card.expectedResumeAt})`
  return (
    `Waiting ticket "${escapeSlackText(card.title)}" is past its expected resume date${since}: ` +
    `${cardUrl(publicBaseUrl, card.id)} — move it back to In Progress, or out and back in with a fresh date.`
  )
}
