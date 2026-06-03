# Implementation Plan: Streaming & History Memory Optimization + Large Text Translation

**Branch**: `006-memory-perf-opt` | **Date**: 2026-06-01 | **Spec**: [spec.md](specs/006-memory-perf-opt/spec.md)
**Input**: Feature specification from `specs/006-memory-perf-opt/spec.md`; user request: "We should be able to translate large things"

> **Spec note**: User Story 4 (large text translation) extends the scope beyond the current `spec.md`. Run `/speckit-specify` to formally amend the spec before generating updated tasks.

## Summary

Replaces the batch Claude API call with a streaming SSE consumer that emits the translation early, introduces a unified `lingua_history_v1` store serving both cache lookup and history display (compact columnar + optional gzip token storage), adds a lazy-paginated history tab, and inserts a cache-first dispatch path. A new **large-text translation mode** (US4) handles inputs exceeding `LARGE_TEXT_THRESHOLD` (2 000 chars) by running a translation-only batch call — no word breakdown — raising the effective input ceiling from 2 000 to 10 000 characters. All new DOM writes use `.textContent`; all new error paths use typed classes from `lib/errors/index.js`.

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES2022+), Chrome Extension Manifest V3
**Primary Dependencies**: Anthropic Claude API (`claude-sonnet-4-6`; SSE streaming + batch), Chrome APIs (`chrome.storage.local`, `chrome.contextMenus`, `chrome.scripting`), DeepL API (optional, feature 003), native `CompressionStream`/`DecompressionStream` (Chromium 80+)
**Storage**: `chrome.storage.local` — unified key `lingua_history_v1`; existing keys `apiKey`, `deeplKey`
**Testing**: Manual via Chrome DevTools per `specs/006-memory-perf-opt/quickstart.md`; no automated test runner
**Target Platform**: Chrome Extension (Chromium 80+), extension popup (MV3)
**Project Type**: Browser extension — single-user, popup-scoped sessions
**Performance Goals**: Translation visible ≤1 s SC-001; cache hit ≤200 ms SC-002; history tab initial render ≤300 ms SC-004; large-text translation ≤2 s
**Constraints**: Vanilla JS only (no frameworks, no bundlers, no transpilers — Principle II); `chrome.storage.local` 5 MB quota / 4 MB write ceiling; 75-entry LRU cap; 50 KB response byte cap for full analysis; popup destroyed on close (MV3 popup lifecycle)
**Scale/Scope**: Single-user personal extension; 75 history entries max; full analysis up to 2 000 chars; translation-only up to 10 000 chars

---

## Constitution Check

*Gates evaluated against `constitution.md` v1.1.0. Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Pre-design evaluation

| Gate | Status | Notes |
|------|--------|-------|
| 1 — Security audit | **PASS** | All new DOM writes use `.textContent` (renderTranslation, history list items, error banner). No `innerHTML` on user-derived content. No `onclick` attributes introduced. |
| 2 — Error coverage | **PASS** | `StorageError` added to `lib/errors/index.js`. `translateOnly()` throws `ApiError`, `NetworkError`, `JsonError`, `TimeoutError` on all failure paths. No bare `catch {}` blocks. |
| 3 — Contract alignment | **PENDING** | Streaming transport change → v3.3 addendum complete. Large-text path adds `text_translation` tool → **v3.4 addendum required** (generated in Phase 1). |
| 4 — Timeout consistency | **N/A** | Feature does not modify `TIMEOUT_MS`. PA-002 amendment applies. |
| 5 — Permissions minimization | **PASS** | `translateOnly()` calls the same `https://api.anthropic.com/*` endpoint already in `host_permissions`. No new permissions needed. |

Gate 3 is unblocking: the v3.4 addendum is a Phase 1 deliverable generated as part of this plan command.

### Post-design re-check

