# What I Learned: Linguistic Word Breakdown

**Feature**: Chrome extension that translates text and produces a word-level linguistic breakdown for language learning
**Generated**: 2026-05-06 | **Last updated**: 2026-05-29
**Scope**: Full feature
**Implementation status**: 44/47 tasks completed — all core flows complete; T032 (error paths manual test), T038 (npm test run), T040 (final commit) remain

---

## Key Decisions

### 1. Direct `fetch()` from the Popup Instead of Routing Through the Service Worker

**What we did**: `popup.js` calls the Claude API directly via `fetch()`. The service worker (`background/service-worker.js`) handles only the context menu events; the popup has its own independent API client path.

**Why**: The popup is alive for the entire user interaction, so there's no lifecycle concern. The popup already has access to `fetch()` and `chrome.storage.local`. Routing through the service worker would add `chrome.runtime.sendMessage` / `onMessage` boilerplate with zero benefit — it's a common MV3 mistake to reach for the service worker out of habit from MV2.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Service worker proxy | Adds message-passing boilerplate; useful only if you need background tasks or requests that survive popup close |
| Content script | Requires page permissions and injects into the visited site — completely out of scope |

**When you'd choose differently**: If you needed background sync, offline caching, or the request to continue after the popup closes (e.g., a long-running export), route through the service worker.

---

### 2. Typed Error Class Hierarchy Instead of Error Codes or Strings

**What we did**: Five custom classes — `TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError` — each extending `Error`, defined in `lib/errors/index.js` and re-exported from `lib/analyzer.js`. The UI checks them with `instanceof` in `popup.js handleError()`.

**Why**: The UI needs to respond differently to each failure mode — 401 shows a Settings link, 429 shows a wait message, network errors show Retry. If errors were raw strings or numeric codes, `popup.js` would need brittle string matching. `instanceof` dispatch is readable, refactor-safe, and works across module boundaries without sharing a constants file.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Single `Error` with a `type: string` field | Works, but requires trusting undocumented string values; no IDE autocomplete |
| HTTP status codes directly | Mixes transport-level detail into UI logic; doesn't cover non-HTTP errors like `JsonError` |

**When you'd choose differently**: For a tiny one-file script with two error states, typed classes are overkill. Once you have 3+ distinct error categories with different user responses, they pay for themselves.

---

### 3. Claude Tool Use (Function Calling) for Guaranteed Structured Output

**What we did**: The API call in `lib/analyzer.js` uses Claude's tool use mechanism — `ANALYSIS_TOOL` declares a formal `input_schema`, and `tool_choice: { type: 'tool', name: 'linguistic_analysis' }` forces Claude to always invoke the tool. The result is extracted from `content.find(b => b.type === 'tool_use').input` — never from `content[0].text`.

**Why**: Tool use (function calling) moves the schema contract from the system prompt into the API request itself. Claude is guaranteed to return structured data matching the declared schema rather than freeform text that merely *looks* like JSON. The Constitution (Principle III) explicitly prohibits `JSON.parse(content[0].text)` — if the model drifts, adds prose, or wraps the JSON in markdown fences, a prompt-only approach silently fails. Tool use fails loudly and predictably.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| System prompt instructs "return only JSON" | Brittle — model can add explanation text or wrap in markdown; format changes across model versions |
| `JSON.parse(content[0].text)` on raw output | Explicitly prohibited by Constitution Principle III; no schema enforcement |
| External JSON schema validation library | No build step allowed (Constitution Principle II); validation written manually |

**When you'd choose differently**: For a throwaway script where schema drift doesn't matter, a strict system prompt is simpler. For any production feature where the output feeds structured UI, always use tool use — it's the difference between a type-checked interface and duck typing.

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

### 5. `AbortController` for the 30-Second Timeout

**What we did**: In `analyzeText()`, an `AbortController` is created before the `fetch()` call. A `setTimeout` fires `controller.abort()` after 30 seconds (`TIMEOUT_MS = 30000`). The `signal` is passed to `fetch()`.

