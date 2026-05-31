# Tasks: Tiered API Pipeline

**Input**: Design documents from `/specs/003-tiered-api-pipeline/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅

**Status**: Core implementation (lang-detect.js, translator.js, romanizer.js, analyzer.js pipeline, popup UI, service worker, manifest) is already in place. Remaining work: three targeted code fixes, unit tests for new lib files, and manual verification.

**Organization**: Tasks grouped by user story. US1 and US2 are both P1 and can proceed after Phase 2; US3 and US4 can begin in parallel with US1/US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: Establish a passing baseline before any changes.

- [x] T001 Run `npm test` from `extension/` and confirm all existing tests pass; record any pre-existing failures

**Checkpoint**: Baseline green — all subsequent changes must not break existing tests.

---

## Phase 2: Foundational — Constitution Fixes and Lib Unit Tests

**Purpose**: Resolve the two open constitution issues and write unit tests for all new `lib/` modules. These must land before any user story phase is validated.

**⚠️ CRITICAL**: T002 must complete before Phase 5 (US3) test tasks, which assert the console.warn fires.

- [x] T002 Fix `lib/analyzer.js` empty DeepL catch block: replace `catch { /* fall through */ }` with `catch (err) { console.warn('[Lingua] DeepL translation failed, falling back to Claude:', err.message); }` — do not change any other behavior (FR-006, Principle IV violation fix)
- [x] T003 [P] Apply constitution amendment PA-003: update `.specify/memory/constitution.md` Principle V to include `https://api-free.deepl.com/*` in the allowed permissions list using the replacement text in `specs/003-tiered-api-pipeline/plan.md#pending-constitution-amendment`; bump **Version** line to `1.0.1`
- [x] T004 [P] Create `tests/lang-detect.test.js`: unit tests for `detectScript()` covering — KOR (pure Hangul), JPN (Kana present), CMN (CJK, no Kana), LAT (ASCII letters), UND (empty string, symbols only), mixed Korean+English (Korean dominant returns KOR), mixed CJK+Kana (Kana tiebreaker returns JPN)
- [x] T005 [P] Create `tests/romanizer.test.js`: unit tests for `romanizeKorean()` covering — single syllable block (e.g. `안` → `an`), multi-syllable word (e.g. `안녕` → `annyeong`), non-Hangul characters passed through unchanged, empty string returns empty string
- [x] T006 [P] Create `tests/translator.test.js`: unit tests for `translateWithDeepL()` mocking `fetch` — success case returns `translations[0].text`; non-2xx response throws `Error` with `status` property; response with missing `translations` field returns `null`; response with `translations[0].text` equal to empty string or whitespace returns `null`

**Checkpoint**: `npm test` still passes. Both constitution issues resolved. New lib unit tests all green.

---

## Phase 3: User Story 1 — Add DeepL Key in Settings (Priority: P1) 🎯

**Goal**: The Settings panel accepts, saves, and clears a DeepL key independently of the Anthropic key. Cancel does not retain partial input.

**Independent Test**: Open Settings, enter a DeepL key, save, reopen Settings, confirm key is registered; clear, reopen, confirm empty; type partial key, click Cancel, reopen, confirm field is empty.

- [x] T007 [US1] Update `popup/popup.js` `cancelBtn` click handler: add `deeplKeyInput.value = '';` alongside the existing `apiKeyInput.value = '';` before `showMain()` (FR-001, Design Decision 7 fix)
- [x] T008 [US1] Manual verification — follow "Testing Settings Cancel" section in `specs/003-tiered-api-pipeline/quickstart.md`: (a) enter DeepL key → save → reopen Settings → confirm key is on file; (b) leave DeepL field blank → save → confirm key removed; (c) type partial DeepL key → Cancel → reopen Settings → confirm field is empty (FR-001, SC-004)

**Checkpoint**: Settings DeepL field saves, clears via blank save, and cancel leaves field empty.

---

## Phase 4: User Story 2 — Cost-Reduced Analysis for Non-Latin Text (Priority: P1)

**Goal**: When both keys are configured and text is non-Latin, DeepL translates first and Claude receives a schema without the translation field.

**Independent Test**: Configure both keys, analyze Korean text, inspect DevTools Network — confirm `api-free.deepl.com` request fires before Anthropic request and Claude request body omits translation field.

- [x] T009 [US2] Add unit tests to `tests/analyzer.test.js` for `buildAnalysisTool()`: assert schema shape for each combination — `(KOR, null)`: translation required, no romanization, particles/endings present; `(KOR, 'text')`: translation absent; `(JPN, null)`: translation required, romanization required; `(JPN, 'text')`: translation absent, romanization present; `(CMN, null/set)`: same as JPN pattern; `(LAT, null)`: translation required, no romanization, no particles (FR-005)
- [x] T010 [US2] Add unit tests to `tests/analyzer.test.js` for `analyzeText()` DeepL success path: mock `translateWithDeepL` to return `'mocked translation'`; mock `fetch` returning a valid Claude response with no `translation` field in `toolUse.input`; assert (a) the Claude request JSON body's `tools[0].input_schema` does not include `translation` in `required`, (b) `result.translation` equals `'mocked translation'` (pre-translation merge), (c) Korean tokens have `romanization` field populated by `romanizeKorean` (FR-004, FR-005)
- [x] T011 [US2] Manual verification — follow "Testing with DeepL Key" section in `specs/003-tiered-api-pipeline/quickstart.md`: valid DeepL key + Korean text → DevTools Network confirms `api-free.deepl.com` request before Anthropic; result shows translation + word breakdown + romanization (SC-001, SC-002)

**Checkpoint**: DeepL success path confirmed via unit tests and DevTools network inspection.

