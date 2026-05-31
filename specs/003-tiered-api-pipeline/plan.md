# Implementation Plan: Tiered API Pipeline

**Branch**: `005-tiered-api-pipeline` | **Date**: 2026-05-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-tiered-api-pipeline/spec.md`

## Summary

Adds DeepL Free tier as an optional second API key. When a DeepL key is present and the input is non-Latin script, DeepL handles the translation and Claude receives a schema that omits the translation field — reducing Claude token usage. Falls back silently to Claude-only mode when no key is configured or any DeepL call fails. Includes local Korean Revised Romanization (no Claude round-trip for romanization), a language-conditional Claude tool schema, and Unicode-based script detection. The Settings panel gains an independent DeepL key field with save-to-clear semantics.

## Technical Context

**Language/Version**: Vanilla JavaScript ES2022+ (no transpiler, no bundler)
**Primary Dependencies**: None at runtime; Jest 29 (devDependency)
**Storage**: `chrome.storage.local` — `apiKey` and `deeplKey` only; no user text retained
**Testing**: Jest 29 (`node --experimental-vm-modules`), `npm test`
**Target Platform**: Chrome / Chromium desktop, Manifest V3
**Project Type**: Browser Extension (single-user, local; no server-side component)
**Performance Goals**: DeepL call adds one network hop before Claude; Korean romanization generated locally (no extra Claude round-trip); Claude schema omits translation field when DeepL succeeds
**Constraints**: No build step; MV3 injected functions must be self-contained; 30 s API timeout; 2000-char input cap; 50 KB response cap

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — Security-First Rendering

| Check | Status | Notes |
|-------|--------|-------|
| DeepL translation merged via `result.translation = preTranslation` | ✅ PASS | String value only; inserted into DOM via `textContent` in renderResults |
| No new `innerHTML` usage in any file | ✅ PASS | All new lib files construct no DOM; overlay renderer unchanged |
| POS/particle allowlist validation unchanged | ✅ PASS | No changes to validation logic |
| No inline JS event handlers added | ✅ PASS | cancelBtn/saveBtn wired via `addEventListener` |

### Principle II — Vanilla JavaScript, No Build Step

| Check | Status | Notes |
|-------|--------|-------|
| No new runtime dependencies | ✅ PASS | No npm packages added |
| All new files directly loadable | ✅ PASS | `lib/lang-detect.js`, `lib/translator.js`, `lib/romanizer.js` are plain ES modules |
| No bundler required | ✅ PASS | All files follow existing module pattern |

### Principle III — Structured API Contracts

| Check | Status | Notes |
|-------|--------|-------|
| Tool use mechanism retained | ✅ PASS | `tool_choice: { type: 'tool' }` and `linguistic_analysis` tool unchanged |
| `input_schema` now built dynamically | ⚠️ CONTRACT UPDATE NEEDED | `buildAnalysisTool(lang, preTranslation)` generates conditional fields; v3.2 contract document created in Phase 1 |
| `cache_control: { type: 'ephemeral' }` on system message | ✅ PASS | Preserved in `buildSystemPrompt` output |

### Principle IV — Typed Error Handling

| Check | Status | Notes |
|-------|--------|-------|
| DeepL error silently swallowed | ❌ **VIOLATION** | `catch { /* fall through */ }` in `analyzeText` does nothing — constitution MUST: catch blocks must not swallow silently. Fix: add `console.warn`. See Design Decision 5. Task T-W01. |
| All other failure paths use typed error classes | ✅ PASS | `TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError` all present |

### Principle V — Minimal Data Retention

| Check | Status | Notes |
|-------|--------|-------|
| `cachedDeeplKey` never logged | ✅ PASS | Module-scope variable; used only in `getKeys()` call chain |
| DeepL key sent only to `api-free.deepl.com` as Auth header | ✅ PASS | Not in request body; not in Claude request |
| New host permission `https://api-free.deepl.com/*` not in Principle V's allowed list | ⚠️ **AMENDMENT NEEDED** | Constitution requires explicit justification. Amendment PA-003 drafted in this plan. Task T-W02. |

**Constitution verdict: TWO ISSUES to resolve before the feature ships.**

1. **❌ Principle IV VIOLATION**: Add `console.warn` to the empty DeepL catch block (task T-W01)
2. **⚠️ Principle V AMENDMENT**: Add DeepL host permission to Principle V's allowed list (task T-W02)

## Project Structure

### Documentation (this feature)

```text
specs/003-tiered-api-pipeline/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── ai-prompt-contract.md   # v3.2 amendment — conditional schema
└── tasks.md             # /speckit-tasks output
```

### Source Code (modified/new files)

```text
extension/
├── popup/
│   ├── popup.html      # DeepL key field + label in settings-view
│   └── popup.js        # cachedDeeplKey; getKeys(); saveBtn; cancelBtn gap (DD-7)
│
├── lib/
│   ├── analyzer.js     # buildAnalysisTool(); buildSystemPrompt(); deeplKey param; pipeline
│   ├── lang-detect.js  # NEW — detectScript(), SCRIPT enum
│   ├── translator.js   # NEW — translateWithDeepL()
│   └── romanizer.js    # NEW — romanizeKorean()
│
├── background/
│   └── service-worker.js   # cachedDeeplKey; getKeys(); passes deeplKey to analyzeText
│
└── manifest.json           # +host_permissions: api-free.deepl.com; +CSP connect-src
```

