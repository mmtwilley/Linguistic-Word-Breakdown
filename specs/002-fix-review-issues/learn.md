# What I Learned: Code Review Fixes

**Feature**: Eleven targeted fixes to the Lingua Chrome Extension — security, race conditions, rate limiting, accessibility, and UX cleanup
**Generated**: 2026-05-30
**Scope**: Full feature
**Implementation status**: 18/18 tasks completed

---

## Key Decisions

### 1. The API Key "Leak" Was a False Positive — but Worth Proving

**What we did**: Kept the existing architecture unchanged. Added a code comment on `linguaRenderOverlay` and a unit test asserting the injected payload never contains an API key string.

**Why**: `linguaRenderOverlay` is a named function at module scope — not a closure. Chrome's `executeScript({ func })` serializes the function *source code*, not a closure snapshot. It cannot capture variables from the surrounding `onClicked` handler scope. The `args: [payload]` array holds only the result object (`{ translation, tokens }`), never the key. This is a correctness property of how `executeScript` works, not a lucky coincidence.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Proxy API calls through a backend server | Adds server infrastructure; the whole extension is designed to work without one |
| Route API calls via `chrome.runtime.sendMessage` from the page | Unnecessary indirection — the service worker already owns the API call |

**When you'd choose differently**: If you ever refactor `linguaRenderOverlay` into an inline arrow function or a closure *inside* `onClicked`, this guarantee disappears. Any time a function moves from module scope into a closure, re-audit what it can see.

---

### 2. Dismiss-During-Load: Message Passing, Not a Second Injection

**What we did**: When the user closes the loading spinner, the injected close button sends `chrome.runtime.sendMessage({ type: 'lingua-overlay-dismissed', tabId })` to the service worker. The SW adds the tab ID to a `dismissedTabs` Set and skips the result injection if that ID is present.

**Why**: The alternative — injecting a second script to check whether the panel is still there — requires an extra `executeScript` round-trip *after* the API response arrives. It also creates a new race window between the check and the inject. Keeping the dismissed state in the SW (where injection decisions are made) is cleaner: one check, one decision point, no second trip.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Check DOM for overlay presence before injecting result | Adds latency (extra round-trip); still has a race between check and inject |
| BroadcastChannel between page and service worker | Not available in MV3 service workers; SW context is isolated from the page |

**When you'd choose differently**: If you need richer bidirectional communication (e.g., the page needs to query SW state frequently), a persistent port via `chrome.runtime.connect` would be cleaner than one-off `sendMessage` calls.

---

### 3. Shared Renderer: Accept One Structural Duplicate

**What we did**: Extracted `buildTokenCard` and `buildMorphemeCard` into `lib/renderer.js` as ES module exports. `popup.js` imports them. The `linguaRenderOverlay` function in `service-worker.js` keeps its own identical inline implementation.

**Why**: `chrome.scripting.executeScript({ func })` serializes the function as source code. The serialized function runs in the page's execution context — which has no access to the extension's module graph. You can't `import` from inside an injected function.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Inject `lib/renderer.js` via `files` first, then call a global | Requires `renderer.js` to be a non-module IIFE polluting the page namespace; can't simultaneously be an ES module for the popup; two-step injection creates its own ordering race |
| Add a build step (bundler) | Violates the project's no-build-step constraint; adds toolchain complexity |

**When you'd choose differently**: If this project ever adds a build step (even a simple `esbuild` bundle), you could bundle the renderer into the injected function and eliminate the duplicate. For now, the duplicate is the honest choice — it's explicit, diff-able, and doesn't require infrastructure.

---

### 4. Response Size Check Belongs at the Network Boundary

**What we did**: Replaced `JSON.stringify(data).length > MAX_RESPONSE_BYTES` (checked *after* parsing) with `responseText.length > MAX_RESPONSE_BYTES` checked on the raw response text *before* `JSON.parse`.

