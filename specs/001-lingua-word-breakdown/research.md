# Research: Linguistic Word Breakdown Extension

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-03

---

## Decision 1: Extension Architecture — Manifest V3

**Decision**: Use Chrome Extensions Manifest V3 (MV3) with a popup-only UI.

**Rationale**: MV3 is the current and only supported manifest version for new Chrome extensions. Service workers replace background pages; however, for this feature, all API calls can be made directly from `popup.js` via `fetch()` — no service worker routing is needed. A minimal service worker file is still required by MV3 to be registered in the manifest.

**Alternatives considered**:
- MV2: Deprecated, being phased out, rejected.
- Content-script overlay: Would require page permissions and adds complexity out of scope for v1.

---

## Decision 2: AI API — Claude (Anthropic)

**Decision**: Use the Anthropic Claude API (`claude-sonnet-4-6` or equivalent) called via `fetch()` from the popup context.

**Rationale**:
- Claude reliably produces structured JSON when given a precise system prompt with schema instructions.
- The Claude API accepts HTTPS `POST` requests with a JSON body — trivially callable from a Chrome extension popup with no additional SDK needed.
- MV3 CSP allows `fetch()` to external origins when the origin is listed in `host_permissions` in `manifest.json`.

**API call pattern**:
```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: <user API key>
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
  { model, max_tokens, system, messages: [{role:"user", content: inputText}] }
```

**Alternatives considered**:
- OpenAI GPT-4o: Also viable; rejected to keep a single provider dependency and align with the Claude API skill context.
- On-device model (Gemini Nano via Chrome AI APIs): Insufficient instruction-following for structured JSON output; experimental and unreliable.
- Backend proxy: Eliminates client-side key exposure but adds infra complexity out of scope for v1.

---

## Decision 3: API Key Storage — chrome.storage.local

**Decision**: Store the user's API key in `chrome.storage.local`.

**Rationale**:
- `chrome.storage.local` is the standard for per-extension persistent data in MV3.
- It is not exposed to web pages and is scoped to the extension origin.
- The key is entered once via a settings input in the popup and persisted.

**Security note**: `chrome.storage.local` is not encrypted at rest; it is as secure as the user's OS profile. This is the accepted trade-off for client-side extensions. A backend proxy would be the only way to avoid client-side key storage, which is out of scope.

**Alternatives considered**:
- `chrome.storage.session`: Cleared on browser close — poor UX for API key.
- `localStorage`: Not available in MV3 service workers and not recommended for extensions.

---

## Decision 4: Fetch from Popup vs. Service Worker

**Decision**: Make the Claude API `fetch()` call directly from `popup.js`.

**Rationale**:
- Popup context has full access to `fetch()` and `chrome.storage.local`.
- Routing through the service worker adds message-passing boilerplate with no benefit for this use case.
- The popup is alive for the duration of the user's interaction, so there is no lifecycle concern.

**Alternatives considered**:
- Service worker proxy: Useful if background tasks or caching were needed; rejected as over-engineering for v1.

---

## Decision 5: Prompt Engineering for Structured JSON

**Decision**: Use a strict system prompt that defines the exact JSON schema and rules, and instruct the model to return ONLY the JSON object.

**Rationale**: Claude reliably follows schema constraints when the schema is embedded in the system prompt and the user message is purely the input text. No post-processing fallback (e.g., regex extraction) should be needed for well-formed responses, but the popup will catch JSON parse errors and show a user-friendly error.

**System prompt approach**: See `contracts/ai-prompt-contract.md`.

---

## Decision 6: UI Layout — Single Popup, Two Views

**Decision**: The popup has two views:
1. **Main view**: Text input area + Submit button + results panel (translation headline + token cards).
2. **Settings view**: API key input field + Save button.

Navigation between views is handled by toggling CSS classes — no router needed.

**Rationale**: Simple, minimal DOM manipulation. No framework overhead.

---

## Decision 7: Testing Strategy

**Decision**: Manual testing for popup UI; lightweight unit tests via `jest` + `chrome` mock for `analyzer.js` (the API call module).

**Rationale**: Chrome extension popup testing with full browser automation (e.g., Puppeteer extension testing) is complex to set up. Given the small scope, manual smoke testing of the popup covers the golden path. The API call and JSON parsing logic in `analyzer.js` is the only logic worth unit-testing in isolation.

**Alternatives considered**:
- Playwright + chrome extension fixture: Viable but high setup cost for v1.
