# Tasks: Bulk Text Translation

**Feature**: 007-bulk-text-translation | **Date**: 2026-06-01
**Input**: [plan.md](plan.md), [spec.md](spec.md), [data-model.md](data-model.md), [research.md](research.md)
**Spec**: [spec.md](spec.md) — 4 user stories (P1–P4), 18 functional requirements

**Tests**: Not generated — spec does not request TDD. Validation uses [quickstart.md](quickstart.md) manual test procedures.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency on another in-progress task)
- **[Story]**: Which user story this task belongs to (US1–US4)
- All paths are relative to `extension/`

---

## Phase 1: Setup

**Purpose**: Verify the hard prerequisite from feature 006 and set up the unit test runner before writing any new code.

- [x] T000 Set up Node.js native unit test runner: create `tests/unit/` directory; confirm `node --test --experimental-vm-modules tests/unit/*.test.js` resolves ES module imports; add a one-line `.nvmrc` or document the required Node version (≥18) in a `tests/README.md`; no npm packages required — Node built-in `node:test` and `node:assert` are sufficient
- [x] T001 Verify `translateOnly()` is exported from `lib/analyzer.js` (feature 006 prerequisite — if missing, complete and merge feature 006 first; all phases are blocked until this export exists)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: New constant export and rate-limiter module that `BulkTranslator` depends on. Both must be complete before any user story phase begins.

**⚠️ CRITICAL**: T002 and T003 both block the entire Phase 3 start.

- [x] T002 Export `CHUNK_TIMEOUT_MS = 15_000` from `lib/analyzer.js` alongside the existing `TIMEOUT_MS` export — add as a named constant below `TIMEOUT_MS`; used by `BulkTranslator._dispatchUnit()` to configure the per-chunk `AbortController` timeout
- [x] T002a [P] Extract `TRANSLATION_SYSTEM_PROMPT` and `TEXT_TRANSLATION_TOOL` constants from `lib/analyzer.js`: (1) find the inline system prompt string literal inside `translateOnly()` (the text used as the `system` message array element), move it to a named module-level `export const TRANSLATION_SYSTEM_PROMPT = '...'`, replace the inline string with the constant; (2) find the tool definition object used by `translateOnly()` (the object passed as the `tools` array element), move it to a named module-level `export const TEXT_TRANSLATION_TOOL = { … }`, replace the inline object with the constant — `prewarmCache()` in `lib/bulk-translator.js` imports **both** exports and uses them verbatim; exact text and structural equality between the pre-warm call and every queue dispatch call is required for the API prompt cache slot to match (depends on T001)
- [x] T003 [P] Create `lib/rate-limiter.js`: export `class SlidingWindowRateLimiter` with `constructor(maxRequests = 50, windowMs = 60_000)` (initialises `this.timestamps = []`, `this.maxRequests`, `this.windowMs`); `async waitForSlot()` (prunes entries older than `windowMs`, `await`s via `setTimeout` until `timestamps.length < maxRequests`); `record()` (appends `Date.now()` to `timestamps`)
- [x] T003a [P] Write unit tests for `SlidingWindowRateLimiter` in `tests/unit/rate-limiter.test.js` (depends on T000, T003): (1) `waitForSlot()` resolves immediately when `timestamps.length < maxRequests`; (2) `record()` appends a timestamp within the current window; (3) `waitForSlot()` delays resolution when at capacity — use a short `windowMs` (e.g., 100 ms) to keep tests fast; (4) stale timestamps older than `windowMs` are pruned on the next `waitForSlot()` call; run via `node --test --experimental-vm-modules tests/unit/rate-limiter.test.js`

**Checkpoint**: T002 and T003 done → BulkTranslator implementation can begin

---

## Phase 3: User Story 1 — Translate a Full Forum Post (P1) 🎯 MVP

**Goal**: User pastes a long forum post; the extension chunks it, processes it sequentially via a client-side queue, and streams translated results progressively to the UI as each unit completes. The assembled translation is stored in `lingua_history_v1` on queue completion.

**Independent Test**: Paste a 1,000–5,000 word foreign-language forum post → confirm (1) translated chunks appear progressively in `#bulk-results`; (2) `#bulk-progress` counter updates per chunk; (3) full output assembled without truncation; (4) DevTools Network shows one POST per cache-miss chunk; (5) Application → Local Storage shows one new `lingua_history_v1` entry with `lang:'UND'`.

### Implementation for User Story 1

