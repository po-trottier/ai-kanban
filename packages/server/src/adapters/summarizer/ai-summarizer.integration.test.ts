import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { openAiChatCompletionResponse } from '../../../test/fixtures/llm-responses.ts'
import { parseEnv } from '../../env.ts'
import { startLlmFixture } from '../../test/llm.ts'
import { createAiSummarizer, summarizerSettingsFromEnv } from './ai-summarizer.ts'

/**
 * Provider-agnostic summarizer against a real local fixture HTTP server
 * (ADR-017, docs/dev/testing.md): one OpenAI-compatible wire shape, selected
 * by `SUMMARIZER_BASE_URL`. No mocks — the `openai` client runs unmodified
 * against a `node:http` server on 127.0.0.1:0.
 */

const logger = pino({ level: 'silent' })

const DOCUMENT = {
  title: 'Replace compressor hose in bay 4',
  description: 'The bay 4 compressor leaks oil; maintenance suspects the intake hose.',
  suggestedPriority: 'P1',
  tags: ['hvac', 'bay-4'],
}

/** Env → settings → adapter, exactly the production path. */
function summarizerFor(baseUrl: string, timeoutMs?: number): ReturnType<typeof createAiSummarizer> {
  const env = parseEnv({
    SUMMARIZER_ENABLED: 'true',
    SUMMARIZER_MODEL: 'fixture-model',
    SUMMARIZER_API_KEY: 'fixture-api-key',
    SUMMARIZER_BASE_URL: baseUrl,
  })
  const settings = summarizerSettingsFromEnv(env)
  if (settings === null) throw new Error('summarizer unexpectedly disabled')
  return createAiSummarizer(timeoutMs === undefined ? settings : { ...settings, timeoutMs }, logger)
}

describe('AiSummarizer', () => {
  it('returns the schema-constrained draft and honors the base-URL override', async () => {
    const fixture = await startLlmFixture({ respond: () => openAiChatCompletionResponse(DOCUMENT) })
    try {
      const summarizer = summarizerFor(fixture.url)

      const draft = await summarizer.summarize('The compressor in bay 4 is leaking oil again')

      expect(draft).toEqual(DOCUMENT)
      // The fixture at SUMMARIZER_BASE_URL actually received the request…
      expect(fixture.requests).toHaveLength(1)
      const request = fixture.requests[0]
      if (request === undefined) throw new Error('no request recorded')
      expect(request.path).toBe('/chat/completions')
      // …carrying the json_schema response_format and the explicit API key.
      expect(JSON.stringify(request.body.response_format)).toContain('suggestedPriority')
      expect(String(request.headers.authorization)).toContain('fixture-api-key')
    } finally {
      await fixture.close()
    }
  })

  it('clamps out-of-bound model output to the card limits', async () => {
    const oversized = {
      title: `  ${'t'.repeat(300)}  `,
      description: 'd'.repeat(25_000),
      suggestedPriority: 'P2',
      tags: ['ok', '', '  padded  ', 'a', 'b', 'c', 'd'],
    }
    const fixture = await startLlmFixture({
      respond: () => openAiChatCompletionResponse(oversized),
    })
    try {
      const summarizer = summarizerFor(fixture.url)

      const draft = await summarizer.summarize('thread text')

      expect(draft?.title).toHaveLength(200)
      expect(draft?.description).toHaveLength(20_000)
      expect(draft?.tags).toEqual(['ok', 'padded', 'a', 'b', 'c'])
    } finally {
      await fixture.close()
    }
  })
})

describe('AiSummarizer failure handling (raw-text fallback path)', () => {
  it('returns null on a provider error status', async () => {
    const fixture = await startLlmFixture({
      status: 500,
      respond: () => ({ error: { type: 'api_error', message: 'boom' } }),
    })
    try {
      const draft = await summarizerFor(fixture.url).summarize('thread text')

      expect(draft).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('returns null on a malformed (non-JSON draft) response', async () => {
    const fixture = await startLlmFixture({
      // Valid chat completion, but the message content is not the expected JSON.
      respond: () => openAiChatCompletionResponse('not a ticket draft at all'),
    })
    try {
      const draft = await summarizerFor(fixture.url).summarize('thread text')

      expect(draft).toBeNull()
      expect(fixture.requests).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })

  it('returns null when the provider exceeds the timeout budget', async () => {
    const fixture = await startLlmFixture({
      delayMs: 5_000,
      respond: () => openAiChatCompletionResponse(DOCUMENT),
    })
    try {
      const startedAt = Date.now()
      const draft = await summarizerFor(fixture.url, 120).summarize('thread text')

      expect(draft).toBeNull()
      expect(Date.now() - startedAt).toBeLessThan(3_000)
    } finally {
      await fixture.close()
    }
  })
})

describe('summarizerSettingsFromEnv', () => {
  it('is null when the summarizer is disabled (default boot path)', () => {
    expect(summarizerSettingsFromEnv(parseEnv({}))).toBeNull()
  })
})
