# Feature Specification: Tiered API Pipeline

**Feature Branch**: `005-tiered-api-pipeline`
**Created**: 2026-05-30
**Status**: Draft
**Input**: User description: "add as optional second API key in settings, fall back to Claude if absent. Also used to reduce token usage"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add DeepL Key in Settings (Priority: P1)

A user who has a DeepL API key opens the extension Settings, finds the optional DeepL API key field below the existing Anthropic key field, enters their key, and saves it. On subsequent opens of Settings, the field confirms a key is saved. The user can also clear the DeepL key at any time without affecting their saved Anthropic key.

**Why this priority**: Without this, no other part of the feature is reachable. It is the entry point for all DeepL-powered behavior and the foundation for the cost-reduction and fallback stories.

**Independent Test**: Can be fully tested by opening Settings, entering a DeepL key, saving, reopening Settings to confirm the key is registered, then clearing it and confirming it is gone — all without submitting any text for analysis.

**Acceptance Scenarios**:

1. **Given** Settings is open and no DeepL key is saved, **When** the user enters a key and clicks Save, **Then** the key is stored and the Settings panel confirms it is configured.
2. **Given** a DeepL key is already saved, **When** the user opens Settings, **Then** the DeepL field indicates a key is on file (without showing the raw key value).
3. **Given** a DeepL key is saved, **When** the user clicks Clear on the DeepL field, **Then** the key is removed and the extension returns to Claude-only mode for all subsequent analyses.
4. **Given** a DeepL key is cleared, **When** the user opens Settings again, **Then** the DeepL field is empty.

---

### User Story 2 - Cost-Reduced Analysis for Non-Latin Text (Priority: P1)

A user with both API keys configured submits Korean (or other non-Latin script) text for analysis. DeepL provides the translation; the AI handles only the linguistic breakdown, omitting the translation task from its work. The user sees the same quality result they always received — translation, word breakdown, romanization, particles — but the AI API cost is lower because the translation field was handled separately.

**Why this priority**: This is the core value proposition of the feature. If this story doesn't work, the DeepL key serves no purpose beyond sitting in storage.

**Independent Test**: Can be fully tested by configuring both keys, submitting Korean text, and confirming: (1) the result contains translation and full linguistic breakdown, and (2) the AI request omitted the translation field from its task (verifiable via the AI request payload in DevTools).

**Acceptance Scenarios**:

1. **Given** both API keys are configured, **When** the user analyzes Korean text, **Then** the result displays translation, word breakdown, romanization, and particle/ending identification — identical quality to before.
2. **Given** both API keys are configured, **When** the user analyzes Korean text, **Then** the AI request payload does not include a translation task (the translation field is omitted from the AI schema).
3. **Given** both API keys are configured, **When** the user analyzes Chinese or Japanese text, **Then** the same tiered behavior applies — DeepL translates, AI handles the rest.

---

### User Story 3 - Graceful Fallback When DeepL is Unavailable (Priority: P2)

A user submits text for analysis, but either no DeepL key is configured or the DeepL service returns an error. The analysis completes normally — the AI provides the full result including translation — and the user sees no indication that anything fell back. The experience is identical to using the extension without a DeepL key.

**Why this priority**: The fallback guarantees that configuring a DeepL key can never make the extension worse. Users should never see a degraded result due to a DeepL failure.

**Independent Test**: Can be fully tested in two ways: (1) submit non-Latin text with no DeepL key configured and confirm the full result appears; (2) configure an invalid DeepL key, submit text, and confirm the full result still appears with no error message about DeepL.

**Acceptance Scenarios**:

1. **Given** no DeepL key is configured, **When** the user analyzes Korean text, **Then** the AI provides the complete result including translation — identical to the current extension behavior.
2. **Given** a DeepL key is configured but the DeepL service returns an error (network failure, invalid key, rate limit exceeded), **When** the user analyzes text, **Then** the analysis still completes successfully and no DeepL-specific error is shown to the user.
3. **Given** a DeepL key is configured and the DeepL free-tier character limit is exceeded, **When** the user analyzes text, **Then** the analysis completes via AI fallback — the user sees the result, not a limit error.

---

### User Story 4 - Latin Text Unaffected (Priority: P3)

A user analyzes English, Spanish, French, or other Latin-script text. Whether or not a DeepL key is configured, the analysis runs exactly as before — DeepL is not called, and the AI handles the full breakdown. The user sees no difference.

**Why this priority**: Latin-script analysis is the baseline behavior. This story protects existing users from any regression introduced by the new feature.

**Independent Test**: Can be fully tested by configuring a DeepL key, then analyzing English text and confirming the AI request payload is identical to the pre-feature behavior (full schema, no pre-translation step).

**Acceptance Scenarios**:

