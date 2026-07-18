import { describe, expect, it } from 'vitest'
import { type Actor } from '../domain/entities.ts'
import { DEFAULT_POLICY_DOCUMENT, type Permission, type PolicyDocument } from '../domain/policy.ts'
import { evaluatePolicy } from './policy-engine.ts'

const USER_ID = '10000000-0000-7000-8000-000000000001'
const OTHER_ID = '10000000-0000-7000-8000-000000000002'

function userOf(role: string, id = USER_ID): Actor {
  return { kind: 'user', id, role }
}

function enforced(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true, ...overrides }
}

/** A policy whose single `user` role grants exactly the listed permissions. */
function withUserPerms(...perms: Permission[]): PolicyDocument {
  return {
    ...DEFAULT_POLICY_DOCUMENT,
    roles: [
      { key: 'user', name: 'User', permissions: Object.fromEntries(perms.map((p) => [p, true])) },
      ...DEFAULT_POLICY_DOCUMENT.roles.filter((role) => role.key !== 'user'),
    ],
  }
}

describe('evaluatePolicy — grant lookup (default-deny)', () => {
  it('ALLOWs when the actor’s role grants the permission', () => {
    // Arrange — default `user` role grants card.create/update/move/etc.
    const actor = userOf('user')

    // Act
    const create = evaluatePolicy(actor, { type: 'card.create' }, DEFAULT_POLICY_DOCUMENT)
    const update = evaluatePolicy(actor, { type: 'card.update' }, DEFAULT_POLICY_DOCUMENT)
    const move = evaluatePolicy(
      actor,
      { type: 'card.move', fromLane: 'intake', toLane: 'done' },
      DEFAULT_POLICY_DOCUMENT,
    )
    const cancel = evaluatePolicy(actor, { type: 'card.cancel' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(create).toEqual({ allowed: true })
    expect(update).toEqual({ allowed: true })
    expect(move).toEqual({ allowed: true })
    expect(cancel).toEqual({ allowed: true })
  })

  it('DENIEs, naming permission:<perm>, when the role omits the grant', () => {
    // Arrange — a role stripped of card.update
    const policy = withUserPerms('card.create')

    // Act
    const decision = evaluatePolicy(userOf('user'), { type: 'card.update' }, policy)

    // Assert
    expect(decision).toEqual({ allowed: false, kind: 'denied', rule: 'permission:card.update' })
  })

  it('DENIEs an unknown role key entirely (default-deny)', () => {
    // Arrange — no `ghost` role is defined in the default policy.
    const actor = userOf('ghost')

    // Act
    const decision = evaluatePolicy(actor, { type: 'card.create' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(decision).toEqual({ allowed: false, kind: 'denied', rule: 'permission:card.create' })
  })

  it('grants the manage* surfaces to admin, denies them to user by default', () => {
    // Arrange
    const admin = userOf('admin')
    const user = userOf('user')

    // Act
    const adminUsers = evaluatePolicy(admin, { type: 'manageUsers' }, DEFAULT_POLICY_DOCUMENT)
    const userUsers = evaluatePolicy(user, { type: 'manageUsers' }, DEFAULT_POLICY_DOCUMENT)
    const adminRoles = evaluatePolicy(admin, { type: 'manageRoles' }, DEFAULT_POLICY_DOCUMENT)
    const userPolicy = evaluatePolicy(user, { type: 'managePolicy' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(adminUsers).toEqual({ allowed: true })
    expect(adminRoles).toEqual({ allowed: true })
    expect(userUsers).toEqual({ allowed: false, kind: 'denied', rule: 'permission:manageUsers' })
    expect(userPolicy).toEqual({ allowed: false, kind: 'denied', rule: 'permission:managePolicy' })
  })
})

describe('evaluatePolicy — always-on identity rules (UNCHANGED)', () => {
  it('denies every mutation to a read-scope token regardless of policy', () => {
    // Arrange — an admin-role read token must still be denied all writes.
    const readToken: Actor = { kind: 'mcp', id: USER_ID, role: 'admin', scope: 'read' }

    // Act
    const update = evaluatePolicy(readToken, { type: 'card.update' }, DEFAULT_POLICY_DOCUMENT)
    const comment = evaluatePolicy(readToken, { type: 'comment.add' }, DEFAULT_POLICY_DOCUMENT)
    const manage = evaluatePolicy(readToken, { type: 'manageUsers' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(update).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
    expect(comment).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
    expect(manage).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
  })

  it('lets a read_write token mutate under the permissive default', () => {
    // Arrange
    const writeToken: Actor = { kind: 'mcp', id: USER_ID, role: 'user', scope: 'read_write' }

    // Act
    const decision = evaluatePolicy(writeToken, { type: 'card.update' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(decision).toEqual({ allowed: true })
  })

  it('restricts comment editing to the author, even for admins', () => {
    // Arrange
    const author = userOf('user', USER_ID)
    const admin = userOf('admin', OTHER_ID)

    // Act
    const own = evaluatePolicy(
      author,
      { type: 'comment.edit', authorId: USER_ID },
      DEFAULT_POLICY_DOCUMENT,
    )
    const foreign = evaluatePolicy(
      admin,
      { type: 'comment.edit', authorId: USER_ID },
      DEFAULT_POLICY_DOCUMENT,
    )

    // Assert
    expect(own).toEqual({ allowed: true })
    expect(foreign).toEqual({ allowed: false, kind: 'denied', rule: 'comment-author-only' })
  })

  it('lets the system actor do anything (scheduled jobs)', () => {
    // Arrange
    const system: Actor = { kind: 'system', id: USER_ID, role: 'admin' }

    // Act
    const move = evaluatePolicy(
      system,
      { type: 'card.move', fromLane: 'intake', toLane: 'done' },
      enforced(),
    )
    const manage = evaluatePolicy(system, { type: 'managePolicy' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(move).toEqual({ allowed: true })
    expect(manage).toEqual({ allowed: true })
  })
})

describe('evaluatePolicy — ownership beats a missing delete-others grant', () => {
  it('lets the author delete their own comment even when deleteOthers is absent', () => {
    // Arrange — `user` role has no comment.deleteOthers grant.
    const policy = withUserPerms('comment.add')

    // Act
    const own = evaluatePolicy(
      userOf('user'),
      { type: 'comment.delete', authorId: USER_ID },
      policy,
    )
    const foreign = evaluatePolicy(
      userOf('user'),
      { type: 'comment.delete', authorId: OTHER_ID },
      policy,
    )

    // Assert — own short-circuits; foreign hits default-deny.
    expect(own).toEqual({ allowed: true })
    expect(foreign).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'permission:comment.deleteOthers',
    })
  })

  it('grants deleting others’ comments/attachments when the permission is present', () => {
    // Arrange
    const policy = withUserPerms('comment.deleteOthers', 'attachment.deleteOthers')

    // Act
    const comment = evaluatePolicy(
      userOf('user'),
      { type: 'comment.delete', authorId: OTHER_ID },
      policy,
    )
    const attachment = evaluatePolicy(
      userOf('user'),
      { type: 'attachment.remove', uploaderId: OTHER_ID },
      policy,
    )

    // Assert
    expect(comment).toEqual({ allowed: true })
    expect(attachment).toEqual({ allowed: true })
  })

  it('lets the uploader remove their own attachment even without deleteOthers', () => {
    // Arrange
    const policy = withUserPerms()

    // Act
    const own = evaluatePolicy(
      userOf('user'),
      { type: 'attachment.remove', uploaderId: USER_ID },
      policy,
    )

    // Assert
    expect(own).toEqual({ allowed: true })
  })
})

describe('evaluatePolicy — transition enforcement (topology only, no per-edge role)', () => {
  it('allows any edge of the seeded graph to a role that has card.move', () => {
    // Arrange
    const policy = enforced()

    // Act — waiting_approval→ready no longer carries a minRole gate.
    const user = evaluatePolicy(
      userOf('user'),
      { type: 'card.move', fromLane: 'waiting_approval', toLane: 'ready' },
      policy,
    )

    // Assert
    expect(user).toEqual({ allowed: true })
  })

  it('rejects a move with no matching edge as an illegal transition', () => {
    // Arrange
    const policy = enforced()

    // Act
    const decision = evaluatePolicy(
      userOf('admin'),
      { type: 'card.move', fromLane: 'intake', toLane: 'ready' },
      policy,
    )

    // Assert
    expect(decision).toEqual({
      allowed: false,
      kind: 'illegal-transition',
      from: 'intake',
      to: 'ready',
    })
  })

  it('denies the move on a missing card.move grant BEFORE consulting topology', () => {
    // Arrange — role can’t move at all; a legal edge must still be denied.
    const policy = enforced({
      roles: [
        { key: 'user', name: 'User', permissions: { 'card.create': true } },
        ...DEFAULT_POLICY_DOCUMENT.roles.filter((role) => role.key !== 'user'),
      ],
    })

    // Act
    const decision = evaluatePolicy(
      userOf('user'),
      { type: 'card.move', fromLane: 'intake', toLane: 'waiting_approval' },
      policy,
    )

    // Assert
    expect(decision).toEqual({ allowed: false, kind: 'denied', rule: 'permission:card.move' })
  })

  it('leaves same-lane reorders outside the transition graph', () => {
    // Arrange
    const policy = enforced()

    // Act
    const decision = evaluatePolicy(
      userOf('user'),
      { type: 'card.reorder', lane: 'in_progress' },
      policy,
    )

    // Assert
    expect(decision).toEqual({ allowed: true })
  })
})
