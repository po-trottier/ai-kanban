import { DEFAULT_POLICY_DOCUMENT } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Both policy postures (ADR-013, docs/dev/testing.md): default-permissive —
 * anyone moves anywhere — and enforcement-on applied through the real
 * PUT /policy route, exercising 422 illegal transitions, per-edge minRole
 * gates, and action gates.
 */

let t: TestApp
let adminCookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie: adminCookie } = await t.asRole('admin'))
})

afterAll(async () => {
  await t.cleanup()
})

interface CardBody {
  id: string
  version: number
}

async function createCard(cookie: string, title: string): Promise<CardBody> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title },
  })
  return response.json<CardBody>()
}

function moveCard(
  cookie: string,
  card: CardBody,
  toLane: string,
  extra: Record<string, unknown> = {},
) {
  return t.request(cookie, {
    method: 'POST',
    url: `/api/v1/cards/${card.id}/move`,
    headers: { 'if-match': `"${String(card.version)}"` },
    payload: { toLane, ...extra },
  })
}

function putPolicy(document: Record<string, unknown>, cookie = adminCookie) {
  return t.request(cookie, { method: 'PUT', url: '/api/v1/policy', payload: document })
}

const ENFORCED_POLICY = {
  ...DEFAULT_POLICY_DOCUMENT,
  transitionEnforcement: true,
  actionGates: { cancel: 'supervisor', reopen: 'supervisor' },
} as const

const PERMISSIVE_POLICY = DEFAULT_POLICY_DOCUMENT as unknown as Record<string, unknown>

describe('GET /policy', () => {
  it('returns the seeded permissive document to any authenticated user', async () => {
    const { cookie } = await t.asRole('requester')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/policy' })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ config: { transitionEnforcement: boolean } }>()
    expect(body.config.transitionEnforcement).toBe(false)
  })
})

describe('PUT /policy', () => {
  it('is admin-only and validates the document', async () => {
    const tech = await t.asRole('technician')

    const denied = await putPolicy(PERMISSIVE_POLICY, tech.cookie)
    const invalid = await putPolicy({ transitionEnforcement: 'yes' })

    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('admin-only')
    expect(invalid.statusCode).toBe(400)
  })

  it('appends a new active version (history preserved, newest wins)', async () => {
    const before = await t.request(adminCookie, { method: 'GET', url: '/api/v1/policy' })

    const applied = await putPolicy({ ...ENFORCED_POLICY })
    expect(applied.statusCode).toBe(200)

    const after = await t.request(adminCookie, { method: 'GET', url: '/api/v1/policy' })
    expect(after.json<{ id: string }>().id).not.toBe(before.json<{ id: string }>().id)
    expect(
      after.json<{ config: { transitionEnforcement: boolean } }>().config.transitionEnforcement,
    ).toBe(true)

    // Restore the permissive default for the suites below.
    const restored = await putPolicy(PERMISSIVE_POLICY)
    expect(restored.statusCode).toBe(200)
  })
})

describe('default-permissive posture', () => {
  it('lets any authenticated user move any card anywhere and cancel', async () => {
    const requester = await t.asRole('requester')
    const card = await createCard(requester.cookie, 'Permissive move')

    const moved = await moveCard(requester.cookie, card, 'done')
    expect(moved.statusCode).toBe(200)

    const other = await createCard(requester.cookie, 'Permissive cancel')
    const cancelled = await t.request(requester.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${other.id}/cancel`,
      headers: { 'if-match': '"1"' },
      payload: { resolution: 'cancelled' },
    })
    expect(cancelled.statusCode).toBe(200)
  })
})

describe('enforcement-on posture', () => {
  beforeAll(async () => {
    const applied = await putPolicy({ ...ENFORCED_POLICY })
    if (applied.statusCode !== 200) throw new Error(applied.body)
  })

  it('422s a move with no edge in the workflow graph, naming from and to', async () => {
    const tech = await t.asRole('technician')
    const card = await createCard(tech.cookie, 'Illegal jump')

    const response = await moveCard(tech.cookie, card, 'done')

    expect(response.statusCode).toBe(422)
    expect(response.json<{ type: string; from: string; to: string }>()).toMatchObject({
      type: 'urn:rivian-kanban:problem:illegal-transition',
      from: 'intake',
      to: 'done',
    })
  })

  it('enforces per-edge minRole: technician denied, supervisor allowed', async () => {
    const tech = await t.asRole('technician')
    const supervisor = await t.asRole('supervisor')
    const card = await createCard(tech.cookie, 'Approval path')
    const staged = await moveCard(tech.cookie, card, 'waiting_approval')
    expect(staged.statusCode).toBe(200)
    const stagedCard = staged.json<CardBody>()

    const denied = await moveCard(tech.cookie, stagedCard, 'ready')
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('transition:waiting_approval->ready')

    const allowed = await moveCard(supervisor.cookie, stagedCard, 'ready')
    expect(allowed.statusCode).toBe(200)
  })

  it('enforces the cancel action gate', async () => {
    const requester = await t.asRole('requester')
    const supervisor = await t.asRole('supervisor')
    const card = await createCard(requester.cookie, 'Gated cancel')

    const denied = await t.request(requester.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/cancel`,
      headers: { 'if-match': '"1"' },
      payload: { resolution: 'cancelled' },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('actionGates.cancel')

    const allowed = await t.request(supervisor.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/cancel`,
      headers: { 'if-match': '"1"' },
      payload: { resolution: 'cancelled' },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('enforces the reopen action gate on the done→ready edge', async () => {
    const supervisor = await t.asRole('supervisor')
    const requester = await t.asRole('requester')
    const card = await createCard(supervisor.cookie, 'Gated reopen')
    const cancelled = await t.request(supervisor.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/cancel`,
      headers: { 'if-match': '"1"' },
      payload: { resolution: 'cancelled' },
    })
    const cancelledCard = cancelled.json<CardBody>()

    const denied = await t.request(requester.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/reopen`,
      headers: { 'if-match': `"${String(cancelledCard.version)}"` },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('actionGates.reopen')

    const allowed = await t.request(supervisor.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/reopen`,
      headers: { 'if-match': `"${String(cancelledCard.version)}"` },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('policy denials do not depend on card state: legal edges still work', async () => {
    const tech = await t.asRole('technician')
    const card = await createCard(tech.cookie, 'Legal edge')

    const response = await moveCard(tech.cookie, card, 'waiting_approval')

    expect(response.statusCode).toBe(200)
  })
})
