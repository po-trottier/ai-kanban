import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
// Exclude a release tag on the candidate itself: compare with the previous release.
const baseline = git('describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', 'HEAD^').trim()
const normalize = (text) => text.replace(/\r\n/g, '\n')

for (const folder of ['packages/db/migrations', 'packages/db/migrations/pg']) {
  const journalPath = `${folder}/meta/_journal.json`
  const released = JSON.parse(git('show', `${baseline}:${journalPath}`))
  const current = JSON.parse(readFileSync(journalPath, 'utf8'))
  assert.deepEqual(
    current.entries.slice(0, released.entries.length),
    released.entries,
    `${folder}: released journal entries must not be changed or removed`,
  )
  for (const entry of released.entries) {
    for (const path of [
      `${folder}/${entry.tag}.sql`,
      `${folder}/meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`,
    ]) {
      assert.equal(
        normalize(readFileSync(path, 'utf8')),
        normalize(git('show', `${baseline}:${path}`)),
        `${path}: released migrations are immutable; append a new migration instead`,
      )
    }
  }
  let previous = -Infinity
  for (const [index, entry] of current.entries.entries()) {
    assert.equal(entry.idx, index, `${folder}: migration indexes must be contiguous`)
    assert.ok(
      Number.isSafeInteger(entry.when) && entry.when > previous,
      `${folder}: migration timestamps must strictly increase`,
    )
    assert.match(entry.tag, /^\d{4}_[a-zA-Z0-9_]+$/)
    readFileSync(`${folder}/${entry.tag}.sql`)
    previous = entry.when
  }
}
console.log(`Migration history is append-only since ${baseline}`)
