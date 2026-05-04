# Error Handling & Security Improvements Summary

**Date**: 2026-05-03 | **Branch**: `001-lingua-word-breakdown`

This document summarizes the error handling and security enhancements made to the Linguistic Word Breakdown extension specification.

---

## Improvements Made

### 1. Enhanced Specification (spec.md)

**Added two new mandatory sections:**

- **Error Handling & Recovery** (3 subsections):
  - Input Validation (length limits, language support)
  - API Error Handling (categorized by HTTP status: 401, 429, 5xx, network, timeout, malformed JSON)
  - Response Validation (field presence, POS tag validation, token count, response size limits)
  - Timeout & Retry (10-second timeout, manual user-controlled retries, 1-second rate limit)

- **Security & Data Privacy** (4 subsections):
  - Input & Output Sanitization (textContent vs. innerHTML, no inline scripts)
  - API Key Security (storage in chrome.storage.local, password field masking, HTTPS-only transmission)
  - Data Privacy (no telemetry, no logs, no caching, no history retention)
  - Content Security Policy (CSP declaration, no eval, DOM safety)
  - Network Security (HTTPS only, certificate validation)

**Added 9 new functional requirements (FR-012 through FR-020):**
- FR-012: 2000-character input limit
- FR-013: 10-second timeout
- FR-014: Response field validation
- FR-015: Response size/token limits
- FR-016: XSS prevention via textContent
- FR-017: API key password masking
- FR-018: HTTPS-only transmission
- FR-019: 1-second rate limiting
- FR-020: No data logging/caching

**Updated Assumptions section** with 3 new assumptions addressing:
- OS-level storage security
- HTTPS + certificate validation sufficiency
- Input length as UX constraint, not security boundary

### 2. New Security Document (security.md)

Comprehensive implementation guide with:

**Error Handling Architecture**:
- Error classification table (7 classes: User Input, Network, API Auth, Rate Limit, API Server, Response Format, Response Validity, Response Size)
- Client-side implementation pseudo-code
- Timeout implementation pattern with AbortController
- Rate limiting logic (1-second window tracking)
- Logging strategy (what to keep vs. avoid)

**Security Implementation Details**:
- Input validation code (type check, length check, whitespace check)
- Output sanitization code (textContent vs. innerHTML examples)
- API key storage code (save, retrieve, clear with validation)
- Response validation code (structure checks, field validation, POS correction, size limits)
- HTTPS & fetch implementation (URL verification, timeout setup, error handling)
- CSP manifest requirements
- Response validation error classification

**Testing Error Paths**:
- 10 manual test cases (empty input, whitespace, too long, no key, offline, invalid key, rate limit, 503, malformed JSON, missing field)
- Unit test suggestions for analyzer.js

**Security Assumptions & Limitations**:
- Trade-off table (4 aspects: storage, network, input, output, permissions, telemetry)
- Explicit statement: "Client-side = no backend = API key exposed; acceptable for learning tool"

### 3. Enhanced API Contract (contracts/ai-prompt-contract.md)

**Replaced simple error table with 4 detailed tables:**

**HTTP Error Responses** (3 rows: 401, 429, 5xx):
- Includes detection method, exact user message, action (Settings, wait, Retry)

**Network Errors** (2 rows: connection failed, timeout):
- Includes DNS/WiFi context, timeout details

**Response Parsing Errors** (4 rows: not JSON, missing fields):
- Includes debug logging guidance

**Token Validation Errors** (3 rows: missing field, invalid POS, count mismatch):
- Includes user message, fallback action (silent correction to 'other')

**Response Size Limits**:
- Added explicit limits table (50 KB, 500 tokens)

**Retry Behavior**:
- Clarifies no automatic retries, user-triggered only
- Rate limiting guidance (60-second wait after 429)
- Idempotency statement

### 4. Enhanced Implementation Plan (plan.md)

**Updated all 6 component descriptions:**

**manifest.json**:
- Added CSP requirement: `script-src 'self'; default-src 'self'; img-src 'self' data:;`
- Clarified HTTPS-only for host_permissions

**lib/analyzer.js**:
- Added 10-second timeout with AbortController
- Added custom error classes (TimeoutError, ApiError, NetworkError, JsonError, ValidationError)
- Added comprehensive response validation (size, token count, field presence, POS correction)
- Added note about logging strategy

