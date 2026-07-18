import { afterEach, describe, expect, it } from 'vitest'
import { openAiChatCompletionResponse } from '../../test/fixtures/llm-responses.ts'
import { messageActionPayload } from '../../test/fixtures/slack-payloads.ts'
import { startSummarizerFixture, type LlmFixture } from '../test/llm.ts'
import { createSlackHarness, type SlackHarness } from '../test/slack.ts'

/**
 * Contract tests for the message-shortcut flow (docs/architecture/slack.md
 * #message-shortcut-flow): ack → loading modal → conversations.replies →
 * optional summarizer → views.update with the editable draft. The summarizer
 * runs against a real local LLM fixture server; its failure modes fall back
 * to the raw thread text and never block the modal.
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

const SUMMARY_DOCUMENT = {
  title: 'Replace compressor hose in bay 4',
  description: 'The bay 4 compressor leaks oil; maintenance suspects the intake hose.',
  suggestedPriority: 'P1',
  tags: ['hvac', 'bay-4'],
}

interface ModalView {
  callback_id?: string
  private_metadata?: string
  blocks: {
    block_id?: string
    element?: { initial_value?: string; initial_option?: { value?: string } }
    text?: { text?: string }
  }[]
}

function updatedView(h: SlackHarness): ModalView {
  const updates = h.fixture.callsTo('views.update')
  const view = updates.at(-1)?.view
  if (view === undefined) throw new Error('no views.update recorded')
  return view as ModalView
}

function blockOf(view: ModalView, blockId: string) {
  return view.blocks.find((block) => block.block_id === blockId)
}

async function summarizerAgainst(respond: () => unknown, delayMs?: number) {
  const fixture = await startSummarizerFixture(respond, delayMs)
  llm = fixture.llm
  return fixture.summarizer
}

describe('message shortcut → editable draft modal', () => {
  it('opens the loading modal, then updates it with the raw-text draft (no summarizer)', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    expect(harness.fixture.callsTo('views.open')).toHaveLength(1)
    expect(harness.fixture.callsTo('conversations.replies')).toHaveLength(1)
    const view = updatedView(harness)
    expect(view.callback_id).toBe('facilities_ticket_draft')
    expect(blockOf(view, 'title_block')?.element?.initial_value).toBe(
      'The compressor in bay 4 is leaking oil again',
    )
    expect(blockOf(view, 'description_block')?.element?.initial_value).toContain('needs a new hose')
    expect(blockOf(view, 'priority_block')?.element?.initial_option?.value).toBe('P2')
    // No card yet: creation happens only on view_submission.
    await expect(
      harness.testApp.wired.deps.uow.run((tx) => tx.cards.query({})),
    ).resolves.toHaveLength(0)
  })

  it('carries channel/thread_ts/permalink through private_metadata', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(
      messageActionPayload({ messageTs: '1752749222.000500', threadTs: '1752749000.000100' }),
    )

    const view = updatedView(harness)
    expect(JSON.parse(view.private_metadata ?? '{}')).toEqual({
      channelId: 'C0FACILITIES',
      threadTs: '1752749000.000100',
      permalink: 'https://slack.com/archives/C0FACILITIES/p1752749000000100',
    })
  })

  it('prefills the modal with the summarizer draft when enabled', async () => {
    const summarizer = await summarizerAgainst(() => openAiChatCompletionResponse(SUMMARY_DOCUMENT))
    harness = await createSlackHarness({ summarizer })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const view = updatedView(harness)
    expect(blockOf(view, 'title_block')?.element?.initial_value).toBe(SUMMARY_DOCUMENT.title)
    expect(blockOf(view, 'priority_block')?.element?.initial_option?.value).toBe('P1')
    expect(blockOf(view, 'tags_block')?.element?.initial_value).toBe('hvac, bay-4')
    // The thread text reached the summarizer.
    expect(llm?.requests).toHaveLength(1)
    expect(JSON.stringify(llm?.requests[0]?.body)).toContain('compressor in bay 4')
  })

  it('falls back to the raw thread text when the summarizer returns garbage', async () => {
    const summarizer = await summarizerAgainst(() =>
      openAiChatCompletionResponse({ wrong: 'shape' }),
    )
    harness = await createSlackHarness({ summarizer })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const view = updatedView(harness)
    expect(blockOf(view, 'title_block')?.element?.initial_value).toBe(
      'The compressor in bay 4 is leaking oil again',
    )
    expect(llm?.requests).toHaveLength(1)
  })

  it('falls back to the raw thread text when the summarizer times out', async () => {
    const summarizer = await summarizerAgainst(
      () => openAiChatCompletionResponse(SUMMARY_DOCUMENT),
      5_000,
    )
    harness = await createSlackHarness({ summarizer })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const view = updatedView(harness)
    expect(blockOf(view, 'title_block')?.element?.initial_value).toBe(
      'The compressor in bay 4 is leaking oil again',
    )
  })

  it('skips the summarizer (raw prefill) once the budget is exhausted', async () => {
    const summarizer = await summarizerAgainst(() => openAiChatCompletionResponse(SUMMARY_DOCUMENT))
    harness = await createSlackHarness({
      summarizer,
      limits: { summariesPerUserPerMinute: 0 },
    })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const view = updatedView(harness)
    expect(blockOf(view, 'title_block')?.element?.initial_value).toBe(
      'The compressor in bay 4 is leaking oil again',
    )
    // The LLM was never called — the budget guard, not a failure, degraded it.
    expect(llm?.requests).toHaveLength(0)
  })

  it('shows the ask-an-admin notice to unknown Slack users', async () => {
    harness = await createSlackHarness()

    await harness.send(messageActionPayload({ userId: 'U0STRANGER' }))

    const view = updatedView(harness)
    expect(JSON.stringify(view.blocks)).toContain('Ask an admin')
    expect(harness.fixture.callsTo('conversations.replies')).toHaveLength(0)
  })

  it('binds the Slack id to the board user on first use (sticky mapping)', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const binding = await harness.testApp.wired.deps.uow.run((tx) =>
      tx.userAccounts.findBySlackUserId('U0REPORTER'),
    )
    expect(binding?.user.id).toBe(user.id)
  })

  it('dedupes redelivered shortcut trigger_ids — the modal opens once', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload({ triggerId: '9999.redelivered' }))
    await harness.send(messageActionPayload({ triggerId: '9999.redelivered' }))

    expect(harness.fixture.callsTo('views.open')).toHaveLength(1)
  })

  it('rejects a message_action from a foreign workspace outright', async () => {
    harness = await createSlackHarness()
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload({ teamId: 'T0EVIL' }))

    expect(harness.fixture.callsTo('views.open')).toHaveLength(0)
    expect(harness.fixture.callsTo('users.info')).toHaveLength(0)
  })

  it('truncates over-long prefills at Slack input limit with a visible marker', async () => {
    // The card cap is 20,000 chars but Slack's plain_text_input initial_value
    // caps at 3,000 — the deviation is documented in slack.md flow step 4.
    harness = await createSlackHarness({
      slackOverrides: {
        'conversations.replies': () => ({
          ok: true,
          has_more: false,
          messages: [
            {
              type: 'message',
              user: 'U0REPORTER',
              ts: '1752749000.000100',
              text: `Compressor trouble\n${'x'.repeat(5_000)}`,
            },
          ],
        }),
      },
    })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await harness.send(messageActionPayload())

    const prefill = blockOf(updatedView(harness), 'description_block')?.element?.initial_value
    expect(prefill?.length).toBeLessThanOrEqual(3_000)
    expect(prefill).toContain('[thread truncated')
  })

  it('survives a failed views.open (expired trigger_id) without escaping the listener', async () => {
    harness = await createSlackHarness({
      slackOverrides: { 'views.open': () => ({ ok: false, error: 'expired_trigger_id' }) },
    })
    const { user } = await harness.testApp.createUser('user')
    harness.fixture.setUserEmail('U0REPORTER', user.email)

    await expect(harness.send(messageActionPayload())).resolves.toBeUndefined()

    // The failure was contained before any user resolution or modal update.
    expect(harness.fixture.callsTo('users.info')).toHaveLength(0)
    expect(harness.fixture.callsTo('views.update')).toHaveLength(0)
  })
})
