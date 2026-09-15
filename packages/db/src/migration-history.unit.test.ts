import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { assertMigrationHistory } from './migration-history.ts'

const folder = mkdtempSync(join(tmpdir(), 'migration-history-'))
mkdirSync(join(folder, 'meta'))
const sql = 'SELECT 1;\n--> statement-breakpoint\nSELECT 2;\n'
writeFileSync(join(folder, '0000_test.sql'), sql)
const hash = createHash('sha256').update(sql).digest('hex')
afterAll(() => {
  rmSync(folder, { recursive: true, force: true })
})

function journal(timestamps = [100, 200]): void {
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      entries: timestamps.map((when, idx) => ({ idx, when, tag: '0000_test', breakpoints: true })),
    }),
  )
}

it.each(
  [
    [],
    [{ hash, created_at: 100 }],
    [
      { hash, created_at: '100' },
      { hash, created_at: '200' },
    ],
  ].map((applied) => ({ applied })),
)('accepts a valid applied prefix ($applied)', ({ applied }) => {
  // Arrange
  journal()
  // Act
  const act = () => {
    assertMigrationHistory(folder, applied)
  }
  // Assert
  expect(act).not.toThrow()
})

it.each(
  [
    [{ hash, created_at: 200 }],
    [{ hash, created_at: null }],
    [
      { hash, created_at: 100 },
      { hash, created_at: 100 },
    ],
    [
      { hash, created_at: 100 },
      { hash, created_at: 200 },
      { hash, created_at: 300 },
    ],
    [{ hash: 'modified', created_at: 100 }],
  ].map((applied) => ({ applied })),
)('rejects missing, duplicate, newer, or modified history ($applied)', ({ applied }) => {
  // Arrange
  journal()
  // Act
  const act = () => {
    assertMigrationHistory(folder, applied)
  }
  // Assert
  expect(act).toThrow(/Incompatible migration history/)
})

it.each([[100, 100], [200, 100], [100.5], [null]])(
  'rejects unsafe journal timestamps (%j)',
  (...timestamps) => {
    // Arrange
    writeFileSync(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        entries: timestamps.map((when) => ({ when, tag: '0000_test', breakpoints: true })),
      }),
    )
    // Act
    const act = () => {
      assertMigrationHistory(folder, [])
    }
    // Assert
    expect(act).toThrow(/timestamps must increase strictly/)
  },
)

it('accepts CRLF hashes for SQL checked out with LF', () => {
  // Arrange
  journal()
  const windowsHash = createHash('sha256').update(sql.replace(/\n/g, '\r\n')).digest('hex')
  // Act
  const act = () => {
    assertMigrationHistory(folder, [{ hash: windowsHash, created_at: 100 }])
  }
  // Assert
  expect(act).not.toThrow()
})
