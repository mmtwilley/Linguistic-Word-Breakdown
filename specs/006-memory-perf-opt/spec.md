# Feature Specification: Streaming & History Memory Optimization

**Feature Branch**: `006-memory-perf-opt`  
**Created**: 2026-05-31  
**Status**: Draft  
**Input**: User description: "improve memory and performance issues in streaming and history storage"

## Clarifications

### Session 2026-05-31

- Q: What failure scenarios must each user story cover? → A: Stream disconnection after translation is rendered must clear partial result and show error; special characters in translation must render without corruption; unknown-version history entries must be skipped gracefully; storage write failure must not affect analysis display (logged silently); malformed cache entry must fall through to fresh analysis.
- Q: What NFRs are required beyond the success criteria? → A: Popup must be interactive within 300ms regardless of history size; history loading must not block main view; an active stream must be aborted if the popup closes; history store must remain performant after 6+ months of daily use.
- Q: What are the explicit field schemas for AnalysisEntry and CompactToken? → A: AnalysisEntry has id (compact string), version (number, currently 1), ts (Unix ms), lang (ISO 639-3), input (cache key), snippet (first 60 chars), translation, tokens. CompactToken is an 8-position tuple: word, lemma, pos, meaning, romanization (empty string if absent), pronunciation (empty string if absent), particles ([form, type, meaning][] or null), endings ([form, type, meaning][] or null).
- Q: How should each success criterion be verified? → A: SC-001 by timing stream start to translation render; SC-002 by timing cache lookup to result display; SC-003 by measuring storage bytes after 75 entries; SC-004 by timing history tab activation to first 10 rows visible.
- Q: What is the execution order when cache, streaming, and history interact? → A: Cache checked first — hit renders immediately with no loading state, streaming does not run; miss starts streaming with early translation emission, result stored on completion. History entry restore follows the same path as a cache hit: immediate render, no network request, no loading state.
- Q: What happens to existing entries when the extension updates with a new schema version? → A: Entries with unrecognized version numbers are silently skipped and excluded from history display; no error is surfaced; entries are retained in storage until normal eviction removes them.
- Q: What is the explicit scope boundary? → A: In scope: streaming translation extraction, unified history/cache store, compact storage format, lazy history rendering, stream abort on popup close. Out of scope: external translation API integration, client-side romanization, language detection routing, audio pronunciation.

## Scope

### In Scope

- Early translation extraction from the analysis stream, displayed before token breakdown completes
- Unified local store serving both cache lookup and history display (single store, no duplication)
- Compact entry storage format reducing per-entry footprint by at least 30%
- Lazy (paginated) history rendering — first 10 entries on open, more on demand
- Automatic stream abort when the popup closes mid-analysis
- Storage quota enforcement with LRU eviction at 75-entry cap and 4MB byte ceiling

### Out of Scope

- External translation API integration (DeepL and similar services)
- Client-side romanization algorithm implementation
- Language detection routing logic
- Audio pronunciation playback
- Migration of history entries written by previous schema versions

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See Translation Before Full Analysis Completes (Priority: P1)

A user submits text for analysis. Rather than waiting for the full word-by-word breakdown to finish, the translation of the whole phrase appears almost immediately — within a second of submitting. The detailed token analysis fills in after.

**Why this priority**: Translation is the first thing users want confirmed. Delivering it early makes the extension feel fast even when the full analysis takes several seconds. This is the single highest-impact perceived performance improvement.

**Independent Test**: Can be fully tested by submitting any non-Latin text and verifying the translation appears before the token cards render.

**Acceptance Scenarios**:

1. **Given** a user submits a 10-word Japanese sentence, **When** the analysis begins, **Then** the full translation is displayed within 1 second, before any word tokens appear
2. **Given** a user submits text, **When** the incoming data exceeds the maximum allowed response size, **Then** an error message is shown immediately and no partial result is displayed
3. **Given** a user submits Latin-script text, **When** analysis runs, **Then** results appear in full upon completion (no early partial display needed)
4. **Given** a stream starts and the translation has already been displayed, **When** the connection drops mid-stream, **Then** the partial translation is cleared and an error message is shown — no incomplete result is left visible on screen
5. **Given** the analysis response contains special characters (escaped quotes or unicode sequences), **When** the translation is extracted from the stream, **Then** it renders correctly without corruption or garbled characters

