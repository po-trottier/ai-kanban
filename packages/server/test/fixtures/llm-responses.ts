/**
 * Recorded LLM provider response shapes (docs/dev/testing.md#fixtures),
 * trimmed and anonymized, parameterized by the JSON document the "model"
 * returns. One builder per wire shape from ADR-017's fixture matrix.
 */

/** Anthropic `POST /messages` — the JSON document is the text content. */
export function anthropicMessagesResponse(document: unknown): Record<string, unknown> {
  return {
    id: 'msg_01Fixture0000000000000001',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify(document) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 128, output_tokens: 64 },
  }
}

/** OpenAI + OpenAI-compatible `POST /chat/completions` (one shared shape). */
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

/** Google `POST /models/{model}:generateContent`. */
export function googleGenerateContentResponse(document: unknown): Record<string, unknown> {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(document) }], role: 'model' },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 64, totalTokenCount: 192 },
    modelVersion: 'fixture-model',
  }
}
