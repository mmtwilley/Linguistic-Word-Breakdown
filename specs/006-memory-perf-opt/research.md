# Research: Streaming & History Memory Optimization

**Feature**: 006-memory-perf-opt | **Date**: 2026-05-31

---

## Decision 1: Constitution Amendment Strategy

**Decision**: Amend Principle V with a targeted carve-out for the user-controlled persistent store rather than overriding or removing the principle.

**Rationale**: A full removal of Principle V would eliminate important privacy protections (no telemetry, key redaction from logs, permission minimization). A targeted carve-out preserves those protections while explicitly permitting the new behavior. The amendment text names the specific storage key (`lingua_history_v1`), the specific retention limits (75-entry LRU, 4MB ceiling), and the user's ability to clear the store — making the exception as narrow as the feature requires.

**Alternatives considered**:
- Remove Principle V entirely — rejected; would lose protections for API key handling, telemetry prohibition, and permission minimization that are still valuable
- Add a new Principle VI for persistence — rejected; creates two overlapping principles covering the same concern, increasing governance complexity

---

## Decision 2: Streaming Implementation Approach

**Decision**: Simple hybrid — stream to detect translation early, accumulate full JSON buffer, parse once at stream end.

**Rationale**: Incremental token emission via brace-matching is significantly more complex to implement correctly and maintain. The translation field is the highest-value early signal (appears first in the JSON structure Claude produces). Regex extraction of the translation from the partial buffer works reliably for the translation string specifically. Full parse at stream end gives correct, simple handling for the complete token array. The user perceives the biggest improvement (translation visible in ~300–500ms) with no added fragility.

**Alternatives considered**:
- Full incremental token emission (brace-matching) — rejected; requires per-character state machine, handles edge cases poorly (nested objects, unicode in string values), increases maintenance surface significantly
- No streaming at all (status quo batch call) — rejected; doesn't satisfy SC-001 (translation within 1s perceived)

**Translation regex**:
```
/"translation"\s*:\s*"((?:[^"\\]|\\.)*?)"/
```
Match group 1 is the raw escaped string; must be JSON-parsed (`JSON.parse('"' + match[1] + '"')`) to unescape sequences before rendering.

**Buffer safety**: Two guards required:
1. Hard byte cap: track `totalBytes += chunk.byteLength`; abort at `MAX_RESPONSE_BYTES = 51200` (50KB)
2. Buffer trim after translation emitted: once translation is captured, slice buffer to start of `"tokens"` key to prevent unbounded growth during the long token stream

---

## Decision 3: Storage Format — Shared Key Schema + Native Compression

**Decision**: Two-part approach: (1) store tokens in a shared-key schema (columnar format) per entry; (2) compress the serialized token store with the native Compression Streams API when the JSON payload exceeds 500 bytes.

**Rationale**:

**Format (Option C — Shared Key Schema)**: Field names are stored once per `AnalysisEntry` instead of once per token. A 20-token entry with named objects repeats 8 field names 20 times — roughly 120 bytes of key-name overhead per token, ~2,400 bytes total. Positional arrays eliminate this but are positionally fragile: `row[4]` is opaque without the spec, and a future field inserted at position 4 silently corrupts all existing entries. The shared-key schema stores field names once per entry (~70 bytes) and token values as positional rows, giving the same byte savings as positional arrays while remaining self-documenting — `schema[i]` names `row[i]` for every row. Aligns with Principle II's no-magic-numbers spirit.

**Compression (Option E — Compression Streams API)**: The native `CompressionStream('gzip')` is available from Chromium 80, covering every Chrome user running this extension. No library needed. Applied to the serialized token store, gzip achieves 60–70% reduction on token JSON (repeated short strings compress well even without redundant key names). For 75 entries the difference is ~262KB → ~90KB, well within SC-003's 1MB target and the 4MB ceiling. A 500-byte threshold avoids adding overhead on tiny entries (single-token results, punctuation) where compressed + base64 is larger than raw JSON. `chrome.storage` requires JSON-serializable values, so the compressed bytes are base64-encoded; gzip's typical 65–70% reduction comfortably absorbs the ~33% base64 expansion, netting ~50% final size reduction vs. uncompressed.

