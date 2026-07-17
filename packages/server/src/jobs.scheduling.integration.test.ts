import { join } from 'node:path'
import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scheduleJobs, type ScheduledJobs } from './wiring/jobs.ts'
import { SqliteSnapshotStore } from './wiring/sqlite-snapshot-store.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Croner wiring smoke test (docs/dev/testing.md): the five documented jobs
 * are scheduled with future runs and stop cleanly; a manual trigger drives
 * one run end-to-end through the wrapper (metrics + logging + error
 * containment). Job BEHAVIOR is proven by the per-job suites invoking the
 * run functions directly — never by fake timers.
 */

let t: TestApp
let handle: ScheduledJobs | null = null
const silentLog = pino({ level: 'silent' })

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await handle?.stop()
  handle = null
  await t.cleanup()
})

function schedule(snapshotDir: string): ScheduledJobs {
  handle = scheduleJobs({
    uow: t.wired.deps.uow,
    clock: t.wired.deps.clock,
    cards: t.wired.deps.services.cards,
    notifier: t.wired.notifier,
    boardId: t.wired.boardId,
    systemUserId: t.wired.systemUserId,
    auth: t.wired.deps.services.auth,
    snapshots: new SqliteSnapshotStore(t.wired.connection, snapshotDir),
    metrics: t.wired.deps.metrics,
    logger: silentLog,
  })
  return handle
}

async function scrapeMetrics(): Promise<string> {
  return t.wired.deps.metrics.registry.metrics()
}

describe('croner job scheduling (wiring smoke test)', () => {
  it('schedules the five documented jobs with future next runs, and stop() halts them', async () => {
    const jobs = schedule(join(t.env.BLOB_DIR, '..', 'snapshots'))

    expect(jobs.jobs.map((job) => job.name).sort()).toEqual([
      'doneArchival',
      'positionRebalance',
      'sessionPurge',
      'sqliteSnapshot',
      'waitingAgingAlerts',
    ])
    for (const job of jobs.jobs) {
      const next = job.cron.nextRun()
      expect(next).toBeInstanceOf(Date)
      expect(next?.getTime() ?? 0).toBeGreaterThan(Date.now())
    }

    await jobs.stop()

    for (const job of jobs.jobs) {
      expect(job.cron.nextRun()).toBeNull()
    }
  })

  it('stop() drains an in-flight run before resolving (shutdown closes the DB after it)', async () => {
    const jobs = schedule(join(t.env.BLOB_DIR, '..', 'snapshots'))
    const purge = jobs.jobs.find((job) => job.name === 'sessionPurge')
    const inFlight = purge?.cron.trigger()

    await jobs.stop()

    // The run that was in flight when stop() was called has fully completed —
    // its outcome is already recorded — before stop() resolved.
    const metrics = await scrapeMetrics()
    expect(metrics).toContain('job_runs_total{job="sessionPurge",outcome="success"} 1')
    await inFlight
  })

  it('a triggered run flows through the wrapper: success outcome + duration recorded', async () => {
    const jobs = schedule(join(t.env.BLOB_DIR, '..', 'snapshots'))
    const purge = jobs.jobs.find((job) => job.name === 'sessionPurge')

    await purge?.cron.trigger()

    const metrics = await scrapeMetrics()
    expect(metrics).toContain('job_runs_total{job="sessionPurge",outcome="success"} 1')
    expect(metrics).toContain('job_duration_seconds_count{job="sessionPurge"} 1')
  })

  it('a failing job records an error outcome and never escapes the scheduler', async () => {
    // A snapshot dir nested under an existing FILE cannot be created —
    // the backup fails, the wrapper contains it (exit-crash = missed
    // snapshots for every later night).
    const jobs = schedule(join(t.env.DATABASE_PATH, 'not-a-directory'))
    const snapshot = jobs.jobs.find((job) => job.name === 'sqliteSnapshot')

    await snapshot?.cron.trigger()

    const metrics = await scrapeMetrics()
    expect(metrics).toContain('job_runs_total{job="sqliteSnapshot",outcome="error"} 1')
  })
})
