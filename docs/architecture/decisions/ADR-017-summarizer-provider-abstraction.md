# ADR-017: Provider-agnostic summarizer via the official `openai` SDK

**Status**: accepted (2026-07-18)

## Context

Product-owner direction (2026-07-16, slack.md#summarization--data-handling): the SummarizerPort
adapter must make the concrete LLM a **pure configuration choice** — the summarizer must work
against OpenAI, NVIDIA NIM (build.nvidia.com), a LiteLLM proxy, vLLM, OpenRouter, or any other
remote-inference endpoint — without touching code outside the adapter and its config. Output must
be **schema-constrained**: `{ title, description, suggestedPriority, tags[] }`. Testing rules
(docs/dev/testing.md) forbid mocks: provider HTTP is faked only as real local fixture HTTP
servers, so the client must accept a base-URL override.

The 2026-07-18 revision (PO): **drop the Vercel AI SDK.** The OpenAI Chat Completions wire shape
is the lingua franca of remote inference — spoken by OpenAI, NVIDIA NIM, LiteLLM, vLLM,
OpenRouter, and most hosted/self-hosted stacks. That collapses "which provider" into a single
knob: `SUMMARIZER_BASE_URL`. One client, one wire shape, one fixture format — no per-provider SDK
cluster to track.

Ecosystem facts verified July 2026 (npm registry + official docs, not memory):

- `openai` **6.48.0** (`npm view openai version`; dist-tag `latest`). Apache-2.0, single package.
- Client: `new OpenAI({ apiKey, baseURL })` — `apiKey` explicit (never ambient `OPENAI_API_KEY`),
  `baseURL` any OpenAI-compatible endpoint. Verified against
  <https://github.com/openai/openai-node> README.
- Structured Outputs via the zod helper, verified against
  <https://github.com/openai/openai-node/blob/master/helpers.md> and
  <https://developers.openai.com/api/docs/guides/structured-outputs>:
  `import { zodResponseFormat } from 'openai/helpers/zod'`, then
  `client.chat.completions.parse({ model, messages, response_format: zodResponseFormat(schema, name) })`,
  reading `completion.choices[0].message.parsed` (already validated against the zod schema; a
  refusal or missing content leaves `parsed` null/undefined). Under the hood this sends
  `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`.
- Per-request budget: the second argument to `.parse()`/`.create()` takes `{ timeout }` (ms) and
  `{ signal }`. We use `{ timeout }` — the SDK aborts the request on expiry.

## Alternatives

| Option                                                         | Swap-by-config fidelity                                          | Structured-output guarantee                                                                    | Dependency weight                  | Fixture-server testability                          | Maintenance                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| **(a) Single `openai` client, base-URL selected** — **chosen** | Full: the provider IS `SUMMARIZER_BASE_URL`; call site identical | Native OpenAI `response_format` json_schema + zod parse — on every endpoint that honors it     | One package (`openai`), Apache-2.0 | One fixture shape (`POST /chat/completions`)        | One vendor-tracked surface; new providers are a URL, not a package             |
| (b) Vercel AI SDK (`ai` + 4 provider packages) — previous      | Full, via a per-provider `LanguageModel` factory                 | Native per provider (Anthropic `output_format`, OpenAI `json_schema`, Gemini `responseSchema`) | 5 packages sharing one core        | Four fixture wire shapes to record and keep current | We track 4 provider protocol drifts (via the SDK) plus SDK major-version churn |
| (c) Hand-rolled thin adapters per provider SDK                 | Full, after we re-implement N clients                            | We re-implement N divergent schema protocols + retries ourselves                               | 0–N SDKs; most first-party code    | Same base-URL story, hand-built                     | Highest: we own protocol drift, error taxonomy, streaming/retry forever        |

## Decision

Implement the SummarizerPort adapter in `packages/server` on the official **`openai`** SDK, exact
pin `openai 6.48.0`, as one OpenAI-compatible client:

- `new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl ?? 'https://api.openai.com/v1', maxRetries: 0 })`.
  `apiKey` is always passed explicitly from `SUMMARIZER_API_KEY` — ambient env
  (`OPENAI_API_KEY`, …) is never consulted. `baseURL` comes from `SUMMARIZER_BASE_URL`, defaulting
  to OpenAI's own endpoint.
- The single call site is
  `client.chat.completions.parse({ model, messages: [system, user], response_format: zodResponseFormat(draftSchema, 'facilities_ticket_draft') }, { timeout })`,
  reading `completion.choices[0].message.parsed`. `draftSchema` is the one zod schema for
  `{ title, description, suggestedPriority ('P0'|'P1'|'P2'), tags[] }` (single-schema rule); the
  SDK enforces it via `response_format` json_schema and validates the result before we see it.
- **Any** failure — provider error, timeout (`{ timeout }`), a null `parsed` (refusal / no
  content), or schema-validation failure — resolves to `null`, so the caller prefills the modal
  with raw thread text (slack.md flow step 3). The privacy-preserving `logger.warn` records only
  the endpoint host (or a static `openai`/`openai-compatible` label), model, and error name —
  never the thread text or model output.
- Env (deployment.md table): `SUMMARIZER_ENABLED`, `SUMMARIZER_MODEL` (required when enabled;
  default `gpt-5-mini`), `SUMMARIZER_API_KEY` (required when enabled), `SUMMARIZER_BASE_URL`
  (optional; defaults to `https://api.openai.com/v1`). **`SUMMARIZER_PROVIDER` is dropped** — the
  provider is the base URL now (v0 / no-legacy).

## Consequences

- Swapping providers/models is env-only, exactly as the PO required; a new provider is a URL
  (`SUMMARIZER_BASE_URL=https://integrate.api.nvidia.com/v1`) and a model name — no new package.
- `packages/server` drops five AI-SDK packages for one (`openai`).
- **Tradeoff — one uniform surface, not native per-provider mechanisms.** This drops the previous
  design's native Anthropic Messages `output_format` (and Gemini `responseSchema`) path in favor
  of one OpenAI-compatible surface. Schema enforcement now depends on the endpoint honoring
  `response_format`:
  - OpenAI and NVIDIA NIM honor it — full strict json_schema enforcement.
  - An endpoint that **ignores** `response_format` (notably Anthropic's own OpenAI-compat
    endpoint) gets no schema enforcement; the model may still emit conforming JSON, but if it
    doesn't, our zod parse fails and we fall back to raw text (safe, but no guarantee).
  - To use such a provider **with** enforcement, route it through a **LiteLLM proxy**, which
    translates `response_format` to each provider's native JSON-schema / tool mechanism, and point
    `SUMMARIZER_BASE_URL` at the proxy. This is the recommended path for non-OpenAI-native
    providers.
- **Fixture-server testing** (docs/dev/testing.md, no mocks): one wire shape. Each test boots a
  real `node:http` server on `127.0.0.1:0` serving a recorded OpenAI chat completion (message
  content = the JSON draft) and passes its address as `SUMMARIZER_BASE_URL`. Coverage: happy path
  → clamped `SummaryDraft`; the base-URL override is honored (the fixture receives the request
  carrying the json_schema `response_format` and the explicit API key); and failure paths (HTTP
  500, a non-JSON-draft message, and a timeout) each resolve to `null`.
- Schema style stays constrained by OpenAI strict mode: keep the object flat, no `.optional()`
  (use required fields; clamp in code). Our four-field schema fits.
- `SummarizerPort` in `packages/core` is unchanged (`summarize(text): Promise<SummaryDraft | null>`);
  core stays library-free — the zod schema and `openai` usage live only in the server adapter.
