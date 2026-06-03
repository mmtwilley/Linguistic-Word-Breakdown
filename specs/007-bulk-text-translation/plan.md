# Implementation Plan: Bulk Text Translation

**Branch**: `007-bulk-text-translation` | **Date**: 2026-06-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/007-bulk-text-translation/spec.md`

## Summary

Adds a bulk translation mode for large forum posts. Input text (up to ~30 000 characters / 5 000 words) is split into ~500-character chunks at paragraph boundaries and processed sequentially through a client-side queue. Each chunk is checked against `lingua_history_v1` first (cache hit → instant, free). Cache misses are dispatched via the existing `text_translation` tool (`translateOnly()` from feature 006) with a sliding-window rate limiter (50 req / 60 s) and exponential-backoff retry on 429 (up to 3 retries: 1 s → 2 s → 4 s). Results stream progressively to the user as each unit completes. A pre-warm request fires on popup open to ensure the first queue unit also hits the Claude API prompt cache. New submission while a queue is running cancels and replaces it.

## Technical Context

**Language/Version**: Vanilla JavaScript ES2022+ (no transpiler, no bundler)
**Primary Dependencies**: None at runtime; Claude API (`claude-sonnet-4-6`), `chrome.storage.local`, existing `lib/` modules
**Storage**: `chrome.storage.local` via `lingua_history_v1` (existing key, existing 75-entry LRU cap)
**Testing**: Manual via Chrome DevTools per `specs/007-bulk-text-translation/quickstart.md`
**Target Platform**: Chrome Extension (Chromium), Manifest V3, extension popup
**Project Type**: Browser extension — single-user, popup-scoped sessions
**Performance Goals**: First chunk visible ≤ 5 s (SC-002); ≤2 000-word post complete ≤ 30 s (SC-003); ≤5 000-word post complete ≤ 60 s (SC-004); cancel response ≤ 1 s (SC-009)
**Constraints**: Vanilla JS only (Principle II); `MAX_BULK_CHARS = 30_000`; `CHUNK_TARGET_SIZE = 500`; `CHUNK_TIMEOUT_MS = 15_000`; `TIMEOUT_MS = 30_000` unchanged; 75-entry LRU cap unchanged; 4 MB write ceiling unchanged
**Scale/Scope**: Single-user; up to 60 queue units per submission; 50 API req / 60 s rate limit

## Constitution Check

*Gates evaluated against `constitution.md` v1.1.0. Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Principle I — Security-First Rendering

| Check | Status | Notes |
|-------|--------|-------|
| Chunk translations rendered via `.textContent` only | ✅ PASS | `BulkTranslator` emits plain strings; `popup.js` renders via `textContent` on progress items |
| No `innerHTML` on translated content | ✅ PASS | Bulk results panel uses text-only DOM construction |
| No inline JS event handlers | ✅ PASS | Cancel button and bulk submit wired via `addEventListener` |
| Pre-warm response not rendered | ✅ PASS | `prewarmCache()` discards response body |

### Principle II — Vanilla JavaScript, No Build Step

| Check | Status | Notes |
|-------|--------|-------|
| No new runtime dependencies | ✅ PASS | `bulk-translator.js` and `rate-limiter.js` are plain ES modules; no npm packages |
| All new files directly loadable by Chrome | ✅ PASS | Standard ES module syntax; no bundler needed |

### Principle III — Structured API Contracts

| Check | Status | Notes |
|-------|--------|-------|
| `text_translation` tool reused for queue chunks | ✅ PASS | No new tool schema; bulk path calls `translateOnly()` unchanged |
| Pre-warm request pattern documented | ✅ PASS | v3.5 addendum covers `max_tokens: 0` pre-warm and queue chunk dispatch |
| Contract document created | ✅ PASS | `specs/007-bulk-text-translation/contracts/ai-prompt-contract.md` (v3.5) |

### Principle IV — Typed Error Handling

| Check | Status | Notes |
|-------|--------|-------|
| 429 retry exhausted → `ApiError` surfaced per-unit | ✅ PASS | Unit marked failed; error message shown inline; queue continues |
| Per-chunk timeout → `TimeoutError` | ✅ PASS | `AbortController` at `CHUNK_TIMEOUT_MS` triggers `TimeoutError` in `translateOnly()` |
| Queue cancel → clean abort, no swallowed error | ✅ PASS | Cancellation returns `null` from `translateOnly()` (existing pattern); `BulkTranslator` handles gracefully |
| Pre-warm error silently suppressed | ⚠️ NOTED | Pre-warm failure has no user impact; suppression is intentional, not a silent failure. `console.warn` added per Principle IV spirit. |
| No bare `catch {}` blocks in new code | ✅ PASS | All catch blocks in `bulk-translator.js` log or rethrow |

### Principle V — Minimal Data Retention

| Check | Status | Notes |
|-------|--------|-------|
| Individual chunks NOT written to `lingua_history_v1` | ✅ PASS | Only assembled post written on completion; 75-entry cap unaffected |
| Assembled result written via existing `addEntry()` | ✅ PASS | `tokens: []` for translation-only entries; supported by existing schema |
| No API keys in console output or error messages | ✅ PASS | Pre-warm and dispatch use `apiKey` only in `x-api-key` header |
| Pre-warm calls `api.anthropic.com` only | ✅ PASS | Already in `host_permissions`; no new permissions needed |
| `CHUNK_TIMEOUT_MS` exported and documented | ✅ PASS | New constant; Gate 4 applies to `TIMEOUT_MS` (unchanged); noted here |

**Constitution verdict: ALL GATES PASS. No violations. No amendments required.**

## Project Structure

### Documentation (this feature)

```text
specs/007-bulk-text-translation/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — 9 decisions
├── data-model.md        # Phase 1 output — QueueUnit, BulkTranslationSession, constants
├── quickstart.md        # Phase 1 output — manual test procedures
├── contracts/
│   └── ai-prompt-contract.md   # v3.5 — pre-warm + queue chunk dispatch
└── tasks.md             # /speckit-tasks output (NOT created by /speckit-plan)
```

### Source Code

```text
lib/
├── bulk-translator.js   NEW — BulkTranslator class: chunkText(), runQueue(), prewarmCache()
├── rate-limiter.js      NEW — SlidingWindowRateLimiter class
├── analyzer.js          MODIFIED — export CHUNK_TIMEOUT_MS = 15_000
├── history.js           NO CHANGE — getCached() and addEntry() reused as-is
└── errors/index.js      NO CHANGE — existing typed error classes sufficient

