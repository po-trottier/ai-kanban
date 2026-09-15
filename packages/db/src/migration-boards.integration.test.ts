import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDatabase } from './connection.ts'
import { boards, cards, filterPresets } from './schema.ts'
import { SqliteUnitOfWork } from './unit-of-work.ts'

/**
 * Migration continuity for `0001_boards` (docs/superpowers/plans/2026-09-15-
 * multiple-boards.md): applying it against a database still on `0000_init`
 * must preserve every existing id/row, deterministically flag the
 * pre-existing board `isDefault`, and backfill every `filter_presets` row to
 * it — never regenerating or touching `0000_init` itself.
 */

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-migration-'))
  tempDirs.push(dir)
  return dir
}

/** A migrations folder containing ONLY 0000_init — the pre-multi-board state. */
function legacyMigrationsFolder(): string {
  const src = fileURLToPath(new URL('../migrations', import.meta.url))
  const dir = tempDir()
  cpSync(join(src, '0000_init.sql'), join(dir, '0000_init.sql'))
  cpSync(join(src, 'meta', '0000_snapshot.json'), join(dir, 'meta', '0000_snapshot.json'), {
    recursive: true,
  })
  const journal = JSON.parse(readFileSync(join(src, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[]
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
  )
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('0001_boards migration continuity', () => {
  it('preserves ids/data and backfills existing rows when migrating a populated 0000 database', async () => {
    const dbFile = join(tempDir(), 'legacy.sqlite')

    // Arrange — build a pre-multi-board database (0000_init only) and insert
    // rows using the OLD (boardId-less filter_presets, board-less-columns)
    // shape via raw SQL, matching what a real pre-existing deployment has on disk.
    const legacy = openDatabase(dbFile, legacyMigrationsFolder())
    const now = '2026-01-01T00:00:00.000Z'
    legacy.raw
      .prepare('insert into boards (id, name, created_at) values (?, ?, ?)')
      .run('legacy-board', 'Facilities', now)
    legacy.raw
      .prepare(
        `insert into users (id, email, display_name, role, password_hash, must_change_password, is_active, timezone, theme, created_at)
         values (?, ?, ?, ?, ?, 0, 1, 'PST', 'system', ?)`,
      )
      .run('legacy-user', 'legacy@example.com', 'Legacy', 'admin', 'hash', now)
    legacy.raw
      .prepare(
        `insert into filter_presets (id, owner_id, name, filter, shared, created_at, updated_at)
         values (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run('legacy-preset', 'legacy-user', 'Legacy Preset', '{}', now, now)
    legacy.raw
      .prepare(
        `insert into lanes (id, board_id, key, label, position, wip_limit)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-lane', 'legacy-board', 'intake', 'Intake', 0, null)
    // A HIGH existing card id — nextCardId() after migration must allocate
    // strictly above it, never resetting/colliding.
    legacy.raw
      .prepare(
        `insert into cards (id, board_id, lane_id, position, title, priority, reporter_id, origin, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        9000,
        'legacy-board',
        'legacy-lane',
        'a0',
        'Legacy card',
        'P2',
        'legacy-user',
        'web',
        now,
        now,
      )
    legacy.close()

    // Act — reopen the SAME file against the full migrations folder (0000 + 0001).
    const migrated = openDatabase(dbFile)

    // Assert — the pre-existing board is preserved AND deterministically
    // flagged isDefault; the existing preset is preserved and backfilled.
    const boardRows = migrated.db.select().from(boards).all()
    expect(boardRows).toHaveLength(1)
    expect(boardRows[0]).toMatchObject({
      id: 'legacy-board',
      name: 'Facilities',
      isDefault: true,
      archivedAt: null,
      accessMode: 'all',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [],
    })

    const presetRows = migrated.db.select().from(filterPresets).all()
    expect(presetRows).toHaveLength(1)
    expect(presetRows[0]).toMatchObject({ id: 'legacy-preset', boardId: 'legacy-board' })

    // The pre-existing card survives migration untouched, and global id
    // allocation resumes strictly above it (not reset to 1 per-board).
    const cardRows = migrated.db.select().from(cards).all()
    expect(cardRows).toHaveLength(1)
    expect(cardRows[0]).toMatchObject({ id: 9000, boardId: 'legacy-board', title: 'Legacy card' })

    const uow = new SqliteUnitOfWork(migrated)
    const nextId = await uow.run((tx) => tx.cards.nextCardId())
    expect(nextId).toBe(9001)

    // No dangling/broken FK anywhere after the rebuild-based filter_presets
    // migration and the board/card backfills.
    const violations = migrated.raw.prepare('pragma foreign_key_check').all()
    expect(violations).toEqual([])

    migrated.close()
  })

  it('applies cleanly to a fresh (empty) database', () => {
    const dbFile = join(tempDir(), 'fresh.sqlite')

    const connection = openDatabase(dbFile)
    const boardRows = connection.db.select().from(boards).all()
    connection.close()

    expect(boardRows).toEqual([])
  })
})
