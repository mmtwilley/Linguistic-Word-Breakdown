# What I Learned: Linguistic Word Breakdown

**Feature**: Chrome extension that translates text and produces a word-level linguistic breakdown for language learning
**Generated**: 2026-05-03
**Scope**: Full feature
**Implementation status**: 43/51 tasks completed (7 manual browser tests + 1 npm test pending)

---

## Key Decisions

### 1. Direct `fetch()` from the Popup Instead of Routing Through the Service Worker

**What we did**: `popup.js` calls the Claude API directly via `fetch()`. The service worker (`background/service-worker.js`) is an empty placeholder required by MV3.

**Why**: The popup is alive for the entire user interaction, so there's no lifecycle concern. The popup already has access to `fetch()` and `chrome.storage.local`. Routing through the service worker would add `chrome.runtime.sendMessage` / `onMessage` boilerplate with zero benefit — it's a common MV3 mistake to reach for the service worker out of habit from MV2.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Service worker proxy | Adds message-passing boilerplate; useful only if you need background tasks or requests that survive popup close |
| Content script | Requires page permissions and injects into the visited site — completely out of scope |

**When you'd choose differently**: If you needed background sync, offline caching, or the request to continue after the popup closes (e.g., a long-running export), route through the service worker.

---

### 2. Typed Error Class Hierarchy Instead of Error Codes or Strings

**What we did**: Five custom classes — `TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError` — each extending `Error`, defined in `lib/analyzer.js` and checked with `instanceof` in `popup.js`.

**Why**: The UI needs to respond differently to each failure mode — 401 shows a Settings link, 429 shows a wait message, network errors show Retry. If errors were raw strings or numeric codes, `popup.js` would need brittle string matching. `instanceof` dispatch is readable, refactor-safe, and works across module boundaries without sharing a constants file.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Single `Error` with a `type: string` field | Works, but requires trusting undocumented string values; no IDE autocomplete |
| HTTP status codes directly | Mixes transport-level detail into UI logic; doesn't cover non-HTTP errors like `JsonError` |

**When you'd choose differently**: For a tiny one-file script with two error states, typed classes are overkill. Once you have 3+ distinct error categories with different user responses, they pay for themselves.

---

### 3. System Prompt as the API Contract for Structured JSON

**What we did**: The Claude system prompt (defined as a constant in `lib/analyzer.js`, versioned in `contracts/ai-prompt-contract.md`) instructs the model to return *only* a JSON object matching a specific schema — no prose, no markdown, no extra text.

**Why**: Claude reliably follows strict schema constraints when they're embedded in the system prompt and the user message is purely the input text. This eliminates the need for regex extraction or post-processing fallbacks. The prompt IS the contract — any change to the expected output shape must be reflected there first.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Claude tool use / structured outputs | More robust for production but adds SDK complexity; `fetch()` + system prompt is sufficient here |
| Parse natural-language response | Brittle, model-version-sensitive, and hard to validate |

**When you'd choose differently**: For a commercial or high-volume product, use Claude's structured outputs or tool use — they provide schema enforcement at the API level rather than relying on prompt discipline.

---

### 4. Client-Side API Key Storage (BYOAK Pattern)

**What we did**: Users enter their own Anthropic API key, which is stored in `chrome.storage.local` and read on each request. No backend, no shared key.

**Why**: This is the standard pattern for "bring your own API key" tools. `chrome.storage.local` is scoped to the extension origin — web pages and other extensions can't read it. No backend means no server to build, host, or secure. The trade-off is explicit: the key lives in the browser, as secure as the user's OS account.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Backend proxy with a shared key | Eliminates client-side key exposure but requires infra, auth, and rate limiting per user |
| `localStorage` | Not available in MV3 service workers; not the right API for extension storage |
| `chrome.storage.session` | Clears on browser close — terrible UX for an API key |

**When you'd choose differently**: Any multi-user product, or one where you control the key for users, should use a backend proxy. Exposing a shared key in client-side code is not acceptable.

---

### 5. `AbortController` for the 10-Second Timeout

**What we did**: In `analyzeText()`, an `AbortController` is created before the `fetch()` call. A `setTimeout` fires `controller.abort()` after 10 seconds. The `signal` is passed to `fetch()`.

**Why**: `AbortController` actually cancels the underlying network request, freeing the connection and memory. The alternative — `Promise.race` with a timeout promise — lets the winner resolve but leaves the `fetch()` promise hanging in the background, consuming the connection slot until the server responds.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `Promise.race([fetch(...), timeout(10000)])` | Doesn't cancel the fetch; the request continues running and wastes resources |
| `XMLHttpRequest` with `.timeout` | Supports timeout natively but is verbose and callback-based |

**When you'd choose differently**: You'd always prefer `AbortController` for cancellable fetches. The only exception is targeting environments without `AbortController` support — not a concern for Chrome 120+.

---

### 6. Two-View Layout Toggled with the `hidden` Attribute (No Router)

**What we did**: Main view and Settings view are both present in `popup.html`'s DOM from the start. `popup.js` toggles their `hidden` attribute to switch between them.

**Why**: Two views with no history, no deep linking, and no URL. A DOM toggle is one line per view and zero dependencies. A router would add a library, URL parsing, and a state machine for a problem that's just "show A or show B."

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Hash router | Meaningful for 3+ views with back-button support; overkill for two |
| Dynamically create/destroy views | More memory-efficient but adds re-render logic and flicker |

**When you'd choose differently**: Three or more views, especially if users expect browser back-button navigation, warrant a minimal router.

---

