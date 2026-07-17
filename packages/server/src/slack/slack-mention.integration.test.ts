import { type Card } from '@rivian-kanban/core'
import { afterEach, describe, expect, it } from 'vitest'
import { anthropicMessagesResponse } from '../../test/fixtures/llm-responses.ts'
import { appMentionEnvelope } from '../../test/fixtures/slack-payloads.ts'
import { startSummarizerFixture, type LlmFixture } from '../test/llm.ts'
import { createSlackHarness, type SlackHarness } from '../test/slack.ts'

/**
 * Contract tests for the @-mention surface (docs/architecture/slack.md):
 * the REAL Bolt App driven through the TestReceiver with recorded payloads;
 * asserted on core effects (cards in the real temp db) AND the Web API calls
 * the app attempted (recorded by the fixture server).
 */

let harness: SlackHarness
let llm: LlmFixture | null = null

afterEach(async () => {
  await harness.cleanup()
  if (llm !== null) {
    await llm.close()
    llm = null
  }
})

async function allCards(): Promise<Card[]> {
  return harness.testApp.wired.deps.uow.run((tx) => tx.cards.query({}))
}

describe('app_mention → card creation', () => {
  it('creates the card from an in-thread mention with the thread as description', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(
      appMentionEnvelope({
        text: '<@UBOT001> create ticket P1 Compressor leaking in bay 4',
        threadTs: '1752749000.000100',
        ts: '1752749200.000300',
      }),
    )

    const cards = await allCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: 'Compressor leaking in bay 4',
      priority: 'P1',
      origin: 'slack',
      reporterId: user.id,
      slackChannelId: 'C0FACILITIES',
      slackThreadTs: '1752749000.000100',
      slackPermalink: 'https://slack.com/archives/C0FACILITIES/p1752749000000100',
    })
    // The raw thread text (from conversations.replies) is the description.
    expect(cards[0]?.description).toContain('compressor in bay 4 is leaking oil')
    expect(cards[0]?.description).toContain('needs a new hose')
    const confirmations = harness.fixture.callsTo('chat.postMessage')
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toMatchObject({ thread_ts: '1752749000.000100' })
    expect(String(confirmations[0]?.text)).toContain(`/cards/${cards[0]?.id ?? ''}`)
  })

  it('captures just the message for an out-of-thread mention (P2 default)', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(
      appMentionEnvelope({ text: '<@UBOT001> create ticket Broken door handle in lobby' }),
    )

    const cards = await allCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: 'Broken door handle in lobby',
      priority: 'P2',
      description: '<@UBOT001> create ticket Broken door handle in lobby',
      slackThreadTs: '1752749200.000300',
    })
    // No thread to fetch — the single message is the whole capture.
    expect(harness.fixture.callsTo('conversations.replies')).toHaveLength(0)
  })

  it('writes the audit event with the slack actor identity', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('technician')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({}))

    const cards = await allCards()
    const card = cards[0]
    if (card === undefined) throw new Error('card was not created')
    const events = await harness.testApp.wired.deps.uow.run((tx) => tx.events.listByCard(card.id))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'card.created',
      actorKind: 'slack',
      actorId: user.id,
    })
  })

  it('replies with the usage hint on an unparseable mention and creates nothing', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({ text: '<@UBOT001> please make me a ticket' }))

    expect(await allCards()).toHaveLength(0)
    const replies = harness.fixture.callsTo('chat.postMessage')
    expect(replies).toHaveLength(1)
    expect(String(replies[0]?.text)).toContain('create ticket [P0|P1|P2] <title>')
  })

  it('rejects events from a foreign workspace outright', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({ teamId: 'T0EVIL' }))

    expect(await allCards()).toHaveLength(0)
    expect(harness.fixture.callsTo('chat.postMessage')).toHaveLength(0)
    expect(harness.fixture.callsTo('users.info')).toHaveLength(0)
  })

  it('dedupes redelivered event ids — one card, one confirmation', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)
    const envelope = appMentionEnvelope({ eventId: 'Ev0DUPLICATE' })

    await harness.send(envelope)
    await harness.send(envelope)

    expect(await allCards()).toHaveLength(1)
    expect(harness.fixture.callsTo('chat.postMessage')).toHaveLength(1)
  })

  it('sends unknown Slack users the friendly ask-an-admin reply', async () => {
    harness = await createSlackHarness()
    // No board user and no Slack directory entry for U0STRANGER.

    await harness.send(appMentionEnvelope({ userId: 'U0STRANGER' }))

    expect(await allCards()).toHaveLength(0)
    const replies = harness.fixture.callsTo('chat.postMessage')
    expect(String(replies[0]?.text)).toContain('Ask an admin')
  })

  it('rejects deactivated users the same way, without binding them', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester', { isActive: false })
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({}))

    expect(await allCards()).toHaveLength(0)
    const replies = harness.fixture.callsTo('chat.postMessage')
    expect(String(replies[0]?.text)).toContain('Ask an admin')
    const binding = await harness.testApp.wired.deps.uow.run((tx) =>
      tx.userAccounts.findBySlackUserId('U0REPORTER'),
    )
    expect(binding).toBeNull()
  })

  it('never invokes the summarizer on the mention path, even when enabled', async () => {
    // The spec invariant (slack.md#-mention-grammar): no review step exists
    // here, so no AI output may exist — a live summarizer must stay idle.
    const fixture = await startSummarizerFixture(() =>
      anthropicMessagesResponse({
        title: 'AI title that must never be used',
        description: 'AI description that must never be used',
        suggestedPriority: 'P0',
        tags: ['ai'],
      }),
    )
    llm = fixture.llm
    harness = await createSlackHarness({ summarizer: fixture.summarizer })
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(
      appMentionEnvelope({
        text: '<@UBOT001> create ticket P1 Compressor leaking in bay 4',
        threadTs: '1752749000.000100',
      }),
    )

    expect(llm.requests).toHaveLength(0)
    const cards = await allCards()
    expect(cards).toHaveLength(1)
    // The raw thread text — not the fixture summary — is the description.
    expect(cards[0]?.title).toBe('Compressor leaking in bay 4')
    expect(cards[0]?.description).toContain('compressor in bay 4 is leaking oil')
    expect(cards[0]?.description).not.toContain('must never be used')
  })

  it('refuses to rebind a board user already bound to a different Slack id', async () => {
    // slack.md#identity-mapping: the email is resolved once; a reassigned
    // corporate email must not let a new Slack account act as the old user.
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    await harness.testApp.wired.deps.uow.run((tx) =>
      tx.userAccounts.update({ ...user, slackUserId: 'U0DEPARTED' }),
    )
    harness.fixture.setUserEmail('U0NEWHIRE', user.email)

    await harness.send(appMentionEnvelope({ userId: 'U0NEWHIRE' }))

    expect(await allCards()).toHaveLength(0)
    const replies = harness.fixture.callsTo('chat.postMessage')
    expect(String(replies[0]?.text)).toContain('Ask an admin')
    const stale = await harness.testApp.wired.deps.uow.run((tx) =>
      tx.userAccounts.findBySlackUserId('U0NEWHIRE'),
    )
    expect(stale).toBeNull()
    const kept = await harness.testApp.wired.deps.uow.run((tx) =>
      tx.userAccounts.findBySlackUserId('U0DEPARTED'),
    )
    expect(kept?.user.id).toBe(user.id)
  })

  it('escapes Slack control sequences in the confirmation message', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({ text: '<@UBOT001> create ticket <!channel> pwn' }))

    const cards = await allCards()
    expect(cards).toHaveLength(1)
    // Stored raw; escaped only in the outbound echo (no mass-ping, no spoof).
    expect(cards[0]?.title).toBe('<!channel> pwn')
    const confirmation = String(harness.fixture.callsTo('chat.postMessage')[0]?.text)
    expect(confirmation).toContain('&lt;!channel&gt; pwn')
    expect(confirmation).not.toContain('<!channel>')
  })

  it('throttles card creation per user with a friendly in-thread rejection', async () => {
    harness = await createSlackHarness({ limits: { cardsPerUserPerMinute: 1 } })
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(appMentionEnvelope({ text: '<@UBOT001> create ticket First ticket' }))
    await harness.send(appMentionEnvelope({ text: '<@UBOT001> create ticket Second ticket' }))

    expect(await allCards()).toHaveLength(1)
    const replies = harness.fixture.callsTo('chat.postMessage')
    expect(replies).toHaveLength(2)
    expect(String(replies[1]?.text)).toContain('faster than the limit')
    // Sticky identity: the email lookup ran once; the second event matched
    // the stored slack_user_id without touching users.info again.
    expect(harness.fixture.callsTo('users.info')).toHaveLength(1)
  })
})
