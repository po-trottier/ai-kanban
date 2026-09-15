import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_POLICY_DOCUMENT } from '@rivian-kanban/core'
import { openDatabase } from './connection.ts'
import { openPgliteConnection } from './pg/connection.ts'
import { structuralSeed } from './seed.ts'
import { structuralSeedPg } from './pg/seed.ts'

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'migration-safety-'))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

// Same deployment data and assertions against SQLite and real Postgres SQL (PGlite).
for (const dialect of ['sqlite', 'pg'] as const) {
  describe(`${dialect} upgrade safety`, () => {
    const source = fileURLToPath(
      new URL(dialect === 'pg' ? '../migrations/pg' : '../migrations', import.meta.url),
    )
    const historyTable = dialect === 'pg' ? 'drizzle.__drizzle_migrations' : '__drizzle_migrations'
    const tablesQuery =
      dialect === 'pg'
        ? "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        : "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%drizzle%' ORDER BY name"

    async function open(path: string, folder = source) {
      if (dialect === 'pg') {
        const connection = await openPgliteConnection(folder, path)
        return {
          query: async (text: string) =>
            ((await connection.db.execute(sql.raw(text))) as { rows: Record<string, unknown>[] })
              .rows,
          seed: () => structuralSeedPg(connection.db),
          close: connection.close,
        }
      }
      const connection = openDatabase(path, folder)
      return {
        query: (text: string) => {
          const statement = connection.raw.prepare<[], Record<string, unknown>>(text)
          if (statement.reader) return Promise.resolve(statement.all())
          statement.run()
          return Promise.resolve([])
        },
        seed: () => Promise.resolve(structuralSeed(connection.db)),
        close: () => {
          connection.close()
          return Promise.resolve()
        },
      }
    }

    function migrations(count?: number) {
      const folder = temp()
      cpSync(source, folder, { recursive: true })
      const journalPath = join(folder, 'meta/_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; when: number; tag: string; breakpoints: boolean }[]
      }
      if (count !== undefined) journal.entries = journal.entries.slice(0, count)
      writeFileSync(journalPath, JSON.stringify(journal))
      return { folder, journal, journalPath }
    }

    async function snapshot(connection: Awaited<ReturnType<typeof open>>) {
      const result = new Map<string, Record<string, unknown>[]>()
      for (const { name } of await connection.query(tablesQuery)) {
        const table = String(name)
        result.set(table, await connection.query(`SELECT * FROM "${table}" ORDER BY 1, 2`))
      }
      return result
    }

    it('preserves every populated v1 table across forward migration, seeding, and restart', async () => {
      const path = join(temp(), 'data')
      const legacy = await open(path, migrations(1).folder)
      const fixture = readFileSync(new URL('./test/upgrade-data.sql', import.meta.url), 'utf8')
      for (const statement of fixture.split(';').filter((part) => part.trim()))
        await legacy.query(statement)
      const policy = JSON.stringify({
        ...DEFAULT_POLICY_DOCUMENT,
        transitionEnforcement: true,
      }).replace(/'/g, "''")
      await legacy.query(
        `INSERT INTO board_policies (id, board_id, config, created_by, created_at) VALUES ('p', 'b', '${policy}', 'u', '2026-01-01')`,
      )
      const before = await snapshot(legacy)
      await legacy.close()

      const upgraded = await open(path, migrations(2).folder)
      await upgraded.seed()
      const after = await snapshot(upgraded)
      // Added columns are allowed; every prior column value and row must survive.
      for (const [table, rows] of before) {
        expect(after.get(table)).toHaveLength(rows.length)
        expect(after.get(table)).toMatchObject(rows)
      }
      await upgraded.query(
        `INSERT INTO groups (id, name, user_ids, created_at) VALUES ('g', 'Custom team', '["u"]', '2026-01-01')`,
      )
      await upgraded.query(
        `UPDATE boards SET access_mode = 'restricted', allowed_role_keys = '["admin"]', allowed_user_ids = '["u"]', allowed_group_ids = '["g"]' WHERE id = 'b'`,
      )
      const withGroups = await snapshot(upgraded)
      await upgraded.close()
      const latest = await open(path)
      const afterDefaultsMigration = await snapshot(latest)
      for (const [table, rows] of withGroups) {
        expect(afterDefaultsMigration.get(table)).toEqual(rows)
      }
      for (const [scope, subject] of [
        ['user', 'u'],
        ['group', 'g'],
        ['role', 'admin'],
      ] as const) {
        await latest.query(
          `INSERT INTO board_defaults (scope, subject, board_id) VALUES ('${scope}', '${subject}', 'b')`,
        )
      }
      const current = await snapshot(latest)
      await latest.close()

      const restarted = await open(path)
      await restarted.seed()
      expect(await snapshot(restarted)).toEqual(current)
      await restarted.close()
    })

    it('rolls back data, schema, and history when a later pending migration fails', async () => {
      const path = join(temp(), 'data')
      const original = await open(path)
      await original.seed()
      const before = await snapshot(original)
      const history = await original.query(`SELECT * FROM ${historyTable} ORDER BY created_at`)
      await original.close()
      const { folder, journal, journalPath } = migrations()
      for (const [index, statement] of [
        "UPDATE users SET display_name = 'LOST';--> statement-breakpoint\nCREATE TABLE upgrade_probe (id integer);",
        'INSERT INTO definitely_missing_table VALUES (1);',
      ].entries()) {
        const idx = journal.entries.length
        const tag = `${String(idx).padStart(4, '0')}_test`
        journal.entries.push({ idx, when: Date.now() + index, tag, breakpoints: true })
        writeFileSync(join(folder, `${tag}.sql`), statement)
      }
      writeFileSync(journalPath, JSON.stringify(journal))

      await expect(open(path, folder)).rejects.toThrow()
      const recovered = await open(path)
      expect(await snapshot(recovered)).toEqual(before)
      expect(await recovered.query(`SELECT * FROM ${historyTable} ORDER BY created_at`)).toEqual(
        history,
      )
      await recovered.close()
    })

    it('rejects downgrades and modified SQL without changing saved data', async () => {
      const path = join(temp(), 'data')
      const original = await open(path)
      await original.seed()
      const before = await snapshot(original)
      await original.close()
      const altered = migrations()
      writeFileSync(join(altered.folder, '0000_init.sql'), 'SELECT 1;')

      await expect(open(path, migrations(1).folder)).rejects.toThrow(
        /Incompatible migration history/,
      )
      await expect(open(path, altered.folder)).rejects.toThrow(/applied migration was modified/)
      const recovered = await open(path)
      expect(await snapshot(recovered)).toEqual(before)
      await recovered.close()
    })

    it.each(['DELETE FROM', 'DROP TABLE'])(
      'refuses to recreate lost history (%s)',
      async (operation) => {
        const path = join(temp(), 'data')
        const original = await open(path)
        await original.seed()
        await original.query(`${operation} ${historyTable}`)
        await original.close()

        await expect(open(path)).rejects.toThrow(/Missing migration history/)
      },
    )
  })
}
