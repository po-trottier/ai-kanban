import { type Card, type NotifierPort, type UnitOfWork, type User } from '@rivian-kanban/core'
import { type WebClient } from '@slack/web-api'
import { type AdapterLogger } from '../types.ts'
import { bindSlackIdentity } from '../slack/identity.ts'
import { completedMessage } from '../slack/messages.ts'

/**
 * The first NotifierPort adapter (docs/architecture/slack.md#notifications-outbound):
 * Review→Done completion DMs the card's requester via chat.postMessage. The
 * requester resolves through the stored `slack_user_id` binding first, then a
 * one-time users.lookupByEmail (users:read.email) whose result is persisted —
 * the same sticky mapping as the inbound surfaces. Unmatched users simply get
 * no DM (logged, never fatal): the port contract says notifications are
 * best-effort and a Slack outage must never surface a committed command as
 * failed.
 */

export interface SlackNotifierDeps {
  client: WebClient
  uow: UnitOfWork
  logger: AdapterLogger
  publicBaseUrl: string
}

export class SlackNotifier implements NotifierPort {
  private readonly deps: SlackNotifierDeps

  constructor(deps: SlackNotifierDeps) {
    this.deps = deps
  }

  async cardCompleted(card: Card): Promise<void> {
    try {
      const account = await this.deps.uow.run((tx) => tx.userAccounts.findById(card.reporterId))
      if (account === null) {
        this.deps.logger.info({ cardId: card.id }, 'completion DM skipped: reporter not found')
        return
      }
      const slackUserId = account.user.slackUserId ?? (await this.lookupAndBind(account.user))
      if (slackUserId === null) {
        this.deps.logger.info(
          { cardId: card.id, userId: account.user.id },
          'completion DM skipped: no Slack match for reporter',
        )
        return
      }
      await this.deps.client.chat.postMessage({
        channel: slackUserId,
        text: completedMessage(this.deps.publicBaseUrl, card),
      })
    } catch (error) {
      // Log-and-skip, never throw: the mutation is already committed.
      this.deps.logger.warn(
        { cardId: card.id, reason: error instanceof Error ? error.name : 'unknown' },
        'completion DM failed; skipping',
      )
    }
  }

  /** Email → Slack id once; the binding is persisted for every later event. */
  private async lookupAndBind(user: User): Promise<string | null> {
    let slackUserId: string | null
    try {
      const response = await this.deps.client.users.lookupByEmail({ email: user.email })
      slackUserId = response.user?.id ?? null
    } catch {
      // WebClient throws on ok:false (users_not_found) — treat as unmatched.
      slackUserId = null
    }
    if (slackUserId === null) return null
    const bound = await bindSlackIdentity(this.deps.uow, this.deps.logger, user, slackUserId)
    return bound?.slackUserId ?? null
  }
}