---

## Phase 5: User Story 3 — Graceful Fallback When DeepL Unavailable (Priority: P2)

**Goal**: Any DeepL failure is invisible to the user — analysis completes via Claude fallback with no error shown.

**Independent Test**: Configure an invalid DeepL key, analyze Korean text, confirm full result appears; open DevTools Console and confirm `[Lingua] DeepL translation failed` warning (no user-visible error).

- [x] T012 [US3] Add unit tests to `tests/analyzer.test.js` for `analyzeText()` fallback path: mock `translateWithDeepL` to throw a `new Error('DeepL error 403')`; mock `fetch` returning a full Claude response with `translation` field present; assert (a) `console.warn` was called with a string containing `'[Lingua]'`, (b) `result.translation` comes from Claude (not DeepL), (c) no error is thrown from `analyzeText` (FR-006, SC-003)
- [x] T013 [US3] Manual verification — follow "Testing Fallback Behavior" section in `specs/003-tiered-api-pipeline/quickstart.md`: configure invalid DeepL key → submit Korean text → confirm full result appears with no DeepL error message; confirm DevTools Console shows `[Lingua] DeepL translation failed` warning (SC-003)

**Checkpoint**: Fallback path confirmed — silent to user, logged to console.

---

## Phase 6: User Story 4 — Latin Text Unaffected (Priority: P3) ⚡ Can start after Phase 2

**Goal**: Latin-script input never triggers a DeepL call, regardless of key configuration.

**Independent Test**: Configure a valid DeepL key, analyze English text, confirm DevTools Network shows no request to `api-free.deepl.com`.

- [x] T014 [US4] Add unit tests to `tests/analyzer.test.js` for Latin bypass: spy on `translateWithDeepL`; call `analyzeText` with English text and a non-null `deeplKey`; assert `translateWithDeepL` was NOT called; assert the Claude request body's tool schema includes `translation` in `required` (FR-007, SC-005)
- [x] T015 [US4] Manual verification — follow "Testing Latin Text Bypass" section in `specs/003-tiered-api-pipeline/quickstart.md`: valid DeepL key configured → submit English text → confirm DevTools Network shows no `api-free.deepl.com` request; result identical to Claude-only behavior (SC-005)

**Checkpoint**: Latin text bypasses DeepL entirely — confirmed by unit test and DevTools.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T016 [P] Run `npm test` from `extension/` and confirm all tests pass, including the new T004–T006 lib tests and T009, T010, T012, T014 analyzer tests
- [x] T017 [P] Run all manual verification scenarios from `specs/003-tiered-api-pipeline/quickstart.md`: DeepL valid key path, fallback path, Latin bypass, settings cancel; verify each against the FR verification table; also right-click-select Korean text on a page with a valid DeepL key configured and confirm the context menu analysis produces the same tiered result as the popup flow (spec Assumption 5)
- [x] T018 [P] Add a superseded-by note to `specs/002-fix-review-issues/contracts/ai-prompt-contract.md` (v3.1): prepend `> **Superseded**: See [v3.2](../../003-tiered-api-pipeline/contracts/ai-prompt-contract.md) for the current conditional schema.` at the top of the document

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS** US3 test tasks (T012 tests the T002 console.warn fix)
- **US1 (Phase 3)**: Depends on Phase 2 (T007 touches popup.js; baseline must be green first)
- **US2 (Phase 4)**: Depends on Phase 2 (T009/T010 extend analyzer.test.js; T002 must land first)
- **US3 (Phase 5)**: Depends on Phase 2 AND T002 specifically (T012 asserts console.warn, which requires T002)
- **US4 (Phase 6)**: Depends on Phase 2 only — **can start in parallel with US1/US2/US3**
- **Polish (Phase 7)**: Depends on all user story phases complete

### Within-Phase Dependencies (Phase 2)

- T002, T003, T004, T005, T006 can all run in parallel (different files)

### Within-Phase Dependencies (Phase 4)

- T009 → T010 (both add to `tests/analyzer.test.js`; sequential to avoid conflicts)
- T011 can start after T009 and T010 are complete

### Within-Phase Dependencies (Phases 5 and 6)

- T012 depends on T002 (console.warn must exist to assert)
- T014 can run in parallel with T012 if T002 is already complete (different test blocks, same file — run sequentially to avoid conflicts)

### Parallel Opportunities

```
T001 → T002 [P]  T003 [P]  T004 [P]  T005 [P]  T006 [P]
                ↓
    T007 [US1]   T009 [US2] → T010 [US2]   T012 [US3]   T014 [US4]
    T008 [US1]   T011 [US2]               T013 [US3]   T015 [US4]
                ↓
         T016 [P]   T017 [P]   T018 [P]
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (Settings fix)
4. Complete Phase 4: US2 (pipeline tests + DevTools check)
5. **STOP and VALIDATE**: Both P1 user stories verified
6. Continue to US3–US4 and Polish

### Incremental Delivery

1. Setup + Foundational → constitution clean, lib tests established
2. US1 → Settings cancel fix landed
3. US2 → pipeline confirmed working end-to-end
4. US3 → fallback path tested and verified
5. US4 → Latin bypass confirmed
6. Polish → all gates green

---

## Notes

- All `tests/analyzer.test.js` changes (T009, T010, T012, T014) are sequential — same file, add in order
- T002 (empty catch fix) must land before T012 can be written (T012 asserts the warn fires)
- T003 (constitution amendment) is purely documentation — no source code changes
- `lib/renderer.js`, `lib/errors/`, and the existing overlay render logic in `service-worker.js` are untouched by this feature — do not modify them
- Commit after each task or logical group; commit message should reference the task ID
