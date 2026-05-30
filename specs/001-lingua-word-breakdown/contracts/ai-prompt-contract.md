# AI Prompt Contract: Linguistic Analysis

**Version**: 2.0 | **Date**: 2026-05-29

This document defines the exact structure of requests sent to the Claude API and the expected
response shape. All values here are authoritative and must stay in sync with `lib/analyzer.js`.

---

## Endpoint

```
POST https://api.anthropic.com/v1/messages
```

## Request Headers

| Header                                    | Value                                  |
|-------------------------------------------|----------------------------------------|
| `x-api-key`                               | `<user-configured API key>`            |
| `anthropic-version`                       | `2023-06-01`                           |
| `anthropic-beta`                          | `prompt-caching-2024-07-31`            |
| `content-type`                            | `application/json`                     |
| `anthropic-dangerous-direct-browser-access` | `true`                               |

> `anthropic-dangerous-direct-browser-access` is required for direct browser-to-API calls
> from a Chrome Extension. `anthropic-beta: prompt-caching-2024-07-31` enables caching of
> the system message (see Prompt Caching below).

## Request Body Shape

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "system": [
    {
      "type": "text",
      "text": "<system-prompt — see below>",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "tools": [ /* ANALYSIS_TOOL — see below */ ],
  "tool_choice": { "type": "tool", "name": "linguistic_analysis" },
  "messages": [
    {
      "role": "user",
      "content": "<raw input text from user>"
    }
  ]
}
```

`tool_choice: { type: "tool", name: "linguistic_analysis" }` forces Claude to always invoke
the tool; it never returns freeform text.

---

## System Prompt (verbatim)

```
Analyze the input text for language learning using the linguistic_analysis tool.

For each word:
- lemma: base/dictionary form (Korean: stem without attached particles)
- pos: noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other
- meaning: short English gloss (5 words max)
- romanization: Latin transliteration for non-Latin scripts (Korean: Revised Romanization, Chinese: Pinyin, Japanese: Hepburn). Omit for Latin-script words.
- pronunciation: IPA transcription for non-Latin scripts and non-obvious pronunciations. Omit otherwise.
- particles: Korean grammatical markers only — topic (-은/-는), subject (-이/-가), object (-을/-를), sentence-end (-이네/-이까/-이다/-이네다). Omit if none.
```

### Prompt Caching

The system message is sent with `cache_control: { type: "ephemeral" }`. Anthropic caches this
content for up to 5 minutes, reducing latency and cost on repeated calls within the same
cache window (e.g., multiple analyses in a single popup session).

---

## ANALYSIS_TOOL Declaration

```json
{
  "name": "linguistic_analysis",
  "description": "Structured word-level linguistic breakdown of input text for language learning.",
  "input_schema": {
    "type": "object",
    "properties": {
      "translation": {
        "type": "string",
        "description": "Natural English translation of the full input"
      },
      "tokens": {
        "type": "array",
        "description": "One entry per input word, preserving order",
        "items": {
          "type": "object",
          "properties": {
            "word":          { "type": "string" },
            "lemma":         { "type": "string" },
            "pos":           { "type": "string" },
            "meaning":       { "type": "string" },
            "romanization":  { "type": "string" },
            "pronunciation": { "type": "string" },
            "particles": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "form":    { "type": "string" },
                  "type":    { "type": "string" },
                  "meaning": { "type": "string" }
                },
                "required": ["form", "type", "meaning"]
              }
            }
          },
          "required": ["word", "lemma", "pos", "meaning"]
        }
      }
    },
    "required": ["translation", "tokens"]
  }
}
```

### Field Reference

**Required token fields:**

| Field     | Type   | Description |
|-----------|--------|-------------|
| `word`    | string | Exact surface form from input |
| `lemma`   | string | Base dictionary form |
| `pos`     | string | POS tag — one of: `noun verb adj adv pron prep conj det num punct other` |
| `meaning` | string | Short English gloss, max 5 words |

**Optional token fields:**

| Field           | Type            | When included | Notes |
|-----------------|-----------------|---------------|-------|
| `romanization`  | string          | Non-Latin-script languages only | Korean: Revised Romanization; Chinese: Pinyin; Japanese: Hepburn |
| `pronunciation` | string          | Non-Latin scripts and non-obvious Latin pronunciations | IPA transcription |
| `particles`     | array of object | Agglutinative languages (primarily Korean) when markers are attached | Each particle has `form` (exact marker), `type` (see below), `meaning` |

**Valid `particles[].type` values:** `topic`, `subject`, `object`, `sentence-end`, `other-particle`

**Valid `pos` values:** `noun`, `verb`, `adj`, `adv`, `pron`, `prep`, `conj`, `det`, `num`, `punct`, `other`

---

## Response Extraction

Claude returns a `message` object. Extract the tool result as follows:

```js
const toolUse = data.content?.find(
  b => b.type === 'tool_use' && b.name === 'linguistic_analysis'
);
if (!toolUse?.input || typeof toolUse.input !== 'object') {
  throw new JsonError('Unexpected response format. Please retry.');
}
const result = validateResponse(toolUse.input);
```

> **Never** use `response.content[0].text` or `JSON.parse()` on raw text. The API is always
> invoked with `tool_choice: { type: "tool" }`, so the response is always a structured
> `tool_use` block, not freeform text.

**Example** (input: `"Ich liebe Sprachen"`):

`toolUse.input`:

```json
{
  "translation": "I love languages.",
  "tokens": [
    { "word": "Ich",      "lemma": "ich",     "pos": "pron", "meaning": "I" },
    { "word": "liebe",    "lemma": "lieben",  "pos": "verb", "meaning": "love" },
    { "word": "Sprachen", "lemma": "Sprache", "pos": "noun", "meaning": "languages" }
  ]
}
```

**Example** (input: `"저는 학생이에요"`):

`toolUse.input`:

```json
{
  "translation": "I am a student.",
  "tokens": [
    {
      "word": "저는", "lemma": "저", "pos": "pron", "meaning": "I (polite)",
      "romanization": "jeo-neun", "pronunciation": "t͡ɕʌnɯn",
      "particles": [{ "form": "-는", "type": "topic", "meaning": "topic marker" }]
    },
    {
      "word": "학생이에요", "lemma": "학생", "pos": "noun", "meaning": "student",
      "romanization": "haksaeng-i-e-yo", "pronunciation": "hak̚s͈ɛŋieɾo"
    }
  ]
}
```

---

## Error Handling

### HTTP Error Responses

| Status | Name | Detection | User Message | Action |
|--------|------|-----------|--------------|--------|
| 401 | Unauthorized | `response.status === 401` | "Invalid or expired API key. Check your settings." | Show Settings view; prompt user to update key |
| 429 | Rate Limited | `response.status === 429` | "You've made too many requests. Please wait a moment before trying again." | Show wait message; user must click Retry manually |
| 500–599 | Server Error | `response.status >= 500` | "Claude API is temporarily unavailable. Please try again." | Show Retry button |

### Network Errors

| Error | Detection | User Message | Notes |
|-------|-----------|--------------|-------|
| Connection failed | `fetch()` throws `TypeError` / `NetworkError` | "Network error. Check your internet connection and try again." | Likely DNS/WiFi issue |
| Timeout (>30s) | `AbortController` signal fires after 30,000 ms | "Request took too long (30s). Please try again." | 30s accommodates larger payloads from optional fields |

### Response Parsing Errors

| Error | Detection | User Message | Debug Log |
|-------|-----------|--------------|-----------|
| Not a tool_use block | `content.find(...)` returns undefined | "Unexpected response format. Please retry." | Log content array structure |
| Not JSON / malformed | `response.json()` throws | "Unexpected response format. Please retry." | Log raw response (first 200 chars) |
| Missing `translation` | `!data.translation` | "Incomplete response. Please retry." | Log response structure |
| Missing `tokens` array | `!Array.isArray(data.tokens)` | "Incomplete response. Please retry." | Log response structure |
| Empty tokens array | `data.tokens.length === 0` | "No analysis returned. Please retry." | Log response |

### Token Validation

| Error | Detection | User Message | Action |
|-------|-----------|--------------|--------|
| Token missing required field | `!token.word \|\| !token.lemma \|\| !token.pos \|\| !token.meaning` | "Incomplete analysis (missing field). Please retry." | Log field name and token index |
| Invalid POS tag | `pos` not in `VALID_POS` set | (No error shown to user) | `console.warn`; silently correct to `'other'` |
| Invalid particle type | `particles[].type` not in `VALID_PARTICLE_TYPES` | (No error shown to user) | `console.warn`; silently correct to `'other-particle'` |
| Token count mismatch | `tokens.length !== inputWordCount` | (No error shown; results displayed) | `console.warn`; accept as-is |
| Optional field malformed | `romanization` / `pronunciation` present but not a non-empty string | (No error shown) | Delete the field; continue |

### Response Size Limits

| Limit | Trigger | User Message |
|-------|---------|--------------|
| Response > 50 KB | `JSON.stringify(response).length > 51200` | "Response too large. Please try a shorter input." |
| > 500 tokens | `data.tokens.length > 500` | "Analysis too long (>500 words). Please try a shorter input." |

### Retry Behavior

- **User-triggered retries only**: No automatic retries. User clicks Retry to resubmit.
- **Rate limiting (429)**: User must wait before retrying; no guidance on exact duration is given.
- **Idempotency**: Each retry is a fresh request; no caching or deduplication.

---

## Contract Stability

- This contract is authoritative. Any change to the tool schema (`ANALYSIS_TOOL`), system prompt,
  or constants (`TIMEOUT_MS`, `MAX_TOKENS_API`) in `lib/analyzer.js` **must** be reflected here
  in the same commit.
- The tool name `linguistic_analysis` is stable for v1. Renaming requires a version bump here.
- Model upgrades require re-testing the tool use output format before shipping.
- Optional fields (`romanization`, `pronunciation`, `particles`) may be extended in future versions
  by adding properties to `ANALYSIS_TOOL.input_schema.items.properties` and updating this document.
