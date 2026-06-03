# Feature Specification: Bulk Text Translation

**Feature Branch**: `007-bulk-text-translation`
**Created**: 2026-06-01
**Status**: Draft
**Input**: User description: "There should be the ability to translate large blocks of text without sacrificing security or performance. The timeout will probably need to be adjusted. Ideally, it should translate posts from forums or message boards."

## Clarifications

### Session 2026-06-01

- Q: Should large text be processed as one atomic request or split into sentences/chunks processed sequentially with progressive results streaming to the user? → A: Split input into sentences/chunks; process sequentially with a client-side queue; stream each translated unit progressively to the user as it completes.
- Q: Which client-side rate limiting strategy should throttle the translation queue? → A: Sliding window — tracks requests within a sliding time frame for accurate rate adherence, eliminating boundary spikes; preferred for sustained high-volume queue workloads.
- Q: How many retries are allowed per queue unit on a 429 rate-limit response before it is marked failed and skipped? → A: 3 retries with exponential backoff (e.g., 1s → 2s → 4s); balances resilience against queue stall time.
- Q: What happens when the user submits a new translation while a queue is already running? → A: Replace — the current queue is cancelled immediately and the new request starts fresh; completed units from the prior queue are discarded.
- Q: How should input text be split into queue units? → A: Fixed character/token window (~500 chars) with soft break at nearest paragraph or line boundary — language-agnostic, predictable unit sizes, works correctly across all scripts including CJK and Thai.
- Note: The existing translation cache (lingua_history_v1, feature 006) should serve as a cache-first lookup before each queue unit fires an API request — cache hits resolve instantly at zero API cost and do not consume rate limit capacity. Additionally, queue units should be structured as a continuing conversation rather than independent requests so that the AI prompt context (system instructions + tool definitions) is written to the API cache once per session and read cheaply on every subsequent unit. A pre-warm request on popup open ensures even the first unit benefits from a cache hit. Cache hit/miss counts should be tracked for operational visibility.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Translate a Full Forum Post (Priority: P1)

A user encounters a long forum or message board post written in a foreign language. They want to read the entire post in their native language without truncation, delay, or errors. They paste the full post content and trigger translation. The extension splits the text into sentences or chunks, processes each through a client-side queue, and streams translated units progressively to the user as each one completes.

**Why this priority**: This is the core use case. All other stories build on this working reliably.

**Independent Test**: Can be fully tested by pasting a 1,000–5,000 word forum post and confirming translated sentences appear progressively, the full output is returned without truncation, and the queue processes all units in order.

**Acceptance Scenarios**:

1. **Given** a user has pasted a long foreign-language forum post (up to 5,000 words), **When** they trigger translation, **Then** translated sentences begin appearing progressively as each unit in the queue completes — the user does not wait for the full block before seeing any output.
2. **Given** a user submits a very long post (at or near the size limit), **When** translation is requested, **Then** the system processes all chunks successfully without timing out or losing any units.
3. **Given** a user submits a post that exceeds the maximum supported size, **When** translation is requested, **Then** the system informs the user clearly that the content is too long and suggests a remedy (e.g., split the post).

---

### User Story 2 - Progress Visibility During Queue Processing (Priority: P2)

A user submitting a large post wants to see clear, real-time progress as the client-side queue works through each sentence. They should know how many units remain, see each unit's result appear as it completes, and be able to cancel mid-queue if needed.

**Why this priority**: Sequential queue processing takes time proportional to post length. Without progress visibility, the experience feels broken.

**Independent Test**: Submit a 2,000-word post; confirm a progress indicator updates per sentence/chunk, results stream in order, and a cancel action halts the queue cleanly.

**Acceptance Scenarios**:

1. **Given** a translation queue is running, **When** each sentence/chunk completes, **Then** its translated text appears immediately and a progress indicator updates (e.g., "12 of 40 sentences translated").
2. **Given** a queue is in progress, **When** the user cancels, **Then** the queue stops, any completed translations are retained, and no further API requests are made.
3. **Given** a translation request for a unit times out, **When** the timeout is reached, **Then** the user sees a clear per-unit error and the queue continues with the next unit rather than halting entirely.

---

### User Story 3 - Rate Limit Handling Without User Disruption (Priority: P3)

A user translating a long post should not need to manage API rate limits manually. If the system receives a rate-limit response from the translation API, it should automatically retry with appropriate backoff and resume the queue transparently, surfacing a non-blocking status message only if the delay is significant.

**Why this priority**: Rate limiting is an operational reality for any sustained queue workload. Transparent handling keeps the UX clean.

**Independent Test**: Simulate a 429 response mid-queue; confirm the system pauses, retries automatically, resumes the queue, and the user sees a status message (not an error that kills the session).

