import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { type AddressInfo } from 'node:net'
import { type SummarizerPort } from '@rivian-kanban/core'
import { pino } from 'pino'
import { createAiSummarizer } from '../adapters/summarizer/ai-summarizer.ts'

/**
 * Local fixture HTTP server standing in for an LLM provider
 * (docs/dev/testing.md: external HTTP is faked only as real local servers;
 * our code — the AI SDK included — runs unmodified against it via
 * SUMMARIZER_BASE_URL).
 */

export interface LlmRequest {
  path: string
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
}

export interface LlmFixtureOptions {
  /** Response body per request; a JSON-serializable provider payload. */
  respond: (request: LlmRequest) => unknown
  status?: number
  /** Simulates a slow provider (timeout tests). */
  delayMs?: number
}

export interface LlmFixture {
  /** Base URL (no trailing slash) — pass as SUMMARIZER_BASE_URL. */
  url: string
  requests: LlmRequest[]
  close(): Promise<void>
}

export interface SummarizerFixture {
  llm: LlmFixture
  summarizer: SummarizerPort
}

/**
 * A real AiSummarizer wired to a fresh LLM fixture server (Anthropic wire
 * shape, short timeout) — shared by the Slack surface tests so both can
 * assert whether the summarizer was (or was not) invoked.
 */
export async function startSummarizerFixture(
  respond: (request: LlmRequest) => unknown,
  delayMs?: number,
): Promise<SummarizerFixture> {
  const llm = await startLlmFixture({ respond, ...(delayMs !== undefined ? { delayMs } : {}) })
  const summarizer = createAiSummarizer(
    {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      apiKey: 'fixture-api-key',
      baseUrl: llm.url,
      timeoutMs: 500,
    },
    pino({ level: 'silent' }),
  )
  return { llm, summarizer }
}

export async function startLlmFixture(options: LlmFixtureOptions): Promise<LlmFixture> {
  const requests: LlmRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const request: LlmRequest = {
        path: req.url ?? '/',
        headers: req.headers,
        body: raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {},
      }
      requests.push(request)
      const reply = (): void => {
        if (res.writableEnded || res.destroyed) return
        res.statusCode = options.status ?? 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(options.respond(request)))
      }
      if (options.delayMs !== undefined) {
        const timer = setTimeout(reply, options.delayMs)
        res.on('close', () => {
          clearTimeout(timer)
        })
      } else {
        reply()
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