### 7. `textContent` for All User-Controlled Output (Never `innerHTML`)

**What we did**: Every token field and the translation string is inserted via `element.textContent = value`. No string concatenation into HTML. No `innerHTML`. See `renderResults()` in `popup/popup.js`.

**Why**: `textContent` tells the browser: "this is text, not markup." A token `word` field containing `<img src=x onerror=alert(1)>` gets rendered as the literal string, not executed. `innerHTML` would interpret it as HTML. Even with a sanitization library, using `innerHTML` for data that will always be plain text adds complexity for zero benefit.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `innerHTML` with DOMPurify | Unnecessary complexity; tokens are plain strings, not rich HTML |
| Template literals + `innerHTML` | Classic XSS vector — never use for untrusted content |

**When you'd choose differently**: If you genuinely need to render trusted HTML (e.g., a markdown renderer you control), `innerHTML` with DOMPurify is acceptable. For user-echoed data, always `textContent`.

---

## Concepts to Know

### ES Modules in a Chrome Extension (No Bundler)

**What it is**: Native JavaScript modules using `import`/`export`, loaded by declaring `<script type="module" src="popup.js">` in `popup.html`. The browser handles dependency resolution without webpack or esbuild.

**Where we used it**: `popup.html` loads `popup.js` as a module; `popup.js` imports `analyzeText`, error classes, and `validateInput` from `../lib/analyzer.js`.

**Why it matters**: You get code separation, named exports, and strict mode for free. Without modules, all code would have to live in one file or share globals. Many MV3 tutorials still show bundlers — you don't need one unless you have npm dependencies in your source.

---

### The Typed Error Pattern

**What it is**: Custom classes that extend the built-in `Error`, giving each error a distinct type that can be checked with `instanceof`. Each class can carry extra fields (e.g., `ApiError` carries `.status`).

**Where we used it**: `lib/analyzer.js` defines all five error classes; `popup.js` dispatches on them in `handleError()`.

**Why it matters**: Without typed errors, the UI layer must interpret raw error messages or numeric codes — both are fragile. `instanceof` dispatch is explicit, testable, and survives refactoring. It's the same pattern used by Node.js, Axios, and most mature JS libraries.

---

### `AbortController` and Cancellable Fetch

**What it is**: `AbortController` is a Web API that lets you attach a cancellation signal to any async operation that supports it. `fetch()` accepts a `signal` option; calling `controller.abort()` cancels the request immediately.

**Where we used it**: `analyzeText()` in `lib/analyzer.js` — signal attached to `fetch()`, `abort()` called after 10 seconds via `setTimeout`.

**Why it matters**: Without aborting, a timed-out request keeps the connection open, consuming the browser's limited connection pool and memory until the server responds or the tab closes.

---

### `chrome.storage.local` vs `localStorage`

**What it is**: `chrome.storage.local` is Chrome's async key-value store for extension data, accessible from both the popup and service worker contexts. `localStorage` is a synchronous browser API unavailable in service worker contexts.

**Where we used it**: `popup.js` uses `chrome.storage.local.get('apiKey')` and `.set({ apiKey })` for API key persistence.

**Why it matters**: `localStorage` calls in a service worker throw a `ReferenceError`. Even in popup contexts where `localStorage` works, it's not the right tool — it's not scoped to the extension and behaves differently across browser contexts. Always use `chrome.storage.*` in extensions.

---

### Response Validation as a Security Boundary

**What it is**: Treating every field of the AI response as untrusted input — checking types, lengths, allowed values (POS vocabulary), and size limits before using any of it in the UI.

**Where we used it**: `validateResponse()` and the token-mapping loop in `lib/analyzer.js`; silently correcting invalid POS tags with `console.warn` rather than crashing.

**Why it matters**: The Claude API can return unexpected output (model drift, version changes, edge inputs). Validation catches these before they cause silent data corruption or break the UI. The silent POS correction is a deliberate choice: an invalid POS tag is a model limitation, not a user error — degrading gracefully is better than showing an error.

---

## Architecture Overview

The feature has two clear layers separated by a clean boundary. `lib/analyzer.js` owns all external communication and data validation — it knows nothing about the DOM. `popup/popup.js` owns all UI state and rendering — it calls `analyzeText()` and handles whatever comes back. This separation means the entire data layer can be unit-tested with mocked `fetch()` calls, without a browser.

The service worker is intentionally empty: MV3 requires it to exist, but all logic stays in the popup context where the user interaction lives.

```
popup.html  (entry point, loads as ES module)
  └── popup.js  (UI state: views, events, rendering)
        ├── lib/analyzer.js  (fetch, parse, validate, classify errors)
        │     └── https://api.anthropic.com/v1/messages
        └── chrome.storage.local  (API key, read on each submit)

background/service-worker.js  (empty MV3 placeholder)
```

---

## Glossary

| Term | Meaning |
|------|---------|
| Manifest V3 (MV3) | Chrome's current extension format; replaces persistent background pages with event-driven service workers |
| Service worker | Background script registered in `manifest.json`; required by MV3 even if empty; runs in a separate thread from the popup |
| `host_permissions` | Manifest field that grants the extension permission to `fetch()` a specific external origin |
| BYOAK | "Bring Your Own API Key" — user supplies and stores their own credentials; the app has no shared key |
| Lemma | The base dictionary form of a word (e.g., "running" → "run", "languages" → "language") |
| POS | Part of speech — grammatical category of a word (noun, verb, adj, etc.) |
| `AbortController` | Web API for cancelling in-flight async operations like `fetch()` |
