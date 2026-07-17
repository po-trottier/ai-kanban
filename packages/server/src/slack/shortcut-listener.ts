import { type App } from '@slack/bolt'
import { acquireSummaryBudget, type SlackContext } from './context.ts'
import { resolveSlackUser } from './identity.ts'
import { ASK_ADMIN_MESSAGE } from './messages.ts'
import { rawDraftOf, slackPermalink, threadTextOf } from './thread.ts'
import { draftModal, loadingModal, noticeModal, type SlackSourceMeta } from './views.ts'

/**
 * The primary surface: the "Create facilities ticket" message shortcut —
 * the only Slack entry point that works inside threads
 * (docs/architecture/slack.md#message-shortcut-flow).
 *
 * ack → loading modal (short-lived trigger_id) → conversations.replies →
 * optional summarizer (throttled; failure falls back to the raw thread
 * text — it never blocks) → views.update with the editable draft.
 */

const SHORTCUT_CALLBACK_ID = 'create_facilities_ticket'

const SHORTCUT_FAILED_MESSAGE =
  'Something went wrong while reading the thread. Close this and try again.'

export function registerShortcutListener(app: App, ctx: SlackContext): void {
  app.shortcut(SHORTCUT_CALLBACK_ID, async ({ shortcut, ack, client }) => {
    await ack()
    if (shortcut.type !== 'message_action') return
    // `thread_ts` reaches us through the message's index signature (any).
    const rawThreadTs: unknown = shortcut.message.thread_ts
    const threadTs = typeof rawThreadTs === 'string' ? rawThreadTs : shortcut.message.ts
    const meta: SlackSourceMeta = {
      channelId: shortcut.channel.id,
      threadTs,
      permalink: slackPermalink(shortcut.channel.id, threadTs),
    }

    // Inside the try: an expired trigger_id (ack + open beyond Slack's 3 s
    // budget) must reach our structured logger, not Bolt's console handler.
    let viewId: string | undefined
    try {
      // Open the loading modal immediately — the trigger_id expires in 3 s.
      const opened = await client.views.open({
        trigger_id: shortcut.trigger_id,
        view: loadingModal(),
      })
      viewId = opened.view?.id
      if (viewId === undefined) return

      const user = await resolveSlackUser(ctx, client, shortcut.user.id)
      if (user === null) {
        await client.views.update({ view_id: viewId, view: noticeModal(ASK_ADMIN_MESSAGE) })
        return
      }

      const replies = await client.conversations.replies({
        channel: meta.channelId,
        ts: threadTs,
        limit: 200,
      })
      const rawText = threadTextOf(replies.messages)
      let draft = rawDraftOf(rawText)
      // Budget exhaustion degrades to the raw-text prefill — same UX as a
      // summarizer failure; the human reviews the draft either way.
      if (ctx.summarizer !== null && acquireSummaryBudget(ctx, shortcut.user.id)) {
        draft = (await ctx.summarizer.summarize(rawText)) ?? draft
      }
      await client.views.update({ view_id: viewId, view: draftModal(draft, meta) })
    } catch (error) {
      ctx.logger.error(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'slack shortcut flow failed',
      )
      if (viewId === undefined) return
      try {
        await client.views.update({ view_id: viewId, view: noticeModal(SHORTCUT_FAILED_MESSAGE) })
      } catch {
        // Best-effort: the modal may already be gone.
      }
    }
  })
}