---

### User Story 2 - History Stays Fast and Within Device Storage Limits (Priority: P2)

A user browses their analysis history after having analyzed dozens of sentences over time. The history tab opens quickly, entries are browsable without lag, and storage usage does not grow unboundedly — older entries are removed automatically when limits approach.

**Why this priority**: Without storage discipline, the extension will hit the device's local storage quota and stop working entirely. This is a correctness issue as much as a performance one.

**Independent Test**: Can be fully tested by filling history to 75+ entries and verifying the tab loads without lag, storage stays within limits, and oldest entries are removed when the quota ceiling is approached.

**Acceptance Scenarios**:

1. **Given** a user has 75 history entries, **When** they open the history tab, **Then** the first 10 entries render immediately and remaining entries load on demand as the user scrolls
2. **Given** a user analyzes the same text twice, **When** the second analysis completes, **Then** only one history entry for that text exists, with its timestamp updated to the most recent analysis
3. **Given** total stored history approaches the device storage limit, **When** a new entry is saved, **Then** the oldest entries are automatically removed to stay within the safe storage ceiling
4. **Given** a user has 50 history entries, **When** they click a history entry, **Then** the full analysis result is restored to the main view without making a new network request
5. **Given** a history entry was written by a newer version of the extension with unknown fields, **When** it is read back, **Then** it is silently skipped and excluded from the rendered history list — no error is shown
6. **Given** local storage write fails despite the pre-write quota check, **When** the write fails, **Then** the analysis result is still displayed to the user and the failure is logged silently — it is not surfaced as an analysis error

---

### User Story 3 - Previously Analyzed Text Loads Instantly (Priority: P3)

A user re-submits text they have analyzed before. Instead of waiting for a full network round-trip, the cached result appears instantly from local storage.

**Why this priority**: Cache hits eliminate the most expensive operation (remote API call). Combined with unified storage (cache and history are the same data), this also removes the overhead of maintaining two separate stores.

**Independent Test**: Can be fully tested by submitting identical text twice and confirming the second submission displays results without a network call and in under 200ms.

**Acceptance Scenarios**:

1. **Given** a user has previously analyzed "나는 학교에 갔다", **When** they submit the same text again, **Then** the result appears within 200ms with no outgoing network request
2. **Given** the cache contains a result for normalized input text, **When** a user submits the same text with leading/trailing whitespace, **Then** the cached result is returned (whitespace is normalized before lookup)
3. **Given** the cache is empty, **When** a user submits new text, **Then** the full analysis runs and the result is stored for future cache hits
4. **Given** a cache entry exists but its stored token data is malformed or unreadable, **When** it is read back, **Then** a fresh analysis is performed rather than rendering broken word cards

---

### Edge Cases

- When the response stream exceeds the maximum allowed size, it is aborted and an error is shown; any translation already displayed is cleared
- History entries with an unrecognized schema version are silently skipped during render and not surfaced as errors
- When storage cannot be written even after trimming (e.g., a single oversized entry), the write is skipped; the analysis result is shown for the current session only
- Tokens with absent optional fields store an empty string for romanization and pronunciation, and `null` for particles and endings, preserving the fixed tuple structure
- When the user reaches the end of the history list, the load-more control is hidden

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display the full-text translation as soon as it is extractable from the incoming analysis stream, before the complete token breakdown is available
- **FR-002**: System MUST enforce a hard limit on the total size of incoming analysis data per request and abort with a user-facing error if the limit is exceeded
- **FR-003**: System MUST store each history entry in a compact format that reduces per-entry storage size by at least 30% compared to the current storage representation
- **FR-004**: System MUST cap history at a maximum of 75 entries, evicting the oldest entries when the cap is exceeded
- **FR-005**: System MUST check actual storage byte usage before each write and perform an aggressive trim if usage approaches the device storage ceiling (4MB)
- **FR-006**: System MUST deduplicate history entries by input text: re-analyzing identical text updates the existing entry's timestamp and moves it to the front rather than creating a duplicate
- **FR-007**: System MUST serve analysis results for previously analyzed input text from local cache without making a remote network request
- **FR-008**: Cache lookup MUST normalize input text (trim whitespace) before matching
- **FR-009**: System MUST use a single unified local store that serves both cache lookup and history display — no separate cache and history stores
- **FR-010**: History UI MUST render entries incrementally: display the first 10 entries on open and load additional entries on user demand (scroll or explicit action)
- **FR-011**: Clicking a history entry MUST restore the full analysis result to the main view without triggering a new network request
- **FR-012**: History store MUST remain readable and performant after 6 months of daily use without any manual intervention or maintenance action by the user
- **FR-013**: The extension popup MUST become interactive within 300ms of opening regardless of history entry count; history data loading MUST NOT block the main view from rendering
- **FR-014**: If the user closes the popup while an analysis stream is in progress, the stream MUST be immediately aborted and no further display updates MUST be attempted