- [x] T004 [US1] Create `lib/bulk-translator.js` scaffold: import `{ translateOnly, CHUNK_TIMEOUT_MS, TRANSLATION_SYSTEM_PROMPT, TEXT_TRANSLATION_TOOL }` from `./analyzer.js`; import `{ getCached, addEntry }` from `./history.js`; import `{ SlidingWindowRateLimiter }` from `./rate-limiter.js`; import `{ ApiError, ValidationError }` from `./errors/index.js`; declare module-level constants `CHUNK_TARGET_SIZE = 500`, `MAX_RETRIES = 3`, `RETRY_BASE_MS = 1_000`, `MAX_BULK_CHARS = 30_000`; declare `const sleep = ms => new Promise(r => setTimeout(r, ms))` (depends on T002, T002a, T003)
- [x] T005 [P] [US1] Implement `chunkText(text, targetSize = CHUNK_TARGET_SIZE)` in `lib/bulk-translator.js`: split text on `\n\n` then `\n` to get paragraph/line segments; for each segment ≤ `targetSize` keep as one unit; for oversized segments slide a character window breaking at the last space before the limit (or hard-cut at `targetSize` for CJK/no-space scripts); filter empty strings; return `QueueUnit[]` where each unit is `{ index, text, status:'pending', translation:null, retries:0, fromCache:false }`; export the function (depends on T004)
- [x] T006 [P] [US1] Implement `validateBulkInput(text)` in `lib/bulk-translator.js`: if `text.length > MAX_BULK_CHARS` throw `new ValidationError('text', 'Text is too long for bulk translation. Maximum is approximately 5 000 words.')`; export the function (depends on T004)
- [x] T007 [P] [US1] Implement `export async function prewarmCache(apiKey)` in `lib/bulk-translator.js`: `POST` to `https://api.anthropic.com/v1/messages` with `max_tokens: 0`, system array `[{ type:'text', text: TRANSLATION_SYSTEM_PROMPT, cache_control:{ type:'ephemeral' } }]` (using the import from T002a — **do not hardcode this string**), tools array `[{ ...TEXT_TRANSLATION_TOOL, cache_control:{ type:'ephemeral' } }]` (using the import from T002a — **do not inline the schema**), `tool_choice:{ type:'tool', name:'text_translation' }`, `messages:[{ role:'user', content:'warmup' }]`; wrap entire function body in `try { … } catch { console.warn('[Lingua] Cache pre-warm failed (non-fatal)') }`; do not read or render the response body — the pre-warm and every `translateOnly()` call must reference the same exported constants so the API prompt cache slot matches across all requests in the session (depends on T004, T002a)
- [x] T008 [US1] Implement `class BulkTranslator` in `lib/bulk-translator.js`: `constructor(text)` calls `validateBulkInput(text)`, sets `this.units = chunkText(text)`, `this.session = { units:this.units, total:this.units.length, completed:0, failed:0, cancelled:false }`, `this.abortController = new AbortController()`, `this._rateLimiter = new SlidingWindowRateLimiter()`; `abort()` method sets `this.session.cancelled = true` and calls `this.abortController.abort()`; export the class (depends on T005, T006, T003)
- [x] T009 [US1] Implement `BulkTranslator._dispatchUnit(unit, apiKey, deeplKey, callbacks)` in `lib/bulk-translator.js`: (1) cache-first: `const cached = await getCached(unit.text)`; if `cached?.translation` set `unit.status='hit'`, `unit.translation=cached.translation`, `unit.fromCache=true` and return; (2) `await this._rateLimiter.waitForSlot()`; `this._rateLimiter.record()`; (3) retry loop: `let delay = RETRY_BASE_MS`; `for (let attempt = 0; attempt <= MAX_RETRIES; attempt++)`: create a per-chunk abort controller **linked to the parent**: `const chunkController = new AbortController(); const onParentAbort = () => chunkController.abort(); this.abortController.signal.addEventListener('abort', onParentAbort, { once: true })`; set per-chunk timeout: `const chunkTimer = setTimeout(() => chunkController.abort(), CHUNK_TIMEOUT_MS)`; set `unit.status = 'translating'`; `try { const result = await translateOnly(unit.text, apiKey, deeplKey, { signal: chunkController.signal }); clearTimeout(chunkTimer); this.abortController.signal.removeEventListener('abort', onParentAbort); unit.status = 'done'; unit.translation = result.translation; return; } catch(err) { clearTimeout(chunkTimer); this.abortController.signal.removeEventListener('abort', onParentAbort); if (err instanceof ApiError && err.status === 429 && attempt < MAX_RETRIES) { unit.retries++; if (delay >= 5_000) callbacks.onRateLimitDelay?.(delay); await sleep(delay); delay *= 2; continue; } unit.status = 'failed'; console.warn('[Lingua] Bulk unit failed:', err.message); return; }` — linking `chunkController` to `this.abortController.signal` via the `abort` event listener ensures that when the user cancels (T016 calls `abort()`), the in-flight `translateOnly()` fetch is cancelled immediately via its `signal`, satisfying FR-005 and SC-009 (depends on T008, T002)
- [x] T010 [US1] Implement `async BulkTranslator.runQueue(apiKey, deeplKey, callbacks)` in `lib/bulk-translator.js`: iterate over `this.units` in order; after each unit check `this.session.cancelled` and `break` if true; `await this._dispatchUnit(unit, apiKey, deeplKey, callbacks)`; if `unit.status === 'done' || unit.status === 'hit'` increment `this.session.completed`; if `unit.status === 'failed'` increment `this.session.failed`; call `callbacks.onUnitComplete?.(unit, this.session)`; after loop call `callbacks.onQueueComplete?.(this.session)` (depends on T009)
- [x] T011 [US1] Implement assembled result write inside `runQueue()` onQueueComplete path in `lib/bulk-translator.js`: after all units are processed, if `this.session.completed > 0`: `const fullInput = this.units.map(u => u.text).join(' ').trim()`; `const fullTranslation = this.units.filter(u => u.status === 'done' || u.status === 'hit').map(u => u.translation).join('\n\n')`; `await addEntry({ translation: fullTranslation, tokens: [] }, fullInput, 'UND')` — this writes the assembled post as one `lingua_history_v1` entry without polluting history with individual chunks (depends on T010)
- [x] T012 [P] [US1] Add bulk translate panel to `popup/popup.html`: add `<section id="bulk-section">` containing `<textarea id="bulk-input" placeholder="Paste forum post here…"></textarea>`, `<button id="bulk-submit" type="button">Translate</button>`, `<button id="bulk-cancel" type="button" hidden>Cancel</button>`, `<span id="bulk-progress"></span>`, `<span id="bulk-status"></span>`, `<span id="bulk-cache-stats"></span>`, `<div id="bulk-results"></div>`; no `onclick`, `oninput`, or `onload` attributes on any element; all interaction wired via `addEventListener` in `popup.js`
- [x] T013 [US1] Wire `BulkTranslator` in `popup/popup.js`: add `import { BulkTranslator, prewarmCache } from '../lib/bulk-translator.js'`; in `DOMContentLoaded` after `getKeys()` resolves, call `prewarmCache(apiKey)` (non-blocking, fire-and-forget); declare `let currentTranslator = null`; add `addEventListener` on `#bulk-submit`: call `currentTranslator?.abort()`, clear `#bulk-results` (`bulkResults.textContent = ''`), clear `#bulk-status`, try: create `currentTranslator = new BulkTranslator(bulkInput.value)`, show `#bulk-cancel`, call `currentTranslator.runQueue(apiKey, deeplKey, { onUnitComplete(unit, session) { const p = document.createElement('p'); p.textContent = unit.translation ?? '[Translation failed]'; bulkResults.appendChild(p); }, onQueueComplete(session) { bulkCancel.hidden = true; console.info('[Lingua] Queue complete:', session.completed, 'done,', session.units.filter(u=>u.fromCache).length, 'cache hits'); }, onRateLimitDelay(delayMs) {} })`; catch `ValidationError`: display `err.message` in `#bulk-results` via `textContent` and do not call `runQueue()` (depends on T008, T011, T012, T007) **— Principle I gate (before marking complete): confirm every DOM write in this task uses `.textContent`; confirm no `innerHTML` is present; confirm `#bulk-submit` wired via `addEventListener` not an inline attribute**
- [x] T014 [US1] Implement over-length display in `popup/popup.js`: in the `#bulk-submit` handler catch block, on `ValidationError` set `bulkResults.textContent = err.message`; on any other unexpected error set `bulkResults.textContent = 'Translation failed. Please try again.'`; in both cases ensure `#bulk-cancel` remains hidden (depends on T013) **— Principle I gate (before marking complete): confirm error messages are set via `.textContent` only; confirm no string concatenation of user input into HTML**
- [x] T014a [P] [US1] Write unit tests for `chunkText()` and `validateBulkInput()` in `tests/unit/bulk-translator.test.js` (depends on T000, T005, T006): chunkText — (1) text ≤500 chars returns one unit; (2) two-paragraph text (joined by `\n\n`) returns two units; (3) oversized single segment (600 chars, no spaces) is hard-cut at 500; (4) multi-paragraph CJK text is chunked without corruption; validateBulkInput — (5) text.length ≤ MAX_BULK_CHARS does not throw; (6) text.length > MAX_BULK_CHARS throws `ValidationError` with message containing "5 000 words"; run via `node --test --experimental-vm-modules tests/unit/bulk-translator.test.js`

