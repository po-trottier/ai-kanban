import { describe, expect, it, vi } from 'vitest'
import { FixedClock, InMemoryDb, userWith } from '@rivian-kanban/core/testing'
import { AuthService, mintSession } from './auth-service.ts'
import { LoginBackoff } from './backoff.ts'
import { PasswordHasher } from './password-hasher.ts'

describe('credential changes during password verification', () => {
  it.each(['login', 'change-password'])(
    'rejects stale credentials on %s after a concurrent reset',
    async (operation) => {
      // Arrange
      const db = new InMemoryDb()
      const clock = new FixedClock()
      const hasher = new PasswordHasher({ memoryCost: 2048, timeCost: 2, parallelism: 1 })
      const user = userWith({
        id: 'operator',
        email: 'operator@test.example',
        displayName: 'Operator',
        role: 'user',
        createdAt: clock.now().toISOString(),
      })
      const password = 'original-secure-password'
      const oldHash = await hasher.hash(password)
      const resetHash = await hasher.hash('administrator-reset-password')
      const { rawSessionId, session } = mintSession(user.id, clock.now())
      await db.run(async (tx) => {
        await tx.userAccounts.insert(user, oldHash)
        await tx.sessions.create(session)
      })
      const verify = hasher.verify.bind(hasher)
      vi.spyOn(hasher, 'verify').mockImplementation(async (hash, candidate) => {
        const verified = await verify(hash, candidate)
        // Deterministic interleaving: reset commits while the old hash is being verified.
        await db.run((tx) => tx.userAccounts.setPassword(user.id, resetHash, true))
        return verified
      })
      const auth = new AuthService({ uow: db, clock, hasher, backoff: new LoginBackoff(clock) })

      // Act
      const attempt =
        operation === 'login'
          ? auth.login(user.email, password)
          : auth.changePassword(user.id, rawSessionId, password, 'attacker-chosen-password')

      // Assert
      await expect(attempt).rejects.toThrow()
      expect((await db.read((tx) => tx.userAccounts.findById(user.id)))?.passwordHash).toBe(
        resetHash,
      )
    },
  )
})
