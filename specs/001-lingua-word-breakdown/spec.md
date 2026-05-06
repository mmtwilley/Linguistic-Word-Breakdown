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
- **FR-005**: Each token entry MUST contain: the exact surface word form, the base lemma, a simple POS tag, and a short English meaning gloss.
- **FR-006**: The extension MUST display the translation and token breakdown clearly in the popup UI.
- **FR-007**: The extension MUST reject empty or whitespace-only input and prompt the user to enter text.
- **FR-008**: The extension MUST show a loading indicator while the analysis is in progress.
- **FR-009**: The extension MUST display a user-friendly error message if the analysis request fails, with an option to retry.
- **FR-010**: The POS tags MUST use a consistent, simple vocabulary: noun, verb, adj, adv, pron, prep, conj, det, num, punct, or other.
- **FR-011**: Each meaning gloss MUST be concise (maximum one short phrase, ideally ≤ 5 words).
- **FR-012**: The extension MUST enforce a 2000-character input limit with user warning.
- **FR-013**: The extension MUST implement request timeouts at 10 seconds and display a clear timeout error message.
- **FR-014**: The extension MUST validate that API responses contain all required fields (translation, tokens array with complete token objects).
- **FR-015**: The extension MUST reject responses larger than 50 KB or with more than 500 tokens and display an error.
- **FR-016**: The extension MUST sanitize all displayed content by inserting user-provided text via DOM `textContent` (never `innerHTML`).
- **FR-017**: The extension MUST store the API key in `chrome.storage.local` and display it as a password field in Settings. The key MUST be at least 20 characters (validated on save).
- **FR-018**: The extension MUST send API requests only to `https://api.anthropic.com/` over TLS (never over HTTP).
- **FR-019**: The extension MUST implement a 1-second rate limit between consecutive analysis requests to prevent rapid-fire submissions.
- **FR-020**: The extension MUST not log, cache, or retain user input or analysis results after the popup is closed.

### Key Entities

- **AnalysisRequest**: The raw text string submitted by the user.
- **Translation**: A natural English string representing the full meaning of the input.
- **Token**: One word from the input, carrying surface form (`word`), base form (`lemma`), part-of-speech (`pos`), and English gloss (`meaning`).
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

- **Request timeout**: 10 seconds per request (includes Claude API call).
- **Timeout handling**: User sees "Request took too long. Please try again." with Retry button.
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
- **Permissions minimization**: Extension requests only `storage` and `host_permissions` for Claude API. No access to browsing history, tabs, or page content.

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
- The extension popup is the primary (and only) interface — no content-script overlay or context-menu integration is in scope for v1.
- Language detection is handled implicitly by the AI model; the user does not need to specify the source language.
- The AI model may occasionally make best-guess interpretations for ambiguous words; this is acceptable per the stated rules.
- User's OS profile security is trusted; `chrome.storage.local` encryption is assumed to be as secure as the OS allows.
- HTTPS and browser certificate validation are sufficient; additional certificate pinning is out of scope.
- Users will not intentionally submit extremely long or malicious payloads; 2000 character limit is enforced as a practical UX constraint, not a security boundary.
