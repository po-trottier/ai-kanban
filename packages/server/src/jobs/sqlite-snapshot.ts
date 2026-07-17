import { type Clock } from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Nightly `VACUUM INTO` snapshot (docs/architecture/deployment.md
 * #database-operations): a live WAL database must never be file-copied, so
 * the nightly backup is a self-contained vacuumed copy under SNAPSHOT_DIR,
 * dated by the job clock, with the newest 7 retained. Idempotent: a restart
 * on the same UTC day sees the file already exists and only prunes — sound
 * because the store publishes atomically (a dated file is always a COMPLETED
 * snapshot; an interrupted run leaves only an inert partial that the next
 * attempt reclaims and retries). The store is a port so the job stays pure
 * over injected dependencies; the SQLite/filesystem adapter lives in wiring.
 */

export const SNAPSHOT_RETAIN_COUNT = 7

/** Dated snapshot files the job owns; anything else in the dir is ignored. */
const SNAPSHOT_PATTERN = /^app-\d{4}-\d{2}-\d{2}\.sqlite$/

export interface SnapshotStore {
  /**
   * `VACUUM INTO` the given filename under SNAPSHOT_DIR (must not pre-exist).
   * Must publish atomically: a crash mid-write must never leave a partial
   * file under the final name — the job's same-day idempotency check treats
   * an existing dated file as a completed snapshot and would neither retry
   * nor prune it for SNAPSHOT_RETAIN_COUNT days.
   */
  vacuumInto(filename: string): Promise<void>
  /** Every filename currently in SNAPSHOT_DIR ([] when it does not exist yet). */
  list(): Promise<string[]>
  remove(filename: string): Promise<void>
}

export interface SqliteSnapshotDeps {
  snapshots: SnapshotStore
  clock: Clock
  logger: AdapterLogger
}

function snapshotFilenameFor(instant: Date): string {
  return `app-${instant.toISOString().slice(0, 10)}.sqlite`
}

export async function runSqliteSnapshot(
  deps: SqliteSnapshotDeps,
): Promise<{ created: string | null; pruned: string[] }> {
  const filename = snapshotFilenameFor(deps.clock.now())
  const existing = await deps.snapshots.list()

  let created: string | null = null
  if (!existing.includes(filename)) {
    await deps.snapshots.vacuumInto(filename)
    created = filename
    deps.logger.info({ snapshot: filename }, 'sqlite snapshot created')
  }

  // Dated names sort chronologically; keep the newest SNAPSHOT_RETAIN_COUNT.
  const pruned = [...new Set([...existing, filename])]
    .filter((name) => SNAPSHOT_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(SNAPSHOT_RETAIN_COUNT)
  for (const name of pruned) {
    await deps.snapshots.remove(name)
    deps.logger.info({ snapshot: name }, 'old sqlite snapshot pruned')
  }
  return { created, pruned }
}
