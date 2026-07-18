/**
 * Recorded OpenAI-compatible response shape (docs/dev/testing.md#fixtures),
 * trimmed and anonymized, parameterized by the JSON document the "model"
 * returns. The summarizer speaks one wire shape now (ADR-017): the OpenAI
 * Chat Completions API, spoken by OpenAI, NVIDIA NIM, LiteLLM, vLLM, etc.
 */

/** OpenAI `POST /chat/completions` — the JSON document is the message content. */
export function openAiChatCompletionResponse(document: unknown): Record<string, unknown> {
  return {
    id: 'chatcmpl-fixture0000000001',
    object: 'chat.completion',
    created: 1752750000,
    model: 'fixture-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(document), refusal: null },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 },
  }
}
