import { type UnitOfWork, type User } from '@rivian-kanban/core'
import { type WebClient } from '@slack/web-api'
import { type AdapterLogger } from '../types.ts'
import { type SlackContext } from './context.ts'

/**
 * Sticky identity mapping (docs/architecture/slack.md#identity-mapping): the
 * acting Slack user resolves to a board user by verified email exactly once;
 * the binding is persisted on `users.slack_user_id` and logged, and every
 * later event matches on the stored id — never re-resolved by email (guards
 * against corporate email reassignment). Inactive users are rejected the same
 * way as unknown ones.
 */
export async function resolveSlackUser(
  ctx: SlackContext,
  client: WebClient,
  slackUserId: string,
): Promise<User | null> {
  const bound = await ctx.uow.run((tx) => tx.userAccounts.findBySlackUserId(slackUserId))
  if (bound !== null) {
    return bound.user.isActive ? bound.user : null
  }

  const email = await slackEmailOf(client, slackUserId)
  if (email === null) return null

  const byEmail = await ctx.uow.run((tx) => tx.userAccounts.findByEmail(email))
  if (byEmail?.user.isActive !== true) return null

  return bindSlackIdentity(ctx.uow, ctx.logger, byEmail.user, slackUserId)
}

/**
 * Persists the one-time Slack binding — the single write path shared by the
 * inbound resolver and the outbound notifier. Refuses to rebind a board user
 * already bound to a *different* Slack id: a reassigned corporate email must
 * not let a new Slack account act as the old user's board identity (the
 * threat #identity-mapping names). The caller falls back to the friendly
 * ask-an-admin path; an admin clears a stale binding deliberately.
 */
export async function bindSlackIdentity(
  uow: UnitOfWork,
  logger: AdapterLogger,
  user: User,
  slackUserId: string,
): Promise<User | null> {
  if (user.slackUserId !== null && user.slackUserId !== slackUserId) {
    logger.warn(
      { slackUserId, userId: user.id },
      'slack identity rebind refused: user already bound',
    )
    return null
  }
  const bound: User = { ...user, slackUserId }
  await uow.run((tx) => tx.userAccounts.update(bound))
  logger.info({ slackUserId, userId: user.id }, 'slack identity bound')
  return bound
}

/** users.info profile email (users:read.email); null on any lookup failure. */
async function slackEmailOf(client: WebClient, slackUserId: string): Promise<string | null> {
  try {
    const response = await client.users.info({ user: slackUserId })
    return response.user?.profile?.email ?? null
  } catch {
    // WebClient throws on ok:false (e.g. user_not_found) — treat as unmatched.
    return null
  }
}