**Checkpoint**: User Story 1 complete — forum post translates progressively; results stream chunk by chunk; assembled translation stored in `lingua_history_v1`

---

## Phase 4: User Story 2 — Progress Visibility During Queue Processing (P2)

**Goal**: User sees a live "N of M translated" counter; can cancel the queue mid-run; completed chunks remain visible after cancel.

**Independent Test**: Submit a 2,000-word post → confirm `#bulk-progress` updates after each chunk ("1 of 8 translated" → "2 of 8 translated" …); click Cancel after 2-3 chunks → confirm queue halts, rendered chunks remain in `#bulk-results`, no further Network requests fire.

### Implementation for User Story 2

- [x] T015 [US2] Add progress counter update in `popup/popup.js` `onUnitComplete` callback: after appending chunk paragraph, set `bulkProgress.textContent = \`${session.completed} of ${session.total} translated\`` (depends on T013)
- [x] T015a [US2] Display cache stats in `popup/popup.js` `onQueueComplete` callback: compute `const hits = session.units.filter(u => u.fromCache).length`; set `bulkCacheStats.textContent = hits > 0 ? \`${hits} of ${session.total} from cache\` : ''`; this satisfies SC-012 without DevTools (depends on T013, T015)
- [x] T016 [US2] Wire cancel button in `popup/popup.js`: `addEventListener` on `#bulk-cancel`; on click: call `currentTranslator?.abort()`; set `bulkProgress.textContent = 'Cancelled.'`; hide `#bulk-cancel` (set `bulkCancel.hidden = true`); do not clear `#bulk-results` — preserve already-rendered chunk output (depends on T013)
- [x] T017 [US2] Show/hide `#bulk-cancel` lifecycle in `popup/popup.js`: show `bulkCancel.hidden = false` immediately when `runQueue()` is called; hide `bulkCancel.hidden = true` inside `onQueueComplete` handler when queue finishes normally (depends on T013, T016)
- [x] T018 [P] [US2] Add CSS for bulk translate panel in `popup/popup.css`: `#bulk-section` (display, margin), `#bulk-input` (width:100%, min-height:120px, box-sizing:border-box), `#bulk-results` (overflow-y:auto, max-height:300px, border), `#bulk-results p` (border-bottom, padding, margin:0), `#bulk-progress` (font-size:0.85em, color:var(--muted)), `#bulk-cache-stats` (font-size:0.8em, color:var(--muted), margin-left:8px), `#bulk-cancel` (margin-left:8px)
- [x] T018a [P] [US1] Add `white-space: pre-wrap` to the `#bulk-results p` rule in `popup/popup.css` — this preserves `\n` characters within a translated chunk as visible line breaks in the rendered output, satisfying FR-012 (MUST: "preserve paragraph structure and line breaks") and making SC-007 achievable; `textContent` assignment in T013 remains the write path so no security implication exists; one declaration added to the rule created by T018 (depends on T018)