**Why**: The old check was doing two things wrong. First, it ran after the response was already parsed into an object — the expensive work was already done. Second, `JSON.stringify(data)` re-serializes the entire object just to measure its length, which is O(n) work for a value you already have as a string. Reading the response as `.text()` first gives you the raw string you need to check length, and also lets you catch `JSON.parse` errors explicitly instead of relying on `response.json()`.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Check `Content-Length` header | Not always reliable; server may not send it; doesn't guard against chunked transfer |
| Keep size check in `validateResponse` | Still runs after parsing; can't avoid the re-serialization cost |

**When you'd choose differently**: If you were reading a streaming response (e.g., with `response.body` reader), you'd need to accumulate chunks and check as you go. For a one-shot JSON response, `response.text()` + length check is the right approach.

---

### 5. Rate Limit: The Timestamp Must Come First

**What we did**: Moved `lastSubmitTime = Date.now()` to the very first line of `runAnalysis`, before the gate check: `const now = Date.now(); if (now - lastSubmitTime < RATE_LIMIT_MS) return; lastSubmitTime = now;`

**Why**: The original code set `lastSubmitTime` inside the `try`/`catch` blocks — meaning during an in-flight request, the variable still held the *previous* submission time. A Retry click within the 1-second window would pass the gate check (because `Date.now() - previousSubmitTime > 1000` might be true), then set `lastSubmitTime = now` after the handler ran — bypassing the intended protection for that retry.

The fix is a single change in ordering: stamp the time before checking it. Any subsequent call within 1 second will be blocked, regardless of which button triggered it.

**When you'd choose differently**: This pattern only works because `runAnalysis` is synchronous up to the gate check. If gate logic were async (e.g., checking a remote rate limit endpoint), you'd need a lock mechanism to prevent concurrent invocations.

---

### 6. Tool Schema Descriptions Are What Claude Actually Uses

**What we did**: Reduced the system prompt from a full per-field rule list to a two-sentence framing message. All per-field rules (which particle type for 은/는, which ending type for -고, etc.) live exclusively in the tool schema `description` fields.

**Why**: When you call the API with `tool_choice: { type: 'tool', name: 'linguistic_analysis' }`, Claude is forced to produce structured output matching the tool schema. In this mode, Claude reads the field `description` values to understand what to fill in. The system prompt is better suited for high-level framing and cross-cutting constraints. Having the same rules in both places creates two maintenance burdens: they can drift out of sync, and they waste prompt tokens.

**Alternatives considered**:
| Approach | Why it wasn't chosen |
|----------|---------------------|
| Keep rules in system prompt only; remove from tool schema | Tool schema descriptions travel with the function call — they're still visible to Claude during output generation. System prompt only is less reliable for structured output. |
| Keep both (status quo) | Rules can drift; if they conflict, Claude's behavior is unpredictable |

**When you'd choose differently**: If you're using `tool_choice: auto` (Claude decides whether to use the tool), system prompt rules become more important because the tool schema may not be consulted at all.

---

## Concepts to Know

### Chrome `executeScript` Serializes Functions, Not Closures

**What it is**: `chrome.scripting.executeScript({ func: myFn, args: [payload] })` converts `myFn` to a source string and re-evaluates it in the page's JavaScript context. The function has no memory of where it came from. It can only receive data through `args`, and `args` must be JSON-serializable.

**Where we used it**: `background/service-worker.js` — `linguaRenderOverlay` is injected this way. The security audit relied on understanding this: because it's serialized, it cannot capture `apiKey` from the outer scope.

**Why it matters**: Any time you inject a function and expect it to "remember" something from the service worker context, you're wrong — it can't. All state must be passed explicitly through `args`. This is also why sharing `lib/renderer.js` with the overlay is impossible without a build step.

---

### Module-Scope State in Service Workers

**What it is**: Variables declared at module scope in a service worker (`const pendingTabs = new Set()`) persist across event handler calls as long as the SW process is alive. They're cleared when Chrome terminates the SW (which it does after a period of inactivity).

