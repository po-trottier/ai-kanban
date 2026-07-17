import { getTableConfig, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  attachments,
  boardPolicies,
  boards,
  cardEvents,
  cardTags,
  cards,
  comments,
  lanes,
  locations,
  serviceTokens,
  sessions,
  tags,
  users,
} from './schema.ts'

/**
 * Schema contract tests: the Drizzle table definitions must mirror
 * docs/architecture/data-model.md exactly — snake_case columns, the
 * documented indexes and FKs, and conservative column types only (ADR-003).
 */

const ALL_TABLES: readonly AnySQLiteTable[] = [
  users,
  boards,
  lanes,
  locations,
  boardPolicies,
  cards,
  tags,
  cardTags,
  comments,
  attachments,
  cardEvents,
  sessions,
  serviceTokens,
]

function columnNames(table: AnySQLiteTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name)
}

function indexSummaries(table: AnySQLiteTable): string[] {
  return getTableConfig(table).indexes.map((index) => {
    const config = index.config
    const columns = config.columns.map((column) => (column as { name: string }).name).join(', ')
    const partial = config.where === undefined ? '' : ' PARTIAL'
    return `${config.name}${config.unique ? ' UNIQUE' : ''} (${columns})${partial}`
  })
}

function foreignKeySummaries(table: AnySQLiteTable): string[] {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference()
    const from = reference.columns.map((column) => column.name).join(', ')
    const toTable = getTableConfig(reference.foreignTable).name
    const to = reference.foreignColumns.map((column) => column.name).join(', ')
    return `${from} -> ${toTable}(${to})`
  })
}

describe('schema contract (data-model.md)', () => {
  it('uses conservative column types only: TEXT and INTEGER (ADR-003 portability)', () => {
    // Arrange
    const allowed = new Set(['text', 'integer', 'text COLLATE NOCASE'])

    // Act
    const offending = ALL_TABLES.flatMap((table) =>
      getTableConfig(table)
        .columns.filter((column) => !allowed.has(column.getSQLType()))
        .map((column) => `${getTableConfig(table).name}.${column.name}`),
    )

    // Assert
    expect(offending).toEqual([])
  })

  it('maps the cards entity to the exact documented snake_case columns', () => {
    // Arrange — the columns of data-model.md#cards, in definition order
    const documented = [
      'id',
      'board_id',
      'lane_id',
      'position',
      'title',
      'description',
      'priority',
      'estimate_minutes',
      'reporter_id',
      'assignee_id',
      'location_id',
      'origin',
      'resolution',
      'blocked',
      'blocked_reason',
      'blocked_at',
      'waiting_reason',
      'expected_resume_at',
      'resume_alerted_at',
      'work_started_at',
      'slack_channel_id',
      'slack_thread_ts',
      'slack_permalink',
      'version',
      'created_at',
      'updated_at',
      'archived_at',
    ]

    // Act
    const actual = columnNames(cards)

    // Assert
    expect(actual).toEqual(documented)
  })

  it('declares users and service_tokens with their security-relevant columns', () => {
    // Arrange
    const userColumns = columnNames(users)
    const tokenColumns = columnNames(serviceTokens)

    // Act
    const hasAll =
      ['must_change_password', 'password_hash', 'is_active', 'slack_user_id'].every((column) =>
        userColumns.includes(column),
      ) && ['token_hash', 'role', 'scope', 'revoked_at'].every((c) => tokenColumns.includes(c))

    // Assert
    expect(hasAll).toBe(true)
  })

  it('creates exactly the documented indexes', () => {
    // Arrange
    const tablesWithIndexes = {
      cards,
      cardEvents,
      comments,
      attachments,
      boardPolicies,
      lanes,
      serviceTokens,
    }

    // Act
    const summaries = Object.fromEntries(
      Object.entries(tablesWithIndexes).map(([name, table]) => [name, indexSummaries(table)]),
    )

    // Assert
    expect(summaries).toEqual({
      cards: [
        'cards_lane_id_position_unique UNIQUE (lane_id, position)',
        'cards_board_id_archived_at_idx (board_id, archived_at)',
        'cards_assignee_id_idx (assignee_id)',
        'cards_reporter_id_idx (reporter_id)',
        // Supports the newest-first keyset list query (O(page) per request).
        'cards_created_at_id_idx (created_at, id)',
        // Partial (live rows only): activeOnly lane reads skip the archive.
        'cards_lane_active_position_idx (lane_id, position) PARTIAL',
        // Partial (live blocked rows): the stale-cards blocked leg.
        'cards_blocked_active_idx (created_at, id) PARTIAL',
      ],
      cardEvents: ['card_events_card_id_created_at_idx (card_id, created_at)'],
      comments: ['comments_card_id_created_at_idx (card_id, created_at)'],
      attachments: ['attachments_card_id_idx (card_id)'],
      boardPolicies: ['board_policies_board_id_created_at_idx (board_id, created_at)'],
      lanes: [],
      // Credential-hash uniqueness is a schema invariant (like users email).
      serviceTokens: ['service_tokens_token_hash_unique UNIQUE (token_hash)'],
    })
  })

  it('declares every documented foreign key, and none where actors may be tokens', () => {
    // Arrange
    const expectations: Record<string, string[]> = {
      users: [],
      boards: [],
      lanes: ['board_id -> boards(id)'],
      locations: ['parent_id -> locations(id)'],
      board_policies: ['board_id -> boards(id)', 'created_by -> users(id)'],
      cards: [
        'board_id -> boards(id)',
        'lane_id -> lanes(id)',
        'reporter_id -> users(id)',
        'assignee_id -> users(id)',
        'location_id -> locations(id)',
      ],
      tags: [],
      card_tags: ['card_id -> cards(id)', 'tag_id -> tags(id)'],
      comments: [
        'card_id -> cards(id)',
        'parent_comment_id -> comments(id)',
        'author_id -> users(id)',
      ],
      attachments: ['card_id -> cards(id)', 'uploaded_by -> users(id)'],
      // actor_id is deliberately FK-free: it may hold a service-token id.
      card_events: ['card_id -> cards(id)'],
      sessions: ['user_id -> users(id)'],
      service_tokens: ['created_by -> users(id)'],
    }

    // Act
    const actual = Object.fromEntries(
      ALL_TABLES.map((table) => [getTableConfig(table).name, foreignKeySummaries(table)]),
    )

    // Assert
    expect(actual).toEqual(expectations)
  })

  it('gives tags.name case-insensitive collation with a unique constraint', () => {
    // Arrange
    const nameColumn = getTableConfig(tags).columns.find((column) => column.name === 'name')

    // Act
    const sqlType = nameColumn?.getSQLType()

    // Assert
    expect(sqlType).toBe('text COLLATE NOCASE')
    expect(nameColumn?.isUnique).toBe(true)
  })

  it('keys card_tags on the composite (card_id, tag_id) primary key', () => {
    // Arrange
    const config = getTableConfig(cardTags)

    // Act
    const primaryKey = config.primaryKeys.map((pk) => pk.columns.map((c) => c.name).join(', '))

    // Assert
    expect(primaryKey).toEqual(['card_id, tag_id'])
  })

  it('enforces UNIQUE(board_id, key) on lanes and UNIQUE email on users', () => {
    // Arrange
    const laneUniques = getTableConfig(lanes).uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name).join(', '),
    )
    const emailColumn = getTableConfig(users).columns.find((column) => column.name === 'email')

    // Act
    const laneKeyUnique = laneUniques.includes('board_id, key')

    // Assert
    expect(laneKeyUnique).toBe(true)
    expect(emailColumn?.isUnique).toBe(true)
  })
})