**Checkpoint**: User Story 2 complete — progress visible per chunk; cancel halts queue within 1 s (SC-009)

---

## Phase 5: User Story 3 — Rate Limit Handling Without User Disruption (P3)

**Goal**: 429 responses trigger automatic exponential backoff retry (1 s → 2 s → 4 s); if the wait exceeds 5 s a non-blocking status message appears in `#bulk-status`; failed units are skipped and the queue continues.

**Independent Test**: Intercept a chunk request via DevTools and return 429 → confirm retry delays visible in Network tab (1 s, 2 s, 4 s gaps); if delay ≥ 5 s confirm `#bulk-status` shows rate-limit message; confirm queue resumes and remaining chunks translate.

### Implementation for User Story 3

- [x] T019 [US3] Connect `onRateLimitDelay` callback in `BulkTranslator._dispatchUnit()` in `lib/bulk-translator.js`: the retry path in T009 already calls `callbacks.onRateLimitDelay?.(delay)` when `delay >= 5_000` — verify this call is present and the `callbacks` argument is threaded correctly from `runQueue()` → `_dispatchUnit()` (no new logic required if T009 was implemented per spec; this task is a targeted review and fix pass) (depends on T009, T010)
- [x] T020 [US3] Wire `onRateLimitDelay` in `popup/popup.js` `runQueue()` callbacks: in the `onRateLimitDelay(delayMs)` callback set `bulkStatus.textContent = \`Rate limit reached — retrying in ${Math.ceil(delayMs / 1000)} s…\``; in `onUnitComplete` clear `bulkStatus.textContent = ''` after a successful unit (so message disappears once queue resumes); also clear in `onQueueComplete` (depends on T013, T019)
- [x] T021 [P] [US3] Add CSS for rate-limit status message in `popup/popup.css`: `#bulk-status` (font-size:0.8em, color:var(--muted), font-style:italic, display:block, min-height:1.2em)

