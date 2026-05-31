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
- Response body exceeding `MAX_RESPONSE_BYTES` throws `ValidationError` before `JSON.parse` (T004b — FR-008)
- Response body within limit resolves to a parsed result (T004b — FR-008)
- `analyzeText` validates input exactly once per call (FR-004)
- `executeScript` `args` array never contains a key-shaped string (T008 — FR-001)

---

## Testing Settings Cancel

1. Open the Lingua popup and click the **Settings** gear icon
2. Type any partial text into the API key input field
3. Click **Cancel** (do not click Save)
4. Click the **Settings** gear icon again
5. **Expected**: The API key input field is empty

Bonus check: save a valid key first, then repeat steps 1–5. The field should still be empty on reopen (the saved key is in storage, not pre-populated).

---

## FR Verification Matrix (SC-007)

All 12 functional requirements must have a passing verification before the feature is marked complete. Use this table to sign off each one.

| FR | Short Description | Method | Where to Verify |
|----|-------------------|--------|-----------------|
| FR-001 | API key absent from `executeScript` args | Unit test | `npm test` — T008 assertion in `analyzer.test.js` confirms no call's `args` array contains a key-shaped string |
| FR-002 | Dismissed overlay does not reappear | Manual | "Testing the Overlay Race Condition" — dismiss-during-load steps (steps 4–5) |
| FR-003 | Double-trigger produces single overlay | Manual | "Testing the Overlay Race Condition" — double-trigger steps |
| FR-004 | `validateInput` called exactly once per submission | Unit test | `npm test` — `analyzer.test.js` single-call assertion (see "Running Unit Tests") |
| FR-005 | Token card renderer canonical in `lib/renderer.js`; popup imports it | Code inspection | `grep -n "buildTokenCard\|buildMorphemeCard" popup/popup.js lib/renderer.js` — both files must show hits; service-worker.js keeps its own copy |
| FR-006 | Results container cleared via `replaceChildren()` | Code inspection | `grep -n "replaceChildren" popup/popup.js` — must return exactly one match |
| FR-007 | Rate-limit cooldown starts at submission | Manual | "Testing the Rate Limit Fix" |
| FR-008 | Response size check before `JSON.parse` (no re-serialization) | Unit test | `npm test` — T004b assertions in `analyzer.test.js`: over-limit body throws `ValidationError`; within-limit body resolves |
| FR-009 | System prompt framing-only; no duplicate rules | Code inspection | Compare `SYSTEM_PROMPT` string in `lib/analyzer.js` with `contracts/ai-prompt-contract.md` v3.1; all per-field rules must appear only in the tool schema descriptions |
| FR-010 | API key cached in memory after first read | Code inspection | `grep -n "cachedApiKey" popup/popup.js background/service-worker.js` — `let cachedApiKey = null` must be present at module scope in both files |
| FR-011 | Results region announces to screen readers | Manual | "Testing Screen Reader Accessibility"; also `grep -n "aria-live" popup/popup.html` must show `aria-live="polite"` on `#results` and `role="alert"` on `#error-banner` |
| FR-012 | Cancel clears API key input | Manual | "Testing Settings Cancel" (this document) |

---

## Key Implementation Notes

- The `linguaRenderOverlay` function in `service-worker.js` must remain self-contained — it cannot import from `lib/renderer.js` due to MV3 injection constraints. If you update `buildTokenCard` logic in `lib/renderer.js`, apply the same change in `linguaRenderOverlay`.
- The `tabId` field is now part of the overlay payload. When injecting the result or error, always include `tabId` so the close button can send the dismiss message.
- The system prompt in `lib/analyzer.js` is updated to v3.1 (see `contracts/ai-prompt-contract.md`). The tool schema is unchanged.
