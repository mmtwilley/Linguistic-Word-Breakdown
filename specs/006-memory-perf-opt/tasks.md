---
description: "Task list for feature 006-memory-perf-opt"
---

# Tasks: Streaming & History Memory Optimization

**Input**: Design documents from `specs/006-memory-perf-opt/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ai-prompt-contract.md ✅, quickstart.md ✅

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no unmet dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are required in every task description

---

## Phase 1: Setup

**Purpose**: Confirm development baseline before any code changes

- [ ] T001 Load extension as unpacked in Chrome with DevTools open — verify zero console errors on popup open; record current `chrome.storage.local` byte usage as SC-003/SC-005 baseline

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Error infrastructure and `lib/history.js` data layer — required by all three user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add `StorageError extends Error` class to `lib/errors/index.js` — export it alongside existing classes; no other changes to the file
- [X] T003 [P] Create `lib/history.js` with module-level constants: `HISTORY_KEY = 'lingua_history_v1'`, `MAX_ENTRIES = 75`, `QUOTA_CEILING = 4 * 1024 * 1024`, `SNIPPET_LENGTH = 60`, `PAGE_SIZE = 10`, `SCHEMA_VERSION = 1`, `COMPRESS_THRESHOLD = 500`
- [X] T004 Add `gzipBase64(json)` and `ungzipBase64(b64)` to `lib/history.js` — implement using native `CompressionStream('gzip')` / `DecompressionStream('gzip')` with `new Blob([json]).stream().pipeThrough(...)` and `new Response(stream).arrayBuffer()` / `.text()` patterns documented in `specs/006-memory-perf-opt/data-model.md`
- [X] T005 Add `packTokens(tokens)` to `lib/history.js` — build `TokenStore { schema: ["word","lemma","pos","meaning","rom","ipa","particles","endings"], rows: [...] }` from token array; if `JSON.stringify(store).length > COMPRESS_THRESHOLD` return `{ c: 1, d: await gzipBase64(JSON.stringify(store)) }`; otherwise return the raw `TokenStore`
- [X] T006 Add `unpackTokens(packed)` to `lib/history.js` — if `packed.c === 1` decompress with `ungzipBase64` and `JSON.parse`; map each row through `store.schema` back to token objects restoring `word`, `lemma`, `pos`, `meaning` always and spreading `romanization`, `pronunciation`, `particles`, `endings` only when non-empty / non-null
- [X] T007 Add `buildEntry(analysisResult, text, lang)` to `lib/history.js` — construct `AnalysisEntry` with `id = Date.now().toString(36)`, `version = SCHEMA_VERSION`, `ts = Date.now()`, `lang = lang.code`, `input = text.trim()`, `snippet = text.trim().slice(0, SNIPPET_LENGTH)`, `translation = analysisResult.translation`, `tokens = await packTokens(analysisResult.tokens)`

**Checkpoint**: `lib/errors/index.js` exports `StorageError`; `lib/history.js` exports `gzipBase64`, `ungzipBase64`, `packTokens`, `unpackTokens`, `buildEntry` with no runtime errors when imported

---

## Phase 3: User Story 1 — See Translation Before Full Analysis Completes (Priority: P1) 🎯 MVP

**Goal**: Replace the batch API call with a streaming SSE consumer that extracts the translation immediately via early regex match, renders it before tokens arrive, and aborts cleanly when the popup closes or the byte cap is exceeded.

**Independent Test**: Submit any 10+ word Korean or Japanese sentence — translation text appears in under 1 second before word token cards render (SC-001). Close the popup while tokens are loading — no console errors, no `renderResults on undefined` warnings, no further network activity in DevTools.

### Implementation for User Story 1

- [X] T008 [P] [US1] Export `renderTranslation(text)` from `lib/renderer.js` — sets translation banner content exclusively via `.textContent`; no `innerHTML`, no `outerHTML`, no template literals producing HTML; must coexist with existing `renderTokens` export unchanged
- [X] T009 [P] [US1] Replace batch `fetch` with streaming SSE consumer in `lib/analyzer.js` — add module-level constant `MAX_RESPONSE_BYTES = 51200`; add `stream: true` to request body; acquire `response.body.getReader()` with `new TextDecoder()`; loop `reader.read()` until done; parse each SSE line prefixed with `data: ` as JSON; accumulate `input_json_delta` partial JSON to a string buffer; track `totalBytes += chunk.byteLength`; cancel reader and throw `ValidationError` if `totalBytes > MAX_RESPONSE_BYTES`; extract full tool input at stream end with `/(\{[\s\S]*\})/` regex and `JSON.parse`
- [X] T010 [US1] Add early translation extraction to the streaming loop in `lib/analyzer.js` — on each buffer append test `/"translation"\s*:\s*"((?:[^"\\]|\\.)*?)"` against the buffer; on first match call `JSON.parse('"' + match[1] + '"')` to unescape then invoke the `onTranslation` callback; immediately slice buffer to the start of the `"tokens"` key to prevent unbounded growth during the long token stream
- [X] T011 [US1] Accept `AbortController` signal in `analyzeText(text, lang, options)` in `lib/analyzer.js` — check `options.signal?.aborted` before each callback invocation; pass `signal` to `fetch`; on byte cap abort: cancel reader, clear any partial translation display, throw `ValidationError`
- [X] T012 [P] [US1] Add module-level `AbortController` to `popup/popup.js` — declare `let controller` at module scope; reset with `controller = new AbortController()` at the start of each new analysis submission; add `window.addEventListener('unload', () => controller.abort())` once during popup init
- [X] T013 [US1] Add `addEntry(analysisResult, text, lang)` to `lib/history.js` — call `buildEntry` to construct the entry; read `lingua_history_v1` (default `[]`); remove any existing entry with the same `input` (deduplication); prepend new entry; trim to `MAX_ENTRIES` with `history.splice(MAX_ENTRIES)`; compute `new TextEncoder().encode(JSON.stringify(history)).length`; if result exceeds `QUOTA_CEILING` splice to `Math.floor(MAX_ENTRIES / 2)`; call `chrome.storage.local.set({ lingua_history_v1: history })`; catch rejection and throw `new StorageError(message)`
- [X] T014 [US1] Update the analysis submission handler in `popup/popup.js` — pass `{ onTranslation: renderTranslation, signal: controller.signal }` to `analyzeText`; on stream completion call `await addEntry(result, text, lang)` imported from `lib/history.js`; wrap `addEntry` call in try/catch: catch `StorageError` and call `console.error` only — do NOT call `showError` (FR-014)

