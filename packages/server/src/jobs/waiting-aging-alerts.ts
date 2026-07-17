import { type CardService, type NotifierPort } from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Hourly waiting-lane aging job (docs/product/workflow.md
 * #waiting-on-parts--vendor-discipline). The business rules — the overdue
 * definition, the at-most-once-per-episode claim via `resumeAlertedAt`, and
 * the recipient policy — live in `CardService.claimOverdueWaitingAlerts`
 * (like the archival job's `archiveExpired`); this job only owns scheduling
 * and delivery. Delivery is best-effort (NotifierPort): failures are logged
 * and never fail the job, and the episode stays claimed — a crash between
 * claim and DM costs one alert, never a re-fire storm.
 */

export interface WaitingAgingAlertsDeps {
  cards: CardService
  notifier: NotifierPort
  logger: AdapterLogger
}

export async function runWaitingAgingAlerts(
  deps: WaitingAgingAlertsDeps,
): Promise<{ alerted: number }> {
  const claimed = await deps.cards.claimOverdueWaitingAlerts()
  for (const { card, recipients } of claimed) {
    try {
      await deps.notifier.waitingOverdue(card, recipients)
    } catch (error) {
      // The episode stays claimed: best-effort delivery, never a re-fire.
      deps.logger.warn(
        { cardId: card.id, reason: error instanceof Error ? error.name : 'unknown' },
        'waiting-overdue alert delivery failed; episode stays marked',
      )
    }
  }
  if (claimed.length > 0) {
    deps.logger.info({ alerted: claimed.length }, 'waiting aging alerts sent')
  }
  return { alerted: claimed.length }
}
