import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('migration gate accepts appends and rejects released edits or skipped timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migration-gate-'))
  const script = fileURLToPath(new URL('./check-migrations.mjs', import.meta.url))
  try {
    // Isolated copy of committed history. Never modify the working migration files.
    execFileSync('git', ['clone', '--shared', '--quiet', '.', dir], { stdio: 'pipe' })
    const check = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' })
    assert.equal(check().status, 0)
    for (const folder of ['packages/db/migrations', 'packages/db/migrations/pg']) {
      const sqlPath = join(dir, folder, '0000_init.sql')
      const originalSql = readFileSync(sqlPath, 'utf8')
      writeFileSync(sqlPath, `${originalSql}\n-- rewritten release\n`)
      assert.notEqual(check().status, 0, 'released SQL edits must fail')
      writeFileSync(sqlPath, originalSql)

      const journalPath = join(dir, folder, 'meta/_journal.json')
      const originalJournal = readFileSync(journalPath, 'utf8')
      const journal = JSON.parse(originalJournal)
      const idx = journal.entries.length
      const when = journal.entries.at(-1).when
      const tag = `${String(idx).padStart(4, '0')}_test`
      journal.entries.push({ ...journal.entries.at(-1), idx, tag })
      writeFileSync(join(dir, folder, `${tag}.sql`), 'SELECT 1;\n')
      writeFileSync(journalPath, JSON.stringify(journal))
      assert.notEqual(check().status, 0, 'duplicate timestamps must fail')
      journal.entries.at(-1).when = when + 1
      writeFileSync(journalPath, JSON.stringify(journal))
      assert.equal(check().status, 0, 'forward append must pass')
      journal.entries.shift()
      writeFileSync(journalPath, JSON.stringify(journal))
      assert.notEqual(check().status, 0, 'removed history must fail')
      writeFileSync(journalPath, originalJournal)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
