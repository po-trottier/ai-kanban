import { CARD_DESCRIPTION_MAX } from '@rivian-kanban/core'
import { type App } from '@slack/bolt'
import { slackActorOf, type SlackContext } from './context.ts'
import { MENTION_USAGE_HINT, parseMentionCommand } from './grammar.ts'
import { resolveSlackUser } from './identity.ts'
import { ASK_ADMIN_MESSAGE, CARD_RATE_LIMIT_MESSAGE, CREATE_FAILED_MESSAGE } from './messages.ts'
import { createdMessage } from './messages.ts'
import { slackPermalink, threadTextOf } from './thread.ts'

/**
 * The secondary surface: `@FacilitiesBot create ticket [P0|P1|P2] <title>`
 * (docs/architecture/slack.md#-mention-grammar). Zero-click in-thread
 * creation: the raw thread text becomes the description, the summarizer
 * never runs (no review step — the "human always reviews AI output"
 * invariant holds because no AI output exists), and non-matching mentions
 * get an in-thread usage hint.
 */

export function registerMentionListener(app: App, ctx: SlackContext): void {
  app.event('app_mention', async ({ event, client }) => {
    const slackUserId = event.user
    if (slackUserId === undefined) return
    const threadTs = event.thread_ts ?? event.ts
    const say = async (text: string): Promise<void> => {
      await client.chat.postMessage({ channel: event.channel, thread_ts: threadTs, text })
    }

    try {
      const command = parseMentionCommand(event.text)
      if (command === null) {
        await say(MENTION_USAGE_HINT)
        return
      }
      const user = await resolveSlackUser(ctx, client, slackUserId)
      if (user === null) {
        await say(ASK_ADMIN_MESSAGE)
        return
      }
      if (!ctx.cardLimiter.tryAcquire(slackUserId)) {
        await say(CARD_RATE_LIMIT_MESSAGE)
        return
      }

      // In a thread: the whole thread is the description. Outside one: the
      // mention message itself is the entire capture.
      const description =
        event.thread_ts !== undefined
          ? threadTextOf(
              (
                await client.conversations.replies({
                  channel: event.channel,
                  ts: event.thread_ts,
                  limit: 200,
                })
              ).messages,
            )
          : event.text.slice(0, CARD_DESCRIPTION_MAX)

      const card = await ctx.cards.create(
        slackActorOf(user),
        { title: command.title, description, priority: command.priority },
        {
          slackSource: {
            channelId: event.channel,
            threadTs,
            permalink: slackPermalink(event.channel, threadTs),
          },
        },
      )
      await say(createdMessage(ctx.publicBaseUrl, card))
    } catch (error) {
      ctx.logger.error(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'slack mention flow failed',
      )
      try {
        await say(CREATE_FAILED_MESSAGE)
      } catch {
        // Best-effort: the confirmation channel may be unreachable.
      }
    }
  })
}
