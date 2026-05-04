# Lingua Word Breakdown

A Chrome Extension that translates text and produces a word-level linguistic breakdown for language learning.

## Load the Extension

1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select this directory (`extension/`)
4. The Lingua icon appears in the Chrome toolbar

## Configure Your API Key

1. Click the Lingua icon to open the popup
2. Click the **⚙ Settings** icon
3. Paste your Anthropic API key and click **Save**

Your key is stored locally via `chrome.storage.local` and is never sent anywhere except `api.anthropic.com`.

## Usage

1. Open the popup
2. Paste or type any text (any language, up to 2000 characters)
3. Click **Analyze** or press Enter
4. The popup shows:
   - **Translation** — natural English rendering of the sentence
   - **Token cards** — one card per word: surface form, lemma, POS badge, English gloss

## Running Unit Tests

```sh
npm install
npm test
```

Requires Node.js 18+ (uses `--experimental-vm-modules` for ESM support).

## Project Layout

```
extension/
├── manifest.json          # MV3 manifest
├── popup/
│   ├── popup.html         # Popup markup (two-view: main + settings)
│   ├── popup.js           # UI logic, event handling, rendering
│   └── popup.css          # Styles
├── lib/
│   └── analyzer.js        # Claude API client, response validation
├── background/
│   └── service-worker.js  # MV3 placeholder (no logic)
├── icons/                 # Extension icons
└── tests/                 # Jest unit tests for analyzer.js
```

See [quickstart.md](specs/001-lingua-word-breakdown/quickstart.md) for more setup details.