**Why**: `AbortController` actually cancels the underlying network request, freeing the connection and memory. The alternative — `Promise.race` with a timeout promise — lets the winner resolve but leaves the `fetch()` promise hanging in the background, consuming the connection slot until the server responds. The timeout is 30 seconds (not the initially-planned 10s) because optional response fields — romanization, IPA pronunciation, and particle arrays for agglutinative languages — add substantial payload size, and Claude needs more time to construct them.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `Promise.race([fetch(...), timeout(30000)])` | Doesn't cancel the fetch; the request continues running and wastes resources |
| `XMLHttpRequest` with `.timeout` | Supports timeout natively but is verbose and callback-based |
| Shorter timeout (10s) | Insufficient for large responses with romanization + IPA + particle arrays |

**When you'd choose differently**: You'd always prefer `AbortController` for cancellable fetches. Adjust the timeout duration based on your p99 response time — for simple prompts with short outputs, 10–15s is appropriate; for structured outputs with optional enrichment fields, 30s is safer.

---

### 6. Prompt Caching on the System Message

**What we did**: The system message is sent as an array with `cache_control: { type: 'ephemeral' }` on the single text block. The `anthropic-beta: prompt-caching-2024-07-31` header opts in to the caching beta.

**Why**: The system prompt (which defines the full linguistic analysis schema, POS vocabulary, and per-language romanization rules) is identical on every request in a session — only the user's input text changes. Anthropic caches the tokenized system prompt for up to 5 minutes. On cache hits, Claude skips re-tokenizing the prompt, which reduces both latency and cost per call. For a user who analyzes multiple sentences in a session, every call after the first benefits from the cache.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| No caching | Pays full tokenization cost on every request; no latency benefit |
| Caching the user message | User messages change every call — caching them has no benefit |
| Server-side session caching | Would require a backend; out of scope |

**When you'd choose differently**: Skip prompt caching when the system prompt changes per request (e.g., personalized instructions that include user name or preferences). The cache key is the exact token sequence — any change invalidates it.

---

### 7. Two-View Layout Toggled with the `hidden` Attribute (No Router)

**What we did**: Main view and Settings view are both present in `popup.html`'s DOM from the start. `popup.js` toggles their `hidden` attribute to switch between them.

**Why**: Two views with no history, no deep linking, and no URL. A DOM toggle is one line per view and zero dependencies. A router would add a library, URL parsing, and a state machine for a problem that's just "show A or show B."

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Hash router | Meaningful for 3+ views with back-button support; overkill for two |
| Dynamically create/destroy views | More memory-efficient but adds re-render logic and flicker |

**When you'd choose differently**: Three or more views, especially if users expect browser back-button navigation, warrant a minimal router.

---

### 8. `textContent` for All User-Controlled Output (Never `innerHTML`)

**What we did**: Every token field and the translation string is inserted via `element.textContent = value`. No string concatenation into HTML. No `innerHTML`. See `renderResults()` in `popup/popup.js`.

**Why**: `textContent` tells the browser: "this is text, not markup." A token `word` field containing `<img src=x onerror=alert(1)>` gets rendered as the literal string, not executed. `innerHTML` would interpret it as HTML. Even with a sanitization library, using `innerHTML` for data that will always be plain text adds complexity for zero benefit.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `innerHTML` with DOMPurify | Unnecessary complexity; tokens are plain strings, not rich HTML |
| Template literals + `innerHTML` | Classic XSS vector — never use for untrusted content |

**When you'd choose differently**: If you genuinely need to render trusted HTML (e.g., a markdown renderer you control), `innerHTML` with DOMPurify is acceptable. For user-echoed data, always `textContent`.

---

### 9. Two-Tier Validation: Structural vs. Semantic

**What we did**: `validateResponse()` in `lib/analyzer.js` runs two distinct checks. First it checks structural validity — is `translation` present, is `tokens` an array? Then it checks semantic usefulness — is the tokens array non-empty? Each failure throws a `ValidationError` with a different message.

**Why**: A missing `tokens` field means the API returned something completely unexpected — a bug in the prompt or model. An empty `tokens` array means the model understood the schema but produced no analysis — a different failure. Conflating them into one message hides useful signal from the user.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Single "Incomplete response" catch-all | Simpler, but loses the distinction between "wrong shape" and "right shape, no content" |
| Let empty tokens render silently | Would display a valid-looking UI with no token cards — confusing and hard to debug |

**When you'd choose differently**: For an internal tool where users are developers, a single generic error is fine — the error type logged to console has enough detail. For end users with no visibility into error types, message specificity is worth the extra code path.

---

