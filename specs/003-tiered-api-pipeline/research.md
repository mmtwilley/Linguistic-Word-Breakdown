# Research: Tiered API Pipeline

**Branch**: `005-tiered-api-pipeline` | **Date**: 2026-05-30

## Script Detection

**Decision**: Character-count by Unicode block range; dominant count wins.

**Rationale**: No external library fits the no-build-step constraint. Unicode blocks for Hangul (U+AC00–U+D7A3, U+1100–U+11FF, U+3130–U+318F), Hiragana/Katakana (U+3040–U+30FF), CJK Unified Ideographs (U+4E00–U+9FFF), and ASCII Latin (U+0041–U+007A) are stable and well-defined. Kana presence breaks the Japanese/Chinese tie because CJK characters appear in both scripts but Kana is Japan-exclusive.

**Alternatives considered**:
- `langdetect` / `franc` npm packages — rejected: require a build step and add runtime dependencies.
- `Intl.Segmenter` — rejected: segments words/graphemes but does not identify script family.

**Edge cases**: Mixed-script input returns the dominant-count winner. Truly equal counts are broken by `SCRIPT.LAT` as the final fallback (no DeepL call — safe conservative default).

---

## DeepL Free API

**Decision**: POST to `https://api-free.deepl.com/v2/translate` with `application/x-www-form-urlencoded` body and `DeepL-Auth-Key` Authorization header.

**Rationale**: DeepL Free tier uses the `-free.` subdomain (not `api.deepl.com`). `URLSearchParams` encoding is required — the endpoint rejects `application/json`. The `target_lang` is always `EN` because the extension is for English-speaking language learners. Response shape is `{ translations: [{ detected_source_language, text }] }`.

**Key limit**: 500,000 characters/month on the Free tier. Over-limit returns HTTP 456 (Quota Exceeded); the extension catches all non-2xx statuses and falls through to Claude.

**Alternatives considered**:
- DeepL Pro API (`api.deepl.com`) — rejected: different subdomain; user would need a paid account.
- Proxy server — rejected: spec assumption explicitly excludes server-side components.

---

## Korean Romanization

**Decision**: Local syllable-block decomposition implementing Revised Romanization of Korean (국립국어원 표준). Tables for onset (초성), vowel (중성), and coda (종성) extracted from the Korean Language Institute standard.

**Rationale**: Claude is asked not to produce Korean romanization (it wastes tokens and is often inconsistent between requests). Algorithmic romanization of Hangul syllable blocks (U+AC00–U+D7A3) is entirely deterministic and correct — no model inference needed.

**Tradeoff**: Cross-syllable phonetic assimilation rules (연음, 비음화, 경음화, etc.) are not applied. `한국어` becomes `hangugo` rather than `hangugeo`. This is accepted — the output is clear and readable for language learners, and full assimilation requires lookahead over multiple syllables with significant complexity.

**Alternatives considered**:
- Call Claude for romanization — rejected: unnecessary token spend; inconsistent output.
- `hangul-romanize` npm package — rejected: build step required.

---

## Language-Conditional Claude Schema

**Decision**: `buildAnalysisTool(lang, preTranslation)` generates a schema conditioned on script and whether pre-translation exists. Korean romanization is always omitted from the schema (generated locally). Translation field is omitted from the schema when `preTranslation` is truthy.

**Rationale**: Requesting fields Claude doesn't need wastes input and output tokens. A structured `input_schema` declaration drives Claude's output more reliably than system prompt instructions alone.

**Token savings estimate**: Omitting the `translation` field from the schema removes ~20–50 output tokens per analysis (the field description + the translation value itself). For Korean, additionally omitting romanization from the schema removes ~15–30 output tokens per token in the response.

---

## Dual Key Caching Pattern

**Decision**: Both keys cached as a unit in a single `getKeys()` call. `cachedApiKey` acts as the cache sentinel — if it is set, both keys are returned from cache without a storage read.

**Rationale**: Consistent with the single-key caching pattern established in spec 002. Treating both keys as a unit is safe because they are always both read from storage at the same time (single `chrome.storage.local.get` call with both keys). The DeepL key can legitimately be `null` even when the Anthropic key is set — this is correct and expected.
