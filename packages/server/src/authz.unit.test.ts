import {
  DEFAULT_POLICY_DOCUMENT,
  NotFoundError,
  type BoardPolicy,
  type TransactionContext,
} from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { loadActivePolicy, manageUsersRoleKeys, roleExists } from './authz.ts'

const BOARD_ID = '10000000-0000-7000-8000-000000000001'

/** A transaction whose only used capability is `policies.getActive`. */
function txReturning(active: BoardPolicy | null): TransactionContext {
  return {
    policies: { getActive: () => Promise.resolve(active) },
  } as unknown as TransactionContext
}

describe('loadActivePolicy', () => {
  it('returns the active policy document', async () => {
    // Arrange
    const record: BoardPolicy = {
      id: BOARD_ID,
      boardId: BOARD_ID,
      config: DEFAULT_POLICY_DOCUMENT,
      createdBy: BOARD_ID,
      createdAt: '2026-07-16T12:00:00.000Z',
    }
    // Act
    const policy = await loadActivePolicy(txReturning(record), BOARD_ID)
    // Assert
    expect(policy).toBe(DEFAULT_POLICY_DOCUMENT)
  })

  it('throws NotFoundError when no policy is seeded (boot invariant — never permissive)', async () => {
    // Arrange
    const tx = txReturning(null)
    // Act
    const act = loadActivePolicy(tx, BOARD_ID)
    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('roleExists', () => {
  it('is true for a defined role key and false for an unknown one', () => {
    // Arrange
    const policy = DEFAULT_POLICY_DOCUMENT
    // Act
    const results = [roleExists(policy, 'user'), roleExists(policy, 'wizard')]
    // Assert
    expect(results).toEqual([true, false])
  })
})

describe('manageUsersRoleKeys', () => {
  it('returns only the roles that grant manageUsers (the admin-equivalent set)', () => {
    // Arrange
    const policy = DEFAULT_POLICY_DOCUMENT
    // Act
    const keys = manageUsersRoleKeys(policy)
    // Assert — the seeded Administrator grants it; the base User does not.
    expect(keys.has('admin')).toBe(true)
    expect(keys.has('user')).toBe(false)
  })
})
