import { type AdapterLogger } from '../types.ts'

/**
 * Daily session purge (docs/architecture/overview.md#scheduled-jobs-croner-in-process):
 * deletes sessions past their folded `expiresAt` (idle and absolute caps are
 * folded at write time — ADR-009). Expired sessions are already unusable at
 * read time; this job just keeps the table from growing forever, so it is
 * trivially idempotent and restart-safe.
 */

export interface SessionPurgeDeps {
  /** AuthService's purge surface — the only piece of auth the job touches. */
  auth: { deleteExpiredSessions(): Promise<number> }
  logger: AdapterLogger
}

export async function runSessionPurge(deps: SessionPurgeDeps): Promise<{ purged: number }> {
  const purged = await deps.auth.deleteExpiredSessions()
  if (purged > 0) deps.logger.info({ purged }, 'expired sessions purged')
  return { purged }
}