### Analysis Execution Order

When a user submits text for analysis, the system follows this fixed priority order:

1. Normalize the input text (trim whitespace)
2. Check the unified store for a matching entry → if found, render result immediately with no loading state and stop; streaming does not run
3. If no match, start streaming analysis → emit translation as soon as extractable from the stream → on stream completion, store the full result → render complete token cards
4. Clicking a history entry follows the same render path as a cache hit: result displays immediately with no loading state and no network request

### Version Migration Behavior

When reading entries from the unified store, any entry with an unrecognized `version` value MUST be silently skipped and excluded from history display. No error is surfaced to the user. The entry is retained in storage and removed only when normal LRU eviction applies.

### Key Entities

#### AnalysisEntry

A unified record that serves as both a cache lookup entry and a history display item.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Compact unique identifier (e.g. base-36 timestamp) |
| version | number | Schema version; currently `1`; used to detect incompatible entries |
| ts | number | Unix millisecond timestamp of most recent analysis for this input |
| lang | string | ISO 639-3 language code (e.g. `kor`, `jpn`, `lat`) |
| input | string | Full normalized input text; primary cache lookup key |
| snippet | string | First 60 characters of input text; used for history list preview |
| translation | string | Full translation of the input text |
| tokens | CompactToken[] | Ordered list of compressed token representations |

#### CompactToken

A fixed-position tuple storing one linguistic token. Position order is stable for the lifetime of schema version 1 and must not change.

| Position | Field | Type | When absent |
|----------|-------|------|-------------|
| 0 | word | string | always present |
| 1 | lemma | string | always present |
| 2 | pos | string | always present |
| 3 | meaning | string | always present |
| 4 | romanization | string | empty string `""` |
| 5 | pronunciation | string | empty string `""` |
| 6 | particles | [form, type, meaning][] | `null` |
| 7 | endings | [form, type, meaning][] | `null` |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Translation text is visible to the user within 1 second of submitting non-Latin text for analysis — *verified by: timing from analysis submission to translation first render*
- **SC-002**: A cache hit for previously analyzed text returns results within 200ms with no outgoing network request — *verified by: timing from submission to result display on second identical input*
- **SC-003**: Total local storage used by history remains under 1MB for 75 fully populated entries — *verified by: measuring storage bytes in use after filling history to 75 entries*
- **SC-004**: The history tab renders its initial view (first 10 entries) in under 300ms regardless of total entry count — *verified by: timing from history tab activation to first 10 rows visible in the list*
- **SC-005**: Total extension local storage footprint stays under 1MB for a typical usage pattern of 100 analyses — *verified by: measuring total storage bytes in use after 100 distinct analyses*
- **SC-006**: No analysis result is lost or corrupted due to a storage quota error under normal usage (up to 75 entries) — *verified by: confirming result is displayed to user even when the underlying storage write fails*

## Assumptions

- Device local storage quota for the extension is 5MB; the 4MB write ceiling is a safety margin to account for other stored data (API key, settings)
- The 75-entry history cap is appropriate for typical users; power users who exceed this will lose oldest entries by design
- Streaming optimization applies to the primary linguistic analysis call only; the optional pre-translation step is not streamed
- Entries with schema `version` values other than `1` are silently skipped; no migration of legacy entries is performed
- History and cache are always in sync: there is no scenario where a cached result exists but no history entry does, or vice versa
- Lazy loading threshold of 10 initial entries is appropriate for the extension popup viewport size
