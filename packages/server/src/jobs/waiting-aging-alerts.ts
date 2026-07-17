import {
  type Card,
  type Clock,
  type NotifierPort,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Hourly waiting-lane aging job (docs/product/workflow.md
 * #waiting-on-parts--vendor-discipline): cards in `waiting_parts_vendor` past
 * their `expectedResumeAt` (overdue starts the day AFTER the expected date,
 * UTC) get one DM per overdue episode to the assignee plus every active
 * supervisor.
 *
 * At-most-once per episode: `resumeAlertedAt` is claimed in the same
 * transaction that reads the overdue set, BEFORE any delivery is attempted —
 * a crash between claim and DM costs one alert, never a re-fire storm, and a
 * restart re-derives everything from persisted state. Delivery is
 * best-effort (NotifierPort): failures are logged and never fail the job.
 */

export interface WaitingAgingAlertsDeps {
  uow: UnitOfWork
  clock: Clock
  notifier: NotifierPort
  logger: AdapterLogger
  boardId: string
}

interface ClaimedAlert {
  card: Card
  recipients: User[]
}

export async function runWaitingAgingAlerts(
  deps: WaitingAgingAlertsDeps,
): Promise<{ alerted: number }> {
  const nowIso = deps.clock.now().toISOString()
  const today = nowIso.slice(0, 10)

  // One transaction claims every due episode and resolves its recipients —
  // no async I/O inside (SqliteUnitOfWork invariant); DMs happen after commit.
  const claimed = await deps.uow.run(async (tx): Promise<ClaimedAlert[]> => {
    const lane = await tx.lanes.findByKey(deps.boardId, 'waiting_parts_vendor')
    if (lane === null) return []
    const overdue = (await tx.cards.query({ laneId: lane.id, overdueBefore: today })).filter(
      (card) => card.resumeAlertedAt === null,
    )
    if (overdue.length === 0) return []

    const supervisors = (await tx.userAccounts.list()).filter(
      (user) => user.role === 'supervisor' && user.isActive,
    )
    const alerts: ClaimedAlert[] = []
    for (const card of overdue) {
      // Assignee first, then supervisors, deduped (an assignee who is also a
      // supervisor gets one DM). Deactivated assignees get none.
      const recipients = new Map<string, User>()
      if (card.assigneeId !== null) {
        const assignee = await tx.users.findById(card.assigneeId)
        if (assignee?.isActive === true) recipients.set(assignee.id, assignee)
      }
      for (const supervisor of supervisors) recipients.set(supervisor.id, supervisor)

      const marked: Card = { ...card, resumeAlertedAt: nowIso }
      // Bookkeeping only — no version bump, no updatedAt churn, no audit
      // event: the alert marker is not a user-visible edit (data-model.md).
      await tx.cards.update(marked)
      alerts.push({ card: marked, recipients: [...recipients.values()] })
    }
    return alerts
  })

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
