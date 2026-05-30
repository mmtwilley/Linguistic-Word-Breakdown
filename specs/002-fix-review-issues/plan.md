# Implementation Plan: Code Review Fixes

**Branch**: `002-fix-review-issues` | **Date**: 2026-05-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-fix-review-issues/spec.md`

## Summary

Eleven targeted fixes to the Lingua Chrome Extension addressing security, correctness, performance, accessibility, and UX issues identified in a code review. Critical changes: (1) adding double-inject guard and dismiss-during-load protection to the page overlay; (2) correcting rate-limit timing to start at submission, not response; (3) confirming and documenting that the API key is already secure in the scripting injection path. Supporting changes: extract shared token card renderer, add ARIA live region, cache the API key in memory, simplify system prompt, and clean up settings cancel behavior.

## Technical Context

**Language/Version**: Vanilla JavaScript ES2022+ (no transpiler, no bundler)
**Primary Dependencies**: None at runtime; Jest 29 (devDependency)
**Storage**: `chrome.storage.local` — API key only; no user data retained
**Testing**: Jest 29 (`node --experimental-vm-modules`), `npm test`
**Target Platform**: Chrome / Chromium desktop, Manifest V3
**Project Type**: Browser Extension (single-user, local; no server-side component)
**Performance Goals**: API key read once per popup/SW instance; response size check must not re-serialize the full response object
**Constraints**: No build step; MV3 injected functions must be self-contained (cannot use ES module imports); 30 s API timeout; 2000-char input cap

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — Security-First Rendering

| Check | Status | Notes |
|-------|--------|-------|
| API key confirmed absent from `executeScript` args | ✅ PASS | `linguaRenderOverlay` is a module-scope function, not a closure; `args: [payload]` never contains the key. Confirmed by code inspection (see research.md). |
| All user data rendered via `textContent` | ✅ PASS | No new `innerHTML` usage; `replaceChildren()` and new renderer use `textContent` only |
| POS/particle class names still validated against allowlists | ✅ PASS | No changes to validation logic |
| No inline JS event handlers added | ✅ PASS | New message listener added via `chrome.runtime.onMessage.addListener` |

### Principle II — Vanilla JavaScript, No Build Step

| Check | Status | Notes |
|-------|--------|-------|
| No new runtime dependencies | ✅ PASS | No npm packages added |
| No bundler required | ⚠️ NOTE | `lib/renderer.js` is an ES module importable by `popup.js`. The overlay function in `service-worker.js` cannot import it (MV3 injection constraint). Overlay keeps own implementation. See Design Decisions. |
| All source files directly loadable | ✅ PASS | New `lib/renderer.js` follows same module pattern as existing lib files |

### Principle III — Structured API Contracts

| Check | Status | Notes |
|-------|--------|-------|
| System prompt simplified (FR-009) | ✅ PASS | Framing-only system prompt; all per-field rules remain in tool schema descriptions |
| Tool schema structure unchanged | ✅ PASS | `input_schema` fields, types, and `required` arrays unmodified |
| Contract document updated | ✅ PASS | `specs/002-fix-review-issues/contracts/ai-prompt-contract.md` documents the v3.1 system prompt |

### Principle IV — Typed Error Handling

| Check | Status | Notes |
|-------|--------|-------|
| No new failure modes require new error classes | ✅ PASS | Double-inject guard uses early return; dismiss guard uses early return; no new throw paths |
| No silent failures introduced | ✅ PASS | All new guards either return early with visible feedback or log warnings |

### Principle V — Minimal Data Retention

| Check | Status | Notes |
|-------|--------|-------|
| In-memory API key cache (FR-010) | ✅ PASS | `cachedApiKey` variable in module scope only; never logged; cleared when popup/SW process terminates |
| API key never in console output | ✅ PASS | Cache variable is used for calls, never logged or printed |

**Constitution verdict: ALL GATES PASS — no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-review-issues/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output — dev notes for this fix batch
├── contracts/
│   └── ai-prompt-contract.md   # System prompt v3.1 amendment
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (modified files)

```text
extension/
├── popup/
│   ├── popup.html          # +aria-live="polite" on #results; +role="alert" on #error-banner
│   └── popup.js            # rate limit timing fix; replaceChildren(); cancel clear;
│                           # key cache; remove redundant validateInput call; import renderer
│
├── lib/
│   ├── analyzer.js         # size check via response.text(); simplified system prompt
│   └── renderer.js         # NEW: shared buildTokenCard() + buildMorphemeCard() functions
│
├── background/
│   └── service-worker.js   # pendingTabs guard; dismiss message handler; confirming comment
│
└── tests/
    └── analyzer.test.js    # size check tests; confirm apiKey absent from inject args
