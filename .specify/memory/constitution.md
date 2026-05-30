<!--
SYNC IMPACT REPORT
==================
Version change: (unfilled template) → 1.0.0
Type: MINOR (initial ratification — all principles newly defined)

Modified principles:
  All five principles: (template placeholders) → concrete Lingua principles

Added sections:
  ## Core Principles (I–V)
  ## Development Workflow
  ## Quality Gates
  ## Governance

Removed sections:
  None (template placeholders replaced)

Templates reviewed:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate section aligns; no changes needed
  ✅ .specify/templates/spec-template.md — mandatory sections align with principles; no changes needed
  ✅ .specify/templates/tasks-template.md — "Security hardening" polish task aligns with Principles I & IV; no changes needed

Deferred TODOs:
  None — all fields resolved from project context
-->

# Lingua Constitution

## Core Principles

### I. Security-First Rendering

All user-controlled data — including translation text, token fields, and any content derived from
API responses — MUST be inserted into the DOM exclusively via the `textContent` property.
Use of `innerHTML`, `outerHTML`, or template literals that produce HTML strings containing
user data is prohibited.

Dynamic CSS class suffixes derived from API response values (e.g., POS tags, particle types)
MUST be validated against an in-code allowlist (e.g., `VALID_POS`, `VALID_PARTICLE_TYPES`)
before being applied as class names. Unrecognized values MUST be normalized to a safe default
(`other` / `other-particle`) and MUST NOT be applied raw to the DOM.

No inline JavaScript (`onclick`, `oninput`, `onload` attributes) is permitted in any HTML file.
All event listeners MUST be attached via `addEventListener()` in script files.

### II. Vanilla JavaScript — No Framework, No Build Step

The extension MUST be implemented using native browser APIs and vanilla JavaScript (ES2022+).
No UI frameworks (React, Vue, Angular, Svelte, etc.), no CSS-in-JS libraries, no bundlers
(webpack, Vite, esbuild), and no transpilers (Babel, TypeScript compiler) are permitted.

All source files MUST be loadable directly by Chrome as an unpacked extension with no prior
build step. This constraint exists to keep the extension auditable, dependency-free, and
simple to load for development and distribution.

### III. Structured API Contracts — Tool Use Required

The Anthropic Claude API integration MUST use the tool use (function calling) mechanism with
a formally declared `input_schema`. Parsing freeform text output from AI responses (e.g.,
`JSON.parse(content[0].text)`) is prohibited; the response MUST always be extracted from
`content.find(b => b.type === 'tool_use').input`.

The tool contract (name, `input_schema`, required fields, optional fields) MUST be documented
in `specs/<feature>/contracts/ai-prompt-contract.md`. Any change to the tool schema requires
updating the contract document in the same commit.

Prompt caching SHOULD be applied to the system message via `cache_control: { type: 'ephemeral' }`
to reduce latency and cost on repeated calls within the same cache window.

### IV. Typed Error Handling — No Silent Failures

Every distinct failure mode MUST have a dedicated typed error class. Acceptable classes are:
`TimeoutError`, `ApiError`, `NetworkError`, `JsonError`, `ValidationError`. New failure modes
that do not fit existing classes MUST introduce a new named class.

Catch blocks MUST NOT swallow errors silently. Rethrowing, logging, or surfacing to the user
are all acceptable — doing nothing is not.

Every user-facing error MUST surface a human-readable message within 1 second of detection
(per SC-005). Error classes MUST be co-located in `lib/errors/index.js` and imported by
all consumers; defining error classes inline in other modules is prohibited.

### V. Minimal Data Retention

The extension MUST NOT log, cache, or persist user input or linguistic analysis results beyond
the lifetime of the current popup session. No telemetry, no history, no background storage of
user text or translation data.

API keys MUST be stored only in `chrome.storage.local` and MUST NOT appear in console output,
error messages, network request bodies sent to non-Anthropic endpoints, or any logged artifact.

The extension MUST request only the Chrome permissions required for declared functionality:
`storage`, `contextMenus`, `activeTab`, `scripting`, and the `host_permissions` entry for
`https://api.anthropic.com/*`. Adding permissions beyond this set requires a constitution
amendment with explicit justification.

## Development Workflow

- All features MUST begin with a specification (`/speckit-specify`) before implementation.
- Implementation MUST follow the task list in `tasks.md`; ad-hoc changes to unspecified areas
  require a spec or task amendment first.
- Each phase MUST have a named checkpoint; work on the next phase MUST NOT begin until the
  current checkpoint passes manual verification.
- Unit tests for `lib/` modules (especially `analyzer.js` and `lib/errors/`) MUST be written
  or updated alongside the code they cover.
- Each commit SHOULD correspond to a completed task (T-ID) or a logical atomic unit of work.

## Quality Gates

The following gates MUST pass before marking any feature implementation complete:

1. **Security audit**: `grep -r innerHTML popup/ lib/` returns zero matches on user content.
   `grep -r onclick popup/` returns zero matches.
2. **Error coverage**: Every `analyzeText` failure path is caught by a typed error class and
   surfaces a user message. No bare `catch (e) {}` blocks exist in `lib/` or `popup/`.
3. **Contract alignment**: `contracts/ai-prompt-contract.md` reflects the current tool schema
   in `ANALYSIS_TOOL` (field names, required vs optional, types match).
4. **Timeout consistency**: `TIMEOUT_MS` value in `lib/analyzer.js`, FR-013 in `spec.md`, and
   any task checklist items referencing the timeout all agree on the same value.
5. **Permissions minimization**: `manifest.json` permissions list matches exactly the set
   declared in Principle V; no extras present.

## Governance

This constitution supersedes all other project practices and conventions. When a practice
conflicts with a constitution principle, the principle wins.

**Amendments**: Any change to a principle requires:
1. A clear justification documented in the commit message or PR description.
2. A version bump (MAJOR for principle removal/redefinition, MINOR for new principle or
   material expansion, PATCH for wording/clarification).
3. Re-running `/speckit-constitution` to propagate changes to dependent templates.
4. A follow-up pass on `spec.md` and `tasks.md` to check for newly created gaps.

**Compliance review**: Every implementation task that touches `lib/analyzer.js`, `popup/popup.js`,
or `manifest.json` MUST verify compliance with Principles I, III, and V respectively before
the task is marked complete.

**Version**: 1.0.0 | **Ratified**: 2026-05-03 | **Last Amended**: 2026-05-29
