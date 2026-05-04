# Implementation Plan: Linguistic Word Breakdown

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-lingua-word-breakdown/spec.md`

---

## Summary

Build a Chrome Extension (Manifest V3) popup that accepts arbitrary foreign-language text, calls the Claude API to produce a structured JSON linguistic analysis, and renders the English translation plus a word-by-word token breakdown (lemma, POS, gloss) in a clean popup UI. The user supplies their own Anthropic API key, stored locally in `chrome.storage.local`.

---

## Technical Context

**Language/Version**: JavaScript (ES2022+), HTML5, CSS3 — no build step required  
**Primary Dependencies**: Chrome Extensions API (MV3), Anthropic Claude API via native `fetch()`  
**Storage**: `chrome.storage.local` (API key persistence only)  
**Testing**: Manual smoke testing (popup UI); Jest + chrome mock for `lib/analyzer.js` unit tests  
**Target Platform**: Chrome 120+ / Chromium-based browsers (Manifest V3)  
**Project Type**: Browser extension — popup UI only  
**Performance Goals**: Full analysis returned within 5 seconds for sentences ≤ 30 words  
**Constraints**: MV3 compliant (service worker, no background page); CSP blocks inline scripts; API calls to `https://api.anthropic.com/*` must be declared in `host_permissions`  
**Scale/Scope**: Single user, single popup instance; one Claude API call per analysis

---

## Constitution Check

*No active constitution principles defined — all gates pass by default.*

Re-check: N/A (no constraints to re-evaluate post-design).

---

## Project Structure

### Documentation (this feature)

```text
specs/001-lingua-word-breakdown/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── ai-prompt-contract.md   # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
extension/
├── manifest.json              # MV3 manifest
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Input handling, render logic, settings view
│   └── popup.css              # Popup styles
├── lib/
│   └── analyzer.js            # Claude API call + JSON parse/validate
├── background/
│   └── service-worker.js      # Minimal MV3 service worker
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**Structure Decision**: Single-project layout. No backend. No build toolchain. Pure HTML/CSS/JS loaded directly by Chrome as an unpacked extension. The popup is the sole entry point for user interaction.

---

## Component Breakdown

### `manifest.json`

- `manifest_version: 3`
- `action.default_popup: popup/popup.html`
- `background.service_worker: background/service-worker.js`
- `permissions: ["storage"]` (for chrome.storage.local API key access)
- `host_permissions: ["https://api.anthropic.com/*"]` (only HTTPS to Claude API)
- `content_security_policy.extension_pages`: `"script-src 'self'; default-src 'self'; img-src 'self' data:;"` (block inline scripts, external scripts)

### `lib/analyzer.js`

Core module. Exports one async function:

```js
analyzeText(text, apiKey) → Promise<AnalysisResult>
```

Responsibilities:
1. Build the Claude API request (model, system prompt, user message).
2. Wrap `fetch()` in a 10-second timeout using `AbortController`.
3. Check HTTP status; throw typed errors for 401, 429, 5xx, network failure, timeout.
4. Extract `response.content[0].text`.
5. `JSON.parse()` the text; validate all required fields and structure (see security.md).
6. Validate each token has `word`, `lemma`, `pos`, `meaning` (all strings, all non-empty).
7. Validate response size ≤ 50 KB and token count ≤ 500.
8. Silently correct invalid POS tags to `other`; warn if token count ≠ input word count.
9. Return the validated `AnalysisResult` object.

**Error handling**: Throws custom error classes:
- `TimeoutError`: Request exceeded 10 seconds
- `ApiError(status, message)`: HTTP error
- `NetworkError(message)`: Connection/DNS failure
- `JsonError(message)`: JSON parse failure
- `ValidationError(field, message)`: Missing/invalid field

The Claude system prompt is defined as a constant inside this module (see `contracts/ai-prompt-contract.md` for the exact text).

### `popup/popup.js`

UI controller and error handler. On popup open:
1. Load `apiKey` from `chrome.storage.local`.
2. If no key, show Settings view automatically.
3. Clear any previous error/loading state.

On submit:
1. Validate input (non-empty, non-whitespace, ≤ 2000 characters).
2. Enforce 1-second rate limit (disable submit button if clicked < 1s ago).
3. Show loading state (spinner, disable inputs).
4. Call `analyzeText(text, apiKey)` wrapped in try/catch.
5. On success: render translation headline + token cards (using `textContent`, never `innerHTML`).
6. On error: catch typed errors and display appropriate user message:
   - `TimeoutError` → "Request took too long..." with Retry
   - `ApiError` (401) → "Invalid API key..." with Settings link
   - `ApiError` (429) → "Rate limited..." (no auto-retry)
   - `ApiError` (5xx) → "API error..." with Retry
   - `NetworkError` → "Network error..." with Retry
   - `JsonError` → "Unexpected response..." with Retry
   - `ValidationError` → "Incomplete response..." with Retry
   - Any other error → Generic error message with Retry

On Settings save:
1. Validate API key is non-empty and reasonable length (≥ 20 chars).
2. Write `apiKey` to `chrome.storage.local`.
3. Return to main view.

On Settings close:
1. Do not save changes; discard user input.
2. Return to main view.

**DOM Safety**: All user data (translation, token fields) inserted via `textContent` property, never `innerHTML`. POS badges inserted with `setAttribute()` (safe since POS is from response, validated).

### `popup/popup.html`

Two-view structure toggled by CSS class on a root container:

- **Main view**: `<textarea>` for input (max 2000 chars), Analyze `<button>`, results `<div>` (translation + token grid), Settings icon `<button>`.
- **Settings view**: API key `<input type="password">` (masked display), Save `<button>`, Cancel `<button>`.
- Loading spinner overlay (hidden by default, centered).
- Error banner with typed error messages and Retry/Settings buttons (hidden by default, styled in red).

**Security**: 
- No inline JavaScript (no `onclick`, `oninput` attributes)
- No inline styles (all CSS in popup.css)
- API key input uses `type="password"` to mask the value
- All event listeners attached via `addEventListener()` in popup.js
- User content rendered via `textContent`, never `innerHTML`

### `popup/popup.css`

Minimal, clean design:
- Fixed popup width: 400px; max-height: 600px; overflow-y: auto.
- Token cards displayed in a responsive flex/grid layout.
- Each card: surface word (large), lemma (italic), POS badge (color-coded), meaning.
- Loading spinner centered.
- Error banner styled in red.

### `background/service-worker.js`

Empty placeholder required by MV3. No logic needed for v1.

---

## Data Flow

```
User types text
      ↓
popup.js validates (non-empty)
      ↓
popup.js reads apiKey from chrome.storage.local
      ↓
popup.js calls analyzer.analyzeText(text, apiKey)
      ↓
analyzer.js POSTs to https://api.anthropic.com/v1/messages
      ↓
Claude returns JSON text in content[0].text
      ↓
analyzer.js parses + validates AnalysisResult
      ↓
popup.js renders translation + token cards
```

---

## API Contract & Security Reference

See [contracts/ai-prompt-contract.md](contracts/ai-prompt-contract.md) for:
- Full system prompt text
- Request/response shape
- Detailed error handling classification
- Example output

See [security.md](security.md) for:
- Error handling implementation patterns
- Input validation strategy
- Output sanitization rules
- API key storage and handling
- Network security (HTTPS, timeouts)
- CSP requirements
- Testing error paths

---

## Complexity Tracking

*No constitution violations — section not applicable.*
