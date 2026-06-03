# Quickstart: Bulk Text Translation

**Feature**: 007-bulk-text-translation | **Date**: 2026-06-01

---

## Prerequisites

- Chrome / Chromium (any version supporting MV3 + CompressionStream)
- Extension loaded as an unpacked extension from the `extension/` directory
- Valid Anthropic API key saved in extension settings

---

## Loading the Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory
4. Extension icon appears in the toolbar

---

## Testing Bulk Translation

### Happy Path — Small Post (~500 words)

1. Open the extension popup
2. Click **Bulk Translate** tab (or equivalent UI trigger)
3. Paste a forum post of ~500 words in a foreign language
4. Click **Translate**
5. **Expected**: First chunk result appears within 5 seconds. Progress indicator updates ("1 of 4 translated"). All chunks complete within ~30 seconds.

### Happy Path — Large Post (~5 000 words)

1. Paste a ~5 000-word forum post
2. Click **Translate**
3. **Expected**: Progressive results appear chunk by chunk. Total completes within ~60 seconds. No truncation.

### Cache Hit Test

1. Translate any post once to completion
2. Translate the same post again immediately
3. **Expected**: Results appear nearly instantly; no API calls fired (all chunks served from `lingua_history_v1` match on full-post entry, or individual chunks if previously cached separately).

### Cancel Mid-Queue

1. Paste a large post and click **Translate**
2. After 2-3 chunks appear, click **Cancel**
3. **Expected**: Queue stops immediately. No further results appear. No additional API calls made.

### Replace-on-Submit

1. Start translating a long post
2. While the queue is running, paste a different post and click **Translate**
3. **Expected**: Previous queue cancelled; new queue starts immediately. Only the new post's output appears.

### Over-Length Input

1. Paste text exceeding 30 000 characters
2. Click **Translate**
3. **Expected**: Error message displayed immediately: "Text is too long for bulk translation. Maximum is approximately 5 000 words."

### Rate Limit Simulation (DevTools)

1. Open DevTools → Network tab
2. Set network throttling to simulate slow responses
3. Submit a large post
4. Interrupt a request to simulate a 429 (or use a mock service worker)
5. **Expected**: Retry with delay visible in Network tab (1 s → 2 s → 4 s gaps). Queue resumes after retry succeeds. If 3 retries all fail, that chunk is skipped and marked failed; queue continues.

---

## Verifying Cache Pre-Warm

1. Open DevTools → Network tab before opening the popup
2. Open the extension popup
3. **Expected**: A `POST` to `api.anthropic.com/v1/messages` fires within 1-2 seconds of popup open with `max_tokens: 1` in the request body. Response is fast (one token generated to satisfy the API minimum; cache write still occurs).

---

## Verifying Constitution Compliance

```bash
# Principle I: no innerHTML on user content in new files
grep -n innerHTML lib/bulk-translator.js popup/popup.js

# Principle I: no onclick attributes
grep -n onclick popup/popup.html

# Principle II: no require/import of external packages
grep -n "require\|from '" lib/bulk-translator.js lib/rate-limiter.js

# Principle IV: no empty catch blocks
grep -A2 "catch" lib/bulk-translator.js lib/rate-limiter.js

# Principle V: CHUNK_TIMEOUT_MS documented in plan
grep -n "CHUNK_TIMEOUT_MS" lib/analyzer.js
```

---

## Verifying Contract Alignment (Gate 3)

- `specs/007-bulk-text-translation/contracts/ai-prompt-contract.md` (v3.5) must match the `text_translation` tool definition in `lib/analyzer.js` — schema fields, system prompt text, caching headers.
- Pre-warm request structure in `lib/bulk-translator.js` must match the v3.5 contract Addition 1.
