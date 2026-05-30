# Feature Specification: Linguistic Word Breakdown

**Feature Branch**: `001-lingua-word-breakdown`  
**Created**: 2026-05-03  
**Status**: Draft  
**Input**: User description: "Chrome Extension: Translate input text and produce a word-level linguistic breakdown for language learning."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Translate and Analyze Foreign Text (Priority: P1)

A language learner encounters a sentence in a foreign language (e.g., on a webpage or copied from a book). They paste the text into the extension's input field, submit it, and instantly receive a natural English translation alongside a token-by-token breakdown of every word: its base dictionary form, part of speech, and a short English gloss.

**Why this priority**: This is the core feature. Without translation and token breakdown, the extension delivers no value. All other stories depend on this working correctly.

**Independent Test**: Paste a foreign-language sentence, click the analyze button, and verify that the extension shows the English translation plus a table/list of word cards each displaying the surface form, lemma, POS, and meaning.

**Acceptance Scenarios**:

1. **Given** the extension popup is open and the input field is empty, **When** the user types or pastes a non-English sentence and submits, **Then** the extension displays a full English translation and one token entry per word in the original sentence.
2. **Given** a submitted sentence, **When** the analysis is rendered, **Then** every token entry shows the exact surface form from the input, the lemma, a POS tag (noun/verb/adj/adv/pron/prep/conj/etc.), and a short English gloss (≤ 5 words).
3. **Given** the extension receives analysis results, **When** the UI renders them, **Then** the tokens are displayed in the same order as the original sentence words.

---

### User Story 2 - Analyze English Text for Grammar Study (Priority: P2)

A learner who is studying English grammar pastes an English sentence to see its linguistic breakdown without needing a translation.

**Why this priority**: The breakdown is valuable for English grammar study even when translation is the same as the input. This is a natural extension of P1 with minimal extra scope.

**Independent Test**: Submit an English sentence; verify translation equals the original sentence and token breakdown is still produced accurately.

**Acceptance Scenarios**:

1. **Given** the user submits an English sentence, **When** the analysis is returned, **Then** the translation is the same natural English rendering of the sentence and tokens are still generated for each word.

---

### User Story 3 - Handle Short or Single-Word Input (Priority: P3)

A learner wants to look up a single word or a very short phrase to understand its meaning and grammatical role.

**Why this priority**: Single-word lookups are a common learning pattern. The feature should degrade gracefully to one token entry rather than breaking.

**Independent Test**: Submit a single word; verify one token is returned with lemma, POS, and meaning, plus a translation of that word.

**Acceptance Scenarios**:

1. **Given** the user submits a single word, **When** the analysis completes, **Then** exactly one token is returned and the translation is a natural English rendering of that word.

---

---

### User Story 4 - Right-Click to Analyze Selected Text on Any Page (Priority: P2)

A learner is reading a foreign-language article in their browser. They highlight a word, phrase, or sentence, right-click, and choose "Lingua: Analyze '...'" from the context menu. An overlay panel appears in the top-right corner of the page showing a spinner while the analysis runs, then the full translation and token breakdown — without leaving the page or opening the popup.

**Why this priority**: Reduces friction for in-page reading workflows. Copying text, switching to the popup, and pasting are three extra steps that break reading flow. Context menu integration brings the analysis to where the text already is.

**Independent Test**: Highlight a foreign-language word on any normal webpage, right-click → "Lingua: Analyze", and verify the overlay appears with a spinner then resolves to the token breakdown. Close the overlay with ✕.

**Acceptance Scenarios**:

1. **Given** the user has selected text on a webpage, **When** they right-click and choose "Lingua: Analyze", **Then** a panel overlay appears immediately showing a loading spinner.
2. **Given** the overlay is showing the spinner, **When** the analysis completes, **Then** the spinner is replaced by the translation and token breakdown using the same format as the popup UI.
3. **Given** the overlay is visible, **When** the user clicks the ✕ button, **Then** the overlay is removed from the page.
4. **Given** no API key is configured, **When** the user triggers the context menu, **Then** the overlay shows a prompt to open the extension settings.
5. **Given** the analysis fails (network error, API error, etc.), **When** the error is received, **Then** the overlay displays the user-friendly error message instead of the spinner.

