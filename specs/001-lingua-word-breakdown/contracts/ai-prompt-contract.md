# AI Prompt Contract: Linguistic Analysis

**Version**: 1.0 | **Date**: 2026-05-03

This document defines the exact prompt structure sent to the Claude API to produce the linguistic breakdown JSON.

---

## Endpoint

```
POST https://api.anthropic.com/v1/messages
```

## Request Headers

| Header              | Value                        |
|---------------------|------------------------------|
| `x-api-key`         | `<user-configured API key>`  |
| `anthropic-version` | `2023-06-01`                 |
| `content-type`      | `application/json`           |

## Request Body Shape

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2048,
  "system": "<system-prompt — see below>",
  "messages": [
    {
      "role": "user",
      "content": "<raw input text from user>"
    }
  ]
}
```

---

## System Prompt (verbatim)

```
Translate the input text and produce a word-level linguistic breakdown for language learning.

Input: A single string of text in any language.

Output: Return ONLY valid JSON. No explanations, no markdown, no extra text.

Schema:
{
  "translation": "string",
  "tokens": [
    {
      "word": "string",
      "lemma": "string",
      "pos": "string",
      "meaning": "string"
    }
  ]
}

Rules:
- translation: natural English rendering of the full sentence
- tokens: one entry per original word, preserving order
- word: exact surface form from input
- lemma: base dictionary form of the word
- pos: simple part-of-speech tag (noun, verb, adj, adv, pron, prep, conj, det, num, punct, other)
- meaning: short English gloss (max 1 short phrase, ideally 5 words or fewer)
- If uncertain, choose the most likely interpretation given sentence context
- Do not include any text outside the JSON object
- Keep output concise and consistent for UI rendering
```

---

## Expected Response

Claude returns a `message` object. The linguistic JSON is in:

```
response.content[0].text
```

This string must be parseable with `JSON.parse()` into an `AnalysisResult` object.

**Example** (input: `"Ich liebe Sprachen"`):

```json
{
  "translation": "I love languages.",
  "tokens": [
    { "word": "Ich",      "lemma": "ich",      "pos": "pron", "meaning": "I" },
    { "word": "liebe",    "lemma": "lieben",   "pos": "verb", "meaning": "love" },
    { "word": "Sprachen", "lemma": "Sprache",  "pos": "noun", "meaning": "languages" }
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
| 500–599 | Server Error | `response.status >= 500` | "Claude API is temporarily unavailable. Please try again." | Show Retry button; suggest user wait a moment |

### Network Errors

| Error | Detection | User Message | Notes |
|-------|-----------|--------------|-------|
| Connection failed | `fetch()` throws `TypeError` or `NetworkError` | "Network error. Check your internet connection and try again." | Likely DNS/WiFi issue |
| Timeout (>10s) | `AbortController` signal fires after 10s | "Request took too long. Please try again." | API or network latency issue |

### Response Parsing Errors

| Error | Detection | User Message | Debug Log |
|-------|-----------|--------------|-----------|
| Not JSON | `JSON.parse()` throws `SyntaxError` | "Unexpected response format. Please retry." | Log raw response (first 200 chars) |
| Missing `translation` field | `!response.translation` | "Incomplete response. Please retry." | Log response structure |
| Missing `tokens` array | `!Array.isArray(response.tokens)` | "Incomplete response. Please retry." | Log response structure |
| Empty tokens array | `response.tokens.length === 0` | "No analysis returned. Please retry." | Log response |

### Token Validation Errors

| Error | Detection | User Message | Action |
|-------|-----------|--------------|--------|
| Token missing field | `!token.word \|\| !token.lemma \|\| !token.pos \|\| !token.meaning` | "Incomplete analysis (missing field). Please retry." | Log which field, which token index |
| Invalid POS tag | `pos` not in vocabulary | (No error shown to user) | Log warning; silently set `pos = 'other'` and continue |
| Token count mismatch | `tokens.length !== inputWordCount` | (No error shown; results displayed) | Log warning; accept results as-is |

### Response Size Limits

| Limit | Trigger | User Message |
|-------|---------|--------------|
| Response > 50 KB | `JSON.stringify(response).length > 51200` | "Response too large. Please try a shorter input." |
| > 500 tokens | `response.tokens.length > 500` | "Analysis too long (>500 words). Please try a shorter input." |

### Retry Behavior

- **User-triggered retries**: User clicks Retry button to re-submit the same input text with the same API key.
- **No automatic retries**: The extension does not automatically retry failed requests.
- **Rate limiting**: If user receives 429 error, Claude is rate-limiting the API key. User must wait (recommendation: 60 seconds) before retrying.
- **Idempotency**: Each retry is a fresh request; no request deduplication or caching.

---

## Contract Stability

- The system prompt is the authoritative contract. Any change to the prompt must be versioned here.
- The JSON schema (`translation` + `tokens[]` with `word`, `lemma`, `pos`, `meaning`) is fixed for v1.
- Model upgrades (e.g., switching to a newer Claude version) require re-testing the output format before shipping.
