# Testing: Lingua Word Breakdown

## Unit Tests (automated)

```sh
npm install && npm test
```

Tests cover `lib/analyzer.js`: input validation, response validation, HTTP error classification, and network/timeout error handling.

---

## Manual Test Cases

### User Story 1 — Translate and Analyze Foreign Text

Load the extension (`chrome://extensions` → Load unpacked) and configure a valid API key.

| # | Action | Expected |
|---|--------|----------|
| 1 | Paste "Ich liebe Sprachen", click Analyze | Translation + 3 token cards (pron/verb/noun) |
| 2 | Paste a 30-word sentence in any language | All tokens shown in input order |
| 3 | Open Settings, paste API key, Save | Popup returns to main view; key persists on reopen |
| 4 | Delete API key in Settings, reopen popup | Settings view shown automatically |

### User Story 2 — Analyze English Text

| # | Action | Expected |
|---|--------|----------|
| 5 | Type "The quick brown fox jumps", Analyze | Tokens: det/adj/adj/noun/verb |
| 6 | Type "Don't you know?", Analyze | Tokens produced; no crash |

### User Story 3 — Single Word Input

| # | Action | Expected |
|---|--------|----------|
| 7 | Type "casa", Analyze | 1 token card returned |
| 8 | Type "日本", Analyze | 1–2 tokens, no crash |

---

## Error Path Checklist (10 scenarios)

| # | How to trigger | Expected message |
|---|----------------|-----------------|
| 1 | Submit empty input | "Please enter text to analyze." |
| 2 | Submit whitespace only | "Please enter text to analyze." |
| 3 | Paste 2001+ characters | Char counter turns red; submit rejects |
| 4 | No API key configured | Settings view shown on open |
| 5 | Disable WiFi, Analyze | "Network error. Check your internet connection..." + Retry |
| 6 | Use invalid API key (e.g. "dummy12345678901234") | "Invalid or expired API key. Check your settings." + Open Settings |
| 7 | (Mock 429 in DevTools) Analyze | "You've made too many requests..." — no Retry button |
| 8 | (Mock 503 in DevTools) Analyze | "Claude API is temporarily unavailable..." + Retry |
| 9 | (Mock response `"invalid json"`) Analyze | "Unexpected response format. Please retry." + Retry |
| 10| (Mock `{"translation":"hi"}`) Analyze | "No analysis returned. Please retry." + Retry |

---

## Security Audit Checklist

- [ ] No `innerHTML` used for user content (grep: `innerHTML` in popup.js → none)
- [ ] No inline JS in HTML (grep: `onclick`, `oninput` in popup.html → none)
- [ ] API key never logged (grep: `apiKey` in console calls → none)
- [ ] All fetch calls use HTTPS (grep: `http://` → none)
- [ ] No `eval()` or `Function()` (grep: `eval` → none)
