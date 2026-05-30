# Feature Specification: Code Review Fixes

**Feature Branch**: `002-fix-review-issues`
**Created**: 2026-05-30
**Status**: Draft
**Input**: User description: "Fix issues from code review: 1. API key passed through chrome.scripting.executeScript args (security). 2. linguaRenderOverlay double-inject race condition. 3. validateInput called twice. 4. Token card rendering duplicated between popup and service worker. 5. tokensGrid.textContent = '' should use replaceChildren(). 6. Rate limit lastSubmitTime set after call instead of before. 7. MAX_RESPONSE_BYTES check re-serializes full response. 8. System prompt and tool schema describe particles/endings rules redundantly. 9. chrome.storage.local.get called on every analysis — no in-memory cache. 10. Missing aria-live region on results div. 11. cancelBtn does not clear partial API key input."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - API Key Stays Private (Priority: P1)

A user analyzes selected text via the right-click context menu. Their Anthropic API key is retrieved from local browser storage within the extension's background process and used to call the API — the key never appears in Chrome DevTools, extension debugging panels, or any other browser-accessible surface during this flow.

**Why this priority**: The API key is a credential that grants billable access to the user's Anthropic account. Exposing it in devtools creates a real risk of theft for anyone who shares their screen or steps away from an unlocked machine.

**Independent Test**: Can be fully tested by opening DevTools, triggering a right-click analysis, and confirming the API key does not appear in the Sources, Network, or Console panels. Delivers the security guarantee independently of all other fixes.

**Acceptance Scenarios**:

1. **Given** a user has saved their API key in Settings, **When** they right-click selected text and choose "Lingua: Analyze", **Then** the API key is not visible in Chrome DevTools at any point during the request.
2. **Given** the extension service worker is inspected via `chrome://serviceworker-internals`, **When** an analysis is triggered via the context menu, **Then** the raw API key string does not appear in any logged message or script argument.

---

### User Story 2 - Overlay Behaves Predictably (Priority: P1)

A user right-clicks to analyze text on a webpage. While the loading spinner is showing, they click the close button to dismiss the panel. The panel disappears and does not reappear when the response arrives. Separately, if a user triggers analysis twice in quick succession on the same tab, only one request runs and one overlay appears.

**Why this priority**: A panel that reappears after being dismissed, or two overlapping panels on the same page, are confusing and feel broken — they undermine trust in the extension.

**Independent Test**: Can be fully tested by (1) triggering analysis, immediately closing the spinner panel, and confirming no result panel appears; (2) triggering analysis twice rapidly on the same tab and confirming only one overlay appears.

**Acceptance Scenarios**:

1. **Given** the loading overlay is showing on a page, **When** the user clicks the close button, **Then** the panel is removed and does not reappear when the API response arrives.
2. **Given** an analysis is already in progress for a tab, **When** the user triggers analysis again on the same tab, **Then** only one overlay is shown and only one API request is made.

---

### User Story 3 - Retry Respects Rate Limit (Priority: P2)

A user clicks Analyze and immediately clicks Retry (before the first response returns). The second submission is held to the same 1-second cooldown as any other submission — it does not bypass the gate simply because it was triggered via the Retry button during an in-flight request.

**Why this priority**: The rate limit exists to prevent runaway API charges. A bypass via Retry undermines that protection and can cause duplicate charges.

**Independent Test**: Can be fully tested by clicking Analyze and immediately clicking Retry, then confirming only one API request is fired within the cooldown window.

**Acceptance Scenarios**:

1. **Given** the user clicks Analyze, **When** they immediately click Retry before 1 second has passed, **Then** the second request is blocked and a "please wait" message is shown.
2. **Given** the user clicks Analyze and waits 1 second, **When** they click Retry, **Then** the request proceeds normally.

---

### User Story 4 - Screen Readers Announce Results (Priority: P2)

A user who relies on a screen reader submits text for analysis. When the results appear in the popup, their screen reader automatically announces that new content is available — they do not need to manually navigate to find the results section.

**Why this priority**: Without automatic announcement, screen reader users have no way to know when the analysis is complete, making the extension effectively unusable for them.

**Independent Test**: Can be fully tested by enabling a screen reader (e.g., NVDA, JAWS, or VoiceOver), submitting an analysis, and confirming an announcement is made when results appear.

**Acceptance Scenarios**:

1. **Given** a screen reader is active, **When** analysis results are rendered in the popup, **Then** the screen reader announces the results region without the user navigating to it.
2. **Given** a screen reader is active, **When** an error message appears, **Then** the screen reader announces the error.

---

### User Story 5 - Settings Cancel Clears Input (Priority: P3)

A user opens the Settings panel, starts typing an API key, then changes their mind and clicks Cancel. The API key input field is empty when they return to Settings next time — the partial key is not retained.