**Checkpoint**: Submit a 10-word Korean sentence → translation visible <1s (SC-001); storage write completes; closing popup mid-stream produces no console errors (FR-014)

---

## Phase 4: User Story 2 — History Stays Fast and Within Device Storage Limits (Priority: P2)

**Goal**: Add read operations to `lib/history.js`; build the history tab panel in `popup/popup.html`; wire lazy pagination and entry restore in `popup/popup.js` — all without touching the streaming path.

**Independent Test**: Analyze 12 distinct texts → open history tab → first 10 entries visible in <300ms (SC-004); click "Load more" → next 2 entries append; inject a version-99 entry (quickstart.md) → it does not appear in the list; click any entry → full result restores to main view with no network request (FR-011).

### Implementation for User Story 2

- [X] T015 Add `getHistory(page)` to `lib/history.js` — read `lingua_history_v1` (default `[]`); filter to `entry.version === SCHEMA_VERSION`; return `history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)` containing only `{ id, ts, lang, snippet }` per entry — do NOT call `unpackTokens` for list view
- [X] T016 [P] [US2] Add history tab to `popup/popup.html` — add tab button with `data-tab="history"`; add history panel containing `<ul id="history-list"></ul>` and `<button id="load-more">Load more</button>`; both tab button and list items must be keyboard-accessible; load-more button is hidden initially
- [X] T017 [US2] Wire history tab in `popup/popup.js` — on tab button click: call `getHistory(0)`, build each entry as a `<li>` with `document.createElement` (no `innerHTML`), set snippet via `.textContent`, append to `#history-list`; wire `#load-more` click to append next page; hide `#load-more` when returned page has fewer than `PAGE_SIZE` entries
- [X] T018 [US2] Add `getEntry(id)` to `lib/history.js` — read `lingua_history_v1`; find entry by `id`; if `entry.version !== SCHEMA_VERSION` return `null`; wrap `unpackTokens(entry.tokens)` in try/catch — on any error return `null` so the caller falls through to fresh analysis; return `{ ...entry, tokens: expandedTokens }` on success; return `null` if not found
- [X] T019 [US2] Wire history entry click in `popup/popup.js` — on `<li>` click: call `await getEntry(id)` from `lib/history.js`; call `renderTranslation(result.translation)` and `renderTokens(result.tokens)`; switch active panel to main view; no network request (FR-011)

**Checkpoint**: History tab renders 10 rows in <300ms (SC-004); 76th distinct analysis evicts the oldest entry; re-analyzing existing text updates its timestamp and moves it to position 0; version-99 injected entry absent from list; entry click restores full result instantly

---

## Phase 5: User Story 3 — Previously Analyzed Text Loads Instantly (Priority: P3)

**Goal**: Insert a cache lookup before the streaming path — hit renders immediately from local storage; miss falls through to streaming unchanged.

**Independent Test**: Submit identical text twice — second submission renders in <200ms with no `messages` request appearing in DevTools Network tab (SC-002). Submit same text with leading/trailing whitespace — cached result returned. Corrupt a cached entry's tokens field in DevTools → falls through to fresh analysis, no error shown.

### Implementation for User Story 3

