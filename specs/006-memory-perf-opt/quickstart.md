# Developer Quickstart: Streaming & History Memory Optimization

**Feature**: 006-memory-perf-opt | **Date**: 2026-05-31

---

## Prerequisites

- Chrome browser with the extension loaded as an unpacked extension (Developer Mode)
- Claude API key configured in the extension settings
- DevTools open to the extension popup (`right-click popup → Inspect`)

---

## Key Files

| File | Role |
|------|------|
| `lib/history.js` | NEW — unified store: read, write, compress, expand, evict |
| `lib/analyzer.js` | MODIFIED — streaming consumer; was batch fetch |
| `lib/errors/index.js` | MODIFIED — new `StorageError` class |
| `lib/renderer.js` | MODIFIED — new `renderTranslation()` export |
| `popup/popup.js` | MODIFIED — cache-first dispatch, history tab, stream abort |
| `popup/popup.html` | MODIFIED — history tab panel, load-more button |

---

## Testing the Streaming Path (SC-001)

1. Open the extension popup and open DevTools → Network tab
2. Submit a non-Latin text (e.g., any Korean or Japanese sentence)
3. In Network, find the `messages` request to `api.anthropic.com` — it will show as `EventStream` type
4. The translation text should appear in the popup **before** the word tokens finish rendering
5. Timing: In DevTools Console, the implementation logs `[Lingua] translation emitted: <ms>ms` from stream start

**Expected**: Translation visible within ~300–700ms; tokens complete within 2–4s.

---

## Inspecting the Unified Store (SC-003, SC-005)

1. Open DevTools → Application tab → Storage → Local Storage → `chrome-extension://...`
2. Find key `lingua_history_v1`
3. The value is a JSON array of `AnalysisEntry` objects
4. Each `tokens` array contains `CompactToken` tuples (8-element arrays)

To measure current storage usage in the DevTools Console:
```js
chrome.storage.local.getBytesInUse('lingua_history_v1', bytes => console.log(bytes, 'bytes'));
```

---

## Testing the Cache Path (SC-002)

1. Submit a text and wait for full analysis to complete
2. Submit the **exact same text** again (or the same text with extra whitespace)
3. The second submission should complete in <200ms with no new network request visible in DevTools Network
4. In the Console: `[Lingua] cache hit: <ms>ms`

---

## Testing the History Tab (SC-004)

1. Analyze 11+ different texts (to get past the first page)
2. Click the History tab in the popup
3. The first 10 entries should render immediately (<300ms)
4. Scroll to the bottom or click "Load more" — next 10 entries should append
5. Click any history entry — the full analysis result should restore immediately with no network request

---

## Testing Stream Abort (FR-014)

1. Submit a long text (20+ words) for analysis
2. While the analysis is in progress (translation has appeared but tokens are loading), close the popup
3. Reopen DevTools → Network tab
4. Confirm no further `messages` request activity after popup closed
5. Confirm no console errors about `renderResults on undefined` or detached DOM

---

## Testing Storage Eviction (FR-004, FR-005)

To test the 75-entry cap:
```js
// Run in DevTools console while popup is open
// (only works if history.js exposes these for testing)
chrome.storage.local.get('lingua_history_v1', d => console.log(d.lingua_history_v1?.length));
```

To simulate quota pressure, add many large entries and verify the aggressive trim fires before the write fails.

---

## Testing Version Skip (Version Migration Behavior)

1. In DevTools console, manually inject an entry with `version: 99`:
```js
chrome.storage.local.get('lingua_history_v1', data => {
  const h = data.lingua_history_v1 || [];
  h.unshift({ id: 'test', version: 99, ts: Date.now(), lang: 'kor',
               input: 'test', snippet: 'test', translation: 'test', tokens: [] });
  chrome.storage.local.set({ lingua_history_v1: h });
});
```
2. Open the history tab — the injected entry should NOT appear in the list
3. The real entries should render normally
4. The version-99 entry should still be present in storage (retained until eviction)

---

## Testing Large Text Translation (US4)

1. Paste any text longer than 2 000 characters into the input field
2. Submit — the extension should call `translateOnly()` (batch, no streaming)
3. In DevTools → Network tab: the `messages` request should **not** be an `EventStream`; it should be a normal JSON response
4. The translation banner appears; **no word-token cards** are rendered below it
5. In DevTools console: `[Lingua] large-text translation: <ms>ms`

**Expected**: Translation visible within ~1–2 s; word-cards panel hidden; entry saved to history with `translationOnly: true`.

To verify the `translationOnly` flag in storage:
```js
chrome.storage.local.get('lingua_history_v1', d =>
  console.log(d.lingua_history_v1?.[0]?.translationOnly));
// → true
```

To test the 10 000-char hard ceiling:
- Paste text exceeding 10 000 characters
- Submit — should see validation error immediately before any API call

To verify cache works for large text:
1. Submit a >2 000-char text, wait for translation
2. Submit the same text again — second result should appear in <200 ms with no new network request

---

## Error Scenarios

| Scenario | Expected behavior |
|----------|-------------------|
| Stream byte cap exceeded | Error message shown; translation cleared if already displayed |
| Connection drop mid-stream | Error message shown; translation cleared |
| Storage write fails | Analysis result displayed normally; error logged to console only |
| Cache entry malformed | Falls through to fresh analysis; no error shown |
| Input > 10 000 chars | Validation error shown immediately; no API call made |
| Large-text API call fails | Typed error (`ApiError`/`NetworkError`) surfaces user-facing message within 1 s |
