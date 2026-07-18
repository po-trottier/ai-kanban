import { describe, expect, it } from 'vitest'
import { type Role } from '../domain/constants.ts'
import { type Actor } from '../domain/entities.ts'
import { DEFAULT_POLICY_DOCUMENT, type PolicyDocument } from '../domain/policy.ts'
import { evaluatePolicy } from './policy-engine.ts'

const USER_ID = '10000000-0000-7000-8000-000000000001'
const OTHER_ID = '10000000-0000-7000-8000-000000000002'

function userOf(role: Role, id = USER_ID): Actor {
  return { kind: 'user', id, role }
}

function enforced(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return { ...DEFAULT_POLICY_DOCUMENT, transitionEnforcement: true, ...overrides }
}

describe('evaluatePolicy — permissive default posture', () => {
  it('lets any authenticated user move any card to any lane', () => {
    // Arrange
    const actor = userOf('user')

    // Act
    const decision = evaluatePolicy(
      actor,
      { type: 'card.move', fromLane: 'intake', toLane: 'done' },
      DEFAULT_POLICY_DOCUMENT,
    )

    // Assert
    expect(decision).toEqual({ allowed: true })
  })

  it('lets any authenticated user cancel, reopen, and reorder ready when no gates are set', () => {
    // Arrange
    const actor = userOf('user')

    // Act
    const cancel = evaluatePolicy(actor, { type: 'card.cancel' }, DEFAULT_POLICY_DOCUMENT)
    const reopen = evaluatePolicy(actor, { type: 'card.reopen' }, DEFAULT_POLICY_DOCUMENT)
    const reorder = evaluatePolicy(
      actor,
      { type: 'card.reorder', lane: 'ready' },
      DEFAULT_POLICY_DOCUMENT,
    )

    // Assert
    expect(cancel).toEqual({ allowed: true })
    expect(reopen).toEqual({ allowed: true })
    expect(reorder).toEqual({ allowed: true })
  })

  it('lets a non-author delete another comment when the gate is absent', () => {
    // Arrange
    const actor = userOf('user')

    // Act
    const decision = evaluatePolicy(
      actor,
      { type: 'comment.delete', authorId: OTHER_ID },
      DEFAULT_POLICY_DOCUMENT,
    )

    // Assert
    expect(decision).toEqual({ allowed: true })
  })
})

