# AI Prompt Contract Addendum: v3.5

**Version**: 3.5 (addendum to v3.4)
**Date**: 2026-06-01
**Amends**: `specs/006-memory-perf-opt/contracts/ai-prompt-contract.md` (v3.4)

---

## Change Summary

Two additions to the transport layer for the bulk text translation queue. The `text_translation` tool schema (introduced in v3.4) is **unchanged**. The `linguistic_analysis` tool and its streaming transport (v3.3) are **unchanged**.

1. **Cache pre-warm request** — new request pattern using `max_tokens: 0`, fired on popup open
2. **Queue chunk dispatch** — confirmation that `text_translation` tool is reused for each bulk queue unit; no new tool schema

---

## Addition 1: Cache Pre-Warm Request

### When Used

Called by `prewarmCache(apiKey)` in `lib/bulk-translator.js` immediately on popup `DOMContentLoaded`. Fires once per popup open. Errors are silently suppressed — pre-warm failure does not affect the user session.

### Purpose

Writes the `text_translation` system prompt and tool definition to the API prompt cache before any user interaction, so that the first queue unit dispatch gets a cache read rather than a cache write.

### Request Body

```
POST /v1/messages
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 0,
  "system": [
    { "type": "text", "text": "Translate the input text to English using the text_translation tool.", "cache_control": { "type": "ephemeral" } }
  ],
  "tools": [
    { ...text_translation, "cache_control": { "type": "ephemeral" } }
  ],
  "tool_choice": { "type": "tool", "name": "text_translation" },
  "messages": [{ "role": "user", "content": "warmup" }]
}
```

**Key field**: `"max_tokens": 0` — instructs the API to process the prompt and write the cache without generating any output. Zero output tokens are billed.

### Response Handling

```
if (!response.ok): silently return (no error thrown)
// No response body consumed — pre-warm has no useful output
```

**Security constraint (Principle I)**: No response data from the pre-warm request is rendered in the DOM.

---

## Addition 2: Bulk Queue Chunk Dispatch

### When Used

Each cache-miss queue unit is dispatched by `BulkTranslator._dispatchUnit()` via `translateOnly(chunk, apiKey, { signal })` in `lib/analyzer.js`. The request structure is **identical to the v3.4 `text_translation` batch call** with one addition: `CHUNK_TIMEOUT_MS = 15_000` is used as the per-unit timeout instead of `TIMEOUT_MS = 30_000`.

### Request Body

Identical to v3.4 `text_translation` request. No changes to tool name, schema, system prompt text, `tool_choice`, or caching headers. The only runtime difference is the shorter `AbortController` timeout.

```
POST /v1/messages
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2048,
  "system": [
    { "type": "text", "text": "Translate the input text to English using the text_translation tool.", "cache_control": { "type": "ephemeral" } }
  ],
  "tools": [
    { ...text_translation, "cache_control": { "type": "ephemeral" } }
  ],
  "tool_choice": { "type": "tool", "name": "text_translation" },
  "messages": [{ "role": "user", "content": "<chunk text, ≤500 chars>" }]
}
```

### Cache Behaviour Across Queue Units

Because the system prompt and tool definition are identical across all chunk requests and carry `cache_control: { type: 'ephemeral' }`, the API cache is written on the first request (or the pre-warm) and read on all subsequent requests within the 5-minute TTL. Each queue unit after the first benefits from a cache read at ~10% of the base input token cost.

### Response Consumption

Identical to v3.4 `text_translation` response consumption:

```
body = await response.json()
toolInput = body.content?.find(b => b.type === 'tool_use')?.input
if (!toolInput?.translation):
  throw new JsonError('No translation returned. Please retry.')
return { translation: toolInput.translation, tokens: [] }
```

### Timeout

`CHUNK_TIMEOUT_MS = 15_000` ms per unit. New constant exported from `lib/analyzer.js`. `TIMEOUT_MS = 30_000` is unchanged and continues to govern `analyzeText()` and `translateOnly()` in their standard (non-queue) invocations. Bulk queue calls to `translateOnly()` pass a pre-configured `AbortSignal` that fires at `CHUNK_TIMEOUT_MS`.

### 429 Retry

On `ApiError` with status 429, the caller (`BulkTranslator._dispatchUnit()`) retries up to 3 times with exponential backoff (1 000 ms → 2 000 ms → 4 000 ms). Retry attempts reuse the same request structure with a fresh `AbortController`.

---

## What Did Not Change (v3.5)

- `text_translation` tool name, schema, and system prompt text — unchanged from v3.4
- `linguistic_analysis` tool name, schema, and SSE transport — unchanged from v3.3
- `validateResponse()` — not called by `translateOnly()`; unchanged
- `buildSystemPrompt()` / `buildAnalysisTool()` — not called by bulk path; unchanged
- All request headers (`x-api-key`, `anthropic-version`, `anthropic-beta`, `content-type`, `anthropic-dangerous-direct-browser-access`) — unchanged