---

### Edge Cases

- What happens when the input is empty or whitespace only? The extension should prompt the user to enter text rather than sending a request.
- How does the system handle words with ambiguous POS (e.g., "run" as noun vs. verb)? Choose the most likely interpretation based on sentence context.
- What happens when the input contains numbers, punctuation, or emoji mixed with words? Punctuation/emoji tokens should be skipped or handled gracefully; numbers may be included as their own token with POS "num".
- How does the system handle very long sentences (50+ words)? The breakdown is still produced in full, preserving order.
- What happens when the AI service is unavailable or returns an error? The extension displays a user-friendly error message and allows the user to retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST provide an input field where users can type or paste text in any language.
- **FR-002**: The extension MUST send the submitted text to an AI language model and receive a structured linguistic analysis response.
- **FR-003**: The response MUST include a natural English translation of the full input sentence.
- **FR-004**: The response MUST include one token entry per original word, preserving input order.
- **FR-005**: Each token entry MUST contain: the exact surface word form, the base lemma, a simple POS tag, and a short English meaning gloss. Each token entry MAY additionally contain romanization, pronunciation, and particles (see FR-026–FR-028).
- **FR-006**: The extension MUST display the translation and token breakdown clearly in the popup UI.
- **FR-007**: The extension MUST reject empty or whitespace-only input and prompt the user to enter text.
- **FR-008**: The extension MUST show a loading indicator while the analysis is in progress.
- **FR-009**: The extension MUST display a user-friendly error message if the analysis request fails, with an option to retry.
- **FR-010**: The POS tags MUST use a consistent, simple vocabulary: noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other.
- **FR-011**: Each meaning gloss MUST be concise (maximum one short phrase, ideally ≤ 5 words).
- **FR-012**: The extension MUST enforce a 2000-character input limit with user warning.
- **FR-013**: The extension MUST implement request timeouts at 30 seconds and display a clear timeout error message ("Request took too long (30s). Please try again.").
- **FR-014**: The extension MUST validate that API responses contain all required fields (translation, tokens array with complete token objects).
- **FR-015**: The extension MUST reject responses larger than 50 KB or with more than 500 tokens and display an error.
- **FR-016**: The extension MUST sanitize all displayed content by inserting user-provided text via DOM `textContent` (never `innerHTML`).
- **FR-017**: The extension MUST store the API key in `chrome.storage.local` and display it as a password field in Settings. The key MUST be at least 20 characters (validated on save).
- **FR-018**: The extension MUST send API requests only to `https://api.anthropic.com/` over TLS (never over HTTP).
- **FR-019**: The extension MUST implement a 1-second rate limit between consecutive analysis requests to prevent rapid-fire submissions.
- **FR-020**: The extension MUST not log, cache, or retain user input or analysis results after the popup is closed.
- **FR-021**: The extension MUST register a context menu item labeled "Lingua: Analyze '%s'" visible when the user has text selected on a webpage.
- **FR-022**: On context menu activation the extension MUST immediately inject a loading overlay into the active tab before calling the API, so the user has visual feedback within one frame.
- **FR-023**: The injected overlay MUST be isolated inside a closed Shadow DOM (`attachShadow({ mode: 'closed' })`) to prevent host-page CSS from affecting its appearance and host-page JavaScript from reading its contents.
- **FR-024**: The injected overlay MUST render all analysis content (translation, token fields) via `textContent`, never `innerHTML`, consistent with FR-016.
- **FR-025**: If the active tab is not injectable (e.g., `chrome://` pages), the context menu activation MUST fail silently without surfacing a browser error to the user.
- **FR-026**: Each token entry for a non-Latin-script word MUST include a `romanization` field — a standard Latin-script transliteration using the language's conventional system (Korean: Revised Romanization, Chinese: Pinyin, Japanese: Hepburn). This field is omitted for Latin-script words.
- **FR-027**: Each token entry for a non-Latin-script word MUST include a `pronunciation` field — an IPA transcription of the word's actual pronunciation. Also included for Latin-script words with non-obvious pronunciation; omitted otherwise.
- **FR-028**: Each token entry MAY include a `particles` field — an ordered array of case particles (조사) attached to the word. Each particle carries a `form` (exact attached marker, e.g. `는`), a `type` (one of: `topic`, `subject`, `object`, `sentence-end`, `other-particle`), and a short English `meaning`. Applies to Korean nouns and pronouns. This field is omitted when no particles are attached.
- **FR-029**: Each token entry MAY include an `endings` field — an ordered array of grammatical verb/adjective endings (어미) attached to the stem. Each ending carries a `form` (exact attached ending, e.g. `고`), a `type` (one of: `connective`, `attributive`, `nominal`, `concessive`, `sentence-final`, `other-ending`), and a short English `meaning` explaining what the ending expresses. Applies to Korean verbs and adjectives. This field is omitted when no endings are attached.
- **FR-030**: Particles (FR-028) and endings (FR-029) MUST each be rendered as standalone token cards immediately following their parent word card in the grid. Each morpheme card displays the form large, a colour-coded type badge, and the full English meaning. Inline badge rows inside the parent word card are not used.