**Acceptance Scenarios**:

1. **Given** a 429 rate-limit response is received for a queue unit, **When** the retry condition is met, **Then** the system automatically retries that unit after an appropriate delay without user intervention.
2. **Given** repeated rate-limit responses exhaust the retry budget for a unit, **When** the budget is exceeded, **Then** the user is informed that unit could not be translated and the queue continues with remaining units.
3. **Given** a rate-limit delay will exceed 5 seconds, **When** the delay begins, **Then** the user sees a non-blocking status message indicating the queue is paused temporarily.

---

### User Story 4 - Input Sanitization and Security for Long Text (Priority: P4)

A user submits a forum post that may contain HTML markup, JavaScript, embedded links, or other potentially unsafe content from an untrusted source. The system translates only the text content and does not execute, render, or expose unsafe content during or after translation.

**Why this priority**: Forum posts are untrusted third-party content. Security must be preserved regardless of input length or queue depth.

**Independent Test**: Submit a forum post containing HTML tags and script content; confirm translated output strips or escapes unsafe elements and does not execute any scripts.

**Acceptance Scenarios**:

1. **Given** a post contains HTML tags, **When** it is translated, **Then** the output is plain translated text with no raw HTML rendered in the result.
2. **Given** a post contains a script injection attempt, **When** it is translated, **Then** no scripts are executed and the translated output is safe to display.
3. **Given** a post contains special characters or Unicode from different scripts, **When** translated, **Then** the output preserves correct encoding without corruption.

---

### Edge Cases

- What happens when the user pastes text that is already in their target language?
- How does the system handle posts that mix two or more languages within the same block?
- What happens if the user selects only partial text from a very large page?
- How does the system handle posts containing only images or non-translatable content?
- What happens when the network connection drops mid-queue?
- What counts as a sentence boundary for chunking (abbreviations, lists, non-Latin scripts)?
- What happens if a new translation is submitted while a queue is already running?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept text input up to at least 5,000 words for translation.
- **FR-002**: The system MUST split input text into fixed-size chunks (~500 characters) with soft breaks at the nearest paragraph or line boundary, and process them sequentially via a client-side queue; this approach must work correctly across all scripts including CJK and Thai.
- **FR-003**: The system MUST stream each translated chunk to the user as it completes, without waiting for the full block to finish.
- **FR-004**: The system MUST display a progress indicator showing how many units have been translated versus the total queue size.
- **FR-005**: The system MUST allow the user to cancel a running translation queue at any time; in-flight API calls are cancelled and already-rendered results remain visible.
- **FR-005a**: The system MUST cancel any running queue and discard its results when the user submits a new translation request; the new request starts immediately.
- **FR-006**: The system MUST apply timeout settings per chunk appropriate for large text inputs, distinct from single-word or short-phrase translation timeouts.
- **FR-007**: The system MUST automatically retry a failed queue unit on receipt of a rate-limit (429) response using exponential backoff (1s → 2s → 4s), up to a maximum of 3 retries, without user intervention.
- **FR-008**: The system MUST continue processing remaining queue units if a single unit exhausts its 3-retry budget, reporting that unit as failed without halting the full queue.
- **FR-009**: The system MUST sanitize all user-submitted text before processing to prevent injection of unsafe content. Input text is treated as plain text throughout processing; protection against script injection is enforced at the output rendering layer — translated content is never inserted into the DOM as HTML regardless of what the input contained.
- **FR-010**: The system MUST return translated output that is free of executable code or unsafe markup.
- **FR-011**: The system MUST provide a clear, user-readable error message when input exceeds the supported size limit.
- **FR-012**: The system MUST preserve paragraph structure and line breaks in the translated output to maintain readability of forum-style content.
- **FR-013**: The system MUST handle Unicode content correctly across all supported languages without encoding corruption.
- **FR-014**: The system SHOULD display a non-blocking status message when a rate-limit delay exceeds 5 seconds.
- **FR-015**: Before dispatching each queue unit to the API, the system MUST check the existing translation cache (lingua_history_v1); a cache hit resolves the unit instantly without an API call and without consuming rate limit capacity.
- **FR-016**: The system SHOULD structure bulk queue requests to maximize API prompt context cache reuse across units in a session, so that system instructions and tool definitions are cached after the first request and served at reduced cost for all subsequent units in the same batch.
- **FR-017**: The system SHOULD pre-load its translation context when the popup opens, before the user submits any request, so that the first queue unit benefits from cached context rather than incurring a cold-start cost.
- **FR-018**: The system SHOULD track and expose cache hit and miss counts per queue session for operational visibility (e.g., how many units were served from local cache vs. API).

### Key Entities

