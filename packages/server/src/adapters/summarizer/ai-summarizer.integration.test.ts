import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import {
  anthropicMessagesResponse,
  googleGenerateContentResponse,
  openAiChatCompletionResponse,
} from '../../../test/fixtures/llm-responses.ts'
import { parseEnv } from '../../env.ts'
import { startLlmFixture, type LlmRequest } from '../../test/llm.ts'
import { createAiSummarizer, summarizerSettingsFromEnv } from './ai-summarizer.ts'

/**
 * Provider-agnostic summarizer against real local fixture HTTP servers
 * (ADR-017, docs/dev/testing.md): the SAME test body runs against every
 * provider, switching only env — the PO's swap-by-config requirement is
 * itself under test. Each case also proves the request carried the schema
 * natively (output_format / response_format / responseSchema).
 */

const logger = pino({ level: 'silent' })

const DOCUMENT = {
  title: 'Replace compressor hose in bay 4',
  description: 'The bay 4 compressor leaks oil; maintenance suspects the intake hose.',
  suggestedPriority: 'P1',
  tags: ['hvac', 'bay-4'],
}

interface ProviderCase {
  provider: 'anthropic' | 'openai' | 'google' | 'openai-compatible'
  model: string
  path: string
  respond: () => unknown
  /** The provider's native schema-constraint carrier in the request body. */
  schemaCarrierOf: (request: LlmRequest) => unknown
  apiKeyHeaderOf: (request: LlmRequest) => unknown
}

const providerCases: ProviderCase[] = [
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    path: '/messages',
    respond: () => anthropicMessagesResponse(DOCUMENT),
    // Native structured output: `output_config.format` carries the JSON schema.
    schemaCarrierOf: (request) =>
      (request.body.output_config as Record<string, unknown> | undefined)?.format,
    apiKeyHeaderOf: (request) => request.headers['x-api-key'],
  },
  {
    provider: 'openai',
    model: 'fixture-model',
    path: '/chat/completions',
    respond: () => openAiChatCompletionResponse(DOCUMENT),
    schemaCarrierOf: (request) => request.body.response_format,
    apiKeyHeaderOf: (request) => request.headers.authorization,
  },
  {
    provider: 'openai-compatible',
    model: 'fixture-model',
    path: '/chat/completions',
    respond: () => openAiChatCompletionResponse(DOCUMENT),
    schemaCarrierOf: (request) => request.body.response_format,
    apiKeyHeaderOf: (request) => request.headers.authorization,
  },
  {
    provider: 'google',
    model: 'gemini-fixture',
    path: '/models/gemini-fixture:generateContent',
    respond: () => googleGenerateContentResponse(DOCUMENT),
    schemaCarrierOf: (request) =>
      (request.body.generationConfig as Record<string, unknown> | undefined)?.responseSchema,
    apiKeyHeaderOf: (request) => request.headers['x-goog-api-key'],
  },
]

/** Env → settings → adapter, exactly the production path. */
function summarizerFor(
  provider: string,
  model: string,
  baseUrl: string,
  timeoutMs?: number,
): ReturnType<typeof createAiSummarizer> {
  const env = parseEnv({
    SUMMARIZER_ENABLED: 'true',
    SUMMARIZER_PROVIDER: provider,
    SUMMARIZER_MODEL: model,
    SUMMARIZER_API_KEY: 'fixture-api-key',
    SUMMARIZER_BASE_URL: baseUrl,
  })
  const settings = summarizerSettingsFromEnv(env)
  if (settings === null) throw new Error('summarizer unexpectedly disabled')
  return createAiSummarizer(timeoutMs === undefined ? settings : { ...settings, timeoutMs }, logger)
}

describe('AiSummarizer provider swap (config-only)', () => {
  it.each(providerCases)(
    'returns the schema-constrained draft via $provider',
    async ({ provider, model, path, respond, schemaCarrierOf, apiKeyHeaderOf }) => {
      const fixture = await startLlmFixture({ respond })
      try {
        const summarizer = summarizerFor(provider, model, fixture.url)

        const draft = await summarizer.summarize('The compressor in bay 4 is leaking oil again')

        expect(draft).toEqual(DOCUMENT)
        expect(fixture.requests).toHaveLength(1)
        const request = fixture.requests[0]
        if (request === undefined) throw new Error('no request recorded')
        expect(request.path).toBe(path)
        expect(schemaCarrierOf(request)).toBeDefined()
        expect(JSON.stringify(schemaCarrierOf(request))).toContain('suggestedPriority')
        expect(String(apiKeyHeaderOf(request))).toContain('fixture-api-key')
      } finally {
        await fixture.close()
      }
    },
  )
})

describe('AiSummarizer failure handling', () => {
  it('returns null on a schema-violating response (raw-text fallback path)', async () => {
    const fixture = await startLlmFixture({
      respond: () => anthropicMessagesResponse({ totally: 'wrong-shape' }),
    })
    try {
      const summarizer = summarizerFor('anthropic', 'claude-haiku-4-5', fixture.url)

      const draft = await summarizer.summarize('thread text')

      expect(draft).toBeNull()
      expect(fixture.requests).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })

  it('returns null on a provider error status', async () => {
    const fixture = await startLlmFixture({
      status: 500,
      respond: () => ({ type: 'error', error: { type: 'api_error', message: 'boom' } }),
    })
    try {
      const summarizer = summarizerFor('anthropic', 'claude-haiku-4-5', fixture.url)

      const draft = await summarizer.summarize('thread text')

      expect(draft).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('returns null when the provider exceeds the timeout budget', async () => {
    const fixture = await startLlmFixture({
      delayMs: 5_000,
      respond: () => anthropicMessagesResponse(DOCUMENT),
    })
    try {
      const summarizer = summarizerFor('anthropic', 'claude-haiku-4-5', fixture.url, 120)

      const startedAt = Date.now()
      const draft = await summarizer.summarize('thread text')

      expect(draft).toBeNull()
      expect(Date.now() - startedAt).toBeLessThan(3_000)
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
      respond: () => anthropicMessagesResponse(oversized),
    })
    try {
      const summarizer = summarizerFor('anthropic', 'claude-haiku-4-5', fixture.url)

      const draft = await summarizer.summarize('thread text')

      expect(draft?.title).toHaveLength(200)
      expect(draft?.description).toHaveLength(20_000)
      expect(draft?.tags).toEqual(['ok', 'padded', 'a', 'b', 'c'])
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