popup/
├── popup.js             MODIFIED — prewarmCache() on init; bulk translate mode; queue lifecycle
├── popup.html           MODIFIED — bulk translate panel, progress indicator, cancel button
└── popup.css            MODIFIED — bulk translation UI styles

background/
└── service-worker.js    NO CHANGE — bulk translation initiated from popup only
```

**Structure decision**: Single flat extension project (no build step; Principle II). Two new lib files only. No new directories in `extension/`. No changes to `manifest.json`, `package.json`, or test runner configuration.

## Design Decisions

### 1. BulkTranslator Class (FR-002, FR-003, FR-004, FR-005)

`lib/bulk-translator.js` exports `BulkTranslator`. Key methods:

- `chunkText(text)` → `QueueUnit[]` — splits at paragraph/line boundaries, falls back to character window for oversized segments; works on all scripts
- `runQueue(apiKey, deeplKey, callbacks)` → async generator yielding `{ unit, assembled }` on each completion
- `abort()` — signals `AbortController`; halts queue and any in-flight fetch

`BulkTranslator` is instantiated per submission. `popup.js` holds a reference to the active instance; on new submission, calls `currentTranslator?.abort()` before constructing a fresh one.

### 2. SlidingWindowRateLimiter (FR-007, FR-014)

`lib/rate-limiter.js` exports `SlidingWindowRateLimiter`. Interface:

- `constructor(maxRequests = 50, windowMs = 60_000)`
- `async waitForSlot()` — prunes stale timestamps, resolves when a slot is available
- `record()` — appends current timestamp after a slot is granted

Cache hits bypass `waitForSlot()` entirely — they do not consume rate-limiter capacity.

### 3. Cache-First Dispatch (FR-015, SC-010)

For each unit before dispatching to API:

```
const cached = await getCached(unit.text);
if (cached?.translation) {
  unit.status = 'hit';
  unit.translation = cached.translation;
  unit.fromCache = true;
  return;
}
await rateLimiter.waitForSlot();
rateLimiter.record();
// → translateOnly(unit.text, apiKey, { signal: chunkSignal })
```

### 4. Retry Loop (FR-007, FR-008)

```
let delay = 1_000;
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    result = await translateOnly(unit.text, apiKey, { signal });
    unit.status = 'done';
    unit.translation = result.translation;
    return;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429 && attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= 2;
      continue;
    }
    unit.status = 'failed';
    console.warn('[Lingua] Bulk unit failed:', err.message);
    return;
  }
}
```

### 5. Progress Callbacks (FR-004, FR-010)

`runQueue()` accepts a `callbacks` object:

```js
{
  onUnitComplete(unit, session) {},   // called after each unit resolves (hit/done/failed)
  onRateLimitDelay(delayMs) {},       // called when a rate-limit wait exceeds 5 000 ms
  onQueueComplete(session) {},        // called after all units processed
}
```

`popup.js` uses these to update the progress indicator (`N of M translated`) and render each chunk's translation to the results panel via `textContent`.

### 6. Pre-Warm (FR-017, SC-011)

```js
// lib/bulk-translator.js
export async function prewarmCache(apiKey) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { /* standard headers */ },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 0,
        system: [{ type: 'text', text: TRANSLATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...TEXT_TRANSLATION_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: 'text_translation' },
        messages: [{ role: 'user', content: 'warmup' }],
      }),
    });
  } catch {
    console.warn('[Lingua] Cache pre-warm failed (non-fatal)');
  }
}
```

Called from `popup.js` `DOMContentLoaded` after `getKeys()` resolves.

### 7. Assembled Result Storage (SC-010, Principle V)

On `onQueueComplete`, if at least one unit succeeded:

```js
const fullInput = units.map(u => u.text).join(' ');
const fullTranslation = units
  .filter(u => u.status === 'done' || u.status === 'hit')
  .map(u => u.translation)
  .join('\n\n');
await addEntry({ translation: fullTranslation, tokens: [] }, fullInput, 'UND');
```

This stores the assembled post for future cache lookup as a single entry — without polluting history with individual chunks.

### 8. Over-Length Validation (FR-011)

`validateBulkInput(text)` in `lib/bulk-translator.js`:

```js
if (text.length > MAX_BULK_CHARS) {
  throw new ValidationError('text', 'Text is too long for bulk translation. Maximum is approximately 5 000 words.');
}
```

Called before chunking. User sees the error immediately; no queue starts.

## Complexity Tracking

> No unjustified constitution violations. No amendments required.
