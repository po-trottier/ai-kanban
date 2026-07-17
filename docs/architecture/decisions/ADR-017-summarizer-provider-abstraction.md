# ADR-017: Provider-agnostic summarizer via Vercel AI SDK

**Status**: accepted (2026-07-17)

## Context

Product-owner direction (2026-07-16, slack.md#summarization--data-handling): the SummarizerPort
adapter must make the concrete LLM a **pure configuration choice** — Anthropic, OpenAI, Google
Gemini, NVIDIA (build.nvidia.com), or any OpenAI-compatible endpoint — via
`SUMMARIZER_PROVIDER`, `SUMMARIZER_MODEL`, `SUMMARIZER_API_KEY`, `SUMMARIZER_BASE_URL`. Default
`anthropic` / `claude-haiku-4-5`. Output must be **schema-constrained** across all providers:
`{ title, description, suggestedPriority, tags[] }`. Testing rules (docs/dev/testing.md) forbid
mocks: provider HTTP is faked only as real local fixture HTTP servers, so every provider client
must accept a base-URL override.

Ecosystem facts verified July 2026 (npm registry + official docs, not memory):

- Vercel AI SDK: `ai` 7.0.30; provider packages `@ai-sdk/anthropic` 4.0.15, `@ai-sdk/openai`
  4.0.15, `@ai-sdk/google` 4.0.17, `@ai-sdk/openai-compatible` 3.0.11 — all on the same
  `@ai-sdk/provider` 4.0.3 / `@ai-sdk/provider-utils` 5.0.10 core, all with zod peer range
  `^3.25.76 || ^4.1.8` (our pinned `zod` 4.4.3 satisfies it).
- **`generateObject`/`streamObject` were removed in AI SDK 7** (deprecated in 6): structured
  output is `generateText({ output: Output.object({ schema }) })`, read `result.output`,
  failures throw `NoObjectGeneratedError`. Older tutorials showing `generateObject` are stale.
- Per-provider schema enforcement is native, not prompt-and-pray: Anthropic `output_format`
  (`structuredOutputMode: 'outputFormat' | 'jsonTool' | 'auto'`), OpenAI strict `json_schema`
  (`strictJsonSchema` defaults to true), Gemini `responseSchema` (`structuredOutputs` defaults
  to true), OpenAI-compatible `response_format: json_schema` when
  `supportsStructuredOutputs: true`.
- Every provider factory takes `baseURL` (and explicit `apiKey`): Anthropic default
  `https://api.anthropic.com/v1`, OpenAI `https://api.openai.com/v1`, Google
  `https://generativelanguage.googleapis.com/v1beta` (`x-goog-api-key` header),
  `createOpenAICompatible({ name, baseURL, apiKey })` for everything else. NVIDIA NIM
  (`https://integrate.api.nvidia.com/v1`) is documented by the AI SDK itself as an
  OpenAI-compatible provider and supports `response_format`/structured output on its hosted
  models.
- Anthropic's own OpenAI-compatibility endpoint **ignores `response_format` and tool `strict`**
  and is documented as "primarily intended to test and compare model capabilities … not a
  long-term or production-ready solution" — it cannot carry our default provider.

## Alternatives

| Option                                                          | Swap-by-config fidelity                                                         | Structured-output guarantee                                                                                         | Dependency weight                                                               | Fixture-server testability                                               | Maintenance                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **(a) Vercel AI SDK** (`ai` + 4 provider packages) — **chosen** | Full: one `LanguageModel` value selected by env; call site identical everywhere | Native per provider (`output_format`, strict `json_schema`, `responseSchema`, compat `response_format`) + zod parse | 5 packages, one shared core, Apache-2.0, provenance-signed; server package only | `baseURL` on every factory; custom `fetch` hook as a second escape hatch | One well-maintained surface tracks 4 provider protocol drifts for us                     |
| (b) Hand-rolled thin adapters per provider SDK (or raw fetch)   | Full, but only after we re-implement 4 clients                                  | We re-implement 4 divergent schema protocols + zod→JSON-Schema dialects (Gemini uses an OpenAPI subset) + retries   | 0–4 SDKs; least third-party code, most first-party code                         | Same `baseURL` story, hand-built                                         | Highest: we own protocol drift, error taxonomy, streaming/retry semantics forever        |
| (c) Single OpenAI-compatible client for all providers           | Broken for the default: Anthropic compat endpoint is eval-only                  | **Fails**: Anthropic ignores `response_format`/`strict` → default provider gets no schema guarantee                 | Minimal (one client)                                                            | One fixture shape (nice) — but only because it drops provider fidelity   | Low code, high risk: silently ignored params, per-vendor compat gaps (Gemini compat too) |

## Decision

Implement the SummarizerPort adapter in `packages/server` on the **Vercel AI SDK**, exact pins:

```
ai                        7.0.30
@ai-sdk/anthropic         4.0.15
@ai-sdk/openai            4.0.15
@ai-sdk/google            4.0.17
@ai-sdk/openai-compatible 3.0.11
```

- One factory maps env → `LanguageModel`: `anthropic` → `createAnthropic({ apiKey, baseURL })`,
  `openai` → `createOpenAI({ apiKey, baseURL }).chat(model)`, `google` →
  `createGoogleGenerativeAI({ apiKey, baseURL })`, `openai-compatible` →
  `createOpenAICompatible({ name, apiKey, baseURL, supportsStructuredOutputs: true })`.
  `apiKey` is always passed explicitly from `SUMMARIZER_API_KEY` — ambient provider env vars
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) are never consulted.
- The single call site is `generateText({ model, output: Output.object({ schema }), … })` with
  a zod schema for `{ title, description, suggestedPriority ('P0'|'P1'|'P2'), tags[] }`; the
  SDK enforces the schema through each provider's native mechanism and validates the result
  with zod before we ever see it. `NoObjectGeneratedError` (and any other rejection) maps to
  the summarizer-failure path: prefill the modal with raw thread text (slack.md flow step 3).
