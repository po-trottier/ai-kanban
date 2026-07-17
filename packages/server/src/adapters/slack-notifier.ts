import {
  type Card,
  type NotifierPort,
  type UnitOfWork,
  type User,
  type UserCredentials,
} from '@rivian-kanban/core'
import { type WebClient } from '@slack/web-api'
import { type AdapterLogger } from '../types.ts'
import { bindSlackIdentity } from '../slack/identity.ts'
import { completedMessage, waitingOverdueMessage } from '../slack/messages.ts'

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
    let account: UserCredentials | null
    try {
      account = await this.deps.uow.read((tx) => tx.userAccounts.findById(card.reporterId))
    } catch (error) {
      // Log-and-skip, never throw: the mutation is already committed.
      this.deps.logger.warn(
        { cardId: card.id, reason: error instanceof Error ? error.name : 'unknown' },
        'completion DM failed; skipping',
      )
      return
    }
    if (account === null) {
      this.deps.logger.info({ cardId: card.id }, 'completion DM skipped: reporter not found')
      return
    }
    await this.dmUser(account.user, completedMessage(this.deps.publicBaseUrl, card), {
      cardId: card.id,
      skipMessage: 'completion DM skipped: no Slack match for reporter',
      failMessage: 'completion DM failed; skipping',
    })
  }

  /**
   * Waiting-lane overdue alert (workflow.md#waiting-on-parts--vendor-discipline):
   * one DM per resolved recipient. Per-recipient failures are logged and
   * skipped — the hourly job already marked the episode as alerted, and one
   * unmatched supervisor must not cost the others their DM.
   */
  async waitingOverdue(card: Card, recipients: User[]): Promise<void> {
    const text = waitingOverdueMessage(this.deps.publicBaseUrl, card)
    for (const recipient of recipients) {
      await this.dmUser(recipient, text, {
        cardId: card.id,
        skipMessage: 'overdue DM skipped: no Slack match for recipient',
        failMessage: 'overdue DM failed; skipping recipient',
      })
    }
  }

  /**
   * The shared per-recipient delivery: resolve the Slack id (stored binding
   * first, one-time email lookup otherwise), skip-log unmatched users, DM,
   * and catch-log failures — never throws (NotifierPort is best-effort).
   */
  private async dmUser(
    recipient: User,
    text: string,
    log: { cardId: string; skipMessage: string; failMessage: string },
  ): Promise<void> {
    try {
      const slackUserId = recipient.slackUserId ?? (await this.lookupAndBind(recipient))
      if (slackUserId === null) {
        this.deps.logger.info({ cardId: log.cardId, userId: recipient.id }, log.skipMessage)
        return
      }
      await this.deps.client.chat.postMessage({ channel: slackUserId, text })
    } catch (error) {
      this.deps.logger.warn(
        {
          cardId: log.cardId,
          userId: recipient.id,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        log.failMessage,
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
