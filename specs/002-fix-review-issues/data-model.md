# Data Model: Code Review Fixes

**Branch**: `002-fix-review-issues` | **Date**: 2026-05-30

This feature introduces no new persistent data. All new state is transient (runtime memory only).

---

## Runtime State Entities

### PendingTabs

| Attribute | Type | Description |
|-----------|------|-------------|
| `tabId` | `number` | Chrome tab ID with an in-progress right-click overlay analysis |

**Lifecycle**: Added when `onClicked` handler starts; removed in `finally` block. Module-scope `Set<number>` in `service-worker.js`.

**Transitions**:
- `{}` → `{tabId}` on right-click analysis start
- `{tabId}` → `{}` on analysis complete or error (always via `finally`)

---

### DismissedTabs

| Attribute | Type | Description |
|-----------|------|-------------|
| `tabId` | `number` | Chrome tab ID where the user dismissed the overlay while loading was in progress |

**Lifecycle**: Added when the service worker receives a `lingua-overlay-dismissed` message. Checked before injecting result; removed after check. Module-scope `Set<number>` in `service-worker.js`.

**Transitions**:
- User clicks overlay close button → close button sends `chrome.runtime.sendMessage({ type: 'lingua-overlay-dismissed', tabId })` → SW adds to `DismissedTabs`
- Before result inject → if tabId in `DismissedTabs`: skip inject, remove from `DismissedTabs`

---

### CachedApiKey (popup)

| Attribute | Type | Description |
|-----------|------|-------------|
| `value` | `string \| null` | The user's Anthropic API key, or null if not yet read from storage |

**Lifecycle**: Starts `null` on popup open. Set to the key string on first successful `chrome.storage.local.get`. Immediately updated (or cleared to null) when user saves or removes a key. Module-scope variable in `popup.js`.

---

### CachedApiKey (service worker)

Same structure as popup CachedApiKey. Module-scope variable in `service-worker.js`. Reset to `null` each time Chrome terminates and restarts the service worker.

---

## Updated Message Types

### lingua-overlay-dismissed

New runtime message sent from the injected page context to the service worker.

| Field | Type | Value |
|-------|------|-------|
| `type` | `string` | `'lingua-overlay-dismissed'` |
| `tabId` | `number` | The tab ID where the overlay was dismissed |

**Sender**: `linguaRenderOverlay` (injected function in page context) — close button click handler.

**Receiver**: `chrome.runtime.onMessage` listener in `service-worker.js`.

---

## Overlay Payload Shape (updated)

The `payload` argument to `linguaRenderOverlay` gains a `tabId` field so the close button can send the dismiss message.

| Field | Type | Present when | Notes |
|-------|------|-------------|-------|
| `tabId` | `number` | Always | Used by close button to send dismiss message |
| `loading` | `boolean` | Loading state | Mutually exclusive with result/error |
| `result` | `object` | Success | `{ translation: string, tokens: Token[] }` |
| `error` | `string` | Failure | Human-readable error message |

**Token shape**: Unchanged from 001 feature — see `specs/001-lingua-word-breakdown/data-model.md`.