- **Translation Request**: A user-submitted block of text with a source language (auto-detected or specified) and a target language. Includes size constraints and timeout policy.
- **Translation Queue**: The ordered list of sentence/chunk units derived from the input block. Tracks per-unit state: pending, hit, translating, done, failed. Units remain in "translating" status throughout any 429-triggered retries; there is no distinct "retrying" state.
- **Queue Unit**: A fixed-size chunk of text (~500 characters, soft-broken at the nearest paragraph or line boundary) within the queue. Language-agnostic segmentation ensures correct handling across all scripts. Has its own timeout, retry count, and translated result.
- **Translation Result**: The assembled output of all completed queue units, including the translated content, source language detected, and any per-unit warnings (e.g., failed units).
- **Size Policy**: The rules governing minimum/maximum input size and what feedback is shown at each boundary.
- **Timeout Policy**: The configured time limit per queue unit, separate from existing short-text timeout settings.
- **Rate Limit State**: Tracks 429 responses, retry attempts, and backoff timing per unit and across the active queue session. The client-side throttle uses a sliding window algorithm — request counts are measured within a continuously advancing time frame to prevent boundary-clustering spikes and ensure accurate adherence to API rate limits at scale. Cache hits (lingua_history_v1) bypass the rate limiter entirely.
- **Translation Cache** (lingua_history_v1): The existing per-chunk translation store introduced in feature 006. Serves as the first dispatch path for each queue unit; hits return instantly at zero API cost. Cache lookups must occur before the sliding window throttle is consulted.
- **Prompt Context Cache**: The API-level cache of the system prompt and tool definitions maintained across queue units within a session window. Eliminates repeated input costs for units 2-N in a batch. Pre-warmed on popup open so unit 1 also benefits. Hit and miss counts are tracked per queue session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully translate forum posts of up to 5,000 words without truncation in at least 95% of attempts.
- **SC-002**: The first translated sentence/chunk appears within 5 seconds of the user triggering translation for posts of any size.
- **SC-003**: Translations of posts up to 2,000 words complete (all queue units resolved) within 30 seconds under normal conditions.
- **SC-004**: Translations of posts between 2,000 and 5,000 words complete within 60 seconds under normal conditions.
- **SC-005**: Zero instances of untrusted input content (HTML, scripts) being executed or rendered in translation output.
- **SC-006**: Users receive an informative error message in 100% of timeout or oversized-input cases, with no silent failures.
- **SC-007**: Paragraph and line-break structure is preserved in translated output for at least 90% of multi-paragraph inputs.
- **SC-008**: Rate-limit (429) responses are handled automatically with no user action required in at least 95% of occurrences.
- **SC-009**: A running queue can be cancelled within 1 second of the user's cancel action, with all completed units retained.
- **SC-010**: Previously translated chunks within a post are served from the local cache instantly; users translating overlapping or repeated content see those portions resolve without delay.
- **SC-011**: For bulk jobs of 5 or more queue units in a single session, the average time-to-result per unit (units 2-N) is at least 30% lower, or at least 500 ms lower, than unit 1 — validated via DevTools Network tab by recording the response time of the first unit (cold cache) and comparing it to the average response time of units 2 through 5 — demonstrating that prompt context caching is active and reducing per-unit overhead.
- **SC-012**: Cache hit and miss counts are available per queue session for operational monitoring; the ratio is used to validate that pre-warming and cache-first dispatch are functioning correctly.

## Assumptions

- The existing translation pipeline handles short-text requests; this feature extends it with a client-side queue layer without a full rewrite of the translation core.
- The lingua_history_v1 cache (feature 006) is available and will be reused as the cache-first dispatch layer for queue units; this feature does not reimplement the cache store.
- The AI prompt context (system instructions and tool definitions) is already cached via ephemeral cache control in analyzer.js; this feature extends that pattern by structuring queue units as a continuing conversation to maximise cache reuse across a batch.
- Pre-warming the prompt context on popup open is assumed to be feasible within the extension's existing popup lifecycle.
- A practical upper limit of ~5,000 words per request is sufficient for most forum posts; very long threads will require the user to translate individual posts rather than entire threads.
- Chunking uses fixed ~500-character windows with soft breaks at paragraph/line boundaries; no language-specific NLP is required.
- Auto-detection of source language is already supported and will be reused for bulk text.
- Mobile support is out of scope for this feature iteration; the primary target is the browser extension on desktop.
- Users are expected to copy-paste forum content manually; automatic page scraping or DOM selection is out of scope.
- Output is displayed as plain text; rich formatting (bold, links, images from the original post) is not preserved.
- A new translation submission while a queue is running cancels the current queue immediately and starts fresh; prior partial results are not retained.
