import { openDatabase } from './connection.ts'

/**
 * `npm run db:migrate` — applies the committed migrations to DATABASE_PATH.
 * Boot does the same programmatically (connection.ts); this exists for
 * operating on a database without starting the app (restore drills, CI).
 */
const databasePath = process.env.DATABASE_PATH
if (databasePath === undefined || databasePath === '') {
  console.error('DATABASE_PATH is required (e.g. DATABASE_PATH=./data/app.sqlite)')
  process.exit(1)
}
const connection = openDatabase(databasePath)
connection.close()
console.log(`migrations applied: ${databasePath}`)