**Alternatives considered**:
- **A — Positional Arrays (prior choice)**: Same byte efficiency as Option C, but positionally fragile — `row[4]` requires the spec to interpret, and inserting a field at any position other than the end silently corrupts old entries. Superseded by Option C, which keeps per-row positional values but adds a self-documenting `schema` field.
- **B — Abbreviated Keys (`{w, l, p, m}`)**: Saves ~60–70% of named-object key-name overhead, slightly less than columnar format. Better compression patterns under gzip than positional arrays due to repeated short keys — but this advantage disappears when compression is applied to either format. Less readable than full names; no significant advantage over Option C once compression is in place.
- **D — MessagePack**: With gzip applied to both JSON and MessagePack the size difference is ~140 bytes at 75-entry scale — negligible. Requires base64 encoding for `chrome.storage` (binary blobs not JSON-serializable), recovering ~33% of the compressed size. No native browser decoding; requires a library (~8kB). Rejected.
- **E — Compression Streams API**: Adopted as the compression layer. Zero dependencies, native Chrome support. Only cost is async encode/decode on each token read/write, negligible against the storage I/O already present.
- **F — Omit IPA entirely**: IPA strings average 15–20 chars per token, representing ~10% of a typical 20-token entry. If Web Speech API audio is implemented (on the roadmap), stored IPA becomes redundant on restore. Deferred — not adopted now, but noted as the highest-impact single-field removal if budget pressure increases later.

---

## Decision 4: Unified Store Architecture

**Decision**: Single `lingua_history_v1` key in `chrome.storage.local` holding an array of `AnalysisEntry` objects, sorted newest-first. Cache lookup is an `O(n)` linear scan on `entry.input === normalizedText`; history display is the same array, first 10 entries.

**Rationale**: A separate cache key and history key would require two storage reads on every analysis submission and two writes on every new entry. With 75 entries as the cap, `O(n)` scan completes in microseconds — well within the 200ms SC-002 target. Unified store halves storage writes, eliminates the risk of cache/history desync, and keeps the module surface minimal.

**Alternatives considered**:
- `Map` keyed on normalized input + separate ordered history array — rejected; duplicates data; two writes per entry
- IndexedDB — rejected; significantly more complex API, async cursor-based reads, no meaningful benefit at 75-entry scale; also violates Principle II's no-dependency spirit

**Storage key naming**: `lingua_history_v1` — version suffix allows future breaking changes to use `lingua_history_v2` without conflicting with old entries.

**Known scaling paths** (not applicable now, revisit if cap grows or popup architecture changes):

- **Two-key + in-memory index** (`lingua_index_v1` Map): Adds O(1) lookup by splitting the index into a separate storage key and rebuilding a `Map` on popup open. The O(n) scan at 75 entries completes in microseconds and is not a measurable factor for SC-002. The in-memory `Map` is also destroyed on popup close (MV3 popup lifecycle), so it gives no benefit on the first lookup after each open. Becomes relevant at ~300+ entries where the linear scan accumulates. The natural next step if the cap grows significantly.

- **`chrome.storage.session` as hot tier**: Use `chrome.storage.session` (10MB quota, browser-session-scoped, faster reads) as a promotion cache in front of `chrome.storage.local`. On a local hit, write the entry to session storage; subsequent lookups skip the local read. Interesting in theory, but the popup is destroyed on close — the session layer only helps if the user closes and reopens the popup in the same browser session. The added complexity (two async reads on miss, a promotion write on hit, two storage APIs) does not pay for itself at current scale. Becomes genuinely attractive if a service worker is introduced to maintain a warm cache across popup opens, since the service worker outlives the popup and would keep the session layer populated.

---

## Decision 5: AbortController Wiring

**Decision**: Create a module-level `AbortController` in `popup.js` that is reset on each new analysis. Pass its `signal` to `analyzeText()`. Add a `disconnect` or `unload` handler that calls `abort()` when the popup closes.

**Rationale**: Without explicit abort, a streaming fetch that completes after the popup DOM is destroyed will invoke callbacks that call `renderTranslation()` and `renderTokens()` on detached elements. `AbortController` cancels the in-flight fetch cleanly; the stream callbacks check `signal.aborted` before any DOM write.

**Chrome MV3 consideration**: Popup scripts are destroyed when the popup closes; `beforeunload` fires reliably for extension popups. Alternatively, `window.addEventListener('unload', () => controller.abort())` is the safest pattern.

---

## Decision 6: StorageError Class

**Decision**: Add `StorageError extends Error` to `lib/errors/index.js`. Throw it from `history.js` when `chrome.storage.local.set()` rejects. Catch it in `popup.js`, log to console, and do not surface to the user.

