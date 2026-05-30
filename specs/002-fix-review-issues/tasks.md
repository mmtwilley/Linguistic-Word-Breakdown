# Tasks: Code Review Fixes

**Input**: Design documents from `/specs/002-fix-review-issues/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅

**Tests**: Unit test tasks included only where practical (lib/ functions). Overlay and popup UI verified manually per quickstart.md.

**Organization**: Tasks grouped by user story. User stories US3–US5 (popup-only changes) can begin after foundational phase without waiting for US1/US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 1: Setup

**Purpose**: Establish a passing baseline before any changes.

- [ ] T001 Run `npm test` from `extension/` and confirm all existing tests pass; record any pre-existing failures

**Checkpoint**: Baseline green — all subsequent changes must not break existing tests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-cutting fixes to shared modules that user-story phases depend on. No user story work should begin until this phase is complete.

**⚠️ CRITICAL**: US1–US5 phases all touch popup.js or service-worker.js. These foundational changes must land first to avoid merge conflicts.

- [ ] T002 [P] Create `lib/renderer.js`: export `buildTokenCard(token)` and `buildMorphemeCard(form, badgeClass, typeLabel, meaning)` as ES module named exports; use `textContent`-only DOM construction matching the current card structure in `popup/popup.js`
- [ ] T003 Update `popup/popup.js`: import `buildTokenCard` and `buildMorphemeCard` from `../lib/renderer.js`; refactor `renderResults()` to call them instead of inline card construction; replace `tokensGrid.textContent = ''` with `tokensGrid.replaceChildren()`; remove the explicit `validateInput(inputText.value)` call from `runAnalysis()` (FR-004, FR-005, FR-006)
- [ ] T004 [P] Fix `lib/analyzer.js` response size check: replace `JSON.stringify(data).length > MAX_RESPONSE_BYTES` check in `validateResponse` with a pre-parse check in `analyzeText` — `const text = await response.text(); if (text.length > MAX_RESPONSE_BYTES) throw new ValidationError(...); const data = JSON.parse(text);` (FR-008)
- [ ] T005 Update `lib/analyzer.js` `SYSTEM_PROMPT` to v3.1: replace per-field rule list with framing-only text as specified in `specs/002-fix-review-issues/contracts/ai-prompt-contract.md`; preserve `cache_control: { type: 'ephemeral' }` on the system message object (FR-009)
- [ ] T006 Add API key in-memory cache to `popup/popup.js`: add `let cachedApiKey = null` at module scope; add `async function getApiKey()` that returns cache or reads from `chrome.storage.local`; replace direct `chrome.storage.local.get('apiKey')` call in `runAnalysis` with `await getApiKey()`; update `saveBtn` click handler to set `cachedApiKey = key` after saving (FR-010)
- [ ] T007 [P] Add API key in-memory cache to `background/service-worker.js`: add `let cachedApiKey = null` at module scope; add `async function getApiKey()` that returns cache or reads from storage; replace the `chrome.storage.local.get('apiKey')` call in `onClicked` handler with `await getApiKey()`; add code comment on `linguaRenderOverlay` confirming function is module-scope and cannot capture `apiKey` (FR-001, FR-010)

**Checkpoint**: `npm test` still passes. Extension loads unpacked. Popup analysis still works end-to-end.

---

## Phase 3: User Story 1 — API Key Stays Private (Priority: P1) 🎯

**Goal**: Confirm and test that the API key never appears in Chrome DevTools or scripting injection arguments.

**Independent Test**: Open DevTools → Network/Sources/Console; trigger right-click analysis; confirm key string absent at all stages.

- [ ] T008 [P] [US1] Add unit test in `tests/analyzer.test.js`: mock `chrome.scripting.executeScript` and assert that no call's `args` array contains a string matching the test API key pattern (confirms FR-001 guarantee)
- [ ] T009 [US1] Manual verification: load extension, open Chrome DevTools, select text on a page, right-click → Lingua: Analyze; inspect Network and Console tabs and confirm API key is not present in any logged value or request parameter

**Checkpoint**: Test T008 passes. Manual DevTools check shows no key exposure.

---

## Phase 4: User Story 2 — Overlay Behaves Predictably (Priority: P1)

**Goal**: Right-click overlay cannot double-fire; dismissing during load prevents result from appearing.

**Independent Test**: (1) Trigger analysis, close spinner, confirm no result panel appears. (2) Trigger analysis twice in <1s on the same tab, confirm single overlay only.

- [ ] T010 [US2] Add `const pendingTabs = new Set()` at module scope in `background/service-worker.js`; at start of `onClicked` handler: return early if `pendingTabs.has(tab.id)`; add `pendingTabs.add(tab.id)` before the first `inject()` call; add `pendingTabs.delete(tab.id)` in a `finally` block (FR-003)
- [ ] T011 [US2] Update all `inject(tab.id, payload)` calls in `background/service-worker.js` to include `tabId: tab.id` in the payload object (e.g., `inject(tab.id, { tabId: tab.id, loading: true })`); update the `linguaRenderOverlay` close button click handler to call `chrome.runtime.sendMessage({ type: 'lingua-overlay-dismissed', tabId: payload.tabId })` before removing the host element (FR-002)
- [ ] T012 [US2] Add `const dismissedTabs = new Set()` at module scope in `background/service-worker.js`; add `chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'lingua-overlay-dismissed') dismissedTabs.add(msg.tabId); })`; in `onClicked` handler, before `inject(tab.id, { result })`: if `dismissedTabs.has(tab.id)`, skip inject and call `dismissedTabs.delete(tab.id)`; add `dismissedTabs.delete(tab.id)` to the `finally` block as well (FR-002)

**Checkpoint**: Manual test: spinner dismiss does not produce result panel. Double-trigger produces single overlay.

---

## Phase 5: User Story 3 — Retry Respects Rate Limit (Priority: P2)

**Goal**: The 1-second cooldown starts at submission, not at response receipt.

**Independent Test**: Trigger analysis; immediately click Retry (by triggering an error first); confirm second submission within 1s is blocked.

- [ ] T013 [US3] Fix `popup/popup.js` `runAnalysis()`: capture `const now = Date.now()` at the top of the function; run the rate-limit gate check first (`if (now - lastSubmitTime < 1000) …`); immediately after the gate passes, set `lastSubmitTime = now` — before any async call; remove the `lastSubmitTime = Date.now()` assignments from inside the `try` and `catch` blocks (FR-007)

**Checkpoint**: Manual test: cause a fast error (e.g., invalid key); click Retry immediately; confirm "please wait" message appears if within 1 second.

---

## Phase 6: User Story 4 — Screen Readers Announce Results (Priority: P2)

**Goal**: ARIA live region causes screen reader to announce results automatically.

**Independent Test**: Enable a screen reader (NVDA/VoiceOver/Narrator); submit analysis; confirm announcement fires without manual navigation.

- [ ] T014 [P] [US4] Update `popup/popup.html`: add `aria-live="polite"` and `role="status"` attributes to the `<div id="results">` element; add `role="alert"` to the `<div id="error-banner">` element (FR-011)

**Checkpoint**: Screen reader test per quickstart.md. Results and errors are announced on appearance.

---

## Phase 7: User Story 5 — Settings Cancel Clears Input (Priority: P3)

**Goal**: Clicking Cancel in Settings always leaves the API key input empty.

**Independent Test**: Open Settings, type partial key, click Cancel, reopen Settings, confirm input is empty.

- [ ] T015 [US5] Update `popup/popup.js` `cancelBtn` click handler: add `apiKeyInput.value = ''` before or after `showMain()` (FR-012)

**Checkpoint**: Manual test: partial key typed → Cancel → Settings reopened → field empty.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T016 [P] Run `npm test` from `extension/` and confirm all tests pass including new T008 assertion
- [ ] T017 [P] Run all manual verification scenarios from `specs/002-fix-review-issues/quickstart.md`: overlay race, dismiss-during-load, rate limit, screen reader, cancel clear
- [ ] T018 [P] Update `specs/001-lingua-word-breakdown/contracts/ai-prompt-contract.md` to v3.1: replace the system prompt verbatim block with the v3.1 text from `specs/002-fix-review-issues/contracts/ai-prompt-contract.md`; bump version field to 3.1

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **US1 (Phase 3)**: Depends on Phase 2 (T007 — service-worker.js cache)
- **US2 (Phase 4)**: Depends on Phase 2 (T007 — service-worker.js changes)
- **US3 (Phase 5)**: Depends on Phase 2 (T006 — popup.js changes)
- **US4 (Phase 6)**: Depends only on Phase 1 (popup.html only — no code dependencies); can start in parallel with Phase 3–5
- **US5 (Phase 7)**: Depends on Phase 2 (T006 — popup.js), Phase 5 (T013 — popup.js same file)
- **Polish (Phase 8)**: Depends on all user story phases complete

### Within-Phase Task Dependencies

**Phase 2:**
- T002 → T003 (renderer.js must exist before popup.js imports it)
- T003 → T006 (popup.js: renderer changes must land before adding cache function)
- T004 → T005 (both modify `lib/analyzer.js`; T004 must land first to avoid merge conflicts)
- T007 is independent of T002/T003/T004/T005

**Phase 4 (US2):**
- T010 → T011 → T012 (all modify service-worker.js; each builds on previous)

### User Story Dependencies

- US1, US2 are both P1 and can be implemented concurrently (different files: US1 = tests + SW comment, US2 = SW overlay logic)
- US3, US4 can start after Phase 2 in parallel with US1/US2
- US5 must wait for US3 (same popup.js file, T013 lands before T015)

### Parallel Opportunities

Within Phase 2 (after T002 completes, T003 can start; T004→T005 and T007 can run in parallel with T003):
```
T001 → T002 → T003 → T006
              ↕
         T004 [P] → T005
         T007 [P]
