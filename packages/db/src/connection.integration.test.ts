import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDatabase } from './connection.ts'

const tempDirs: string[] = []

function tempPath(...segments: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-db-'))
  tempDirs.push(dir)
  return join(dir, ...segments)
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates the database file (and missing parent directories) and applies all migrations', () => {
    const databasePath = tempPath('nested', 'deeper', 'app.sqlite')

    const connection = openDatabase(databasePath)
    const tableNames = connection.raw
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name)
    connection.close()

    expect(existsSync(databasePath)).toBe(true)
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'users',
        'boards',
        'lanes',
        'locations',
        'board_policies',
        'cards',
        'tags',
        'card_tags',
        'comments',
        'attachments',
        'card_events',
        'sessions',
        'service_tokens',
      ]),
    )
  })

  it('creates the documented indexes, including the UNIQUE(lane_id, position) backstop', () => {
    const connection = openDatabase(tempPath('app.sqlite'))

    const indexNames = connection.raw
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name)
    connection.close()

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'cards_lane_id_position_unique',
        'cards_board_id_archived_at_idx',
        'cards_assignee_id_idx',
        'cards_reporter_id_idx',
        'cards_created_at_id_idx',
        'card_events_card_id_created_at_idx',
        'comments_card_id_created_at_idx',
        'attachments_card_id_idx',
        'board_policies_board_id_created_at_idx',
        'tags_name_unique',
        'users_email_unique',
        'users_email_ci_unique',
        'lanes_board_id_key_unique',
      ]),
    )
  })

  it('applies the mandatory pragmas on open', () => {
    const connection = openDatabase(tempPath('app.sqlite'))

    const journalMode = connection.raw.pragma('journal_mode', { simple: true })
    const synchronous = connection.raw.pragma('synchronous', { simple: true })
    const busyTimeout = connection.raw.pragma('busy_timeout', { simple: true })
    const foreignKeys = connection.raw.pragma('foreign_keys', { simple: true })
    connection.close()

    expect(journalMode).toBe('wal')
    expect(synchronous).toBe(1) // NORMAL
    expect(busyTimeout).toBe(5000)
    expect(foreignKeys).toBe(1)
  })

  it('is idempotent across reopen: migrations no-op and data survives', () => {
    const databasePath = tempPath('app.sqlite')
    const first = openDatabase(databasePath)
    first.raw
      .prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)')
      .run('11111111-1111-7111-8111-111111111111', 'Facilities', '2026-07-16T12:00:00.000Z')
    first.close()

    const second = openDatabase(databasePath)
    const boardCount = second.raw
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM boards')
      .get()
    second.close()

    expect(boardCount?.n).toBe(1)
  })
})
