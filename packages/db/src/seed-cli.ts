import { openDatabase } from './connection.ts'
import { demoSeed, structuralSeed } from './seed.ts'

/**
 * `npm run db:seed` — migrates DATABASE_PATH, applies the idempotent
 * structural seed, and (when SEED_DEMO_DATA=true, never in production) the
 * demo fixture dataset (data-model.md#seeding).
 */
const databasePath = process.env.DATABASE_PATH
if (databasePath === undefined || databasePath === '') {
  console.error('DATABASE_PATH is required (e.g. DATABASE_PATH=./data/app.sqlite)')
  process.exit(1)
}
const connection = openDatabase(databasePath)
try {
  const structural = structuralSeed(connection.db)
  console.log(`structural seed ok (board ${structural.boardId})`)
  if (process.env.SEED_DEMO_DATA === 'true') {
    const demo = demoSeed(connection.db)
    if (demo.seeded) {
      console.log(`demo seed ok: ${demo.cardCount.toString()} cards`)
      console.log(
        `demo users (placeholder password hashes until the server auth task): ${demo.userEmails.join(', ')}`,
      )
    } else {
      console.log('demo data already present — skipped')
    }
  }
} finally {
  connection.close()
}
