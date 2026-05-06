# Tasks: Linguistic Word Breakdown Chrome Extension

**Input**: Design documents from `/specs/001-lingua-word-breakdown/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, security.md

**Tests**: Unit tests for analyzer.js error handling and validation; manual testing for UI flows.

**Organization**: Tasks grouped by user story to enable independent implementation of each story. All tasks follow security requirements from [security.md](security.md) and error handling patterns from [contracts/ai-prompt-contract.md](contracts/ai-prompt-contract.md).

## Format: `- [ ] [ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1, US2, US3)
- Include exact file paths in all descriptions

---

## Phase 1: Setup & Project Structure

**Purpose**: Initialize project structure and core files per plan.md

- [x] T001 Create extension directory structure: `extension/manifest.json`, `popup/`, `lib/`, `background/`, `icons/`
- [x] T002 [P] Create `extension/manifest.json` with Manifest V3 config, permissions (storage), host_permissions (https://api.anthropic.com/*), and CSP (script-src 'self', default-src 'self')
- [x] T003 [P] Create `extension/background/service-worker.js` (empty placeholder for MV3 compliance)
- [x] T004 [P] Create icon files: `extension/icons/icon16.png`, `icon48.png`, `icon128.png` (placeholder images acceptable)
- [x] T005 Verify project structure matches plan.md layout

---

## Phase 2: Core Analyzer Module & Error Handling

**Purpose**: Implement the API request layer with comprehensive error handling and input/output validation

**⚠️ CRITICAL**: This phase MUST complete before any UI implementation - all user stories depend on analyzer.js

### Error Handling Infrastructure

- [x] T006 Create `extension/lib/analyzer.js` with custom error classes: `TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError`
- [x] T007 [P] Implement `validateInput(text)` in analyzer.js: check type, non-empty, non-whitespace, ≤ 2000 chars per FR-012

### AI API Integration

- [x] T008 Implement `analyzeText(text, apiKey)` function in analyzer.js:
  - Build request to https://api.anthropic.com/v1/messages (HTTPS only, per FR-018)
  - Include headers: x-api-key, anthropic-version, content-type
  - Use model: claude-sonnet-4-6
  - Include system prompt (from contracts/ai-prompt-contract.md verbatim)
  - Set max_tokens: 2048
  - Wrap fetch in 10-second timeout using AbortController (per FR-013)

- [x] T009 [P] Implement HTTP error handling in analyzer.js:
  - Detect and throw ApiError(status, message) for HTTP errors
  - Specific handling for 401 (invalid key), 429 (rate limit), 5xx (server error)
  - Follow error handling table from contracts/ai-prompt-contract.md

- [x] T010 [P] Implement network error handling in analyzer.js:
  - Catch fetch() exceptions (DNS, connection, AbortError for timeout)
  - Throw NetworkError or TimeoutError with descriptive messages
  - No automatic retries - user controls via Retry button

### Response Validation

- [x] T011 Implement `validateResponse(response)` in analyzer.js:
  - JSON.parse() the response text
  - Catch and throw JsonError on parse failure
  - Check required fields: translation (non-empty string), tokens (array, present)
  - If tokens is empty array: throw ValidationError with message "No analysis returned"
  - Throw ValidationError if other fields missing or invalid

- [x] T012 [P] Implement token validation in analyzer.js:
  - For each token: check word, lemma, pos, meaning are all non-empty strings (per FR-005)
  - Validate POS tag is in vocabulary (noun, verb, adj, adv, pron, prep, conj, det, num, punct, other)
  - If POS invalid: silently correct to 'other' with console.warn (per security.md)
  - If token missing field: throw ValidationError with field name
  - If meaning exceeds 5 words: log console.warn (per FR-011); do not reject (AI may occasionally exceed)

- [x] T013 [P] Implement response size limits in analyzer.js:
  - Reject responses > 50 KB via JSON.stringify().length check (per FR-015)
  - Reject token arrays > 500 items (per FR-015)
  - Throw ValidationError with "Response too large" message

### Unit Tests for Analyzer

- [x] T014 [P] Create `extension/tests/analyzer.test.js`:
  - Test validateInput() with: empty, whitespace, normal, >2000 chars
  - Test validateResponse() with: valid response, missing translation, missing tokens, empty tokens
  - Test invalid POS tag handling (silent correction to 'other')
  - Test response size limits (>50 KB, >500 tokens)
  - Test fetch timeout (AbortController fires at 10s)
  - Test error classification: NetworkError, TimeoutError, ApiError(401/429/5xx), JsonError, ValidationError
  - Test token count mismatch (tokens.length ≠ input word count): verify results still rendered and console.warn fired

- [x] T015 [P] Create unit test mocks in `extension/tests/mocks/`:
  - Mock fetch() with various HTTP responses (200, 401, 429, 500)
  - Mock responses for: valid analysis, missing fields, oversized response, malformed JSON
  - Mock network timeout (AbortError)

**Checkpoint**: analyzer.js is fully functional with all error handling tested. User stories can now implement UI.

---

## Phase 3: User Story 1 - Translate and Analyze Foreign Text (Priority: P1) 🎯 MVP

**Goal**: Users can paste foreign-language text, click Analyze, and receive English translation + token breakdown (word, lemma, POS, meaning) for each word.

**Independent Test**: Submit a German sentence (e.g., "Ich liebe Sprachen") → Verify translation displays and tokens show word/lemma/pos/meaning for each word in same order as input.

### UI Structure & Storage

- [x] T016 [P] [US1] Create `extension/popup/popup.html`:
  - Main view: textarea for input (no maxlength on HTML, enforced in JS)
  - Submit button labeled "Analyze"
  - Results div (translation headline + token grid, hidden by default)
  - Settings icon button (gear icon)
  - Loading spinner overlay (hidden, centered, shows during request)
  - Error banner (hidden, red, shows error message + Retry button)
  - Settings view: hidden by default, API key password input, Save/Cancel buttons

- [x] T017 [P] [US1] Create `extension/popup/popup.css`:
  - Popup fixed width 400px, max-height 600px, overflow-y auto
  - Textarea styled, readable font
  - Translation displayed as headline (large, bold)
  - Token cards: word (large), lemma (italic), POS badge (small, color-coded), meaning (normal)
  - Token grid responsive (flex or grid)
  - Loading spinner: centered, animated
  - Error banner: red background, white text, readable
  - Settings view: hidden by default, inputs readable

### Popup Logic

- [x] T018 [US1] Create `extension/popup/popup.js`:
  - On popup open: load apiKey from chrome.storage.local
  - If no key: show Settings view automatically
  - Clear any previous error/loading/results state

- [x] T019 [US1] Implement input submission in popup.js:
  - On Analyze button click (or Enter key):
    - Validate input via analyzer.validateInput()
    - Check rate limit (see T022) before proceeding
    - Show loading spinner, disable inputs
  - On success from analyzeText():
    - Hide loading spinner
    - Render translation and token cards using textContent (see T023 for DOM safety rules)
  - Preserve input text after results (user can modify and resubmit)

- [x] T020 [US1] Implement error display in popup.js:
  - Catch errors from analyzeText() in try/catch
  - Categorize by error type and display appropriate user message:
    - TimeoutError → "Request took too long. Please try again." + Retry
    - ApiError(401) → "Invalid or expired API key. Check your settings." + Settings button
    - ApiError(429) → "You've made too many requests. Please wait a moment before trying again." + Retry
    - ApiError(5xx) → "Claude API is temporarily unavailable. Please try again in a moment." + Retry
    - NetworkError → "Network error. Check your internet connection and try again." + Retry
    - JsonError → "Unexpected response format. Please retry." + Retry
    - ValidationError (message="No analysis returned") → "No analysis returned. Please retry." + Retry
    - ValidationError → "Incomplete response. Please retry." + Retry
  - Show error banner with message and Retry button (except 401 shows Settings button)
  - Disable submit button during error state

- [x] T021 [US1] Implement Settings view in popup.js:
  - Settings icon click: toggle to Settings view (hide main, show settings)
  - API key input type="password" (masked display per FR-017)
  - Save button: validate key is non-empty and ≥ 20 chars, save to chrome.storage.local
  - Cancel button: discard input, return to main view without saving
  - On return from Settings: reload apiKey from storage, show main view

- [x] T022 [US1] Implement rate limiting in popup.js:
  - Track lastSubmitTime (popup.js variable, not persistent)
  - Before submit: check if now - lastSubmitTime < 1000ms
  - If too soon: disable submit button, show "Please wait..." message (per FR-019)
  - On submit success/error: update lastSubmitTime = now()

### DOM Safety & Rendering

- [x] T023 [US1] Implement safe DOM rendering in popup.js:
  - ALL user-controlled content (translation, token words) inserted via textContent, NEVER innerHTML (per FR-016)
  - POS badges inserted via setAttribute() (safe since POS validated)
  - No inline event handlers (onclick, oninput) - all listeners via addEventListener()
  - Example safe pattern: `element.textContent = translation;` (never `innerHTML`)

### Manual Testing

- [ ] T024 [US1] Manual test User Story 1:
  - Load extension in Chrome dev tools (chrome://extensions → Load unpacked)
  - Test golden path: German sentence → "Ich liebe Sprachen" → Verify translation + 3 tokens with correct word/lemma/pos/meaning
  - Test sentence of ~50 words: Verify breakdown renders without layout errors (covers SC-003)
  - Test English input: Verify translation + tokens
  - Test empty input: Verify "Please enter text..." prompt
  - Test whitespace input: Verify prompt
  - Test 2000+ character input: Verify rejected
  - Test Settings: Enter API key → Save → Verify key persists on popup reopen
  - Test no API key: Delete key, try to analyze → Verify Settings prompt
  - Test invalid API key: Use dummy key → Submit → Verify "Invalid API key" message with Settings link

**Checkpoint**: User Story 1 fully functional and testable independently. Translation + token breakdown working. Error handling for all paths. Ready for demo.

---

## Phase 4: User Story 2 - Analyze English Text for Grammar Study (Priority: P2)

**Goal**: Users can paste English text and receive token breakdown (no translation needed, but system still provides one for consistency). Linguistically accurate POS tags and glosses for English words.

**Independent Test**: Submit "The quick brown fox jumps" → Verify tokens show word, lemma, POS (det, adj, adj, noun, verb), meaning for each.

### Implementation

- [x] T025 [P] [US2] Test English-specific edge cases in analyzer.test.js:
  - Test common English words with multiple POS (e.g., "run" as noun vs. verb)
  - Verify Claude chooses most likely POS given sentence context
  - Test contractions (e.g., "don't" → splits or keeps as single token)

- [ ] T026 [US2] Manual test User Story 2:
  - Submit English sentence: "I love languages"
  - Verify translation shows as-is (or very similar)
  - Verify tokens: "I" (pron), "love" (verb), "languages" (noun)
  - Test with complex sentence: "The quick brown fox jumps over the lazy dog"
  - Verify all tokens present, correct POS, accurate glosses
  - Test with contracted form: "Don't you know?"
  - Ensure US1 flow still works after (no regression)

**Checkpoint**: English text supported. Both foreign and English analyze correctly.

---

## Phase 5: User Story 3 - Handle Short or Single-Word Input (Priority: P3)

**Goal**: Users can look up single words or very short phrases (1-3 words) to understand meaning and grammatical role. System degrades gracefully.

**Independent Test**: Submit "casa" (Spanish: house) → Verify one token with word/lemma/pos/meaning. Submit "日本" (Japanese: Japan) → Verify token(s) returned.

### Implementation

- [x] T027 [P] [US3] Add edge case tests to analyzer.test.js:
  - Single word in various languages: "hello", "casa", "日本", "café"
  - Two-word phrase: "hello world", "ciao mondo"
  - Verify tokens array has correct count (1 for single word, 2 for phrase)

- [x] T028 [US3] Verify popup UI handles single token:
  - Token card should render correctly for single token (no layout issues)
  - No assumption of multiple tokens in CSS/JS

- [ ] T029 [US3] Manual test User Story 3:
  - Single English word: "Hello" → 1 token
  - Single French word: "Bonjour" → 1 token
  - Two-word phrase: "Hello world" → 2 tokens
  - Single emoji/symbol: "👋" → Verify graceful handling (may be skipped or included as token)
  - Ensure US1 and US2 still work (no regression)

**Checkpoint**: All three user stories functional and independently testable. MVP complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: UI polish, documentation, testing summary, and production readiness

### Loading & Error UI Polish

- [x] T030 [P] Implement loading spinner styling:
  - Smooth animation (CSS keyframes or animated GIF)
  - Centered in popup, semi-transparent overlay
  - Test with intentional slow network (Chrome DevTools throttle) to verify visibility

- [x] T031 [P] Implement error banner styling:
  - Red background, white text, readable font size
  - Error messages should fit in 400px popup width (test with longest message)
  - Optional nice-to-have: dismiss button or auto-dismiss after 5 seconds (not required for MVP)

- [ ] T032 [P] Test all error paths manually:
  - Run through 10 error scenarios from security.md test cases:
    - Empty input, whitespace, too long, no key, network offline, invalid key, rate limited, 503, malformed JSON, missing field
  - Verify each shows correct error message and button state

### Documentation & Validation

- [x] T033 [P] Create `extension/README.md`:
  - How to load extension (chrome://extensions → Load unpacked)
  - How to configure API key
  - Feature overview (translate + linguistic breakdown)
  - Reference to [quickstart.md](quickstart.md) for setup

- [x] T034 [P] Create `extension/TESTING.md`:
  - Manual test cases for all 3 user stories
  - Error testing checklist (10 scenarios from security.md)
  - Screenshots (placeholder ok for now)

- [x] T035 Validate quickstart.md against implementation:
  - Follow quickstart.md step-by-step
  - Verify all commands and paths match actual code
  - Update if any path changed

### Final Checklist

- [x] T036 Verify security requirements from spec.md:
  - [x] All user data inserted via textContent (grep for innerHTML - should not find user content)
  - [x] No inline JavaScript in HTML (grep for onclick, oninput - should be empty)
  - [x] API key never logged (search console for apiKey - should not appear)
  - [x] HTTPS-only to Claude API (grep for "http://" - should find none)
  - [x] No eval() or Function() (search for eval - should not appear)

- [x] T037 Verify error handling requirements from spec.md:
  - [x] 10-second timeout implemented (AbortController in fetch)
  - [x] All 6+ error types caught and displayed (TimeoutError, ApiError, NetworkError, JsonError, ValidationError)
  - [x] Input validation: empty, whitespace, 2000 char limit
  - [x] Response validation: required fields, token structure, size limits
  - [x] 1-second rate limit between requests

- [ ] T038 Run unit tests (if created):
  - npm test (or jest command)
  - All analyzer.js tests pass
  - Coverage report shows analyzer.js, DOM rendering functions tested

- [ ] T039 Manual smoke test all user stories together:
  - Load extension
  - US1: German text → Translate + tokens ✓
  - US2: English text → Tokens ✓
  - US3: Single word → Single token ✓
  - Resubmit after seeing results ✓
  - Error paths: timeout, invalid key, network ✓
  - Settings: Configure, save, use key ✓
  - FR-020: Close popup after analysis, reopen → verify no previous results or input retained ✓

- [ ] T040 Create git commit with feature complete tag

**Checkpoint**: Feature complete, tested, documented. Ready for release.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies. Start immediately.
- **Phase 2 (Analyzer)**: Depends on Phase 1. **BLOCKS** all user stories - MUST complete before Phase 3.
- **Phase 3 (US1)**: Depends on Phase 2. Core MVP story.
- **Phase 4 (US2)**: Depends on Phase 2 (not Phase 3 - can run in parallel with US1).
- **Phase 5 (US3)**: Depends on Phase 2 (not Phase 3/4 - can run in parallel).
- **Phase 6 (Polish)**: Depends on at least Phase 3 (US1 must work). Can run after US1 is done while US2/US3 in progress.

### Parallel Opportunities

**Setup Phase**:
- All [P] tasks (manifest.json, service-worker.js, icons) can run in parallel

**Analyzer Phase**:
- All [P] tasks (error classes, error handling, validation) can run in parallel within same feature
- Unit tests can run in parallel with main analyzer code

**User Stories (once Analyzer phase done)**:
- US1, US2, US3 can start in parallel if team has capacity
- Within each story: tests [P] can run in parallel, models [P] can run in parallel

**Example Parallel Run**:
```
Team of 2:
- Person A: Phase 1 Setup (sequential, fast)
- Person B: Phase 2 Analyzer, T006-T015 (sequential, but can start while A finishes)

After Phase 2 done:
- Person A: Phase 3 US1 (T016-T024)
- Person B: Phase 4 US2 (T025-T026) + Phase 5 US3 (T027-T029) in parallel

Final:
- Both: Phase 6 Polish (T030-T040)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (30 min)
2. Complete Phase 2: Analyzer + error handling (2-3 hours) - **CRITICAL PATH**
3. Complete Phase 3: US1 popup UI (2-3 hours)
4. **STOP and VALIDATE**: Test US1 independently with real API key
5. Commit and demo

**Time estimate**: 6-8 hours for MVP

### Incremental Delivery

1. Complete MVP (above) → Validate
2. Add US2 (15 min) → Test independently
3. Add US3 (15 min) → Test independently
4. Polish & cleanup (1 hour)

### Recommended Order (Single Developer)

1. T001-T005 (Setup) - 30 min
2. T006-T015 (Analyzer, tests) - 2.5 hours
3. T016-T024 (US1 UI + tests) - 2.5 hours
4. T025-T029 (US2 + US3 minor tweaks) - 30 min
5. T030-T040 (Polish, final tests) - 1 hour

---

## Notes

- [P] = different files, can parallelize (e.g., T002, T003, T004 can all happen simultaneously)
- Each task includes exact file paths for clarity
- US1 is the true MVP - can ship with just US1 fully working
- US2 and US3 are minimal additions once US1 done
- All security and error handling from security.md must be integrated, not bolted on later
- No external frameworks (Vue/React/etc) - vanilla JS only per plan.md
- Test early and often - especially analyzer.js and error paths
- Commit after each phase for clear git history
