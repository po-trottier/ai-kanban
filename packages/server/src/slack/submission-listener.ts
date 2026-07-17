import { type App } from '@slack/bolt'
import { slackActorOf, type SlackContext } from './context.ts'
import { resolveSlackUser } from './identity.ts'
import { ASK_ADMIN_MESSAGE, CARD_RATE_LIMIT_MESSAGE, CREATE_FAILED_MESSAGE } from './messages.ts'
import { createdMessage } from './messages.ts'
import {
  ASSIGNEE_BLOCK,
  DRAFT_CALLBACK_ID,
  LOCATION_BLOCK,
  parseDraftSubmission,
  TITLE_BLOCK,
  type DraftSubmission,
} from './views.ts'

/**
 * view_submission → cardService.create (flow steps 5–6,
 * docs/architecture/slack.md#message-shortcut-flow): the card lands in
 * Intake with origin slack, the human-reviewed draft as ordinary field
 * values, the Slack permalink + {channel, thread_ts} recorded, and the
 * reporter resolved through the sticky identity mapping. Confirmation goes
 * into the source thread via chat.postMessage (response_url cannot target a
 * thread).
 */

export function registerSubmissionListener(app: App, ctx: SlackContext): void {
  app.view(DRAFT_CALLBACK_ID, async ({ ack, body, view, client }) => {
    let submission: DraftSubmission
    try {
      submission = parseDraftSubmission(view)
    } catch (error) {
      ctx.logger.error(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'slack view_submission carried unusable metadata',
      )
      await ack()
      return
    }

    const slackUserId = body.user.id
    const user = await resolveSlackUser(ctx, client, slackUserId)
    if (user === null) {
      await ack({ response_action: 'errors', errors: { [TITLE_BLOCK]: ASK_ADMIN_MESSAGE } })
      return
    }
    if (!ctx.cardLimiter.tryAcquire(slackUserId)) {
      await ack({ response_action: 'errors', errors: { [TITLE_BLOCK]: CARD_RATE_LIMIT_MESSAGE } })
      return
    }

    // Optional assignee/location resolution; unresolvable values surface as
    // modal field errors so the human can correct them in place.
    let assigneeId: string | undefined
    let assigneeProblem: string | null = null
    const assigneeEmail = submission.assigneeEmail
    if (assigneeEmail !== null) {
      const account = await ctx.uow.run((tx) => tx.userAccounts.findByEmail(assigneeEmail))
      if (account?.user.isActive !== true) {
        assigneeProblem = `No active board user has the email ${assigneeEmail}.`
      } else {
        assigneeId = account.user.id
      }
    }
    let locationId: string | undefined
    let locationProblem: string | null = null
    const locationName = submission.locationName
    if (locationName !== null) {
      const locations = await ctx.uow.run((tx) => tx.locations.list())
      const wanted = locationName.toLowerCase()
      const match = locations.find((location) => location.name.toLowerCase() === wanted)
      if (match === undefined) {
        locationProblem = `No location named "${locationName}" exists on the board.`
      } else {
        locationId = match.id
      }
    }
    if (assigneeProblem !== null || locationProblem !== null) {
      await ack({
        response_action: 'errors',
        errors: {
          ...(assigneeProblem !== null ? { [ASSIGNEE_BLOCK]: assigneeProblem } : {}),
          ...(locationProblem !== null ? { [LOCATION_BLOCK]: locationProblem } : {}),
        },
      })
      return
    }

    await ack()
    try {
      const card = await ctx.cards.create(
        slackActorOf(user),
        {
          title: submission.title,
          description: submission.description,
          priority: submission.priority,
          tags: submission.tags,
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(locationId !== undefined ? { locationId } : {}),
        },
        { slackSource: submission.meta },
      )
      await client.chat.postMessage({
        channel: submission.meta.channelId,
        thread_ts: submission.meta.threadTs,
        text: createdMessage(ctx.publicBaseUrl, card),
      })
    } catch (error) {
      ctx.logger.error(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'slack card creation failed after modal submit',
      )
      try {
        await client.chat.postMessage({
          channel: submission.meta.channelId,
          thread_ts: submission.meta.threadTs,
          text: CREATE_FAILED_MESSAGE,
        })
      } catch {
        // Best-effort: the confirmation channel may be unreachable.
      }
    }
  })
}
