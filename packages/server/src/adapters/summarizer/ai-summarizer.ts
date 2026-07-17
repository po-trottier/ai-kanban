import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  CARD_DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  PRIORITIES,
  TAG_NAME_MAX,
  type SummarizerPort,
  type SummaryDraft,
} from '@rivian-kanban/core'
import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { type Env } from '../../env.ts'
import { type AdapterLogger } from '../../types.ts'

/**
 * Provider-agnostic SummarizerPort adapter (ADR-017): the concrete LLM is
 * pure configuration. One Vercel AI SDK call site; the schema is enforced
 * through each provider's native structured-output mechanism and validated
 * with zod by the SDK before we ever see it. Every failure — provider error,
 * schema violation, timeout — resolves to null so callers fall back to the
 * raw thread text (docs/architecture/slack.md, flow step 3).
 */

type SummarizerProvider = Env['SUMMARIZER_PROVIDER']

export interface SummarizerSettings {
  provider: SummarizerProvider
  model: string
  /** Always passed explicitly — ambient provider env vars are never consulted. */
  apiKey: string
  /** Endpoint override (fixture servers, self-hosted/OpenAI-compatible endpoints). */
  baseUrl?: string
  /** Whole-call budget; a slow provider must never stall the Slack modal. */
  timeoutMs?: number
}

/** The env → settings mapping; null when summarization is disabled. */
export function summarizerSettingsFromEnv(env: Env): SummarizerSettings | null {
  if (!env.SUMMARIZER_ENABLED || env.SUMMARIZER_API_KEY === undefined) return null
  return {
    provider: env.SUMMARIZER_PROVIDER,
    model: env.SUMMARIZER_MODEL,
    apiKey: env.SUMMARIZER_API_KEY,
    ...(env.SUMMARIZER_BASE_URL !== undefined ? { baseUrl: env.SUMMARIZER_BASE_URL } : {}),
  }
}

/**
 * Kept deliberately plain (no length keywords): the strictest provider
 * dialects (OpenAI strict `json_schema`, Gemini's OpenAPI subset) reject or
 * ignore exotic keywords, so hard limits are clamped in code instead.
 */
const draftSchema = z.object({
  title: z.string().describe('Short imperative ticket title (at most 200 characters)'),
  description: z.string().describe('What is broken, where, and what was already tried'),
  suggestedPriority: z
    .enum(PRIORITIES)
    .describe('P0 = safety/production stoppage, P1 = degraded, P2 = routine'),
  tags: z.array(z.string()).describe('Up to 5 short lowercase topic tags'),
})

const SYSTEM_PROMPT =
  'You draft facilities-maintenance tickets from Slack threads. ' +
  'Summarize the thread into a ticket draft a human will review and edit. ' +
  'Be factual; never invent details that are not in the thread.'

const DEFAULT_TIMEOUT_MS = 20_000

/** Maps settings to a concrete AI SDK model instance (never a bare id string). */
function createModel(settings: SummarizerSettings): LanguageModel {
  const { model, apiKey, baseUrl } = settings
  const baseUrlOption = baseUrl !== undefined ? { baseURL: baseUrl } : {}
  switch (settings.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, ...baseUrlOption })(model)
    case 'openai':
      // Chat Completions, not the v7-default Responses API, so `openai` and
      // `openai-compatible` share one wire shape and one fixture format (ADR-017).
      return createOpenAI({ apiKey, ...baseUrlOption }).chat(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey, ...baseUrlOption })(model)
    case 'openai-compatible': {
      if (baseUrl === undefined) {
        // parseEnv already refuses to boot without it; defensive backstop.
        throw new Error('SUMMARIZER_BASE_URL is required for openai-compatible providers')
      }
      return createOpenAICompatible({
        name: 'openai-compatible',
        apiKey,
        baseURL: baseUrl,
        // Without this flag the provider silently skips response_format.
        supportsStructuredOutputs: true,
      })(model)
    }
  }
}

/** Prompted cap ("up to 5 tags"), enforced here like the schema caps. */
const SUMMARY_TAGS_MAX = 5

/** Hard limits from the card schema, enforced in code (see draftSchema note). */
function clampDraft(raw: z.infer<typeof draftSchema>): SummaryDraft {
  const title = raw.title.replace(/\s+/g, ' ').trim().slice(0, CARD_TITLE_MAX)
  return {
    title: title.length > 0 ? title : 'Slack thread ticket',
    description: raw.description.slice(0, CARD_DESCRIPTION_MAX),
    suggestedPriority: raw.suggestedPriority,
    tags: raw.tags
      .map((tag) => tag.trim().slice(0, TAG_NAME_MAX))
      .filter((tag) => tag.length > 0)
      .slice(0, SUMMARY_TAGS_MAX),
  }
}

class AiSummarizer implements SummarizerPort {
  private readonly settings: SummarizerSettings
  private readonly model: LanguageModel
  private readonly logger: AdapterLogger

  constructor(settings: SummarizerSettings, logger: AdapterLogger) {
    this.settings = settings
    this.model = createModel(settings)
    this.logger = logger
  }

  async summarize(threadText: string): Promise<SummaryDraft | null> {
    try {
      const result = await generateText({
        model: this.model,
        output: Output.object({
          schema: draftSchema,
          name: 'facilities_ticket_draft',
          description: 'A reviewable facilities ticket draft summarizing a Slack thread',
        }),
        system: SYSTEM_PROMPT,
        prompt: threadText,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
      return clampDraft(result.output)
    } catch (error) {
      // Thread content and model output must never reach the logs — the
      // failure is recorded by provider/model/error-name only.
      this.logger.warn(
        {
          provider: this.settings.provider,
          model: this.settings.model,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        'summarizer failed; falling back to raw thread text',
      )
      return null
    }
  }
}

export function createAiSummarizer(
  settings: SummarizerSettings,
  logger: AdapterLogger,
): SummarizerPort {
  return new AiSummarizer(settings, logger)
}