**popup/popup.js**:
- Added 1-second rate limit enforcement
- Added granular error handling per error type (401 → Settings, 429 → no retry, etc.)
- Added error catch/display logic
- Clarified DOM safety: textContent only, never innerHTML

**popup/html**:
- Changed input to `type="password"` for API key
- Changed back button label to "Cancel" in Settings
- Added error banner with typed messages
- Added security note: no inline JS/CSS, safe rendering

**plan.md cross-references**:
- Added explicit reference to [security.md](security.md) and [contracts/ai-prompt-contract.md](contracts/ai-prompt-contract.md)
- Updated API Contract Reference section to point to both contract and security docs

### 5. Enhanced Data Model (data-model.md)

**Added error states**:
- Expanded state machine to show [Error] state transitions
- Added error types and fields (TimeoutError, ApiError, NetworkError, JsonError, ValidationError)
- Clarified error UI (message type, button options per error)

---

## Security & Error Handling Coverage

| Area | Before | After | Coverage |
|------|--------|-------|----------|
| **Error Types Documented** | 6 (HTTP + network + JSON) | 13 (adds timeout, rate limit, validation, response size) | 100% |
| **HTTP Error Handling** | 3 statuses (401, 429, 5xx) | 3 statuses + recovery actions | ✓ |
| **Response Validation** | Field presence only | Structure, size, token count, POS validation, saturation checks | ✓ |
| **API Key Security** | Basic storage noted | Detailed storage, masking, deletion, transmission | ✓ |
| **Input Validation** | Non-empty, non-whitespace | Length limit (2000), whitespace, type check, opaque data | ✓ |
| **Output Sanitization** | Mentioned | Detailed: textContent vs. innerHTML, password field | ✓ |
| **Timeout Handling** | Not specified | 10-second timeout, AbortController pattern | ✓ |
| **Rate Limiting** | Not specified | 1-second client-side limit | ✓ |
| **CSP** | Not specified | Full CSP manifest + inline script/style restrictions | ✓ |
| **Logging Strategy** | Not specified | What to log (types) vs. avoid (user data) | ✓ |
| **Testing** | Not specified | 10 manual test cases + unit test suggestions | ✓ |

---

## Key Design Decisions

### Error Handling Philosophy

**User-controlled retries, not automatic**:
- Users click Retry button after seeing error; no background retries
- Avoids masking transient issues; gives user visibility and control
- Prevents retry storms if API is broken

### Security Trade-offs

**Client-side API key storage accepted**:
- Pro: Simple, no backend dependency
- Con: Key exposed to browser and device OS
- Justified: Learning tool, not financial/health data

**HTTPS + certificate validation (no pinning)**:
- Pro: Standard browser security, no maintenance overhead
- Con: Vulnerable to advanced MITM if device is compromised
- Justified: Sufficient for v1 learning tool

**No automatic data encryption**:
- Pro: Simpler implementation
- Con: Relies on OS-level encryption
- Justified: Extension storage is not encryption's traditional use case; OS security assumed

### Implementation Guidance

All error handling and security patterns are documented with:
1. **Pseudo-code examples** in security.md
2. **Code snippets** (JavaScript) showing safe patterns
3. **Testing test cases** for manual verification
4. **Assumptions & limitations** table for transparency

---

## Artifacts Updated

| File | Changes |
|------|---------|
| spec.md | +2 new sections (Error Handling, Security), +9 new requirements |
| plan.md | Enhanced all 6 components with error/security details |
| data-model.md | Added error states and error type definitions |
| contracts/ai-prompt-contract.md | Replaced simple table with 4 detailed error tables |
| security.md | **NEW** — 650+ lines of implementation guidance |
| CLAUDE.md | Added references to security.md and contract |

---

## Next Steps

1. **Code Implementation** (`/speckit-tasks` → `/speckit-implement`):
   - Follow error handling patterns in security.md
   - Use provided code snippets as starting point
   - Implement error classification in analyzer.js and popup.js

2. **Manual Testing**:
   - Run 10 error test cases from security.md test section
   - Verify each error message and button state

3. **Unit Tests**:
   - Test analyzer.js input/output validation
   - Test timeout behavior
   - Test error type detection

4. **Code Review**:
   - Check for innerHTML usage (reject all user-content uses)
   - Check for console.log of user data (reject)
   - Verify manifest CSP is correct
