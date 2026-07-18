import {
  CARD_DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  PRIORITIES,
  TAG_NAME_MAX,
  type SummarizerPort,
  type SummaryDraft,
} from '@rivian-kanban/core'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { type Env } from '../../env.ts'
import { type AdapterLogger } from '../../types.ts'

/**
 * Provider-agnostic SummarizerPort adapter (ADR-017): one official `openai`
 * client aimed at any OpenAI-compatible endpoint (OpenAI, NVIDIA NIM, a
 * LiteLLM proxy, vLLM, …) — the concrete provider IS the base URL. Structured
 * output goes through the SDK's Structured Outputs (`response_format`
 * json_schema, via the zod helper) and is validated against `draftSchema`
 * before we ever see it. Every failure — provider error, malformed/invalid
 * output, timeout — resolves to null so callers fall back to the raw thread
 * text (docs/architecture/slack.md, flow step 3).
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export interface SummarizerSettings {
  model: string
  /** Always passed explicitly — ambient provider env vars are never consulted. */
  apiKey: string
  /** OpenAI-compatible endpoint; defaults to OpenAI's own. */
  baseUrl?: string
  /** Whole-call budget; a slow provider must never stall the Slack modal. */
  timeoutMs?: number
}

/** The env → settings mapping; null when summarization is disabled. */
export function summarizerSettingsFromEnv(env: Env): SummarizerSettings | null {
  if (!env.SUMMARIZER_ENABLED || env.SUMMARIZER_API_KEY === undefined) return null
  return {
    model: env.SUMMARIZER_MODEL,
    apiKey: env.SUMMARIZER_API_KEY,
    ...(env.SUMMARIZER_BASE_URL !== undefined ? { baseUrl: env.SUMMARIZER_BASE_URL } : {}),
  }
}

/**
 * Kept deliberately plain (no length keywords): OpenAI strict `json_schema`
 * rejects or ignores exotic keywords, so hard limits are clamped in code.
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
  private readonly client: OpenAI
  private readonly logger: AdapterLogger
  /** Endpoint host for logs — never the full URL or a secret (env validates it as a URL). */
  private readonly providerHost: string

  constructor(settings: SummarizerSettings, logger: AdapterLogger) {
    this.settings = settings
    const baseURL = settings.baseUrl ?? DEFAULT_BASE_URL
    this.client = new OpenAI({ apiKey: settings.apiKey, baseURL, maxRetries: 0 })
    this.providerHost = new URL(baseURL).host
    this.logger = logger
  }

  async summarize(threadText: string): Promise<SummaryDraft | null> {
    try {
      const completion = await this.client.chat.completions.parse(
        {
          model: this.settings.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: threadText },
          ],
          response_format: zodResponseFormat(draftSchema, 'facilities_ticket_draft'),
        },
        { timeout: this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      )
      const parsed = completion.choices[0]?.message.parsed
      if (parsed === null || parsed === undefined) throw new Error('no parsed output')
      return clampDraft(parsed)
    } catch (error) {
      // Thread content and model output must never reach the logs — the
      // failure is recorded by endpoint host/model/error-name only.
      this.logger.warn(
        {
          provider: this.providerHost,
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