### 10. Input Character Limit Enforced in JS, Not HTML `maxlength`

**What we did**: The `<textarea>` in `popup.html` has no `maxlength` attribute. The 2000-character limit is enforced inside `validateInput()` in `lib/analyzer.js`, which throws a `ValidationError` that `popup.js` surfaces as a user-visible prompt.

**Why**: HTML `maxlength` silently truncates the user's input the moment they type past the limit — the user has no warning that their text was cut. JS-side validation lets us reject the full input with a specific message, keeping the user's original text intact so they can decide how to shorten it.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `maxlength="2000"` on the textarea | Simple but silently destroys user input; no error message shown |
| Both `maxlength` and JS validation | Belt-and-suspenders, but `maxlength` would still truncate before JS sees the full text |

**When you'd choose differently**: For very short limits (e.g., a 10-character username field), `maxlength` is fine — the intent is obvious to users. For longer inputs where the cutoff is non-obvious, JS-side validation gives a better experience.

---

### 11. Mocking AbortErrors with a Plain `Error` Instead of `DOMException`

**What we did**: In `tests/mocks/fetchMock.js`, `makeAbortError()` creates abort errors as `new Error('Aborted')` with `.name = 'AbortError'` set as an own property, rather than `new DOMException('Aborted', 'AbortError')`.

**Why**: Two compounding problems made `DOMException` the wrong choice. First, `DOMException` is only a global in Node.js 18+; Node 16 throws `ReferenceError` at construction. Second, wrapping in `Object.assign(new DOMException(...), { name: 'AbortError' })` throws a `TypeError` in strict mode — `name` on `DOMException` is a getter-only prototype property. Since `analyzer.js` only checks `err.name === 'AbortError'`, a plain `Error` with the right `.name` is correct and works everywhere.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `new DOMException('Aborted', 'AbortError')` | Not a global in Node 16; fragile across runtimes |
| `Object.assign(new DOMException(...), { name: 'AbortError' })` | Strict-mode `TypeError` — `name` is getter-only on the `DOMException` prototype |
| Polyfill `globalThis.DOMException` in Jest setup | Adds test infrastructure for a problem that doesn't need the real type |

**When you'd choose differently**: If the test needed to verify `err instanceof DOMException`, you'd need the real type and would polyfill it. Since `analyzer.js` only checks `.name`, the duck-typed `Error` is correct.

---

### 12. `connect-src` Must Be Explicit in a Chrome Extension CSP

**What we did**: Added `connect-src https://api.anthropic.com` to the `extension_pages` CSP in `manifest.json`. Without it, every `fetch()` to the Anthropic API returned `TypeError: Failed to fetch` — even though `host_permissions` already listed the same origin.

**Why**: `host_permissions` and CSP are two separate security layers in Chrome extensions. `host_permissions` controls what the extension is *allowed* to access from Chrome's perspective. The CSP `connect-src` controls what the popup *page* is allowed to fetch — it's enforced by the browser's content security policy engine, which doesn't consult `host_permissions`. `default-src 'self'` falls back to `connect-src 'self'`, silently blocking all cross-origin fetches.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Remove CSP entirely | Weakens security by allowing inline scripts and external resource loading |
| Rely on `host_permissions` alone | Doesn't satisfy `connect-src`; fetch still blocked at the CSP layer |

**When you'd choose differently**: If your extension proxies all API calls through a service worker (not the popup), you'd add `connect-src` to the service worker's CSP instead.

---

### 13. Reduce Friction for Required External Setup Steps

**What we did**: Added a "Get API key ↗" link directly in the Settings view that opens `console.anthropic.com/account/keys` in a new tab, placed inline next to the "Anthropic API Key" label.

**Why**: Every extra step between "installed extension" and "first successful use" is a dropout point. Putting the link at exactly the moment the user needs it — inside the settings input they're already filling out — eliminates the need to search for where to get the key.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Link in the README only | Not visible during actual use; users don't read READMEs |
| Show link only on 401 error | Useful as a secondary signal, but better to surface it before the first failure |

**When you'd choose differently**: If your extension auto-detects a key from the environment, the link is unnecessary. It's only valuable when setup is entirely manual.

---

### 14. Closed Shadow DOM for the Injected Overlay

**What we did**: The context menu result panel is rendered inside a Shadow DOM with `mode: 'closed'` attached to a zero-size host `div` appended to `document.documentElement`. All styles are inlined inside the shadow root.