- We deliberately use `openai.chat(model)` (Chat Completions), not the v7 default Responses
  API, so `openai` and `openai-compatible` share one wire shape and one fixture format.
- Env (deployment.md table): `SUMMARIZER_PROVIDER`
  (`anthropic | openai | google | openai-compatible`, default `anthropic`), `SUMMARIZER_MODEL`
  (default `claude-haiku-4-5`), `SUMMARIZER_API_KEY` (required when `SUMMARIZER_ENABLED=true`;
  replaces the interim `ANTHROPIC_API_KEY` in env.ts), `SUMMARIZER_BASE_URL` (optional
  override; **required** when provider is `openai-compatible`, e.g.
  `https://integrate.api.nvidia.com/v1`).

## Consequences

- Swapping models/providers is env-only, exactly as the PO required; adding a fifth provider is
  one factory branch plus one pinned package.
- `packages/server` gains five exactly-pinned, provenance-signed packages that share one core;
  they resolve as a single version cluster in the lockfile. `ai` bundles an (inert for us)
  `@ai-sdk/gateway` dependency — we always pass an explicit model instance, so the Vercel
  gateway default can never engage.
- **Fixture-server testing** (docs/dev/testing.md, no mocks): each integration test boots a
  real `node:http` server on `127.0.0.1:0` serving recorded JSON and passes its address as
  `SUMMARIZER_BASE_URL`. Routes per provider: Anthropic — `POST /messages` (request carries the
  JSON schema in `output_config.format`, the wire form of the `output_format` capability —
  verified against `@ai-sdk/anthropic` 4.0.15; response text content is the JSON document);
  OpenAI and OpenAI-compatible —
  `POST /chat/completions` (request carries `response_format: { type: 'json_schema', … }`);
  Google — `POST /models/{model}:generateContent` (request carries `responseSchema`, key in
  `x-goog-api-key`). The provider-swap guarantee is itself tested by running the same adapter
  test against two fixture providers (anthropic + openai-compatible), switching only env.
- Schema style is constrained by the strictest provider: use `.nullable()` rather than
  `.optional()` (OpenAI strict mode) and keep the object flat (Gemini accepts an OpenAPI
  subset). Our four-field schema fits comfortably.
- `SummarizerPort` in `packages/core` widens from `summarize(text): Promise<string>` to return
  the structured draft; core stays library-free (zod schema and SDK usage live in the server
  adapter, honoring dependency-cruiser boundaries).
- Known follow-the-docs trap recorded for reviewers: any snippet using `generateObject` is
  pre-v7 and will not compile against `ai` 7.0.30.
- Anthropic remains reachable only through `@ai-sdk/anthropic` (native Messages API), never
  through its OpenAI-compat endpoint — that endpoint drops the schema guarantee this whole
  design exists to provide.
