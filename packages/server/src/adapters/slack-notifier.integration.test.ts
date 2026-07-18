import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { runWaitingAgingAlerts } from '../jobs/waiting-aging-alerts.ts'
import { startSlackFixture, type SlackFixture } from '../test/slack.ts'
import { createTestApp, rawCard, type TestApp } from '../test/support.ts'

/**
 * SlackNotifier through the REAL service flow (docs/architecture/slack.md
 * #notifications-outbound): the same createTestApp boot, with SLACK_ENABLED
 * env pointing the notifier's WebClient at a local fixture server. A card is
 * driven review→done over REST; completion must DM the requester. Unmatched
 * requesters are logged and skipped — never an error surfaced to the mover.
 * Completion DMs are fire-and-forget off the mutation path (the move response
 * never waits on Slack), so the tests poll the fixture for delivery.
 */

let t: TestApp
let slack: SlackFixture

afterEach(async () => {
  await t.cleanup()
  await slack.close()
})

async function bootWithSlack(
  slackOverrides: Parameters<typeof startSlackFixture>[0] = {},
): Promise<void> {
  slack = await startSlackFixture(slackOverrides)
  t = await createTestApp({
    env: {
      SLACK_ENABLED: 'true',
      SLACK_BOT_TOKEN: 'xoxb-fixture-token',
      SLACK_APP_TOKEN: 'xapp-fixture-token',
      SLACK_TEAM_ID: 'T0TEST',
    },
    slackApiUrl: slack.url,
  })
}

interface CardBody {
  id: string
  title: string
  version: number
}

async function createCard(cookie: string, title: string): Promise<CardBody> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title },
  })
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`)
  return response.json<CardBody>()
}

async function moveCard(
  cookie: string,
  cardId: string,
  toLane: string,
  version: number,
  neighbors: Record<string, string> = {},
): Promise<CardBody> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: `/api/v1/cards/${cardId}/move`,
    headers: { 'if-match': `"${String(version)}"` },
    payload: { toLane, ...neighbors },
  })
  if (response.statusCode !== 200) throw new Error(`move failed: ${response.body}`)
  return response.json<CardBody>()
}

describe('SlackNotifier (review→done completion DMs)', () => {
  it('DMs the requester on completion, binding their Slack id once', async () => {
    await bootWithSlack()
    const requester = await t.asRole('user')
    const supervisor = await t.asRole('admin')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const card = await createCard(requester.cookie, 'Compressor leaking in bay 4')
    const inReview = await moveCard(supervisor.cookie, card.id, 'review', card.version)
    await moveCard(supervisor.cookie, card.id, 'done', inReview.version)

    // The DM is fire-and-forget off the move response — poll for delivery.
    await expect.poll(() => slack.callsTo('chat.postMessage').length).toBe(1)
    const dms = slack.callsTo('chat.postMessage')
    expect(dms[0]).toMatchObject({ channel: 'U0REQUESTER' })
    expect(String(dms[0]?.text)).toContain('Compressor leaking in bay 4')
    expect(String(dms[0]?.text)).toContain(`/cards/${card.id}`)
    // The email lookup ran once and the binding is now stored.
    expect(slack.callsTo('users.lookupByEmail')).toHaveLength(1)
    const binding = await t.wired.deps.uow.run((tx) =>
      tx.userAccounts.findBySlackUserId('U0REQUESTER'),
    )
    expect(binding?.user.id).toBe(requester.user.id)
  })

  it('reuses the stored binding for later completions (no second lookup)', async () => {
    await bootWithSlack()
    const requester = await t.asRole('user')
    const supervisor = await t.asRole('admin')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const first = await createCard(requester.cookie, 'First ticket')
    await moveCard(supervisor.cookie, first.id, 'done', first.version)
    // Wait for the first DM: the binding is persisted before it is sent, so
    // the second completion below deterministically reuses it.
    await expect.poll(() => slack.callsTo('chat.postMessage').length).toBe(1)
    const second = await createCard(requester.cookie, 'Second ticket')
    await moveCard(supervisor.cookie, second.id, 'done', second.version, { prevCardId: first.id })

    await expect.poll(() => slack.callsTo('chat.postMessage').length).toBe(2)
    expect(slack.callsTo('users.lookupByEmail')).toHaveLength(1)
  })

  it('skips unmatched requesters silently — the move still succeeds', async () => {
    await bootWithSlack()
    const requester = await t.asRole('user')
    const supervisor = await t.asRole('admin')
    // No Slack directory entry for the requester's email.

    const card = await createCard(requester.cookie, 'Nobody on Slack')
    const done = await moveCard(supervisor.cookie, card.id, 'done', card.version)

    expect(done.id).toBe(card.id)
    // The unmatched flow ends at the email lookup: once it ran, no DM follows.
    await expect.poll(() => slack.callsTo('users.lookupByEmail').length).toBe(1)
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0)
  })

  it('swallows a failing Slack DM — the move still succeeds', async () => {
    await bootWithSlack({
      'chat.postMessage': () => ({ ok: false, error: 'channel_not_found' }),
    })
    const requester = await t.asRole('user')
    const supervisor = await t.asRole('admin')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const card = await createCard(requester.cookie, 'Slack is having a day')
    const done = await moveCard(supervisor.cookie, card.id, 'done', card.version)

    expect(done.id).toBe(card.id)
    // The DM attempt reached Slack and failed; nothing surfaced to the mover.
    await expect.poll(() => slack.callsTo('chat.postMessage').length).toBe(1)
  })

  it('skips silently when the reporter row cannot be resolved', async () => {
    // Direct adapter call: no service flow can produce a dangling reporterId
    // (FK), so the skip branch is exercised against the real wired notifier.
    await bootWithSlack()
    const ghost = rawCard({
      boardId: t.wired.boardId,
      laneId: randomUUID(),
      reporterId: randomUUID(),
    })

    await t.wired.notifier.cardCompleted(ghost)

    expect(slack.callsTo('users.lookupByEmail')).toHaveLength(0)
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0)
  })

  it('cancellation notifies no one', async () => {
    await bootWithSlack()
    const requester = await t.asRole('user')
    const supervisor = await t.asRole('admin')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const card = await createCard(requester.cookie, 'Withdrawn request')
    const response = await t.request(supervisor.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/cancel`,
      headers: { 'if-match': `"${String(card.version)}"` },
      payload: { resolution: 'declined' },
    })

    expect(response.statusCode).toBe(200)
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0)
  })
})

