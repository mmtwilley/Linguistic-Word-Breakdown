# Lingua Word Breakdown

A Chrome Extension that translates text and produces a word-level linguistic breakdown for language learning. Works via the popup or by right-clicking selected text on any webpage.

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

### Popup

1. Click the Lingua icon in the toolbar
2. Paste or type any text (any language, up to 2000 characters)
3. Click **Analyze** or press Enter
4. Results appear below:
   - **Translation** — natural English rendering of the sentence
   - **Token cards** — one card per word: surface form, romanization, IPA pronunciation, lemma, POS badge, English gloss
   - **Morpheme cards** (Korean) — separate dashed cards for attached particles and verb/adjective endings

### Right-Click Context Menu

1. Select any text on a webpage
2. Right-click → **Lingua: Analyze "…"**
3. A floating panel appears in the top-right corner of the page with the same translation and token breakdown
4. Click **✕** to dismiss the panel

## Word Card Fields

| Field | Description |
|---|---|
| Surface form | Exact word as it appears in the input |
| Romanization | Revised Romanization (Korean), Pinyin (Chinese), Hepburn (Japanese) |
| Pronunciation | IPA transcription |
| Lemma | Base/dictionary form |
| POS badge | Part-of-speech: noun, verb, adj, adv, pron, prep, conj, det, num, punct, other |
| Gloss | Short English meaning (5 words max) |

### Korean Morpheme Cards

Korean nouns/pronouns with attached case particles and Korean verbs/adjectives with grammatical endings each get their own dashed card beneath the parent word card.

**Particle types:** topic (은/는), subject (이/가), object (을/를), sentence-end, other-particle

**Ending types:** connective (-고/-아서 etc.), attributive (-는/-은 etc.), nominal (-기/-음), concessive (-든지 etc.), sentence-final (-다/-요 etc.), other-ending

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
│   ├── popup.html         # Popup markup (main view + settings view)
│   ├── popup.js           # UI logic, event handling, rendering
│   └── popup.css          # Styles
├── lib/
│   ├── analyzer.js        # Claude API client, response validation
│   └── errors/
│       └── index.js       # Typed error classes (ApiError, TimeoutError, etc.)
├── background/
│   └── service-worker.js  # Context menu registration + page overlay injection
├── icons/                 # Extension icons
└── tests/                 # Jest unit tests for analyzer.js
```

See [quickstart.md](specs/001-lingua-word-breakdown/quickstart.md) for more setup details.
