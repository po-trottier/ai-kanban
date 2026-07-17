import {
  type Clock,
  type IdGenerator,
  type NotifierPort,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { Cron } from 'croner'
import { runDoneArchival } from '../jobs/done-archival.ts'
import { runPositionRebalance } from '../jobs/position-rebalance.ts'
import { runSessionPurge } from '../jobs/session-purge.ts'
import { runSqliteSnapshot, type SnapshotStore } from '../jobs/sqlite-snapshot.ts'
import { runWaitingAgingAlerts } from '../jobs/waiting-aging-alerts.ts'
import { type AppMetrics } from '../metrics/metrics.ts'
import { type AdapterLogger } from '../types.ts'

/**
 * Croner registration for the five scheduled jobs
 * (docs/architecture/overview.md#scheduled-jobs-croner-in-process). The jobs
 * themselves are pure functions over injected dependencies; this module is
 * the wiring that gives them a schedule, a shared outcome wrapper (metrics +
 * logging + error containment — a failing night must never take the process
 * down or skip the sibling jobs), and a stop() handle for graceful shutdown
 * that cancels future ticks AND drains any in-flight run — main.ts must not
 * close the SQLite connection under a job mid-transaction.
 * `protect: true` skips a tick while the previous run is still going —
 * overlapping runs of the same job would race their own claims.
 */

export interface ScheduledJobsDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  notifier: NotifierPort
  boardId: string
  auth: { deleteExpiredSessions(): Promise<number> }
  snapshots: SnapshotStore
  metrics: AppMetrics
  logger: AdapterLogger
}

interface ScheduledJob {
  name: string
  cron: Cron
}

export interface ScheduledJobs {
  jobs: ScheduledJob[]
  /** Cancels future ticks, then resolves once every in-flight run finished. */
  stop(): Promise<void>
}

export function scheduleJobs(deps: ScheduledJobsDeps): ScheduledJobs {
  const { metrics, logger } = deps

  // Croner's stop() only cancels FUTURE ticks; stop() below additionally
  // awaits these so shutdown never closes the database under a running job.
  const inFlight = new Set<Promise<void>>()

  const define = (
    name: string,
    pattern: string,
    run: () => Promise<Record<string, unknown>>,
  ): ScheduledJob => {
    const wrapped = async (): Promise<void> => {
      const startedAt = performance.now()
      try {
        const summary = await run()
        metrics.jobCompleted(name, 'success', (performance.now() - startedAt) / 1000)
        logger.info({ job: name, ...summary }, 'scheduled job completed')
      } catch (error) {
        metrics.jobCompleted(name, 'error', (performance.now() - startedAt) / 1000)
        logger.error({ job: name, err: error }, 'scheduled job failed')
      }
    }
    const tracked = (): Promise<void> => {
      const running = wrapped()
      inFlight.add(running)
      void running.finally(() => inFlight.delete(running))
      return running
    }
    return { name, cron: new Cron(pattern, { name, protect: true }, tracked) }
  }

  // Schedules are container-local time (UTC in the image). The dailies are
  // spread across the night, snapshot first so a bad maintenance night still
  // has a fresh backup.
  const jobs: ScheduledJob[] = [
    define('waitingAgingAlerts', '0 * * * *', () =>
      runWaitingAgingAlerts({
        uow: deps.uow,
        clock: deps.clock,
        notifier: deps.notifier,
        logger,
        boardId: deps.boardId,
      }),
    ),
    define('sqliteSnapshot', '0 2 * * *', () =>
      runSqliteSnapshot({ snapshots: deps.snapshots, clock: deps.clock, logger }),
    ),
    define('doneArchival', '20 3 * * *', () =>
      runDoneArchival({
        uow: deps.uow,
        clock: deps.clock,
        ids: deps.ids,
        logger,
        boardId: deps.boardId,
      }),
    ),
    define('positionRebalance', '40 3 * * *', () =>
      runPositionRebalance({ uow: deps.uow, logger, boardId: deps.boardId }),
    ),
    define('sessionPurge', '50 3 * * *', () => runSessionPurge({ auth: deps.auth, logger })),
  ]

  return {
    jobs,
    async stop() {
      for (const job of jobs) job.cron.stop()
      // `wrapped` never rejects (error containment above), so this settles.
      await Promise.all(inFlight)
    },
  }
}