**Why**: Two isolation problems need solving when injecting UI into arbitrary pages. First, the page's CSS can override your panel's styles. Shadow DOM creates a CSS boundary: page styles cannot penetrate it (and your styles don't leak out). Second, `mode: 'closed'` means `host.shadowRoot` returns `null` — no page script can reach in and read the overlay content or manipulate the close button.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Regular DOM injection | Page styles win; page JS can read overlay contents including any user data rendered |
| `<iframe>` overlay | Works but creates a separate browsing context, complicates sizing/positioning, and may trigger CSP on the host page |
| Shadow DOM `mode: 'open'` | Page JS can call `host.shadowRoot` and read rendered content — weaker isolation |

**When you'd choose differently**: If you need the page to be able to interact with your injected widget via JS (e.g., a developer tool that exposes an API), use `mode: 'open'`. For user-facing overlays where isolation is the goal, always prefer `mode: 'closed'`.

---

### 15. Self-Contained Function Passed to `chrome.scripting.executeScript`

**What we did**: `linguaRenderOverlay` in `background/service-worker.js` is defined as a top-level function that references only its `payload` parameter and native DOM APIs. It's passed to `chrome.scripting.executeScript` as `func: linguaRenderOverlay, args: [payload]`.

**Why**: `executeScript` with `func:` serializes the function using `.toString()` and re-evaluates it in the target page's context. This means the function is completely detached from the service worker's module scope at execution time — any outer-scope variable or import reference will throw `ReferenceError`. Data is passed in via `args`, which Chrome serializes as JSON.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Declarative content script in manifest | Loaded on every page matching the URL pattern — wastes resources when never used |
| `files: ['overlay.js']` in `executeScript` | On-demand, but the file can't receive dynamic data at injection time without a separate message pass |

**When you'd choose differently**: If the injected UI needs multiple functions, shared state, or more than ~100 lines, extract it to a dedicated content script file and use `chrome.tabs.sendMessage` to pass data after injection.

---

### 16. `activeTab` Permission Instead of Broad Host Permissions for Injection

**What we did**: The `"activeTab"` permission is used (rather than `"host_permissions": ["<all_urls>"]`) to authorize `chrome.scripting.executeScript` for the context menu feature.

**Why**: `activeTab` grants temporary access to the exact tab the user is currently interacting with — and only when they invoke the extension through a user gesture. The permission expires when the user switches tabs. Broad host permissions, by contrast, grant the extension permanent read/write access to every URL on install — Chrome Web Store reviews flag this, and users see a stronger permission warning.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| `host_permissions: ["<all_urls>"]` | Works but grants persistent access to all sites; triggers stronger install warning and CWS scrutiny |
| `host_permissions: ["https://*/*"]` | Same problem, just scoped to HTTPS |

**When you'd choose differently**: If you need to inject *without* a user gesture — for example, a content script that auto-highlights words on every page load — `activeTab` doesn't cover it. You'd need explicit `host_permissions` for those origins.

---

### 17. CSS `display` Properties Override the HTML `hidden` Attribute

**What we did**: Added `[hidden] { display: none !important; }` as a global rule at the top of `popup.css`.

**Why**: The browser's default stylesheet sets `[hidden] { display: none }`, but author stylesheets take higher precedence. Any class that explicitly sets `display` (e.g., `.loading-overlay { display: flex }`) silently wins over `[hidden]` — the element renders as if `hidden` isn't there. The `!important` restores expected behavior.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Use `.hidden` CSS class instead of `hidden` attribute | Works but is less semantic and requires manually keeping classes in sync |
| Per-element override (`.loading-overlay[hidden] { display: none }`) | Has to be repeated for every element with a `display` class — fragile |

**When you'd choose differently**: You'd skip the `!important` if you intentionally need to un-hide an element from JavaScript by removing a class while keeping the attribute — but that's a smell; just remove the `hidden` attribute directly.

---

## Concepts to Know

### ES Modules in a Chrome Extension (No Bundler)

**What it is**: Native JavaScript modules using `import`/`export`, loaded by declaring `<script type="module" src="popup.js">` in `popup.html`. The browser handles dependency resolution without webpack or esbuild.

**Where we used it**: `popup.html` loads `popup.js` as a module; `popup.js` imports `analyzeText`, error classes, and `validateInput` from `../lib/analyzer.js`. Both popup and service worker share `lib/errors/index.js`.

**Why it matters**: You get code separation, named exports, and strict mode for free. Without modules, all code would have to live in one file or share globals. Many MV3 tutorials still show bundlers — you don't need one unless you have npm dependencies in your source.

---

### LLM Tool Use / Function Calling

**What it is**: A mode where the model outputs structured data matching a declared JSON schema instead of free text. The caller declares the schema upfront; the API guarantees the response will conform to it. Claude always invokes the named tool when `tool_choice: { type: 'tool' }` is set.

**Where we used it**: `ANALYSIS_TOOL` in `lib/analyzer.js` — the tool schema defines every field (`translation`, `tokens[]`, required/optional), and the response is extracted from `content.find(b => b.type === 'tool_use').input` rather than parsed from text.

**Why it matters**: Without tool use, you're relying on prompt discipline — the model might add prose, wrap JSON in markdown, or change format between versions. Tool use makes the output format a hard contract enforced at the API level.

---

### The Typed Error Pattern

**What it is**: Custom classes that extend the built-in `Error`, giving each error a distinct type that can be checked with `instanceof`. Each class can carry extra fields (e.g., `ApiError` carries `.status`).

**Where we used it**: `lib/errors/index.js` defines all five error classes; they're re-exported from `lib/analyzer.js`; `popup.js` dispatches on them in `handleError()`.

**Why it matters**: Without typed errors, the UI layer must interpret raw error messages or numeric codes — both are fragile. `instanceof` dispatch is explicit, testable, and survives refactoring. It's the same pattern used by Node.js, Axios, and most mature JS libraries.

---

### `AbortController` and Cancellable Fetch

**What it is**: `AbortController` is a Web API that lets you attach a cancellation signal to any async operation that supports it. `fetch()` accepts a `signal` option; calling `controller.abort()` cancels the request immediately.

**Where we used it**: `analyzeText()` in `lib/analyzer.js` — signal attached to `fetch()`, `abort()` called after 30 seconds via `setTimeout`.

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

### Specification Drift and the Single Source of Truth for Error Messages

**What it is**: When the same user-facing string appears in multiple documents (the feature spec, the API contract, and the task description), they will drift out of sync over time.

**Where we used it**: The exact error messages for HTTP 401, 429, 5xx, and network errors are defined in both `spec.md` and `contracts/ai-prompt-contract.md`. The canonical source is `contracts/ai-prompt-contract.md`.

**Why it matters**: User-facing strings in specs are often written by product/UX stakeholders, not just developers. If the implementation drifts to shorter or vaguer wording, the user experience degrades in ways that don't show up in functional tests.

---

### `Object.assign` and Getter-Only Prototype Properties in Strict Mode

**What it is**: `Object.assign(target, source)` uses `[[Set]]` — the same path as a plain `=` assignment. If a property exists on the target's prototype chain as a getter with no setter, strict mode throws a `TypeError`. ES modules are always strict.

**Where we used it**: This was the root cause of the failing `makeAbortError()` mock. `DOMException.prototype.name` is getter-only; the `Object.assign` approach threw before the `Promise.reject` ran.

**Why it matters**: `Object.assign` looks like a safe way to merge properties, but it hides a pitfall with accessor-defined properties on built-in prototypes. Whenever you're patching a property onto a DOM type or Error subclass, verify the property is writable before using `Object.assign`.

---

### Shadow DOM as a CSS and JS Isolation Boundary

**What it is**: Shadow DOM is a browser-native mechanism for encapsulating a subtree of DOM nodes. Styles defined inside a shadow root don't affect the outer page, and (in `mode: 'closed'`) the page can't traverse into the shadow tree via JavaScript.

**Where we used it**: The context menu overlay in `background/service-worker.js` — `linguaRenderOverlay` attaches a closed shadow root to the host `div` and puts the entire panel inside it.

**Why it matters**: Web components and injected UIs live inside pages they didn't control. Without Shadow DOM, any `*` reset, font override, or color declaration on the host page can silently break your injected panel.

---

### `chrome.scripting.executeScript` — Serialization Trap

**What it is**: `chrome.scripting.executeScript` with a `func:` argument injects code into a page by calling `.toString()` on the function and re-evaluating the resulting string in the target context. The page context gets a completely fresh copy — no shared memory, no shared module scope.

**Where we used it**: `inject()` in `background/service-worker.js` passes `linguaRenderOverlay` as the `func`. Payload data (analysis results or loading state) is passed via `args`, which Chrome JSON-serializes.

**Why it matters**: Code that works perfectly in the service worker will throw `ReferenceError: X is not defined` in the injected function if `X` is imported from a module. The function boundary is a hard serialization wall.

---

### API Key Hygiene: Treat Keys Like Passwords

**What it is**: An API key is a bearer token — whoever has it can make API calls billed to your account with no additional authentication. Exposing it in a chat log, a screenshot, a commit, or a public URL is equivalent to giving someone your password.

**Where it applies**: Anywhere a key is typed, pasted, copied, or displayed — DevTools console output, chat messages, git diffs, log files. The extension stores the key correctly (`chrome.storage.local`, never logged, displayed only as `type="password"`), but the user's workflow around the key matters just as much.

**Why it matters**: Exposed keys are scraped automatically by bots monitoring public channels. A key leaked in a chat message should be considered compromised immediately — revoke it at `console.anthropic.com/account/keys` and generate a new one.

---

## Architecture Overview

The feature has two entry points sharing one data layer. `lib/analyzer.js` owns all external communication and validation — it knows nothing about the DOM and has no Chrome API dependencies. Both the popup and the service worker import from it, which is why unit tests written against `analyzer.js` cover both flows without needing a browser.

The popup owns its own UI state. The service worker owns the context menu lifecycle and injects result UI into pages via `chrome.scripting.executeScript`. The injected overlay function (`linguaRenderOverlay`) is self-contained at the serialization boundary — it receives structured data via `args` and builds the panel entirely from DOM APIs.

```
popup.html  (entry point, loads as ES module)
  └── popup.js  (UI state: views, events, rendering)
        ├── lib/analyzer.js  (fetch, parse, validate, classify errors)
        │     ├── lib/errors/index.js  (typed error classes)
        │     └── https://api.anthropic.com/v1/messages
        │           └── tool_choice: linguistic_analysis  ← structured output
        └── chrome.storage.local  (API key)

background/service-worker.js  (ES module; context menu + page injection)
  ├── lib/analyzer.js  (shared — same fetch/validate layer)
  ├── chrome.storage.local  (reads apiKey on each click)
  ├── chrome.contextMenus  (registers "Lingua: Analyze" on install)
  └── chrome.scripting.executeScript → linguaRenderOverlay()
        └── Closed Shadow DOM overlay injected into active tab
```

---

## Glossary

| Term | Meaning |
|------|---------|
| Manifest V3 (MV3) | Chrome's current extension format; replaces persistent background pages with event-driven service workers |
| Service worker | Background script registered in `manifest.json`; required by MV3 even if empty; runs in a separate thread from the popup |
| `host_permissions` | Manifest field that grants the extension permission to `fetch()` a specific external origin |
| BYOAK | "Bring Your Own API Key" — user supplies and stores their own credentials; the app has no shared key |
| Tool use / function calling | Claude API mode where the model fills a declared JSON schema instead of returning free text; response is in `content[].type === 'tool_use'` |
| Lemma | The base dictionary form of a word (e.g., "running" → "run", "languages" → "language") |
| POS | Part of speech — grammatical category of a word (noun, verb, adj, etc.) |
| Romanization | Latin-script transliteration of non-Latin text (Korean: Revised Romanization, Chinese: Pinyin, Japanese: Hepburn) |
| `AbortController` | Web API for cancelling in-flight async operations like `fetch()` |
| Shadow DOM | Browser-native DOM encapsulation; `mode: 'closed'` prevents page JS/CSS from accessing the shadow tree |
| `activeTab` | Chrome permission that grants temporary access to the active tab on user gesture — no persistent or broad site access |
| `chrome.scripting.executeScript` | MV3 API for injecting a function or file into a tab; `func:` mode serializes the function — outer-scope variables are unavailable inside |
| Context menu | The right-click menu in Chrome; `chrome.contextMenus.create` registers extension items that appear when `contexts: ['selection']` matches |
| Prompt caching | Anthropic API feature that caches tokenized content (marked with `cache_control: ephemeral`) for up to 5 minutes, reducing per-call latency and cost |
