# Data Model: Bulk Text Translation

**Feature**: 007-bulk-text-translation | **Date**: 2026-06-01

---

## Entities

### QueueUnit

Represents one chunk of text within a bulk translation queue.

| Field | Type | Notes |
|-------|------|-------|
| `index` | `number` | Position in queue (0-based); preserved in output assembly |
| `text` | `string` | The chunk text, ~500 chars, soft-broken at paragraph/line boundary |
| `status` | `'pending' \| 'hit' \| 'translating' \| 'done' \| 'failed'` | Lifecycle state |
| `translation` | `string \| null` | Resolved translation; null until status is `done` |
| `retries` | `number` | Count of 429-triggered retries attempted (0–3) |
| `fromCache` | `boolean` | True when resolved from `lingua_history_v1` without an API call |

**State transitions**:
```
pending → hit     (getCached() returns a match)
pending → translating → done    (API call succeeds)
pending → translating → failed  (retries exhausted or non-retryable error)
translating → translating       (429 retry: up to 3 times)
```

---

### BulkTranslationSession

Runtime object (not persisted). Created per user submission; discarded on cancel or replace. Passed read-only to all `runQueue()` callbacks — callers should not mutate it.

| Field | Type | Notes |
|-------|------|-------|
| `units` | `QueueUnit[]` | Ordered list of all chunks for this submission |
| `total` | `number` | `units.length` |
| `completed` | `number` | Count of units with status `done` or `hit` |
| `failed` | `number` | Count of units with status `failed` |
| `cancelled` | `boolean` | True after `BulkTranslator.abort()` is called |

**Note**: `abortController` (`AbortController`) and `_rateLimiter` (`SlidingWindowRateLimiter`) are properties of the `BulkTranslator` class, not of the session object. This keeps the session safe to hand to callbacks without exposing cancellation internals.

---

### SlidingWindowState

Internal state of `SlidingWindowRateLimiter` (not persisted).

| Field | Type | Notes |
|-------|------|-------|
| `timestamps` | `number[]` | Epoch-ms timestamps of dispatched requests (cache hits excluded) |
| `maxRequests` | `number` | Default: 50 |
| `windowMs` | `number` | Default: 60 000 ms |

**Invariant**: `timestamps` always contains only entries within the last `windowMs`. Entries are appended on dispatch and pruned on the next `waitForSlot()` call.

---

### HistoryEntry (existing, extended)

`lingua_history_v1` entries are unchanged in schema. Bulk translation writes the assembled post as one entry after a completed queue:

| Field | Value for bulk entries |
|-------|----------------------|
| `input` | Full original text (all chunks concatenated, trimmed) |
| `translation` | Full assembled translation (all chunks joined with `\n\n`) |
| `tokens` | `{ schema: [...], rows: [] }` — empty (translation-only mode) |
| `lang` | `'UND'` — bulk mode does not run script detection per chunk |

**Note**: Individual chunk text is NOT stored as separate history entries (see Research Decision 3).

---

## Constants

| Constant | Location | Value | Description |
|----------|----------|-------|-------------|
| `CHUNK_TARGET_SIZE` | `lib/bulk-translator.js` | `500` | Target character count per queue unit |
| `CHUNK_TIMEOUT_MS` | `lib/analyzer.js` | `15_000` | Per-unit API timeout in ms |
| `MAX_RETRIES` | `lib/bulk-translator.js` | `3` | Max 429-retry attempts per unit |
| `RETRY_BASE_MS` | `lib/bulk-translator.js` | `1_000` | Base exponential backoff delay (doubles each retry) |
| `RATE_LIMIT_MAX` | `lib/rate-limiter.js` | `50` | Max API requests per window |
| `RATE_LIMIT_WINDOW_MS` | `lib/rate-limiter.js` | `60_000` | Sliding window duration in ms |
| `MAX_BULK_CHARS` | `lib/bulk-translator.js` | `30_000` | Hard cap on input length (~5 000 words); rejected with `ValidationError` above this |

---

## Relationships

```
popup.js
  └── BulkTranslator (lib/bulk-translator.js)
        ├── chunkText() → QueueUnit[]
        ├── SlidingWindowRateLimiter (lib/rate-limiter.js)
        ├── getCached() ← lib/history.js    (cache-first lookup, read only)
        ├── translateOnly() ← lib/analyzer.js  (API dispatch for cache misses)
        └── addEntry() → lib/history.js     (write assembled result on completion)
```