**Rationale**: Constitution Principle IV prohibits silent swallows. Logging satisfies the principle. Spec FR-014 prohibits surfacing storage errors to the user as analysis errors. Both constraints are satisfied by: catch → log → continue (do not rethrow, do not call `showError()`).

---

## Decision 7: Renderer Partial State

**Decision**: Extract a `renderTranslation(text)` function from `lib/renderer.js` (or add it as a standalone export) that renders only the translation banner before tokens are available. The existing `renderTokens(tokens)` call is unchanged and fires after stream completion.

**Rationale**: The popup currently renders translation and tokens together after a full API response. The streaming path needs a two-phase render: (1) translation early, (2) tokens after. Splitting the render function is the minimal change — no structural rework to `renderer.js` required.

---

## Storage Budget

| Store | Key | Max entries | Approx. size | Total |
|-------|-----|-------------|--------------|-------|
| Unified history/cache | `lingua_history_v1` | 75 | ~1.2KB/entry (columnar + compressed) | ~90KB |
| API keys | `apiKey`, `deeplKey` | — | ~120B | ~120B |
| **Total** | | | | **~90KB** |

Budget headroom: ~3.9MB below the 4MB safety ceiling. The 5MB Chrome quota leaves ~4.9MB unused. Entries below the 500-byte compression threshold (punctuation, short single-token inputs) are stored uncompressed; worst-case uncompressed 75-entry store is ~262KB, still well within budget.

---

## Decision 8: Large Text Translation Mode

**Decision**: Route inputs above `LARGE_TEXT_THRESHOLD` (2 000 chars) to a dedicated `translateOnly()` function that calls Claude with a minimal `text_translation` tool (translation field only, no tokens). The input ceiling is raised from 2 000 to 10 000 chars for this path. Full word analysis continues unchanged for inputs ≤ 2 000 chars.

**Rationale**: The binding constraint for full analysis is `MAX_TOKENS_API = 4096` — a 2 000-char input with Korean grammar can generate 300+ tokens, each with particles and endings, easily exhausting the 4 096-token response budget. Translating without breakdown produces a response of ~500–800 tokens at most, well within budget even for 10 000-char input. Splitting into two code paths at the same threshold as the current validation limit keeps existing behavior unchanged while unlocking the new use case. No new API permissions or libraries are required.

**Rationale for 2 000-char threshold** (not 500 or 1 000): Keeps the switchover exactly where the current `MAX_INPUT_CHARS` limit sits — users submitting text ≤ 2 000 chars get identical behavior to today; users submitting longer text get translation-only. No regression in the existing user experience.

**`translateOnly()` approach**:
- Batch POST (no SSE streaming): translation-only response is small (~200–800 tokens) and arrives in a single chunk; streaming complexity adds no perceived benefit
- Tool schema: `text_translation` with a single required `translation: string` field (documented in contracts/ai-prompt-contract.md v3.4)
- `max_tokens = 2048`: sufficient for the English translation of a 10 000-char input in most languages
- System prompt: `"Translate the input text to English using the text_translation tool."` — short, cacheable
- Same `AbortController` signal wired from popup; same `TIMEOUT_MS` guard
- Returns `{ translation: string, tokens: [] }` — compatible with `addEntry()` and `renderTranslation()`

**Storage**: Translation-only entries stored as normal `AnalysisEntry` with `translationOnly: true` and an empty `TokenStore ({ schema: [...], rows: [] })`. Storage footprint is tiny (~200 bytes/entry before compression). Cache and history lookup paths are unchanged.

**Alternatives considered**:
- **Chunking large input**: Split into N-sentence batches, run full analysis on each, merge results. Rejected — correct sentence boundary detection for Korean/Japanese requires a parser we don't have; merging token arrays across chunks is error-prone; latency multiplies with request count; far outside the no-dependency constraint.
- **Increasing `MAX_TOKENS_API` for all requests**: Setting `max_tokens = 8192` on the existing full-analysis path increases cost and latency on every call to accommodate a rare large-input case. Rejected in favour of a conditional per-call `max_tokens`.
- **Streaming translation-only response**: SSE adds ~200 ms of overhead (SSE handshake, event parsing) for a response that typically arrives complete in a single chunk anyway. Not worth the added complexity for this path. If translation latency proves to be an issue in practice, streaming can be added later.
