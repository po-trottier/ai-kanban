import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase, SqliteUnitOfWork } from '@rivian-kanban/db'
import { pino } from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixedClock } from '@rivian-kanban/core/testing'
import { runSessionPurge } from './jobs/session-purge.ts'
import { runSqliteSnapshot, SNAPSHOT_RETAIN_COUNT } from './jobs/sqlite-snapshot.ts'
import { SqliteSnapshotStore } from './wiring/sqlite-snapshot-store.ts'
import { createTestApp, sessionCookieOf, type TestApp } from './test/support.ts'

/**
 * The maintenance pair against a real temp SQLite database: the daily session
 * purge (auth's deleteExpiredSessions) and the nightly `VACUUM INTO` snapshot
 * with 7-file retention (docs/architecture/deployment.md#database-operations).
 * A snapshot is only proven by opening it: the test restores one through the
 * regular openDatabase path — migrations and all — exactly like the drill.
 */

let t: TestApp
const silentLog = pino({ level: 'silent' })

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.cleanup()
})

describe('session purge job', () => {
  it('deletes expired sessions and keeps live ones working', async () => {
    const { user, password } = await t.createUser('technician')
    const live = await t.request(null, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password },
    })
    const liveCookie = sessionCookieOf(live)
    const expiredHash = randomUUID().replaceAll('-', '')
    await t.wired.deps.uow.run((tx) =>
      tx.sessions.create({
        id: expiredHash,
        userId: user.id,
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-08T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const summary = await runSessionPurge({
      auth: t.wired.deps.services.auth,
      logger: silentLog,
    })

    expect(summary.purged).toBe(1)
    expect(await t.wired.deps.uow.run((tx) => tx.sessions.findByHash(expiredHash))).toBeNull()
    const me = await t.request(liveCookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(200)
  })
})

describe('sqlite snapshot job', () => {
  it('VACUUMs into a dated file that restores through the normal boot path', async () => {
    const supervisor = await t.createUser('supervisor')
    const card = await t.wired.deps.services.cards.create(
      { kind: 'user', id: supervisor.user.id, role: 'supervisor' },
      { title: 'survives the snapshot' },
    )
    const dir = join(t.env.DATABASE_PATH, '..', 'snapshots')
    const snapshots = new SqliteSnapshotStore(t.wired.connection, dir)

    const summary = await runSqliteSnapshot({
      snapshots,
      clock: new FixedClock('2026-07-16T12:00:00.000Z'),
      logger: silentLog,
    })

    expect(summary.created).toBe('app-2026-07-16.sqlite')
    expect(summary.pruned).toEqual([])
    const snapshotPath = join(dir, 'app-2026-07-16.sqlite')
    expect(existsSync(snapshotPath)).toBe(true)
    // Restore drill in miniature: open the self-contained copy (runs
    // migrations) and read the committed card back out of it.
    const restored = openDatabase(snapshotPath)
    try {
      const uow = new SqliteUnitOfWork(restored)
      const restoredCard = await uow.run((tx) => tx.cards.findById(card.id))
      expect(restoredCard?.title).toBe('survives the snapshot')
    } finally {
      restored.close()
    }
  })

  it('reclaims interrupted partials and retries the day that crashed mid-VACUUM', async () => {
    // VACUUM INTO writes through a .tmp sibling and publishes by rename, so a
    // SIGKILL mid-write leaves only a partial — never the dated name the job
    // treats as "done for today". The rerun must reclaim partials and retry.
    const dir = join(t.env.DATABASE_PATH, '..', 'snapshots')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'app-2026-07-16.sqlite.tmp'), 'truncated partial')
    await writeFile(join(dir, 'app-2026-07-10.sqlite.tmp'), 'older interrupted run')
    const snapshots = new SqliteSnapshotStore(t.wired.connection, dir)

    const summary = await runSqliteSnapshot({
      snapshots,
      clock: new FixedClock('2026-07-16T12:00:00.000Z'),
      logger: silentLog,
    })

    expect(summary.created).toBe('app-2026-07-16.sqlite')
    expect((await readdir(dir)).sort()).toEqual(['app-2026-07-16.sqlite'])
    // The retried snapshot is complete: it opens through the normal boot path.
    const restored = openDatabase(join(dir, 'app-2026-07-16.sqlite'))
    restored.close()
  })

  it('publishes atomically: a snapshot that cannot complete leaves nothing behind', async () => {
    const dir = join(t.env.DATABASE_PATH, '..', 'snapshots')
    // A directory squatting on the target name makes the final rename fail —
    // any failure between VACUUM and publish must clean up its partial.
    await mkdir(join(dir, 'occupied.sqlite'), { recursive: true })
    const snapshots = new SqliteSnapshotStore(t.wired.connection, dir)

    await expect(snapshots.vacuumInto('occupied.sqlite')).rejects.toThrow()

    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('is idempotent within a day and prunes beyond the newest 7 snapshots', async () => {
    const dir = join(t.env.DATABASE_PATH, '..', 'snapshots')
    await mkdir(dir, { recursive: true })
    // Eight older dated snapshots plus an unrelated file the job must ignore.
    const dates = ['07-01', '07-02', '07-03', '07-04', '07-05', '07-06', '07-07', '07-08']
    for (const date of dates) await writeFile(join(dir, `app-2026-${date}.sqlite`), 'old')
    await writeFile(join(dir, 'README.txt'), 'not a snapshot')
    const snapshots = new SqliteSnapshotStore(t.wired.connection, dir)
    const clock = new FixedClock('2026-07-16T12:00:00.000Z')

    const first = await runSqliteSnapshot({ snapshots, clock, logger: silentLog })
    const rerun = await runSqliteSnapshot({ snapshots, clock, logger: silentLog })

    // 9 dated files, newest 7 kept: 07-01 and 07-02 pruned, today created once.
    expect(first.created).toBe('app-2026-07-16.sqlite')
    expect(first.pruned).toEqual(['app-2026-07-02.sqlite', 'app-2026-07-01.sqlite'])
    expect(rerun.created).toBeNull()
    expect(rerun.pruned).toEqual([])
    const remaining = (await readdir(dir)).sort()
    expect(remaining).toEqual([
      'README.txt',
      'app-2026-07-03.sqlite',
      'app-2026-07-04.sqlite',
      'app-2026-07-05.sqlite',
      'app-2026-07-06.sqlite',
      'app-2026-07-07.sqlite',
      'app-2026-07-08.sqlite',
      'app-2026-07-16.sqlite',
    ])
    expect(remaining.filter((name) => name.startsWith('app-'))).toHaveLength(SNAPSHOT_RETAIN_COUNT)
  })
})
