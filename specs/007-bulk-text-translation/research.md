# Research: Bulk Text Translation

**Feature**: 007-bulk-text-translation | **Date**: 2026-06-01

---

## Decision 1 — Queue Module Architecture

**Decision**: New `lib/bulk-translator.js` module. `BulkTranslator` class encapsulates chunking, rate limiting, cache-first dispatch, and sequential API dispatch. `lib/analyzer.js` is not restructured.

**Rationale**: `analyzer.js` already handles two distinct pipelines (full analysis + translation-only) and is complex. Adding a third responsibility (queue orchestration) would make it unmanageable. A dedicated module has a single responsibility and is easier to test.

**Alternatives considered**:
- Extend `analyzer.js` with queue logic — rejected: violates separation of concerns; `analyzer.js` already 330+ lines
- Add to `popup.js` inline — rejected: business logic in UI code; untestable in isolation

---

## Decision 2 — Sliding Window Rate Limiter

**Decision**: New `lib/rate-limiter.js`, class `SlidingWindowRateLimiter(maxRequests, windowMs)`. Implementation: array of timestamps. On each dispatch request, remove timestamps older than `windowMs`, then check `count >= maxRequests`. If over limit, `waitForSlot()` resolves when the oldest timestamp expires. Default: `50 requests / 60 000 ms`.

**Rationale**: Sliding window chosen per spec clarification Q2. The timestamp array approach is O(n) on window size but n ≤ maxRequests (50 max), making it negligible. Works in a browser extension context without a separate process.

**Alternatives considered**:
- Token bucket — rejected in spec (Q2 decision)
- Fixed window — rejected: boundary spike problem at window edges risks burst-triggering 429s

**API rate limit context**: Claude API default tier enforces 1000 RPM. A conservative 50 req/60 s (≈ 833 RPM effective max) leaves 17% headroom to absorb other concurrent requests.

---

## Decision 3 — Cache-First Dispatch Interface

**Decision**: Reuse `getCached(chunk)` from `lib/history.js` for cache lookup before each API dispatch. Cache key is the normalized chunk text (exact match on `entry.input`). On hit, return `entry.translation` immediately — no API call, no rate limiter slot consumed.

**Rationale**: `getCached()` already implements the lookup correctly. `entry.translation` is a direct string field on every history entry. No new cache API is needed.

**Alternatives considered**:
- Hash-based lookup — rejected: `history.js` stores and matches by exact normalized text, which is sufficient and avoids adding a hashing dependency

**Write policy**: Individual chunks are NOT written to `lingua_history_v1`. A 50-chunk forum post would evict most of the 75-entry LRU history. Instead, the fully assembled post translation is written as one entry after the queue completes (with `tokens: []` for translation-only mode). Individual chunks benefit from cache only if they were previously translated as standalone inputs.

---

## Decision 4 — Prompt Context Cache Strategy

**Decision**: Independent per-chunk calls to `translateOnly()`, each with `cache_control: { type: 'ephemeral' }` on the system prompt and `text_translation` tool. Pre-warm on popup open ensures the first chunk also gets a system-prompt cache hit. No multi-turn conversation accumulation.

**Rationale**: The large fixed cost per API call is the system prompt + tool definition (hundreds of tokens). With `cache_control: { type: 'ephemeral' }`, these are written to cache on the first call and read cheaply on calls 2-N within the 5-minute TTL. Pre-warming shifts the cache-write to popup open, so no request in the user's queue pays a cold-cache penalty.

Multi-turn conversation accumulation would add the assistant + user turns from previous chunks to each new request, growing the prompt linearly. For a 50-chunk queue, the final request would carry ~49 previous Q&A pairs. The added token cost outweighs the marginal caching benefit.

**Alternatives considered**:
- Multi-turn accumulation — rejected: O(n²) token growth; cache savings on additional turns are small relative to the accumulated message overhead

---

## Decision 5 — Per-Chunk Timeout

