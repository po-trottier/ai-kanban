import { type TransactionContext } from '@rivian-kanban/core'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { SqliteAttachmentRepository } from './attachment-repository.ts'
import { SqliteCardRepository } from './card-repository.ts'
import { SqliteCommentRepository } from './comment-repository.ts'
import { SqliteEventRepository } from './event-repository.ts'
import { SqliteFilterPresetRepository } from './filter-preset-repository.ts'
import { SqliteLaneRepository } from './lane-repository.ts'
import { SqliteLocationRepository } from './location-repository.ts'
import { SqlitePolicyRepository } from './policy-repository.ts'
import { SqliteServiceTokenRepository } from './service-token-repository.ts'
import { SqliteSessionRepository } from './session-repository.ts'
import { SqliteTagRepository } from './tag-repository.ts'
import { SqliteUserAccountRepository } from './user-account-repository.ts'
import { SqliteUserRepository } from './user-repository.ts'

/**
 * All repository adapters over the one shared connection. Handed to unit-of-
 * work callbacks as the only way to touch the database — every statement they
 * issue runs inside whatever transaction is open on that connection.
 */
export function createTransactionContext(db: BetterSQLite3Database): TransactionContext {
  return {
    cards: new SqliteCardRepository(db),
    comments: new SqliteCommentRepository(db),
    attachments: new SqliteAttachmentRepository(db),
    users: new SqliteUserRepository(db),
    userAccounts: new SqliteUserAccountRepository(db),
    sessions: new SqliteSessionRepository(db),
    serviceTokens: new SqliteServiceTokenRepository(db),
    lanes: new SqliteLaneRepository(db),
    locations: new SqliteLocationRepository(db),
    tags: new SqliteTagRepository(db),
    policies: new SqlitePolicyRepository(db),
    events: new SqliteEventRepository(db),
    filterPresets: new SqliteFilterPresetRepository(db),
  }
}