```

After Phase 2:
```
T008 [US1] [P]    T010 → T011 → T012 [US2]    T013 [US3]    T014 [US4] [P]
```

---

## Parallel Example: Phase 2 (Foundational)

```text
Start in parallel after T001:
  T002: Create lib/renderer.js
  T004 [P]: Fix analyzer.js size check  ← then T005 (same file, sequential)
  T007 [P]: service-worker.js cache + comment

After T004 completes:
  T005: Update analyzer.js system prompt (sequential — same file as T004)

After T002 completes:
  T003: popup.js renderer import + replaceChildren + validateInput

After T003 completes:
  T006: popup.js API key cache
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (all tasks)
3. Complete Phase 3: US1 (security confirmation + test)
4. Complete Phase 4: US2 (overlay race conditions)
5. **STOP and VALIDATE**: Both P1 user stories verified
6. Continue to US3–US5 and Polish

### Incremental Delivery

1. Setup + Foundational → base quality improvements live
2. US1 → security guarantee documented and tested
3. US2 → overlay race conditions fixed
4. US3 → rate limit correctly enforced
5. US4 → screen reader users get announcements
6. US5 → settings UX cleaned up
7. Polish → all gates verified

---

## Notes

- All popup.js changes go through a strict sequence: T003 → T006 → T013 → T015; never work on popup.js in parallel tasks
- `lib/renderer.js` is used by `popup.js` only; `linguaRenderOverlay` in `service-worker.js` keeps its own identical helpers (MV3 constraint documented in plan.md)
- Any change to card structure in `lib/renderer.js` must also be applied to `linguaRenderOverlay` in `service-worker.js`
- Commit after each task or logical group; commit message should reference the task ID (e.g., "T010: Add pendingTabs guard to service worker")
- Each user story has a checkpoint — stop and verify before proceeding to the next