**Structure Decision**: Single Chrome Extension project, same layout as features 001/002. Three new lib files. No new directories in `extension/`. No changes to `package.json` or test runner configuration.

## Design Decisions

### 1. Script Detection (FR-003, FR-007)

**Approach**: Count characters in each Unicode block; dominant count wins. Kana presence breaks the CJK tie between Japanese and Chinese. Implemented in `lib/lang-detect.js`.

**Why**: No external library; deterministic; O(n) for typical short inputs (<2000 chars). The 5-way classification (KOR/JPN/CMN/LAT/UND) maps directly to schema-conditioning logic in `buildAnalysisTool`.

**Tradeoff**: Mixed-script input uses dominant-count winner. Equal-count edge cases fall through to LAT (no DeepL call) — a safe default.

### 2. DeepL Free API Integration (FR-004)

**Endpoint**: `POST https://api-free.deepl.com/v2/translate`
**Auth**: `Authorization: DeepL-Auth-Key <key>` request header
**Body**: `application/x-www-form-urlencoded` — `text=<input>&target_lang=EN`
**Response**: `data.translations[0].text` extracted; null returned on absent field

**Manifest changes**: `https://api-free.deepl.com/*` added to `host_permissions` and to `content_security_policy.extension_pages` `connect-src`. These are the minimum additions required for the fetch to succeed in MV3. Triggers PA-003 amendment.

### 3. Conditional Tool Schema (FR-005)

`buildAnalysisTool(lang, preTranslation)` produces different `input_schema` shapes:

| lang | preTranslation | translation field | romanization | particles + endings |
|------|---------------|-------------------|--------------|---------------------|
| LAT / UND | null | required | — | — |
| KOR | null | required | — (local) | optional |
| KOR | set | **omitted** | — (local) | optional |
| JPN | null | required | required | — |
| JPN | set | **omitted** | required | — |
| CMN | null | required | required | — |
| CMN | set | **omitted** | required | — |

Korean romanization is generated locally post-response — never requested from Claude.

### 4. Korean Local Romanization (FR-003)

`lib/romanizer.js` implements syllable-block decomposition (Revised Romanization). Applied in `analyzeText` after the Claude response, populating any Hangul-containing token that has no `romanization` field.

**Tradeoff**: Cross-syllable assimilation rules not applied (e.g., `한국어` → `hangugo`). Acceptable for language-learning display; full assimilation requires lookahead across syllable boundaries and is out of scope.

### 5. Silent DeepL Fallback — Constitution Fix Required (FR-006)

**Current code** (violates Principle IV):
```js
try { preTranslation = await translateWithDeepL(text, deeplKey); }
catch { /* fall through — Claude will generate translation */ }
```

**Fix** (task T-W01):
```js
try { preTranslation = await translateWithDeepL(text, deeplKey); }
catch (err) { console.warn('[Lingua] DeepL translation failed, falling back to Claude:', err.message); }
```

Preserves the silent fallback behavior for the user while satisfying the constitution's logging requirement.

### 6. Pre-Translation Merge

After the Claude response, the result is patched before `validateResponse`:
```js
if (preTranslation && !result.translation) {
  result.translation = preTranslation;
}
```
This ensures `validateResponse`'s translation check passes regardless of which pipeline ran. If Claude unexpectedly returns a translation field despite the schema omitting it, Claude's value is kept.

### 7. Settings Cancel Gap — Implementation Fix Required (FR-001)

**Current state**: `cancelBtn` clears `apiKeyInput.value` but not `deeplKeyInput.value`. A partially typed DeepL key survives a Cancel action.

**Fix** (task T-W03):
```js
cancelBtn.addEventListener('click', () => {
  apiKeyInput.value   = '';
  deeplKeyInput.value = '';
  showMain();
});
```

### 8. Dual Key Cache (FR-008)

Both `popup.js` and `service-worker.js` implement a `getKeys()` function that caches both keys as a unit: if `cachedApiKey` is set, return both cached values without a storage read. `saveBtn` updates both cache variables immediately. Saving with an empty DeepL field sets `cachedDeeplKey = null` (no DeepL calls).

## Pending Constitution Amendment

### PA-003 — Add DeepL host permission to Principle V

**Target**: `.specify/memory/constitution.md`, `## Core Principles > V. Minimal Data Retention`, permissions paragraph.

**Current text**:
> `storage`, `contextMenus`, `activeTab`, `scripting`, and the `host_permissions` entry for
> `https://api.anthropic.com/*`. Adding permissions beyond this set requires a constitution
> amendment with explicit justification.

**Addition**: Append after the existing permissions list:
> For users who configure the optional DeepL integration, `https://api-free.deepl.com/*` in
> `host_permissions` and `connect-src` is also required. The DeepL API key is transmitted only
> as an Authorization header to this endpoint and is never forwarded elsewhere.

**Bump**: PATCH (additive — no existing permission removed or narrowed).

## Complexity Tracking

> No unjustified constitution violations. The two open items (T-W01 console.warn, PA-003 amendment) are minor and scoped.
