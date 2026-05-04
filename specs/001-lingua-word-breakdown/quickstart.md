# Quickstart: Linguistic Word Breakdown Extension

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-03

---

## Prerequisites

- Google Chrome 120+ (or any Chromium-based browser supporting MV3)
- An Anthropic API key with access to the Claude API

---

## Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `extension/` directory (the folder containing `manifest.json`)
5. The extension icon appears in the Chrome toolbar

---

## Configure Your API Key

1. Click the extension icon to open the popup
2. Click the **Settings** (gear) icon
3. Paste your Anthropic API key into the input field
4. Click **Save** — the key is stored locally in your browser

---

## Analyze Text

1. Click the extension icon
2. Type or paste any foreign-language text into the input area
3. Click **Analyze** (or press Enter)
4. The popup displays:
   - **Translation**: the full English meaning of the sentence
   - **Tokens**: one card per word showing the surface form, lemma, POS tag, and English gloss

---

## File Layout (Source)

```
extension/
├── manifest.json              # MV3 manifest — declares permissions and entry points
├── popup/
│   ├── popup.html             # Extension popup markup
│   ├── popup.js               # UI logic: input handling, API call, rendering
│   └── popup.css              # Popup styles
├── lib/
│   └── analyzer.js            # Calls Claude API, parses and validates JSON response
├── background/
│   └── service-worker.js      # Minimal MV3 service worker (required by manifest)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Key Permissions (manifest.json)

| Permission           | Why needed                                    |
|----------------------|-----------------------------------------------|
| `storage`            | Persist user API key via `chrome.storage.local` |
| `host_permissions`   | `https://api.anthropic.com/*` — allow fetch to Claude API |

---

## Development Notes

- All API calls are made from `popup.js` directly via `fetch()` — no service worker routing.
- The Claude system prompt is defined in `lib/analyzer.js` and documented in `contracts/ai-prompt-contract.md`.
- To change the Claude model, update the `model` constant in `lib/analyzer.js`.
- After any source file change, reload the extension at `chrome://extensions` → click the reload icon.