**Where we used it**: `pendingTabs` and `dismissedTabs` Sets in `service-worker.js`. `cachedApiKey` in both `service-worker.js` and `popup.js`.

**Why it matters**: This is how you implement in-memory deduplication and caching in a MV3 extension without using `chrome.storage`. The tradeoff is that the cache is ephemeral — a SW restart (after idle) means one storage read to repopulate it. For a credential cache, this is acceptable.

---

### ARIA Live Regions: `polite` vs `assertive`

**What it is**: An element with `aria-live` tells screen readers to monitor it and announce when its content changes. `polite` queues the announcement until the user is silent; `assertive` (equivalent to `role="alert"`) interrupts immediately.

**Where we used it**: `popup.html` — `aria-live="polite" role="status"` on `#results`; `role="alert"` on `#error-banner`.

**Why it matters**: Without a live region, a screen reader user submitting an analysis has no way to know the results arrived — the page content changed silently. The choice between `polite` and `assertive` matters: results can wait for silence (polite), but errors are time-sensitive and should interrupt (alert).

---

### Temporal Dead Zone (TDZ) — The Naming Trap

**What it is**: `let` and `const` are hoisted to the top of their block, but they're not initialized until the declaration line executes. Accessing them before that line throws a `ReferenceError`. This period is the TDZ. The subtle trap: if you declare a local variable with the same name as a function parameter, the TDZ applies to the *entire function body* — you can't access the parameter either.

**Where we used it**: We hit this bug when adding `let text` for the response body inside `analyzeText(text, apiKey)`. The parameter `text` and the local `let text` shared the same name — reading `text` anywhere in the function (even before the `let`) threw `Cannot access 'text' before initialization`. Fix: rename the local to `responseText`.

**Why it matters**: This error is caught by the generic `catch (err)` block and rethrown as a `NetworkError` — it looks like a network failure, not a naming conflict. Without understanding TDZ, you'd spend a long time debugging the wrong thing.

---

## Architecture Overview

The extension has three independent execution contexts: the popup (ES module page with full import access), the service worker (ES module but injection constraints apply), and injected page scripts (no module access). `lib/` holds pure logic shared between popup and tests. `lib/renderer.js` is the only shared UI code, but it can only be used by popup — the overlay in `service-worker.js` keeps a structurally identical copy due to the `executeScript` serialization constraint. State management follows context boundaries: popup keeps rate limit and API key in module scope; service worker keeps tab deduplication sets in module scope; no shared state crosses contexts (except via `chrome.runtime.sendMessage` for the dismiss signal and `chrome.storage.local` for the key).

```
popup.js ──imports──► lib/renderer.js
    │                  lib/analyzer.js ──► Anthropic API
    └──chrome.storage.local (API key)

service-worker.js
    ├──chrome.storage.local (API key)
    ├──executeScript ──► linguaRenderOverlay (self-contained; no imports)
    └──onMessage ◄── linguaRenderOverlay close button (dismiss signal)
```

---

## Glossary

| Term | Meaning |
|------|---------|
| MV3 | Manifest V3 — the current Chrome extension platform; replaces background pages with service workers, tightens scripting permissions |
| `executeScript({ func })` | Chrome API that serializes a JS function and evaluates it in a target tab's page context |
| TDZ | Temporal Dead Zone — the period between a `let`/`const` variable being hoisted and its declaration line being reached; access during TDZ throws `ReferenceError` |
| ARIA live region | An HTML attribute (`aria-live`) that tells screen readers to announce content changes in a container automatically |
| Shadow DOM | A scoped DOM tree attached to a host element; styles and IDs inside it don't affect the page — used by the overlay to avoid CSS conflicts |
| `pendingTabs` / `dismissedTabs` | Module-scope Sets in the service worker used as ephemeral per-tab state to prevent double-injection and handle dismiss-during-load |