- [X] T020 [US3] Add `getCached(text)` to `lib/history.js` — normalize with `text.trim()`; read `lingua_history_v1`; find first entry where `entry.version === SCHEMA_VERSION && entry.input === normalizedText`; on hit: return `{ ...entry, tokens: await unpackTokens(entry.tokens) }`; wrap `unpackTokens` in try/catch — on any error return `null` so the caller falls through to fresh analysis; return `null` on miss
- [X] T021 [US3] Update analysis submission handler in `popup/popup.js` to be cache-first — normalize input with `.trim()` before any dispatch; call `await getCached(text)` first; on hit: call `renderTranslation(result.translation)` and `renderTokens(result.tokens)` immediately, skip streaming entirely; on miss (null): run the existing streaming path established in Phase 3

**Checkpoint**: Second identical submission renders in <200ms with no network request (SC-002); whitespace-padded duplicate returns cached result; corrupted token data in storage triggers fresh analysis silently

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Timing instrumentation, security audit, UX refinements, final integration validation

- [X] T022 [P] Add timing console logs to `popup/popup.js` — log `'[Lingua] translation emitted: ' + elapsed + 'ms'` after first `renderTranslation` call in the streaming path; log `'[Lingua] cache hit: ' + elapsed + 'ms'` in the cache-hit branch; log `'[Lingua] history tab rendered: ' + elapsed + 'ms'` after the first `getHistory(0)` call resolves and entries are appended to `#history-list` (as documented in `specs/006-memory-perf-opt/quickstart.md`; verifies SC-004)
- [X] T023 [P] Security audit — run `grep -rn "innerHTML\|outerHTML" popup/ lib/` and confirm zero matches on user-derived content; run `grep -rn "onclick" popup/` and confirm zero matches; verify all new DOM writes introduced by this feature use `.textContent` (Quality Gate 1)
- [X] T024 [P] Add indeterminate loading indicator to `popup/popup.html` and `popup/popup.js` — show spinner element on analysis submission; hide it on `onTranslation` callback (translation arrived) or on any error path
- [ ] T025 Run all `specs/006-memory-perf-opt/quickstart.md` validation scenarios — SC-001 streaming timing, SC-002 cache timing, SC-003 storage bytes after 75 entries, SC-004 history tab render time, FR-014 stream abort on popup close, version-skip injection test; confirm all success criteria pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Foundational (T002 `StorageError`, T003–T007 history.js data layer)
- **US2 (Phase 4)**: Depends on Foundational; independent of US1 implementation but reads entries written by US1's `addEntry`
- **US3 (Phase 5)**: Depends on Foundational (T006 `unpackTokens`) and requires `addEntry` (T013) to have populated the store
- **Polish (Phase 6)**: Depends on all story phases complete

### User Story Dependencies

- **US1 (P1)**: Foundational complete → can start; no dependency on US2 or US3
- **US2 (P2)**: Foundational complete → can start; reads entries written by US1 but does not call US1 code
- **US3 (P3)**: Foundational + US1 T013 (`addEntry` must exist so cache has entries to hit)

### Parallel Opportunities

```
Phase 2:  T002 ‖ T003  →  T004  →  T005  →  T006  →  T007

Phase 3:  T008 (renderer.js) ‖ T009 (analyzer.js) ‖ T012 (popup.js AbortController)
            → T010 (analyzer.js, needs T009)
            → T011 (analyzer.js, needs T010)
            → T013 (history.js addEntry, needs T007)
            → T014 (popup.js handler, needs T008+T011+T012+T013)

Phase 4:  T015 (history.js getHistory) ‖ T016 (popup.html)
            → T017 (popup.js tab wiring, needs T015+T016)
            → T018 (history.js getEntry, needs T006)
            → T019 (popup.js click restore, needs T017+T018)

Phase 5:  T020  →  T021
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup baseline
2. Complete Phase 2: Foundational — **CRITICAL, blocks everything**
3. Complete Phase 3: User Story 1 (streaming + early translation + storage write)
4. **STOP and VALIDATE**: Translation <1s (SC-001); stream abort on popup close (FR-014); storage write succeeds
5. Demo: streaming translation is live and independently testable

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready
2. Phase 3 (US1) → Streaming translation + storage write → Validate SC-001
3. Phase 4 (US2) → History tab and read operations → Validate SC-003, SC-004
4. Phase 5 (US3) → Cache-first dispatch → Validate SC-002
5. Phase 6 → Timing logs, security audit, integration validation

---

## Notes

- `[P]` = different files, no unmet dependencies — tasks can run concurrently
- `[USn]` label maps each task to its user story for independent traceability
- `lib/history.js` is a new file — all additions in Phase 2 are sequential (same file being built up)
- All DOM writes in this feature MUST use `.textContent` (constitution Principle I, Quality Gate 1)
- `StorageError` MUST be caught and logged silently — never rethrown to `showError` (FR-014, constitution Principle IV)
- The `tokens` field in `lingua_history_v1` is `TokenStore | CompressedTokens` per `data-model.md` — the legacy `CompactToken[]` notation in `spec.md` Key Entities predates the Decision 3 update; `data-model.md` is authoritative