**Checkpoint**: User Story 3 complete — 429s handled automatically without user action; SC-008 achievable

---

## Phase 6: User Story 4 — Input Sanitization and Security (P4)

**Goal**: Forum posts containing HTML, `<script>` tags, or injection attempts produce safe plain-text translated output. No unsafe content is executed or rendered during or after translation.

**Independent Test**: Paste `<script>alert(1)</script><b>hello</b>` into `#bulk-input` → translate → confirm no alert fires; confirm `#bulk-results` shows plain translated text; run quickstart.md grep commands; confirm zero `innerHTML` calls in new files.

### Implementation for User Story 4

- [x] T022 [P] [US4] Audit `lib/bulk-translator.js` for Principle I compliance: grep for `innerHTML`, `outerHTML`; confirm zero occurrences; grep for `catch` blocks and confirm each has `console.warn` or `rethrow` (no bare `{}`); confirm `apiKey` does not appear in any string passed to `console.log`, `console.warn`, or `console.error`
- [x] T023 [P] [US4] Audit `popup/popup.js` bulk sections for Principle I compliance: grep for `innerHTML`; confirm all chunk result writes use `.textContent`; confirm `#bulk-progress` and `#bulk-status` updates use `.textContent`; confirm `#bulk-submit` and `#bulk-cancel` event handlers are wired via `addEventListener` (not inline attributes)
- [x] T024 [P] [US4] Audit `popup/popup.html` bulk panel for Principle I compliance: grep for `onclick`, `oninput`, `onload`; confirm zero inline event handler attributes on any element inside `#bulk-section`; confirm no template literals producing HTML strings from user-supplied data in any script tag

**Checkpoint**: User Story 4 complete — constitution Principle I gates pass across all new code

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Timeout wiring verification, pre-warm smoke test, history write check, full quickstart.md run.

- [x] T025 [P] Verify `CHUNK_TIMEOUT_MS` is imported in `lib/bulk-translator.js` and the per-chunk `AbortController` timeout is set correctly in `_dispatchUnit()` — `const chunkTimer = setTimeout(() => chunkController.abort(), CHUNK_TIMEOUT_MS)` — and that `clearTimeout(chunkTimer)` is called in both success and failure branches
- [ ] T026 [P] Verify `prewarmCache()` fires on popup open via DevTools Network tab: open popup → confirm a `POST` to `api.anthropic.com/v1/messages` fires within 2 s with `"max_tokens":0` in the request body; confirm no response body is consumed (quickstart.md pre-warm verification)
- [ ] T027 [P] Verify assembled result write to `lingua_history_v1` after queue completion: translate a forum post to completion → DevTools → Application → Local Storage → confirm one new entry with `input` = full concatenated text, `translation` = full assembled output, `lang = 'UND'`, `tokens.rows` = empty array
- [ ] T028 [P] Run quickstart.md manual test scenarios: (1) happy path small post (~500 words), (2) happy path large post (~5 000 words), (3) cache hit (translate same post twice), (4) cancel mid-queue, (5) replace-on-submit (new post while queue running), (6) over-length input (>30 000 chars)
- [x] T029 Run quickstart.md constitution compliance greps and confirm all pass: no `innerHTML` in `lib/bulk-translator.js` or `popup/popup.js`; no `onclick` in `popup/popup.html`; no `require` or external `from` in `lib/bulk-translator.js` or `lib/rate-limiter.js`; no empty `catch {}` blocks in new lib files; **Constitution Quality Gate 3**: confirm `contracts/ai-prompt-contract.md` v3.5 field names, required/optional flags, and types in the `text_translation` tool schema match `TEXT_TRANSLATION_TOOL` in `lib/analyzer.js` — run `grep -A 30 'TEXT_TRANSLATION_TOOL' lib/analyzer.js` and compare against the contract's `input_schema` section

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verify first; all later phases blocked if `translateOnly()` is missing
- **Foundational (Phase 2)**: Depends on Phase 1 confirmation — T002 and T003 BLOCK Phase 3+
- **Phase 3 (US1)**: Depends on T002 + T003 complete
- **Phase 4 (US2)**: Depends on Phase 3 (US1) complete — extends US1 UI with progress layer
- **Phase 5 (US3)**: Depends on Phase 3 (US1) complete — extends T009 retry path with UI callback
- **Phase 6 (US4)**: Depends on Phases 3–5 complete — audits all new code
- **Phase 7 (Polish)**: Depends on Phases 3–6 complete