describe('SlackNotifier (waiting-lane overdue DMs via the aging job)', () => {
  /** Runs the real hourly job with the WIRED services (fixture Web API). */
  async function runAgingJob(): Promise<{ alerted: number }> {
    return runWaitingAgingAlerts({
      cards: t.wired.deps.services.cards,
      notifier: t.wired.notifier,
      logger: pino({ level: 'silent' }),
    })
  }

  async function moveToWaiting(cookie: string, card: CardBody): Promise<CardBody> {
    const response = await t.request(cookie, {
      method: 'POST',
      url: `/api/v1/cards/${card.id}/move`,
      headers: { 'if-match': `"${String(card.version)}"` },
      payload: {
        toLane: 'waiting_parts_vendor',
        waitingReason: 'parts',
        // Long past — the real SystemClock sees the card as overdue.
        expectedResumeAt: '2020-01-01',
      },
    })
    if (response.statusCode !== 200) throw new Error(`move failed: ${response.body}`)
    return response.json<CardBody>()
  }

  it('DMs the assignee and the supervisor, one message each', async () => {
    await bootWithSlack()
    const supervisor = await t.asRole('admin')
    const technician = await t.createUser('user', { slackUserId: 'U0TECH' })
    slack.setUserEmail('U0SUPERVISOR', supervisor.user.email)
    slack.setUserEmail('U0TECH', technician.user.email)
    const created = await t.request(supervisor.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Overdue compressor part', assigneeId: technician.user.id },
    })
    const card = await moveToWaiting(supervisor.cookie, created.json<CardBody>())

    const summary = await runAgingJob()

    expect(summary.alerted).toBe(1)
    const dms = slack.callsTo('chat.postMessage')
    expect(dms.map((dm) => dm.channel).sort()).toEqual(['U0SUPERVISOR', 'U0TECH'])
    for (const dm of dms) {
      expect(String(dm.text)).toContain('Overdue compressor part')
      expect(String(dm.text)).toContain('2020-01-01')
      expect(String(dm.text)).toContain(`/cards/${card.id}`)
    }
  })

  it('skips unmatched recipients without losing the others — and never re-fires', async () => {
    await bootWithSlack()
    const supervisor = await t.asRole('admin')
    // The supervisor has no Slack directory entry; the technician does.
    const technician = await t.createUser('user', { slackUserId: 'U0TECH' })
    slack.setUserEmail('U0TECH', technician.user.email)
    const created = await t.request(supervisor.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Half-matched recipients', assigneeId: technician.user.id },
    })
    await moveToWaiting(supervisor.cookie, created.json<CardBody>())

    const first = await runAgingJob()
    const second = await runAgingJob()

    expect(first.alerted).toBe(1)
    expect(second.alerted).toBe(0)
    const dms = slack.callsTo('chat.postMessage')
    expect(dms).toHaveLength(1)
    expect(dms[0]?.channel).toBe('U0TECH')
  })
})