```

**Structure Decision**: Single-project Chrome Extension, same layout as 001. One new file (`lib/renderer.js`). No new directories in `extension/`. No changes to `manifest.json` or `package.json`.

## Design Decisions

### 1. API Key Security (FR-001)

**Finding confirmed false positive**: `linguaRenderOverlay` is a named function at module scope, not a closure. Chrome serializes the function source; it cannot capture `apiKey` from the calling event handler's scope. The `args: [payload]` array contains `{ loading: true }`, `{ result }`, or `{ error }` — never the API key. The current code is already secure.

**What changes**: Add an explicit comment on `linguaRenderOverlay` reinforcing this guarantee. Add a test asserting the injected payload never contains a key-shaped string.

### 2. Double-Inject Race Condition (FR-002, FR-003)

**In-progress guard**: `const pendingTabs = new Set()` at service-worker module scope. In the `onClicked` handler: add `tab.id` before injection, remove in `finally`. If `tab.id` already present, return early — no second request.

**Dismiss-during-load guard**: When the user closes the overlay while loading, the injected close button sends `chrome.runtime.sendMessage({ type: 'lingua-overlay-dismissed', tabId: tab.id })`. The service worker listens via `chrome.runtime.onMessage` and adds `tab.id` to `const dismissedTabs = new Set()`. Before `inject(tab.id, { result })`, check `dismissedTabs.has(tab.id)`: if true, skip injection and remove from set. The `finally` block also removes from `dismissedTabs`.

**Note on tab.id availability in injected function**: The close button in `linguaRenderOverlay` doesn't have access to `tab.id` directly. Pass it as part of the initial `payload` so the injected function can include it in the dismiss message.

### 3. validateInput Double-Call (FR-004)

**Fix**: Remove the explicit `validateInput(inputText.value)` call in `popup.js:runAnalysis`. `analyzeText()` already calls it internally. The service worker path also calls `analyzeText()` which validates. Single validation point; `popup.js` only calls `analyzeText()`.

**Tradeoff**: The popup previously showed validation errors before even calling `analyzeText`. After the fix, validation still runs synchronously inside `analyzeText` before the async fetch — user experience is identical. The `ValidationError` still propagates to `handleError`.

### 4. Shared Token Card Renderer (FR-005)

**MV3 constraint**: Functions injected via `chrome.scripting.executeScript({ func })` are serialized and cannot import ES modules. `lib/renderer.js` cannot be imported inside `linguaRenderOverlay`.

**Approach**: Extract `buildTokenCard(token)` and `buildMorphemeCard(form, badgeClass, typeLabel, meaning)` into `lib/renderer.js` as named exports. `popup.js` imports them. The `linguaRenderOverlay` function in `service-worker.js` keeps its own identical implementation of these helpers (no functional change — just better organization in popup.js). Any future structural changes must be made in both files; this is documented as a known MV3 limitation.

**Alternative considered**: Inject `lib/renderer.js` via `files` before calling a named global function. Rejected: this requires `lib/renderer.js` to be a non-module IIFE polluting the page global namespace, and creates a two-step injection sequence with its own race condition.

### 5. Response Size Check (FR-008)

**Fix**: In `analyzeText`, replace `response.json()` with:
```js
const text = await response.text();
if (text.length > MAX_RESPONSE_BYTES) throw new ValidationError('response', '...');
const data = JSON.parse(text);
```
This reads the response body once as text, checks length cheaply, then parses. No re-serialization. The `try/catch` around `JSON.parse(text)` throws `JsonError` on malformed responses (same behavior as before).

### 6. System Prompt Consolidation (FR-009)

**Decision**: The tool schema field `description` values are authoritative for Claude's structured output behavior. The system prompt is reduced to high-level framing only:

```
Analyze the input text for language learning using the linguistic_analysis tool. Produce a structured word-level breakdown. For non-Latin-script words (Korean, Chinese, Japanese), romanization and IPA pronunciation are required. For Korean, identify attached particles (조사) and verb/adjective endings (어미) as specified in the tool schema.
```

All per-field mapping rules (which particle type for 은/는, which ending type for -고 etc.) remain exclusively in the tool schema descriptions. This eliminates the duplication without changing analysis quality.

### 7. API Key Cache (FR-010)

**In popup.js**: `let cachedApiKey = null` at module scope. `getApiKey()` async function returns `cachedApiKey` if set, else reads from storage and caches. `saveBtn` click handler updates `cachedApiKey` immediately on save.

**In service-worker.js**: Same pattern — `let cachedApiKey = null`. Note: Chrome may terminate and restart the service worker; the cache starts null on each new instance. This is acceptable — the cost of one storage read per SW start is negligible.

### 8. ARIA Live Region (FR-011)

Add `aria-live="polite"` and `role="status"` to `#results` in `popup.html`. Add `role="alert"` to `#error-banner`. The `hidden` attribute is set/cleared by JS; the live region is active when `hidden` is removed and content is added. No change needed to `popup.js` — the existing `resultsEl.hidden = false` call combined with the live region is sufficient for screen readers to announce new content.

### 9. Cancel Clears API Key Input (FR-012)

Add `apiKeyInput.value = ''` to the `cancelBtn` click handler in `popup.js`. One-line fix.

## Complexity Tracking

> No constitution violations — this section is not applicable.