**Why this priority**: Leaving a partial or incorrect key visible in the input field on the next Settings open is confusing and could lead users to save an incomplete key by mistake.

**Independent Test**: Can be fully tested by opening Settings, typing partial text in the key field, clicking Cancel, reopening Settings, and confirming the field is empty.

**Acceptance Scenarios**:

1. **Given** the user has typed text into the API key field, **When** they click Cancel, **Then** the API key input is cleared.
2. **Given** the user has saved a valid key and opens Settings again, **When** they click Cancel without typing anything, **Then** the input remains empty (saved key is in storage, not pre-populated in the field).

---

### Edge Cases

- What happens if the user's browser storage becomes unavailable mid-session? The in-memory key cache should fall back to re-reading from storage gracefully.
- What if the user saves a new key while an analysis is in progress? The in-flight request should use the key it already retrieved; subsequent requests use the new cached value.
- What if analysis is triggered on a Chrome-internal page (e.g., `chrome://settings`)? The overlay injection should fail gracefully without crashing the service worker.
- What if the screen reader announcement fires while the previous announcement is still being read? The live region should queue the new announcement rather than cutting off the previous one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST retrieve the user's API key from browser storage within the service worker context and use it directly, without passing it as a serialized argument to injected scripts.
- **FR-002**: When the user dismisses the page overlay while a right-click analysis is loading, the overlay MUST remain dismissed when the response arrives — no result panel may appear afterward.
- **FR-003**: When a right-click analysis is already in progress for a tab, any additional analysis trigger on that same tab MUST be ignored until the current one completes.
- **FR-004**: Input text validation MUST occur exactly once per analysis submission.
- **FR-005**: Token card rendering logic MUST be defined canonically in `lib/renderer.js` and used by the popup view; due to the MV3 injection constraint (injected functions cannot import ES modules), the page overlay MUST maintain a synchronized copy of the same logic in `service-worker.js`.
- **FR-006**: The popup's results container MUST be cleared using an explicit, unambiguous DOM method.
- **FR-007**: The rate-limit cooldown MUST begin counting from the moment the user submits an analysis request, not from when a response is received.
- **FR-008**: Response size validation MUST NOT re-serialize the full API response object on each check; it MUST use a more efficient approach.
- **FR-009**: Analysis prompt instructions and tool schema field descriptions MUST NOT duplicate the same rules; each rule MUST have a single authoritative location.
- **FR-010**: The user's API key MUST be cached in memory after the first successful read from browser storage; subsequent analysis requests within the same session MUST use the cached value unless the user saves a new key.
- **FR-011**: When analysis results appear in the popup, the results region MUST be marked so that assistive technologies announce new content automatically.
- **FR-012**: Clicking Cancel in the Settings panel MUST clear the API key input field.

### Key Entities

- **API Key**: A credential string stored in local browser storage, read once and held in memory for the session. Invalidated in cache when the user saves a new key.
- **Analysis Request**: A single submission of text for linguistic breakdown. Has a tab-scoped in-progress state (for context menu) and a session-scoped rate-limit timestamp (for popup).
- **Page Overlay**: A Shadow DOM panel injected into a webpage to display analysis results from a right-click trigger. Has a dismissed/active state that must survive the async response.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user's API key is not visible in Chrome DevTools (Network, Sources, or Console tabs) at any point during a right-click analysis.
- **SC-002**: Zero duplicate page overlays appear when right-click analysis is triggered twice in rapid succession on the same tab.
- **SC-003**: Dismissing the loading overlay while an analysis is in progress results in no result panel appearing — verified in 100% of test attempts.
- **SC-004**: Clicking Analyze and immediately clicking Retry results in exactly one API request being sent within the 1-second cooldown window.
- **SC-005**: A screen reader announces the results region within 1 second of results appearing in the popup, without the user navigating to the results.
- **SC-006**: The API key input field is empty every time the Settings panel is opened after a Cancel action.
- **SC-007**: All 12 functional requirements have a passing test or manual verification step documented in the testing checklist.

## Assumptions

- All fixes are scoped to the existing Chrome Manifest V3 extension — no backend proxy service will be introduced.
- The API key security fix is achieved by keeping the key within the service worker context rather than passing it via scripting arguments; this does not require architectural changes outside the service worker.
- A shared token card rendering module can be imported by the popup directly; for the injected page overlay (which cannot use ES module imports), the render logic will be inlined at build time or serialized as a self-contained function.
- The in-memory API key cache is process-scoped to the service worker instance; it is automatically cleared when the service worker is terminated and restarted by Chrome, which is acceptable behavior.
- The aria-live region improvement targets the popup only (not the page overlay); the overlay is a secondary surface used by fewer users and can be addressed separately.
- Removing prompt/schema duplication does not change the quality of Claude's analysis output — the tool schema field descriptions alone are sufficient to guide structured output.
