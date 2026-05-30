# Implementation Plan: Linguistic Word Breakdown

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-lingua-word-breakdown/spec.md`

## Summary

Chrome Extension (Manifest V3) that uses the Claude API tool use (function calling) mechanism to deliver real-time translation and word-level linguistic analysis for language learners. Users submit text via the popup UI or right-click context menu; the extension calls the Claude Sonnet API with a typed `linguistic_analysis` tool schema and renders the structured result — translation headline plus per-word cards (surface form, lemma, POS, gloss, optional romanization/IPA/particles) — using strict `textContent`-only DOM rendering. No framework, no build step, no server-side components.

## Technical Context

**Language/Version**: Vanilla JavaScript ES2022+ (no transpiler, no bundler)
**Primary Dependencies**: None at runtime; Jest 29 (devDependency for unit tests)
**Storage**: `chrome.storage.local` — API key only; no user data retained
**Testing**: Jest 29 (`node --experimental-vm-modules`), `npm test`
**Target Platform**: Chrome / Chromium desktop, Manifest V3
**Project Type**: Browser Extension (single-user, local; no server-side component)
**Performance Goals**: Analysis ≤ 5 s for typical sentence under 30 words (SC-001)
**Constraints**: 30 s API timeout, 2000-char input cap, 50 KB response cap, 500-token cap
**Scale/Scope**: Single-user local extension; no telemetry, no history, no sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — Security-First Rendering

| Check | Status | Evidence |
|-------|--------|----------|
| All user data via `textContent` (popup) | ✅ PASS | `popup/popup.js` lines 65, 77, 86, etc. — no `innerHTML` |
| All user data via `textContent` (overlay) | ✅ PASS | `background/service-worker.js` — all `textContent` |
| POS class names validated against `VALID_POS` | ✅ PASS | `lib/analyzer.js` — invalid POS normalized to `'other'` before render |
| Particle types validated against `VALID_PARTICLE_TYPES` | ✅ PASS | `lib/analyzer.js` — invalid types normalized to `'other-particle'` |
| No inline JS event handlers in HTML | ✅ PASS | All listeners via `addEventListener()` in script files |

### Principle II — Vanilla JavaScript, No Build Step

| Check | Status | Evidence |
|-------|--------|----------|
| No framework imports | ✅ PASS | `package.json` — only Jest in devDependencies |
| No bundler / transpiler | ✅ PASS | No webpack/Vite/Babel config present |
| Directly loadable as unpacked extension | ✅ PASS | `manifest.json` references native `.js` files |

### Principle III — Structured API Contracts, Tool Use Required

| Check | Status | Evidence |
|-------|--------|----------|
| Tool use with `input_schema` declared | ✅ PASS | `ANALYSIS_TOOL` in `lib/analyzer.js` |
| `tool_choice: { type: 'tool' }` forces structured output | ✅ PASS | `lib/analyzer.js:151` |
| Response extracted from `content.find(b => b.type === 'tool_use').input` | ✅ PASS | `lib/analyzer.js:170` |
| Contract documented in `contracts/ai-prompt-contract.md` | ✅ PASS | v2.0, 2026-05-29 |
| Prompt caching on system message | ✅ PASS | `cache_control: { type: 'ephemeral' }` + beta header |

### Principle IV — Typed Error Handling

| Check | Status | Evidence |
|-------|--------|----------|
| All 5 error classes in `lib/errors/index.js` | ✅ PASS | `TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError` |
| No bare `catch (e) {}` swallowing | ✅ PASS | All catch blocks rethrow or surface to user |
| Errors surface within 1 s (SC-005) | ✅ PASS | Synchronous display via `showError()` on error |

### Principle V — Minimal Data Retention

| Check | Status | Evidence |
|-------|--------|----------|
| No user data logged or cached | ✅ PASS | No `console.log(text/translation)`, no caching layer |
| API key in `chrome.storage.local` only | ✅ PASS | `popup/popup.js:209`, `background/service-worker.js:25` |
| Permissions match Principle V exactly | ✅ PASS | `manifest.json`: `storage, contextMenus, activeTab, scripting` + `https://api.anthropic.com/*` |

