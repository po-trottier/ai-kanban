import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the PostgreSQL dialect (ADR-020): SQL migration
 * generation from src/schema.pg.ts into ./migrations/pg. Kept in lockstep with
 * the sqlite migrations (one `0000_init` each, v0 rule). Applied at boot by
 * src/pg/connection.ts.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.pg.ts',
  out: './migrations/pg',
})
