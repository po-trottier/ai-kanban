import { type TransactionContext } from '@rivian-kanban/core'

/** Revoke browser and delegated credentials in the account change's transaction. */
export async function revokeUserCredentials(
  tx: TransactionContext,
  userId: string,
  keepSessionHash?: string,
): Promise<void> {
  await tx.sessions.revokeOthersForUser(userId, keepSessionHash)
  await tx.oauthAuthorizationCodes.revokeForUser(userId)
  await tx.oauthAccessTokens.revokeForUser(userId)
  await tx.oauthRefreshTokens.revokeForUser(userId)
}