1. **Given** a DeepL key is configured, **When** the user analyzes English text, **Then** the result is identical to submitting the same text without a DeepL key.
2. **Given** a DeepL key is configured, **When** the user analyzes Latin-script text of any language, **Then** no DeepL call is made and the AI receives the full analysis schema.

---

### Edge Cases

- What if the DeepL free-tier monthly character limit is reached mid-session? The call fails silently and the AI handles the full analysis for that request — no user-visible change.
- What if the user saves a new DeepL key while an analysis is already in progress? The in-flight request uses the key it started with; the new key applies to all subsequent requests.
- What if DeepL returns a translation but the AI subsequently fails to return a valid response? The extension handles this via the existing AI error path — the DeepL translation is discarded and the error is surfaced normally.
- What if the input contains mixed script (e.g., Korean words interspersed with English)? Script detection identifies the dominant script; if non-Latin, the DeepL path is attempted.
- What if the user clears the DeepL key while Settings is open in another window? The next analysis request re-reads from storage; the in-memory cache is invalidated on save or clear.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Settings panel MUST include an optional DeepL API key input field with independent Save and Clear actions, visually separate from the Anthropic API key field.
- **FR-002**: The DeepL API key MUST be stored in browser local storage and MUST NOT appear in console output, error messages, network request bodies sent to non-DeepL endpoints, or any logged artifact.
- **FR-003**: The extension MUST automatically detect the script type (Latin, Korean, Chinese, Japanese, or undetermined) of input text before deciding whether to invoke DeepL.
- **FR-004**: When a DeepL key is present and input text is classified as non-Latin script, the extension MUST attempt a DeepL translation call before submitting to the AI.
- **FR-005**: When a DeepL translation succeeds, the AI request MUST use a schema that omits the translation field, relying on the DeepL-sourced translation instead.
- **FR-006**: When no DeepL key is present, or when the DeepL call fails for any reason (network error, authentication failure, rate limit, malformed response), the extension MUST fall back to a full AI analysis request that includes the translation field — with no user-visible indication of the DeepL failure.
- **FR-007**: Input text classified as Latin script MUST NOT trigger a DeepL call, regardless of whether a DeepL key is configured.
- **FR-008**: The DeepL API key MUST be cached in memory for the session after the first successful read from storage, following the same pattern as the Anthropic API key cache.

### Key Entities

- **DeepL API Key**: An optional credential stored in browser local storage. Retrieved once per session and held in memory. Never logged or exposed. Independent of the Anthropic API key — saving or clearing one does not affect the other.
- **Script Type**: A classification of input text (Latin, Korean, Chinese, Japanese, or undetermined) derived from Unicode character analysis. Determines whether the DeepL path is taken.
- **Analysis Pipeline**: The ordered execution sequence — detect script → optionally translate with DeepL → submit to AI with a schema conditioned on whether pre-translation succeeded.
- **Pre-Translation**: A translation result from DeepL injected into the final response as the translation field, allowing the AI request to omit translation from its task.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with both API keys configured who analyzes non-Latin text receives a result containing all expected fields — `translation`, `tokens` (each with `word`, `lemma`, `pos`, `meaning`), and for Korean input `romanization` on each token — with no error shown, verifiable by inspection of the rendered result.
- **SC-002**: When a DeepL key is configured and a non-Latin analysis succeeds via DeepL, the AI request payload does not contain a translation field — confirmed by inspection of the outbound request in DevTools.
- **SC-003**: A DeepL call failure of any kind (network error, expired key, rate limit) produces no user-visible error message related to DeepL — the analysis completes within normal response time.
- **SC-004**: A user can add, update, and remove the DeepL API key in Settings without any effect on their saved Anthropic API key.
- **SC-005**: For Latin-script input, the AI request tool schema includes `translation` in `required` and omits `romanization`, `particles`, and `endings` — regardless of whether a DeepL key is configured — verifiable by inspection of the outbound request payload in DevTools or by unit assertion on the schema shape.

## Assumptions

- DeepL Free tier API is called directly from the extension without a server-side proxy; this means a new host permission for the DeepL API endpoint is required.
- The DeepL key is always optional — users without one experience no degradation in functionality or quality.
- Script detection is performed locally using Unicode character range analysis, with no external service call.
- The DeepL key field in Settings is a separate UI element from the Anthropic key field; saving or clearing one has no effect on the other.
- The tiered pipeline applies both to the popup analysis flow and to the right-click context menu flow, since both invoke the same underlying analysis function.
- Token reduction is achieved by omitting the translation field from the AI schema when DeepL succeeds; no other token optimizations are in scope for this feature.
- If the DeepL translation is an empty string or whitespace, it is treated as a failed translation and the AI fallback applies.
