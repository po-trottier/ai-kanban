import { type APIRequestContext } from '@playwright/test'
import { DEMO_PASSWORD, demoEmail } from './constants.ts'

/**
 * REST-driven per-test arrangement (docs/dev/testing.md: e2e never arranges
 * state through the UI — the behavior under test and all assertions go
 * through the browser). Every helper talks to the real server through a
 * Playwright request context; browser contexts share their cookie jar with
 * `context.request`, so a login here authenticates the pages too.
 */

async function ensureOk(response: {
  ok(): boolean
  status(): number
  text(): Promise<string>
}): Promise<void> {
  if (response.ok()) return
  throw new Error(`request failed (${String(response.status())}): ${await response.text()}`)
}

export async function apiLogin(
  request: APIRequestContext,
  email: string = demoEmail('admin'),
  password: string = DEMO_PASSWORD,
): Promise<void> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } })
  await ensureOk(response)
}

export interface ApiCard {
  id: string
  version: number
  title: string
}

/** `POST /cards` — new cards land in Intake. */
export async function createCard(
  request: APIRequestContext,
  title: string,
  extras: Record<string, unknown> = {},
): Promise<ApiCard> {
  const response = await request.post('/api/v1/cards', { data: { title, ...extras } })
  await ensureOk(response)
  return (await response.json()) as ApiCard
}

/** `PATCH /cards/:id` with the If-Match version; returns the fresh card. */
export async function patchCard(
  request: APIRequestContext,
  card: ApiCard,
  changes: Record<string, unknown>,
): Promise<ApiCard> {
  const response = await request.patch(`/api/v1/cards/${card.id}`, {
    headers: { 'if-match': `"${String(card.version)}"` },
    data: changes,
  })
  await ensureOk(response)
  return (await response.json()) as ApiCard
}

/** `POST /cards/:id/cancel` — lands at the end of Done with a resolution. */
export async function cancelCard(
  request: APIRequestContext,
  card: ApiCard,
  resolution: 'cancelled' | 'declined' | 'duplicate' = 'cancelled',
): Promise<ApiCard> {
  const response = await request.post(`/api/v1/cards/${card.id}/cancel`, {
    headers: { 'if-match': `"${String(card.version)}"` },
    data: { resolution },
  })
  await ensureOk(response)
  return (await response.json()) as ApiCard
}

export interface CreatedUser {
  user: { id: string; email: string; displayName: string }
  tempPassword: string
}

/** `POST /users` (admin session required) — returns the one-time password. */
export async function createUser(
  request: APIRequestContext,
  input: { email: string; displayName: string; role: string },
): Promise<CreatedUser> {
  const response = await request.post('/api/v1/users', { data: input })
  await ensureOk(response)
  return (await response.json()) as CreatedUser
}

/** Flips workflow enforcement on the active policy (admin session required). */
export async function setTransitionEnforcement(
  request: APIRequestContext,
  enabled: boolean,
): Promise<void> {
  const current = await request.get('/api/v1/policy')
  await ensureOk(current)
  const record = (await current.json()) as { config: Record<string, unknown> }
  const response = await request.put('/api/v1/policy', {
    data: { ...record.config, transitionEnforcement: enabled },
  })
  await ensureOk(response)
}

/** A real 1×1 PNG (same bytes the server integration fixtures use). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