### Key Entities

- **AnalysisRequest**: The raw text string submitted by the user.
- **Translation**: A natural English string representing the full meaning of the input.
- **Token**: One word from the input, carrying: surface form (`word`), base form (`lemma`), part-of-speech (`pos`), and English gloss (`meaning`). Required for non-Latin scripts: `romanization` (Latin transliteration) and `pronunciation` (IPA). Optional: `particles` (array of case particles, each with `form`, `type`, `meaning`) and `endings` (array of grammatical verb/adjective endings, each with `form`, `type`, `meaning`).
- **AnalysisResult**: The structured response containing `translation` (string) and `tokens` (ordered list of Token).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users receive a translation and full token breakdown within 5 seconds of submitting a typical sentence (under 30 words) under normal network conditions.
- **SC-002**: 100% of tokens in the breakdown correspond to words in the original input and appear in the same order.
- **SC-003**: The UI renders the breakdown without layout errors for sentences up to 50 words long.
- **SC-004**: Users can submit a new sentence immediately after viewing results without reloading the extension.
- **SC-005**: Error states are surfaced with a human-readable message in under 1 second of the failure being detected.

## Error Handling & Recovery *(mandatory)*

### Input Validation

- **Empty or whitespace-only input**: Rejected immediately with prompt "Please enter text to analyze."
- **Input length limit**: Maximum 2000 characters enforced on client side with user warning.
- **Language validation**: No validation — any language is accepted.

### API Error Handling

- **HTTP 401 (Invalid API key)**: User sees "Invalid or expired API key. Check your settings." with link to Settings view.
- **HTTP 429 (Rate limit)**: User sees "You've made too many requests. Please wait a moment before trying again." No automatic retry — user controls retry manually via the Retry button.
- **HTTP 5xx (Server error)**: User sees "Claude API is temporarily unavailable. Please try again in a moment." with manual Retry button.
- **Network failure (timeout or connection error)**: User sees "Network error. Check your internet connection and try again." with Retry button.
- **Malformed or non-JSON response**: User sees "Unexpected response format. Please retry." Engineering logs the response for debugging (without sensitive data).

### Response Validation

- **Missing required fields**: If `translation` or `tokens` missing, show error "Incomplete response. Please retry."
- **Invalid token structure**: Each token must have `word`, `lemma`, `pos`, `meaning` (all strings, all non-empty).
- **Invalid POS tag**: If `pos` not in vocabulary (noun, verb, adj, adv, pron, prep, conj, det, num, punct, other), treat as `other`.
- **Token count mismatch**: If token count ≠ input word count, accept but log warning; show results anyway.
- **Oversized response**: If response > 50 KB or token array > 500 items, reject with "Response too large. Try a shorter input."

