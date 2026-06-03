# AI Prompt Contract Addendum: v3.3

**Version**: 3.3 (addendum to v3.2)
**Date**: 2026-05-31
**Amends**: `specs/003-tiered-api-pipeline/contracts/ai-prompt-contract.md` (v3.2)

---

## Change Summary

The `linguistic_analysis` tool **schema is unchanged** from v3.2. This addendum documents a change to the HTTP transport layer only: the Claude API call now uses server-sent events (SSE) streaming. The assembled tool input conforms to the same v3.2 schema.

---

## What Changed

### Transport: Batch → Streaming

**v3.2 (batch)**:
```
POST /v1/messages
→ single JSON response body
→ result = body.content.find(b => b.type === 'tool_use').input
```

**v3.3 (streaming)**:
```
POST /v1/messages  { stream: true }
→ SSE event stream of text/event-stream lines
→ input_json_delta events accumulate partial JSON in a string buffer
→ full JSON assembled on stream end, parsed once
→ result = JSON.parse(fullBuffer) or extracted via fullMatch regex
```

### Request Body Addition

Add `"stream": true` to the request body. All other fields (model, max_tokens, system, tools, tool_choice, messages) are unchanged.

### Response Consumption

The response body is consumed as a `ReadableStream`:

```
reader = response.body.getReader()
decoder = new TextDecoder()

loop:
  { done, value } = await reader.read()
  if done: break
  chunk = decoder.decode(value, { stream: true })
  for each SSE line starting with "data: ":
    event = JSON.parse(line.slice(6))
    if event.type === 'content_block_delta' && event.delta.type === 'input_json_delta':
      buffer += event.delta.partial_json ?? ''
      [check for early translation extraction — see below]
```

### Early Translation Extraction

Once `"translation"` appears complete in the buffer, it is extracted and rendered immediately without waiting for the full token array:

```
match = buffer.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*?)"/)
if match:
  translation = JSON.parse('"' + match[1] + '"')   // unescape
  renderTranslation(translation)                    // via textContent only
```

**Security constraint (Principle I)**: The extracted translation string MUST be rendered via `.textContent` only. It must not be assigned to `.innerHTML` or interpolated into an HTML template string.

### Final Parse

After stream end, the complete tool input JSON is extracted from the buffer:

```
fullMatch = buffer.match(/(\{[\s\S]*\})/)
if fullMatch:
  data = JSON.parse(fullMatch[1])
  validateResponse(data)      // existing validation unchanged
  renderTokens(data.tokens)   // existing render unchanged
```

### Byte Cap Guard

If the cumulative byte count of received chunks exceeds `MAX_RESPONSE_BYTES` (50KB), the reader is cancelled and a `ValidationError` is thrown. The translation display (if already emitted) is cleared.

---

## What Did Not Change

- Tool name: `linguistic_analysis`
- `input_schema` structure (all fields, types, required/optional rules) — identical to v3.2
- System prompt generation via `buildSystemPrompt(lang, preTranslation)` — unchanged
- Tool choice: `{ type: 'tool', name: 'linguistic_analysis' }` — unchanged
- Post-response merge of `preTranslation` — unchanged (applied after parse)
- `validateResponse()` — unchanged (called on the assembled JSON)

---

## Contract Stability Note

Per constitution Principle III: tool schema changes require a contract update in the same commit. This addendum is required because the transport change affects how the tool input is assembled — even though the schema itself is stable. Future changes to the tool schema continue to require contract amendments per v3.2 conventions.

---

# AI Prompt Contract Addendum: v3.4

**Version**: 3.4 (addendum to v3.3)
**Date**: 2026-06-01
**Amends**: `specs/006-memory-perf-opt/contracts/ai-prompt-contract.md` (v3.3)

---

## Change Summary

A new `text_translation` tool is introduced for the **large-text translation-only path** (`translateOnly()` in `lib/analyzer.js`). This tool is called exclusively when the input exceeds `LARGE_TEXT_THRESHOLD` (2 000 chars). The `linguistic_analysis` tool and its streaming transport (v3.3) are **unchanged**.

---

## New Tool: `text_translation`

### When Used

Called by `translateOnly(text, apiKey, options)` in `lib/analyzer.js` when `text.length > LARGE_TEXT_THRESHOLD`. Never called by the standard `analyzeText()` path.

### Tool Definition

```json
{
  "name": "text_translation",
  "description": "Translate the input text to English.",
  "input_schema": {
    "type": "object",
    "properties": {
      "translation": {
        "type": "string",
        "description": "Natural English translation of the full input text"
      }
    },
    "required": ["translation"]
  }
}
```

### Request Body

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
  "messages": [{ "role": "user", "content": "<input text>" }]
}
```

**No `"stream": true`** — this path uses a batch (non-streaming) response. The response is small and arrives as a single JSON body.

### Response Consumption

```
body = await response.json()
toolInput = body.content?.find(b => b.type === 'tool_use')?.input
if (!toolInput?.translation):
  throw new JsonError('No translation returned. Please retry.')
return { translation: toolInput.translation, tokens: [] }
```

**Security constraint (Principle I)**: The extracted `translation` string MUST be rendered via `.textContent` only — identical constraint as v3.3.

### Error Handling

Same typed error classes as `analyzeText()`: `ApiError` (4xx/5xx HTTP), `NetworkError` (fetch failure), `JsonError` (malformed body or missing `translation`), `TimeoutError` (TIMEOUT_MS exceeded). `AbortController` signal honored.

---

## What Did Not Change (v3.4)

- `linguistic_analysis` tool name, schema, and transport — unchanged from v3.3
- SSE streaming consumer logic — unchanged
- `validateResponse()` — not called by `translateOnly()`; unchanged
- `buildSystemPrompt()` / `buildAnalysisTool()` — not called by `translateOnly()`; unchanged