### Within Phase 3 (US1) — Sequential Core

```
T004 (scaffold) → T005 [P], T006 [P], T007 [P], T008
T008 → T009 → T010 → T011
T012 [P] (popup.html — can run alongside T005–T011)
T013 (popup.js wiring — depends on T008, T011, T012)
T014 (error display — depends on T013)
```

### Parallel Opportunities

| Tasks | Reason |
|-------|--------|
| T002, T003 | Different files; no interdependency |
| T003a, T005 (after T003) | T003a tests rate-limiter; T005 starts bulk-translator scaffold — different files |
| T005, T006, T007 (after T004) | Independent functions in same file; different agents can draft each |
| T009–T011, T012 | T012 is HTML-only; no conflict with lib tasks |
| T014a, T015 (after T014) | T014a is a unit test file; T015 adds to popup.js — different files |
| T018, T021 | CSS-only tasks; different rules |
| T022, T023, T024 | Audit tasks on different files |
| T025, T026, T027, T028 | Verification tasks; all read-only |

---

## Parallel Example: Phase 2

```
After T001 (verified):
  ├── T002: Export CHUNK_TIMEOUT_MS from lib/analyzer.js
  └── T003: Create lib/rate-limiter.js
```

## Parallel Example: Phase 3 (US1)

```
After T004 (scaffold):
  ├── T005: chunkText()
  ├── T006: validateBulkInput()
  ├── T007: prewarmCache()
  └── T008: BulkTranslator class (needs T005, T006)

After T008:
  ├── T009: _dispatchUnit() (needs T008)
  └── T012: popup.html bulk panel  ← independent, run alongside

After T009 → T010 → T011:
  └── T013: popup.js wiring (needs T008, T011, T012)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 — verify `translateOnly()` exists
2. Phase 2 — T002 + T003 (foundational, ~30 min)
3. Phase 3 — T004–T014 (core BulkTranslator + popup wiring)
4. **STOP AND VALIDATE**: paste a real forum post; confirm progressive output; check `lingua_history_v1`
5. **Ship MVP** — users can translate forum posts end-to-end

### Incremental Delivery

| Phase | Adds | Validates |
|-------|------|-----------|
| 1 + 2 | Foundation | Dependencies resolved |
| + 3 (US1) | Core queue + streaming | MVP: translate any forum post |
| + 4 (US2) | Progress counter + cancel | Improved UX |
| + 5 (US3) | Rate-limit transparency | Production-ready |
| + 6 (US4) | Security audit | Constitution compliance confirmed |
| + 7 | Polish + quickstart | Feature complete |

---

## Notes

- **[P] tasks** operate on different files or are pure functions with no blocking in-flight dependency — safe to run in parallel
- **[Story] label** maps each task to its user story for traceability to spec.md
- **No test tasks generated** — spec does not request TDD; all validation via quickstart.md manual procedures
- **Feature 006 hard dependency** — `translateOnly()` missing from `lib/analyzer.js` blocks everything; resolve before any Phase 2 work
- **DOM writes** — all user-controlled content in new code must use `.textContent`; `innerHTML` is prohibited (Principle I)
- **No external packages** — no npm, no bundler, no transpiler (Principle II)
- Commit after each phase checkpoint to preserve progress on `007-bulk-text-translation` branch