**Constitution verdict: ALL GATES PASS — no violations.**

## Project Structure

### Documentation (this feature)

```text
specs/001-lingua-word-breakdown/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output — API/architecture decisions
├── data-model.md        # Phase 1 output — entity definitions
├── quickstart.md        # Phase 1 output — setup guide
├── security.md          # Security & error handling detail
├── contracts/
│   └── ai-prompt-contract.md   # Claude API tool schema + error table (v2.0)
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
extension/               # project root / Chrome unpacked extension directory
├── manifest.json        # MV3 manifest: permissions, CSP, entry points
├── CLAUDE.md            # Agent context (SPECKIT pointers)
├── README.md
├── TESTING.md           # Manual test cases for all user stories
├── package.json         # Jest test runner (devDependency only)
│
├── background/
│   └── service-worker.js   # Context menu registration + overlay injection
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── lib/
│   ├── analyzer.js          # API client, validateInput, validateResponse, analyzeText
│   └── errors/
│       └── index.js         # Typed error classes (Constitution IV)
│
├── popup/
│   ├── popup.html           # Main UI: input, results, settings views
│   ├── popup.css            # Styles: token cards, POS badges, error banner, spinner
│   └── popup.js             # Popup logic: submit, render, error handling, settings
│
└── tests/
    ├── analyzer.test.js     # Unit tests for validateInput/validateResponse/analyzeText
    └── mocks/
        └── fetchMock.js     # Fetch mock (200/401/429/500/timeout/malformed)
```

**Structure Decision**: Single-project Chrome Extension layout. No frontend/backend split — the extension popup is the UI and the service worker handles background events. `lib/` is shared by both `popup/popup.js` and `background/service-worker.js`.

## Design Decisions

### API Integration
- **Model**: `claude-sonnet-4-6` — best capability/cost balance for structured linguistic analysis.
- **Tool use**: `tool_choice: { type: 'tool', name: 'linguistic_analysis' }` guarantees structured output; freeform text parsing is prohibited (Constitution III).
- **Prompt caching**: System message cached with `cache_control: { type: 'ephemeral' }` to reduce latency/cost within a session's 5-minute cache window.
- **Timeout**: 30 s (`TIMEOUT_MS = 30000`) — raised from initial 10 s to accommodate larger payloads from optional fields (romanization, IPA, particles).

### Context Menu Overlay
- **Shadow DOM** (`attachShadow({ mode: 'closed' })`): Isolates overlay CSS/JS from host page. Host-page styles cannot bleed in; host-page JS cannot read overlay contents (FR-023).
- **Immediate spinner**: Overlay is injected with a loading state before the API call, so users get visual feedback within one frame (FR-022).
- **Silent failure** on non-injectable tabs (`chrome://` etc.): try/catch around `executeScript` suppresses browser errors (FR-025).

### Error Architecture
- Five typed error classes co-located in `lib/errors/index.js`, re-exported from `lib/analyzer.js`.
- `popup.js` and `service-worker.js` both import from `lib/errors/index.js`.
- No error class defined inline in consuming modules (Constitution IV).

## Complexity Tracking

> No constitution violations — this section is not applicable.

## Phase Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Feature spec | `specs/001-lingua-word-breakdown/spec.md` | Complete |
| Research | `specs/001-lingua-word-breakdown/research.md` | Complete |
| Data model | `specs/001-lingua-word-breakdown/data-model.md` | Complete |
| AI prompt contract | `specs/001-lingua-word-breakdown/contracts/ai-prompt-contract.md` | Complete (v2.0) |
| Quickstart | `specs/001-lingua-word-breakdown/quickstart.md` | Complete |
| Security detail | `specs/001-lingua-word-breakdown/security.md` | Complete |
| Tasks | `specs/001-lingua-word-breakdown/tasks.md` | Complete |
