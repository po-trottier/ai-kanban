import { type Card } from '@rivian-kanban/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SUBMISSION_META,
  viewSubmissionPayload,
} from '../../test/fixtures/slack-payloads.ts'
import { createSlackHarness, type SlackHarness } from '../test/slack.ts'

/**
 * Contract tests for view_submission → cardService.create (flow steps 5–6,
 * docs/architecture/slack.md#message-shortcut-flow): origin slack, Slack
 * source metadata from private_metadata, reporter from the sticky identity
 * mapping, in-thread confirmation, and modal-native validation errors.
 */

let harness: SlackHarness

afterEach(async () => {
  await harness.cleanup()
})

async function allCards(): Promise<Card[]> {
  return harness.testApp.wired.deps.uow.run((tx) => tx.cards.query({}))
}

describe('view_submission → card in intake', () => {
  it('creates the card with the edited draft, slack source, and reporter mapping', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    const ackResponse = await harness.send(
      viewSubmissionPayload({
        values: {
          title: 'Compressor leaking in bay 4',
          description: 'Needs a new intake hose.',
          priority: 'P0',
          tags: 'hvac, bay-4',
        },
      }),
    )

    expect(ackResponse).toBeUndefined() // plain ack closes the modal
    const cards = await allCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      title: 'Compressor leaking in bay 4',
      description: 'Needs a new intake hose.',
      priority: 'P0',
      origin: 'slack',
      reporterId: user.id,
      slackChannelId: DEFAULT_SUBMISSION_META.channelId,
      slackThreadTs: DEFAULT_SUBMISSION_META.threadTs,
      slackPermalink: DEFAULT_SUBMISSION_META.permalink,
    })
    const card = cards[0]
    if (card === undefined) throw new Error('card missing')
    const tags = await harness.testApp.wired.deps.uow.run((tx) => tx.tags.listByCard(card.id))
    expect(tags.map((tag) => tag.name).sort()).toEqual(['bay-4', 'hvac'])
  })

  it('lands the card in the intake lane and confirms into the source thread', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(viewSubmissionPayload({}))

    const cards = await allCards()
    const card = cards[0]
    if (card === undefined) throw new Error('card missing')
    const intake = await harness.testApp.wired.deps.uow.run((tx) =>
      tx.lanes.findByKey(card.boardId, 'intake'),
    )
    expect(card.laneId).toBe(intake?.id)
    const confirmations = harness.fixture.callsTo('chat.postMessage')
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toMatchObject({
      channel: DEFAULT_SUBMISSION_META.channelId,
      thread_ts: DEFAULT_SUBMISSION_META.threadTs,
    })
    expect(String(confirmations[0]?.text)).toContain(`/cards/${card.id}`)
    const events = await harness.testApp.wired.deps.uow.run((tx) => tx.events.listByCard(card.id))
    expect(events[0]).toMatchObject({
      eventType: 'card.created',
      actorKind: 'slack',
      actorId: user.id,
    })
  })

  it('resolves the optional assignee email and location name', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)
    const { user: technician } = await harness.testApp.createUser('technician')
    const locationId = '0197fead-0000-7000-8000-00000000aa01'
    await harness.testApp.wired.deps.uow.run((tx) =>
      tx.locations.insert({ id: locationId, parentId: null, kind: 'building', name: 'HQ Annex' }),
    )

    await harness.send(
      viewSubmissionPayload({
        values: { assigneeEmail: technician.email, locationName: 'hq annex' },
      }),
    )

    const cards = await allCards()
    expect(cards[0]).toMatchObject({ assigneeId: technician.id, locationId })
  })

  it('returns modal field errors for an unknown assignee email — no card', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    const ackResponse = await harness.send(
      viewSubmissionPayload({
        values: { assigneeEmail: 'ghost@test.example', locationName: 'Nowhere Hall' },
      }),
    )

    expect(ackResponse).toMatchObject({
      response_action: 'errors',
      errors: {
        assignee_block: expect.stringContaining('ghost@test.example') as unknown,
        location_block: expect.stringContaining('Nowhere Hall') as unknown,
      },
    })
    expect(await allCards()).toHaveLength(0)
  })

  it('rejects unknown Slack users with the ask-an-admin modal error', async () => {
    harness = await createSlackHarness()

    const ackResponse = await harness.send(viewSubmissionPayload({ userId: 'U0STRANGER' }))

    expect(ackResponse).toMatchObject({
      response_action: 'errors',
      errors: { title_block: expect.stringContaining('Ask an admin') as unknown },
    })
    expect(await allCards()).toHaveLength(0)
  })

  it('throttles per-user card creation with a friendly modal error', async () => {
    harness = await createSlackHarness({ limits: { cardsPerUserPerMinute: 1 } })
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(viewSubmissionPayload({ values: { title: 'First' } }))
    const secondAck = await harness.send(viewSubmissionPayload({ values: { title: 'Second' } }))

    expect(secondAck).toMatchObject({
      response_action: 'errors',
      errors: { title_block: expect.stringContaining('faster than the limit') as unknown },
    })
    expect(await allCards()).toHaveLength(1)
  })

  it('rejects a view_submission from a foreign workspace outright', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('requester')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(viewSubmissionPayload({ teamId: 'T0EVIL' }))

    expect(await allCards()).toHaveLength(0)
    expect(harness.fixture.callsTo('chat.postMessage')).toHaveLength(0)
  })
})
