# Quickstart: Code Review Fixes

**Branch**: `002-fix-review-issues` | **Date**: 2026-05-30

This document covers development notes specific to the fixes in this branch. For general extension setup, see [001 quickstart](../001-lingua-word-breakdown/quickstart.md).

---

## Files Changed in This Branch

| File | Change |
|------|--------|
| `popup/popup.html` | `aria-live="polite"` + `role="status"` on `#results`; `role="alert"` on `#error-banner` |
| `popup/popup.js` | Rate limit timing; `replaceChildren()`; cancel clears input; API key cache; import renderer; remove redundant `validateInput` call |
| `lib/analyzer.js` | Size check via `response.text()`; simplified system prompt |
| `lib/renderer.js` | NEW — exports `buildTokenCard` and `buildMorphemeCard` |
| `background/service-worker.js` | `pendingTabs` guard; `dismissedTabs` + message listener; `tabId` in payload; API key comment |
| `tests/analyzer.test.js` | New tests for size check and validateInput behavior |

---

## Testing the Overlay Race Condition

1. Load the unpacked extension at `chrome://extensions`
2. Open any webpage with text (e.g., Wikipedia)
3. Select a sentence and right-click → **Lingua: Analyze "…"**
4. Immediately click the **✕** close button on the loading spinner
5. **Expected**: Panel disappears and does NOT reappear when the response arrives

For the double-trigger guard:
1. Select text and right-click → Lingua: Analyze
2. Before the spinner appears, right-click and trigger again on the same tab
3. **Expected**: Only one overlay appears; no duplicate panels

---

## Testing the Rate Limit Fix

1. Open the Lingua popup
2. Type any text and click **Analyze**
3. While loading, click **Retry** (if you can — it's hidden until an error/result)
   - Alternatively: cause a fast error (e.g., no API key) and immediately click Retry
4. **Expected**: Second submission within 1 second is blocked with "Please wait a moment"

---

## Testing Screen Reader Accessibility

1. Enable a screen reader (Windows: Narrator or NVDA; macOS: VoiceOver)
2. Open the Lingua popup and submit text for analysis
3. **Expected**: Screen reader announces the results region when results appear without you navigating to it

---

## Running Unit Tests

```sh
npm test
```

New test cases in `tests/analyzer.test.js` cover:
- Response size check triggers correctly on oversized text
- `analyzeText` validates input exactly once per call

---

## Key Implementation Notes

- The `linguaRenderOverlay` function in `service-worker.js` must remain self-contained — it cannot import from `lib/renderer.js` due to MV3 injection constraints. If you update `buildTokenCard` logic in `lib/renderer.js`, apply the same change in `linguaRenderOverlay`.
- The `tabId` field is now part of the overlay payload. When injecting the result or error, always include `tabId` so the close button can send the dismiss message.
- The system prompt in `lib/analyzer.js` is updated to v3.1 (see `contracts/ai-prompt-contract.md`). The tool schema is unchanged.
