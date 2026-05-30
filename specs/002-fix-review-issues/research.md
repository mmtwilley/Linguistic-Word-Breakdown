# Research: Code Review Fixes

**Branch**: `002-fix-review-issues` | **Date**: 2026-05-30

---

## Finding 1: API Key in Scripting Args (Issue #1)

**Decision**: No code change required to security model; add confirming comment and test.

**Rationale**: Code inspection confirms `linguaRenderOverlay` is a named function at module scope in `service-worker.js`, not a closure over the `onClicked` handler. Chrome's `chrome.scripting.executeScript({ func })` serializes the function source code — it cannot capture variables from the outer scope. The `args: [payload]` passed to the injected function contain only `{ loading: true }`, `{ result }` (the `{ translation, tokens }` object), or `{ error: string }`. The API key is retrieved from `chrome.storage.local` within the service worker context and passed directly to `analyzeText()` — never to `inject()`.

**Conclusion**: The original review finding is a false positive. The existing architecture is already secure. The fix is documentation (confirming comment) and a test assertion.

**Alternatives considered**: Proxying API calls through a backend (rejected — adds server infrastructure; violates Principle II's no-server constraint). Using `chrome.runtime.sendMessage` for the API call from the page context (rejected — not needed; the service worker already handles the call).

---

## Finding 2: Double-Inject Race Condition (Issue #2)

**Decision**: `pendingTabs` Set for in-progress guard; `dismissedTabs` Set + message listener for dismiss-during-load guard.

**Rationale**: Chrome service workers are long-running but event-driven. A second right-click event on the same tab while the first analysis is in-flight will trigger a second `onClicked` handler invocation. A module-scope `Set` is retained across event handler calls (within the same SW instance lifetime). The `finally` block guarantees cleanup even on error.

For the dismiss-during-load case: the close button is inside the Shadow DOM in the page context. It cannot directly access service worker state. The cleanest bidirectional link is `chrome.runtime.sendMessage` from the page to the SW. The SW listener updates `dismissedTabs` and checks it before the result injection.

**Tab ID availability in overlay**: `tab.id` must be passed as part of the initial `payload` to `linguaRenderOverlay` so the close button can include it in the dismiss message. The overlay function receives `payload.tabId` alongside `payload.loading`/`payload.result`/`payload.error`.

**Alternatives considered**: Checking page DOM for overlay presence before injecting result (requires extra `executeScript` round-trip; adds latency). Using a `BroadcastChannel` between page and SW (not supported in MV3 service workers; SW context is separate from page context).

---

## Finding 3: validateInput Double-Call (Issue #3)

**Decision**: Remove explicit `validateInput()` call from `popup.js:runAnalysis`. Rely on `analyzeText()` as the single validation point.

**Rationale**: `analyzeText()` must validate input because it is also called from the service worker context (right-click path), where the popup's pre-call guard is absent. Having validation in one place (inside `analyzeText`) eliminates the duplication without changing behavior. The popup still gets `ValidationError` thrown synchronously before the fetch call, so the UX is unchanged.

**Alternatives considered**: Making internal validation optional via a flag parameter (rejected — adds API complexity for no benefit). Keeping both calls (status quo — unnecessarily runs validation twice, is confusing).

---

## Finding 4: Shared Token Card Renderer (Issue #4)

**Decision**: Extract to `lib/renderer.js` for popup; overlay keeps self-contained copy. Document as known MV3 limitation.

**Rationale**: MV3's `chrome.scripting.executeScript({ func })` serializes the function as source code. The serialized function cannot contain `import` statements. The injected function runs in the page context, which has no access to the extension's module graph.

The two realistic approaches without a build step:
1. **Self-contained global file**: Define renderer as a non-module IIFE in `lib/renderer.js`. Inject it via `files: ['lib/renderer.js']`, then call the resulting global. Rejected: pollutes page globals; requires two-step injection; `lib/renderer.js` can't be both an IIFE global (for injection) and an ES module (for popup import) simultaneously without duplication or a build step.
2. **Accept structural duplication in overlay; use module in popup**: `lib/renderer.js` exports `buildTokenCard` and `buildMorphemeCard` as ES module functions for `popup.js`. `linguaRenderOverlay` in `service-worker.js` keeps identical inline helpers. This is the accepted approach.

**Risk**: Changes to card structure must be applied in two places. Mitigation: document in code comments; the two implementations are kept structurally identical to make diffs obvious.

---

## Finding 5: tokensGrid.textContent = '' (Issue #5)

**Decision**: Replace with `tokensGrid.replaceChildren()`.

**Rationale**: `element.textContent = ''` removes all child nodes by serializing an empty string assignment — it works but is semantically misleading (the property is for text content, not child node removal). `replaceChildren()` with no arguments is the modern, explicit API for removing all children. No browser compatibility concerns for Chrome MV3 target.

---

## Finding 6: Rate Limit Timing (Issue #6)

**Decision**: Set `lastSubmitTime = Date.now()` at the start of `runAnalysis`, before the async call.

**Rationale**: The current code sets `lastSubmitTime` in both the `try` and `catch` blocks of the async call. This means during an in-flight request, `lastSubmitTime` is still 0 (or the previous request's time), so clicking Retry before the response arrives resets the timestamp to now — but only after the handler completes. The real fix: stamp the time at the start, before `showLoading()`. Any subsequent call (including Retry) within 1 second will be blocked by the gate check.

---

## Finding 7: JSON.stringify Size Check (Issue #7)

**Decision**: Replace `JSON.stringify(data).length` with checking `response.text()` length before `JSON.parse`.

**Rationale**: The current check at line `if (JSON.stringify(data).length > MAX_RESPONSE_BYTES)` in `validateResponse` runs after parsing. It re-creates the full JSON string just to measure its length — O(n) in total response size. The fix: in `analyzeText`, fetch the response as text first, check `.length`, then parse. This moves the check to the network boundary (correct place for size limits) and avoids the re-serialization.

**Size comparison**: `response.text().length` is the raw UTF-16 byte count of the response body, which is slightly different from `JSON.stringify(data).length` (re-serialized). Both are reasonable proxies for "response is too large." The raw text length is more accurate.

---

## Finding 8: System Prompt / Tool Schema Redundancy (Issue #8)

**Decision**: Keep field rules exclusively in tool schema `description` values. Reduce system prompt to framing only.

**Rationale**: Claude's structured output behavior is governed primarily by the tool schema. When `tool_choice: { type: 'tool' }` is set, Claude fills the schema fields according to their descriptions. The system prompt is better used for high-level framing and cross-cutting instructions. Having the same rules in both places creates maintenance risk (they can drift) and wastes prompt tokens.

**Simplified system prompt (v3.1)**:
```
Analyze the input text for language learning using the linguistic_analysis tool. Produce a structured word-level breakdown. For non-Latin-script words (Korean, Chinese, Japanese), romanization and IPA pronunciation are required. For Korean, identify attached particles (조사) and verb/adjective endings (어미) as specified in the tool schema.
```

This retains the key cross-cutting reminder ("romanization and IPA required for non-Latin-script") while removing the redundant per-particle and per-ending type mappings that are already fully described in the tool schema.

---

## Finding 9: API Key Cache (Issue #9)

**Decision**: Module-scope `cachedApiKey` variable with null initialization; updated on save.

**Rationale**: `chrome.storage.local.get` is an async IPC call to the browser process. For the popup, this is called on every `runAnalysis` invocation. Caching the key in module scope after the first read eliminates this overhead for subsequent calls within the same popup session. The cache is invalidated immediately when the user saves a new key via `saveBtn`.

For the service worker: same pattern. The SW may be terminated and restarted by Chrome at any time; the cache starts null on each new instance. One storage read per SW activation is acceptable.

**Safety**: The cache holds the key in a JavaScript variable — no additional persistence, no logging. Consistent with Principle V.

---

## Finding 10: ARIA Live Region (Issue #10)

**Decision**: Add `aria-live="polite"` and `role="status"` to `#results`; add `role="alert"` to `#error-banner`.

**Rationale**: Screen readers monitor ARIA live regions and announce content changes automatically. `polite` is appropriate for results (non-urgent, should not interrupt ongoing announcements). `alert` (which implies `aria-live="assertive"`) is appropriate for errors (time-sensitive information).

The `#results` div is currently `hidden` until results arrive. Live regions work correctly with `hidden` in modern browsers — the SR will announce when `hidden` is removed and content is added in the same tick.

---

## Finding 11: Cancel Clears API Key Input (Issue #11)

**Decision**: Add `apiKeyInput.value = ''` to the `cancelBtn` click handler.

**Rationale**: When the user opens Settings and types a partial key, then cancels, the partial value persists in the input DOM element. On the next Settings open, the field shows the partial entry — confusing and potentially dangerous if the user assumes the saved key is pre-populated. The fix is a single line. The saved key (in `chrome.storage.local`) is not affected.