describe('evaluatePolicy — always-on identity rules', () => {
  it('denies every mutation to a read-scope token regardless of policy', () => {
    // Arrange
    const readToken: Actor = { kind: 'mcp', id: USER_ID, role: 'admin', scope: 'read' }

    // Act
    const update = evaluatePolicy(readToken, { type: 'card.update' }, DEFAULT_POLICY_DOCUMENT)
    const comment = evaluatePolicy(readToken, { type: 'comment.add' }, DEFAULT_POLICY_DOCUMENT)
    const admin = evaluatePolicy(readToken, { type: 'admin' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(update).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
    expect(comment).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
    expect(admin).toEqual({ allowed: false, kind: 'denied', rule: 'token-scope-read' })
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

  it('restricts the admin surface to the admin role, always', () => {
    // Arrange
    const admin = userOf('admin')
    const user = userOf('user')

    // Act
    const allowed = evaluatePolicy(admin, { type: 'admin' }, DEFAULT_POLICY_DOCUMENT)
    const deniedDecision = evaluatePolicy(user, { type: 'admin' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(allowed).toEqual({ allowed: true })
    expect(deniedDecision).toEqual({ allowed: false, kind: 'denied', rule: 'admin-only' })
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
    const admin = evaluatePolicy(system, { type: 'admin' }, DEFAULT_POLICY_DOCUMENT)

    // Assert
    expect(move).toEqual({ allowed: true })
    expect(admin).toEqual({ allowed: true })
  })
})

describe('evaluatePolicy — action gates', () => {
  it('applies the cancel gate by minimum role, exempt from the transition graph', () => {
    // Arrange
    const policy = enforced({ actionGates: { cancel: 'admin' } })

    // Act
    const user = evaluatePolicy(userOf('user'), { type: 'card.cancel' }, policy)
    const admin = evaluatePolicy(userOf('admin'), { type: 'card.cancel' }, policy)

    // Assert
    expect(user).toEqual({ allowed: false, kind: 'denied', rule: 'actionGates.cancel' })
    expect(admin).toEqual({ allowed: true })
  })

  it('gates reordering of the ready lane only', () => {
    // Arrange
    const policy: PolicyDocument = {
      ...DEFAULT_POLICY_DOCUMENT,
      actionGates: { reorderReady: 'admin' },
    }

    // Act
    const readyDenied = evaluatePolicy(
      userOf('user'),
      { type: 'card.reorder', lane: 'ready' },
      policy,
    )
    const readyAllowed = evaluatePolicy(
      userOf('admin'),
      { type: 'card.reorder', lane: 'ready' },
      policy,
    )
    const otherLane = evaluatePolicy(
      userOf('user'),
      { type: 'card.reorder', lane: 'in_progress' },
      policy,
    )

    // Assert
    expect(readyDenied).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'actionGates.reorderReady',
    })
    expect(readyAllowed).toEqual({ allowed: true })
    expect(otherLane).toEqual({ allowed: true })
  })

  it('applies the reopen gate with enforcement off, independent of the graph', () => {
    // Arrange
    const policy: PolicyDocument = {
      ...DEFAULT_POLICY_DOCUMENT,
      actionGates: { reopen: 'admin' },
    }

    // Act
    const user = evaluatePolicy(userOf('user'), { type: 'card.reopen' }, policy)
    const admin = evaluatePolicy(userOf('admin'), { type: 'card.reopen' }, policy)

    // Assert
    expect(user).toEqual({ allowed: false, kind: 'denied', rule: 'actionGates.reopen' })
    expect(admin).toEqual({ allowed: true })
  })

  it('gates deleting others’ comments but never the author’s own', () => {
    // Arrange
    const policy: PolicyDocument = {
      ...DEFAULT_POLICY_DOCUMENT,
      actionGates: { deleteOthersComments: 'admin' },
    }

    // Act
    const foreignDenied = evaluatePolicy(
      userOf('user'),
      { type: 'comment.delete', authorId: OTHER_ID },
      policy,
    )
    const foreignAllowed = evaluatePolicy(
      userOf('admin'),
      { type: 'comment.delete', authorId: OTHER_ID },
      policy,
    )
    const own = evaluatePolicy(
      userOf('user'),
      { type: 'comment.delete', authorId: USER_ID },
      policy,
    )

    // Assert
    expect(foreignDenied).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'actionGates.deleteOthersComments',
    })
    expect(foreignAllowed).toEqual({ allowed: true })
    expect(own).toEqual({ allowed: true })
  })

  it('gates deleting others’ attachments but never the uploader’s own', () => {
    // Arrange
    const policy: PolicyDocument = {
      ...DEFAULT_POLICY_DOCUMENT,
      actionGates: { deleteOthersAttachments: 'admin' },
    }

    // Act
    const foreign = evaluatePolicy(
      userOf('user'),
      { type: 'attachment.remove', uploaderId: OTHER_ID },
      policy,
    )
    const own = evaluatePolicy(
      userOf('user'),
      { type: 'attachment.remove', uploaderId: USER_ID },
      policy,
    )

    // Assert
    expect(foreign).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'actionGates.deleteOthersAttachments',
    })
    expect(own).toEqual({ allowed: true })
  })
})

describe('evaluatePolicy — transition enforcement on', () => {
  it('allows an ungated edge of the seeded graph to any role', () => {
    // Arrange
    const policy = enforced()

    // Act
    const decision = evaluatePolicy(
      userOf('user'),
      { type: 'card.move', fromLane: 'intake', toLane: 'waiting_approval' },
      policy,
    )

    // Assert
    expect(decision).toEqual({ allowed: true })
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

  it('applies the per-edge minRole gate (approval requires admin)', () => {
    // Arrange
    const policy = enforced()

    // Act
    const user = evaluatePolicy(
      userOf('user'),
      { type: 'card.move', fromLane: 'waiting_approval', toLane: 'ready' },
      policy,
    )
    const admin = evaluatePolicy(
      userOf('admin'),
      { type: 'card.move', fromLane: 'waiting_approval', toLane: 'ready' },
      policy,
    )

    // Assert
    expect(user).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'transition:waiting_approval->ready',
    })
    expect(admin).toEqual({ allowed: true })
  })

  it('subjects reopen to the done→ready edge gate', () => {
    // Arrange
    const policy = enforced()

    // Act
    const user = evaluatePolicy(userOf('user'), { type: 'card.reopen' }, policy)
    const admin = evaluatePolicy(userOf('admin'), { type: 'card.reopen' }, policy)

    // Assert
    expect(user).toEqual({
      allowed: false,
      kind: 'denied',
      rule: 'transition:done->ready',
    })
    expect(admin).toEqual({ allowed: true })
  })

  it('treats reopen as illegal when the graph has no done→ready edge', () => {
    // Arrange
    const policy = enforced({
      transitions: DEFAULT_POLICY_DOCUMENT.transitions.filter(
        (edge) => !(edge.from === 'done' && edge.to === 'ready'),
      ),
    })

    // Act
    const decision = evaluatePolicy(userOf('admin'), { type: 'card.reopen' }, policy)

    // Assert
    expect(decision).toEqual({
      allowed: false,
      kind: 'illegal-transition',
      from: 'done',
      to: 'ready',
    })
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
