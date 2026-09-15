import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { boards, cards, filterPresets } from '../schema.pg.ts'
import { PostgresUnitOfWork } from './unit-of-work.ts'

/**
 * Postgres migration continuity for `0001_boards` (mirrors
 * `../migration-boards.integration.test.ts`): applying it against a Postgres
 * database still on `0000_init` must preserve every existing id/row
 * (including a HIGH existing card id), deterministically flag the
 * pre-existing board `isDefault`, backfill `filter_presets`, and initialize
 * the `card_ids` sequence strictly ABOVE the pre-existing MAX(id) — never
 * resetting it. Real Postgres SQL via PGlite (ADR-020), never touching
 * `0000_init`.
 */

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-pg-migration-'))
  tempDirs.push(dir)
  return dir
}

/** A pg migrations folder containing ONLY 0000_init — the pre-multi-board state. */
function legacyMigrationsFolder(): string {
  const src = fileURLToPath(new URL('../../migrations/pg', import.meta.url))
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

function fullMigrationsFolder(): string {
  return fileURLToPath(new URL('../../migrations/pg', import.meta.url))
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('0001_boards pg migration continuity', () => {
  it('preserves a high existing card id, backfills boards/presets, and initializes card_ids strictly above it', async () => {
    const dataDir = join(tempDir(), 'pgdata')
    const now = '2026-01-01T00:00:00.000Z'

    // Arrange — a pre-multi-board Postgres database (0000_init only),
    // populated via raw SQL matching the OLD (boardId-less filter_presets,
    // board-less-columns) shape, including a HIGH existing card id.
    const legacyClient = new PGlite(dataDir)
    const legacyDb = drizzlePglite(legacyClient)
    await migratePglite(legacyDb, { migrationsFolder: legacyMigrationsFolder() })
    await legacyClient.query(`insert into boards (id, name, created_at) values ($1, $2, $3)`, [
      'legacy-board',
      'Facilities',
      now,
    ])
    await legacyClient.query(
      `insert into users (id, email, display_name, role, password_hash, must_change_password, is_active, timezone, theme, created_at)
       values ($1, $2, $3, $4, $5, false, true, 'PST', 'system', $6)`,
      ['legacy-user', 'legacy@example.com', 'Legacy', 'admin', 'hash', now],
    )
    await legacyClient.query(
      `insert into filter_presets (id, owner_id, name, filter, shared, created_at, updated_at)
       values ($1, $2, $3, $4, false, $5, $5)`,
      ['legacy-preset', 'legacy-user', 'Legacy Preset', '{}', now],
    )
    await legacyClient.query(
      `insert into lanes (id, board_id, key, label, position) values ($1, $2, $3, $4, $5)`,
      ['legacy-lane', 'legacy-board', 'intake', 'Intake', 0],
    )
    // A HIGH existing card id — the sequence must initialize strictly above it.
    await legacyClient.query(
      `insert into cards (id, board_id, lane_id, position, title, priority, reporter_id, origin, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [9000, 'legacy-board', 'legacy-lane', 'a0', 'Legacy card', 'P2', 'legacy-user', 'web', now],
    )
    await legacyClient.close()

    // Act — reopen the SAME on-disk PGlite data dir against the full
    // migrations folder (0000 + 0001).
    const client = new PGlite(dataDir)
    const db = drizzlePglite(client)
    await migratePglite(db, { migrationsFolder: fullMigrationsFolder() })

    // Assert — board preserved and deterministically flagged isDefault.
    const boardRows = await db.select().from(boards)
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

    // The existing preset is preserved and backfilled to the default board.
    const presetRows = await db.select().from(filterPresets)
    expect(presetRows).toHaveLength(1)
    expect(presetRows[0]).toMatchObject({ id: 'legacy-preset', boardId: 'legacy-board' })

    // The pre-existing high-id card survives migration untouched.
    const cardRows = await db.select().from(cards)
    expect(cardRows).toHaveLength(1)
    expect(cardRows[0]).toMatchObject({ id: 9000, boardId: 'legacy-board', title: 'Legacy card' })

    // nextCardId() resumes strictly ABOVE the pre-existing MAX(id) — the
    // sequence was initialized by the migration, never reset per-allocation.
    const uow = new PostgresUnitOfWork(db)
    const nextId = await uow.run((tx) => tx.cards.nextCardId())
    expect(nextId).toBe(9001)

    await client.close()
  })

  it('applies cleanly to a fresh (empty) Postgres database', async () => {
    const client = new PGlite(join(tempDir(), 'pgdata-fresh'))
    const db = drizzlePglite(client)
    await migratePglite(db, { migrationsFolder: fullMigrationsFolder() })

    const boardRows = await db.select().from(boards)
    expect(boardRows).toEqual([])

    const uow = new PostgresUnitOfWork(db)
    const firstId = await uow.run((tx) => tx.cards.nextCardId())
    expect(firstId).toBe(1)

    await client.close()
  })
})
