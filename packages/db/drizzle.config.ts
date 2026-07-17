import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config: SQL migration generation from src/schema.ts (ADR-003).
 * Migrations are committed under ./migrations and applied programmatically at
 * boot (src/connection.ts) or via `npm run migrate` (DATABASE_PATH).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    // Only used by `drizzle-kit studio`; generation never touches a database.
    url: process.env.DATABASE_PATH ?? './data/app.sqlite',
  },
})
