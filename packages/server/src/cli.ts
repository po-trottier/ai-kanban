import { SystemClock } from '@rivian-kanban/core'
import { createDataLayer } from '@rivian-kanban/db'
import { PasswordHasher } from './auth/password-hasher.ts'
import { parseEnv } from './env.ts'
import { ActiveAdminExistsError, createAdminUser } from './wiring/create-admin.ts'

/**
 * Operational CLI (docs/architecture/deployment.md#bootstrap):
 *
 *   node dist/cli.js users create-admin --email you@org.com [--force]
 *
 * Prints a one-time temp password (`must_change_password` set). Refuses when
 * an active admin already exists unless --force — the same command is the
 * break-glass recovery if every admin is locked out.
 */

function usage(): never {
  console.error('usage: node dist/cli.js users create-admin --email <email> [--force]')
  process.exit(2)
}

const args = process.argv.slice(2)
if (args[0] !== 'users' || args[1] !== 'create-admin') usage()
const emailFlag = args.indexOf('--email')
const email = emailFlag === -1 ? undefined : args[emailFlag + 1]
if (email?.includes('@') !== true) usage()
const force = args.includes('--force')

const env = parseEnv()
const dataLayer = await createDataLayer({
  databaseUrl: env.DATABASE_URL,
  databasePath: env.DATABASE_PATH,
  sqliteMigrationsDir: env.MIGRATIONS_DIR,
  pgMigrationsDir: env.MIGRATIONS_DIR === undefined ? undefined : `${env.MIGRATIONS_DIR}/pg`,
})
try {
  const { systemUserId, uow } = dataLayer
  const result = await createAdminUser(
    {
      uow,
      clock: new SystemClock(),
      hasher: new PasswordHasher(),
      systemUserId,
    },
    email,
    force,
  )
  console.log(`${result.created ? 'created' : 'reset'} admin ${result.user.email}`)
  console.log(`one-time temp password (shown once): ${result.tempPassword}`)
  console.log('first login will require a password change')
} catch (error) {
  if (error instanceof ActiveAdminExistsError) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
} finally {
  await dataLayer.close()
}