Re-evaluate Gate 3 after contracts/ai-prompt-contract.md v3.4 is written. All other gates are stable.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-memory-perf-opt/
├── plan.md              This file (/speckit-plan output)
├── research.md          Phase 0 output — 8 decisions
├── data-model.md        Phase 1 output — updated with translationOnly field + LARGE_TEXT_THRESHOLD
├── quickstart.md        Phase 1 output — updated with large-text test section
├── contracts/
│   └── ai-prompt-contract.md   v3.3 (streaming) + v3.4 addendum (translation-only tool)
└── tasks.md             Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code

```text
lib/
├── analyzer.js          MODIFIED — streaming consumer (was batch); + translateOnly() for large text
├── history.js           NEW — unified store: read/write/compress/evict, LARGE_TEXT_THRESHOLD export
├── errors/index.js      MODIFIED — StorageError class added
└── renderer.js          MODIFIED — renderTranslation() export added

popup/
├── popup.js             MODIFIED — cache-first dispatch, large-text branch, history tab, stream abort
├── popup.html           MODIFIED — history tab panel, load-more button, loading overlay
└── popup.css            MODIFIED — history tab and translation-mode indicator styles
```

**Structure decision**: Single flat extension project (no build step; all files loaded directly by Chrome per Principle II). No subdirectory reorganization needed.

---

## User Stories

### US1 — See Translation Before Full Analysis Completes (P1, implemented)

Streaming SSE consumer extracts translation via regex from the partial buffer and emits it before the full token array arrives. Abort wired to popup close via `window.addEventListener('unload', ...)`.

**Key constants** (lib/analyzer.js): `MAX_RESPONSE_BYTES = 51200`, `TIMEOUT_MS = 30000`

### US2 — History Stays Fast and Within Device Storage Limits (P2, implemented)

Unified `lingua_history_v1` store; `getHistory(page)` returns 10-entry pages of `{ id, ts, lang, snippet }` without unpacking tokens; `addEntry()` enforces 75-entry LRU cap and 4 MB byte ceiling.

**Key constants** (lib/history.js): `MAX_ENTRIES = 75`, `QUOTA_CEILING = 4*1024*1024`, `PAGE_SIZE = 10`

### US3 — Previously Analyzed Text Loads Instantly (P3, implemented)

`getCached(text)` normalizes input, scans `lingua_history_v1` for a version-1 match, unpacks tokens, and returns the full result. Cache miss falls through to streaming. Corrupted token data falls through silently.

### US4 — Translate Large Blocks of Text (P2, new — spec amendment pending)

A user pastes a paragraph or multi-sentence comment (up to 10 000 chars) and receives an English translation. Word-by-word analysis is not shown. The translation is stored in history and cacheable like any other entry.

**Why this priority**: Translation is the core value. Blocking on 2 000-char input limits cuts off real-world use cases (social media comments, lyrics, subtitles). Translation-only mode delivers value without requiring word-level response scaling.

**Acceptance scenarios**:

1. **Given** a user pastes 2 500-char Korean text, **When** they submit, **Then** an English translation is shown within 2 s; no word cards appear
2. **Given** a user re-submits the same large text, **Then** it is served from cache in <200 ms with no network request
3. **Given** input exceeds 10 000 chars, **Then** a validation error is shown immediately before any API call
4. **Given** a large-text translation is in history, **When** the user clicks the entry, **Then** the translation restores to the main view instantly
5. **Given** the API call for large text fails, **Then** a user-facing error is shown within 1 s; the typed error class is used

**Technical approach** (see research.md Decision 8):

- `LARGE_TEXT_THRESHOLD = 2000` in `lib/analyzer.js` — inputs above this threshold route to `translateOnly()`
- `MAX_LARGE_INPUT_CHARS = 10000` replaces `MAX_INPUT_CHARS` in `validateInput()`
- `translateOnly(text, apiKey, options)` — batch POST using `text_translation` tool (schema in contracts/ai-prompt-contract.md v3.4); `max_tokens = 2048`; same error handling as `analyzeText()`
- `AnalysisEntry.translationOnly = true` flag stored on large-text entries; `tokens` stored as empty `TokenStore`
- `popup.js` dispatch: `text.length > LARGE_TEXT_THRESHOLD → translateOnly()`; renders translation banner only; hides word-cards panel

---

## Complexity Tracking

No constitution gate violations requiring justification.