### Timeout & Retry

- **Request timeout**: 30 seconds per request (includes Claude API call). Raised from 10 s to accommodate the larger response payloads introduced by romanization, pronunciation, and particle fields.
- **Timeout handling**: User sees "Request took too long (30s). Please try again." with Retry button.
- **Manual retry**: User can click Retry button unlimited times. No automatic retries.
- **Rate limiting (user side)**: Minimum 1-second wait between submit button clicks to prevent rapid-fire requests.

---

## Security & Data Privacy *(mandatory)*

### Input & Output Sanitization

- **Input**: User text is treated as opaque string data. No validation for malicious content (it's linguistic data, not executable code).
- **Output sanitization**: All rendered content (translation, tokens) is inserted via DOM `textContent` property, never `innerHTML`, to prevent XSS.
- **User input echoed back**: The `word` field in tokens is the exact surface form from input; sanitization happens at render time, not storage.

### API Key Security

- **Storage**: API key stored in `chrome.storage.local`, scoped to extension origin. No sync across devices.
- **Access scope**: Key only readable by this extension; inaccessible to web pages or other extensions.
- **Transmission**: Key sent only to `https://api.anthropic.com/` over TLS 1.2+ with certificate validation.
- **UI masking**: API key input field displays as password (`type="password"`) in Settings view. Key never displayed once saved.
- **Deletion**: User can clear API key by editing Settings and removing the key, then saving. No confirmation required.

### Data Privacy

- **No telemetry**: Extension does not send user data to any service except the Claude API.
- **No logs**: User input and analysis results are not logged to disk or cloud. Error traces may reference request metadata (HTTP status, error type) but never user text.
- **Data retention**: Analysis results are shown in the popup and cleared when the popup closes or new analysis is submitted. No history kept.
- **No caching**: Each request to Claude is independent; results not cached.
- **Permissions minimization**: Extension requests `storage`, `contextMenus`, `activeTab`, and `scripting` permissions, plus `host_permissions` for the Claude API. `activeTab` grants access only to the current tab during an explicit user gesture (context menu click) — no persistent or broad page-content access.

### Content Security Policy (CSP)

- **Manifest CSP**: Extension declares `script-src: 'self'` and `default-src: 'self'` to block inline scripts and external script injection.
- **No eval**: JavaScript never uses `eval()`, `Function()`, or `setTimeout(code_string)`.
- **No inline styles**: All CSS is in `popup.css`; no `style` attributes on elements.
- **DOM safety**: All user data rendered via `textContent`, `value`, or DOM methods, never via HTML string concatenation.

### Network Security

- **HTTPS only**: All API calls to `https://api.anthropic.com/v1/messages`. No fallback to HTTP.
- **Certificate validation**: Chrome's standard certificate validation applies; no certificate pinning (assumes browser security is sufficient).
- **Header security**: No sensitive headers logged or echoed in responses.

---

## Assumptions

- Users have a modern Chromium-based browser that supports Chrome Extensions Manifest V3.
- The extension communicates with an external AI API (e.g., Claude) to perform translation and linguistic analysis; no on-device NLP model is bundled.
- An API key for the AI service is stored securely in the extension's storage and is configured by the user during initial setup.
- Mobile browser support is out of scope; the extension targets desktop Chrome.
- The extension has two entry points: the popup (for focused analysis) and a right-click context menu (for in-page reading workflows). Both share the same API client and validation layer.
- Language detection is handled implicitly by the AI model; the user does not need to specify the source language.
- The AI model may occasionally make best-guess interpretations for ambiguous words; this is acceptable per the stated rules.
- User's OS profile security is trusted; `chrome.storage.local` encryption is assumed to be as secure as the OS allows.
- HTTPS and browser certificate validation are sufficient; additional certificate pinning is out of scope.
- Users will not intentionally submit extremely long or malicious payloads; 2000 character limit is enforced as a practical UX constraint, not a security boundary.
