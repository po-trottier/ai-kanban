import { afterEach, describe, expect, it } from 'vitest'
import { startSlackFixture, type SlackFixture } from '../test/slack.ts'
import { createTestApp, type TestApp } from '../test/support.ts'

/**
 * SlackNotifier through the REAL service flow (docs/architecture/slack.md
 * #notifications-outbound): the same createTestApp boot, with SLACK_ENABLED
 * env pointing the notifier's WebClient at a local fixture server. A card is
 * driven review→done over REST; completion must DM the requester. Unmatched
 * requesters are logged and skipped — never an error surfaced to the mover.
 */

let t: TestApp
let slack: SlackFixture

afterEach(async () => {
  await t.cleanup()
  await slack.close()
})

async function bootWithSlack(): Promise<void> {
  slack = await startSlackFixture()
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
    const requester = await t.asRole('requester')
    const supervisor = await t.asRole('supervisor')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const card = await createCard(requester.cookie, 'Compressor leaking in bay 4')
    const inReview = await moveCard(supervisor.cookie, card.id, 'review', card.version)
    await moveCard(supervisor.cookie, card.id, 'done', inReview.version)

    const dms = slack.callsTo('chat.postMessage')
    expect(dms).toHaveLength(1)
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
    const requester = await t.asRole('requester')
    const supervisor = await t.asRole('supervisor')
    slack.setUserEmail('U0REQUESTER', requester.user.email)

    const first = await createCard(requester.cookie, 'First ticket')
    await moveCard(supervisor.cookie, first.id, 'done', first.version)
    const second = await createCard(requester.cookie, 'Second ticket')
    await moveCard(supervisor.cookie, second.id, 'done', second.version, { prevCardId: first.id })

    expect(slack.callsTo('chat.postMessage')).toHaveLength(2)
    expect(slack.callsTo('users.lookupByEmail')).toHaveLength(1)
  })

  it('skips unmatched requesters silently — the move still succeeds', async () => {
    await bootWithSlack()
    const requester = await t.asRole('requester')
    const supervisor = await t.asRole('supervisor')
    // No Slack directory entry for the requester's email.

    const card = await createCard(requester.cookie, 'Nobody on Slack')
    const done = await moveCard(supervisor.cookie, card.id, 'done', card.version)

    expect(done.id).toBe(card.id)
    expect(slack.callsTo('users.lookupByEmail')).toHaveLength(1)
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0)
  })

  it('cancellation notifies no one', async () => {
    await bootWithSlack()
    const requester = await t.asRole('requester')
    const supervisor = await t.asRole('supervisor')
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
