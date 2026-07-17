import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type DbConnection } from '@rivian-kanban/db'
import { type SnapshotStore } from '../jobs/sqlite-snapshot.ts'

/**
 * The production SnapshotStore (docs/architecture/deployment.md
 * #database-operations): SQLite's online backup API on the process's database
 * connection, files under SNAPSHOT_DIR. Lives in wiring because it is the
 * composition of the two things jobs must not touch directly: packages/db
 * and the filesystem (docs/dev/standards.md).
 *
 * The backup API (not `VACUUM INTO`) because it copies incrementally and
 * asynchronously, yielding to the event loop between page batches — a
 * year-2-sized database must not freeze every request (and SSE keepalive)
 * for the duration of a synchronous whole-file copy. Same self-consistent
 * result: writes from this connection during the copy are folded in by the
 * backup protocol.
 */
export class SqliteSnapshotStore implements SnapshotStore {
  private readonly connection: DbConnection
  private readonly dir: string

  constructor(connection: DbConnection, dir: string) {
    this.connection = connection
    this.dir = dir
  }

  async backupInto(filename: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    // Interrupted earlier runs (SIGKILL mid-copy, disk full) leave *.tmp
    // partials. They are inert — the job's SNAPSHOT_PATTERN never matches
    // them — but they are reclaimed here so nothing lingers and the same-day
    // retry finds a clear target.
    for (const stale of (await readdir(this.dir)).filter((name) => name.endsWith('.tmp'))) {
      await rm(join(this.dir, stale), { force: true })
    }
    // The backup writes the target incrementally, so the dated name must
    // only ever appear once the copy is complete: write to a .tmp sibling and
    // publish with a same-directory rename (atomic on the Linux data volume).
    // The port contract (SnapshotStore.backupInto) depends on this.
    const target = join(this.dir, filename)
    const partial = `${target}.tmp`
    try {
      await this.connection.raw.backup(partial)
      await rename(partial, target)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
  }

  async list(): Promise<string[]> {
    try {
      return await readdir(this.dir)
    } catch {
      // No snapshot has ever been taken — the first run creates the dir.
      return []
    }
  }

  async remove(filename: string): Promise<void> {
    await rm(join(this.dir, filename))
  }
}