**Decision**: `CHUNK_TIMEOUT_MS = 15_000` (15 seconds). Exported from `lib/analyzer.js`. Existing `TIMEOUT_MS = 30_000` unchanged.

**Rationale**: A 500-character chunk is significantly smaller than the 2 000-character limit used for the existing 30-second timeout. At typical Claude throughput, a 500-char translation completes in 1-3 seconds. A 15-second timeout gives 5-10× margin without leaving a stalled queue waiting 30 seconds per failed unit.

**Gate 4 note**: Constitution Gate 4 checks agreement between `TIMEOUT_MS` and `specs/001-lingua-word-breakdown/spec.md FR-013`. `TIMEOUT_MS` is unchanged. `CHUNK_TIMEOUT_MS` is a new export documented here and in this plan.

---

## Decision 6 — Retry Implementation

**Decision**: Exponential backoff loop in `BulkTranslator._dispatchUnit()`. On `ApiError` with HTTP 429, retry up to 3 times with delays 1 000 ms → 2 000 ms → 4 000 ms. After 3 failures, mark unit as failed and continue. Uses `await new Promise(r => setTimeout(r, delay))`. Retry does not consume a new rate-limiter slot (retries bypass the sliding window).

**Rationale**: Retries for 429 represent waiting for the server's rate-limit window to reset. Running them through the sliding window again would double-count the request and potentially delay the retry unnecessarily.

**Alternatives considered**:
- Honour the Retry-After header from the 429 response — deferred: requires reading the response headers on a 429 fetch, adding complexity. The fixed exponential schedule is sufficient for v1 since the API's window is short.

---

## Decision 7 — Chunking Algorithm

**Decision**: `chunkText(text, targetSize = 500)` in `lib/bulk-translator.js`. Algorithm:
1. Split on double newline (`\n\n`), then single newline (`\n`) to get paragraph/line segments.
2. For each segment, if length ≤ `targetSize`, keep as one unit.
3. If longer, split by character window at `targetSize`, breaking at the last space before the limit (or hard-cut for CJK where there are no spaces).
4. Collect all units, filtering empty strings.

**Rationale**: Language-agnostic — works for Latin, CJK, Arabic, Thai without any script-detection dependency. Predictable unit sizes make rate-limit math trivial. Paragraph/line-boundary preference preserves semantic context within each chunk.

**Alternatives considered**:
- Sentence-boundary detection (NLP-based) — rejected: unreliable for CJK/Thai; adds external dependency; overkill for translation-only output
- Fixed hard-cut only — rejected: breaks mid-word in Latin scripts; paragraph preference gives better translation coherence

---

## Decision 8 — Pre-Warm Implementation

**Decision**: `prewarmCache(apiKey)` exported from `lib/bulk-translator.js`. Fires `POST /v1/messages` with `max_tokens: 0`. Same system prompt and tool structure as `translateOnly()`, with `cache_control: { type: 'ephemeral' }`. Errors are caught and silently suppressed — pre-warm failure does not affect the user. Called from `popup.js` `DOMContentLoaded` handler alongside existing key fetch.

**Rationale**: `max_tokens: 0` causes the API to process the prompt, write the cache, and return immediately with no output tokens billed. Cost is identical to the cache-write charge the first real request would pay anyway, so pre-warming is cost-neutral from the user's perspective.

**API documentation basis**: Anthropic supports `max_tokens: 0` for prompt cache pre-warming. Confirmed in Claude API caching docs.

---

## Decision 9 — Replace-on-Submit Behavior

**Decision**: `BulkTranslator` exposes a single `abort()` method backed by an `AbortController`. When the user submits a new translation while a queue is running, `popup.js` calls `currentTranslator.abort()`, discards the instance, and creates a new `BulkTranslator`. No partial results are preserved.

**Rationale**: Simplest state model. Forum-post translation intent is "translate what I'm looking at now" — the user has navigated away from the previous post. Queuing behind the old job would be confusing.
