import { type TransactionContext } from '@rivian-kanban/core'
import { type PgDb } from './database.ts'
import { PgAttachmentRepository } from './repositories/attachment-repository.ts'
import { PgCardRelationRepository } from './repositories/card-relation-repository.ts'
import { PgCardRepository } from './repositories/card-repository.ts'
import { PgCardWatcherRepository } from './repositories/card-watcher-repository.ts'
import { PgCommentRepository } from './repositories/comment-repository.ts'
import { PgEventRepository } from './repositories/event-repository.ts'
import { PgFilterPresetRepository } from './repositories/filter-preset-repository.ts'
import { PgLaneRepository } from './repositories/lane-repository.ts'
import { PgLocationRepository } from './repositories/location-repository.ts'
import { PgNotificationRepository } from './repositories/notification-repository.ts'
import { PgPolicyRepository } from './repositories/policy-repository.ts'
import { PgServiceTokenRepository } from './repositories/service-token-repository.ts'
import { PgSessionRepository } from './repositories/session-repository.ts'
import { PgTagRepository } from './repositories/tag-repository.ts'
import { PgUserAccountRepository } from './repositories/user-account-repository.ts'
import { PgUserRepository } from './repositories/user-repository.ts'

/**
 * All pg repository adapters over one database handle (the pooled db or an open
 * transaction). The Postgres analogue of `repositories/transaction-context.ts`
 * — same TransactionContext port, different driver.
 */
export function createPgTransactionContext(db: PgDb): TransactionContext {
  return {
    cards: new PgCardRepository(db),
    comments: new PgCommentRepository(db),
    attachments: new PgAttachmentRepository(db),
    users: new PgUserRepository(db),
    userAccounts: new PgUserAccountRepository(db),
    sessions: new PgSessionRepository(db),
    serviceTokens: new PgServiceTokenRepository(db),
    lanes: new PgLaneRepository(db),
    locations: new PgLocationRepository(db),
    tags: new PgTagRepository(db),
    policies: new PgPolicyRepository(db),
    events: new PgEventRepository(db),
    filterPresets: new PgFilterPresetRepository(db),
    cardRelations: new PgCardRelationRepository(db),
    cardWatchers: new PgCardWatcherRepository(db),
    notifications: new PgNotificationRepository(db),
  }
}
