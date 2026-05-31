# AI Prompt Contract Amendment: v3.2

**Version**: 3.2 (amendment to v3.1)
**Date**: 2026-05-30
**Amends**: `specs/002-fix-review-issues/contracts/ai-prompt-contract.md` (v3.1)

---

## Change Summary

The `linguistic_analysis` tool schema is now generated dynamically per call by `buildAnalysisTool(lang, preTranslation)` in `lib/analyzer.js`. The system prompt is also generated dynamically by `buildSystemPrompt(lang, preTranslation)`. All other contract fields (endpoint, headers, model, max_tokens, tool_choice) are **unchanged**.

---

## System Prompt — v3.2 (dynamic)

The system prompt is built by `buildSystemPrompt(lang, preTranslation)`. The base is the v3.1 framing sentence, with conditionals appended:

```
Base:
  "Analyze the input text for language learning using the linguistic_analysis tool.
   Produce a structured word-level breakdown."

If preTranslation is set:
  + "The English translation is already provided as context — do not include a
     translation field in your output. Focus entirely on the word-by-word
     morphological breakdown."

If lang === 'kor':
  + "For Korean, identify attached particles (조사) and verb/adjective endings (어미)
     as specified in the tool schema. Romanization will be generated locally; omit
     it from your output."

If lang === 'jpn':
  + "For Japanese words, provide Hepburn romanization."

If lang === 'cmn':
  + "For Chinese words, provide Pinyin romanization."
```

---

## Tool Schema — v3.2 (conditional)

The `input_schema` shape depends on `lang` and whether `preTranslation` is set.

### Top-level fields

| Field | Type | Required when | Notes |
|-------|------|---------------|-------|
| `translation` | string | `preTranslation` is null | Omitted from schema when DeepL provided the translation |
| `tokens` | array | Always | One entry per input word |

### Token fields

| Field | Type | Required when | Notes |
|-------|------|---------------|-------|
| `word` | string | Always | Exact surface form |
| `lemma` | string | Always | Base/dictionary form |
| `pos` | string | Always | Allowlisted POS tag |
| `meaning` | string | Always | English gloss, ≤5 words |
| `romanization` | string | `lang` is `jpn` or `cmn` | Hepburn (Japanese) or Pinyin (Chinese); absent for Korean (generated locally) |
| `particles` | Particle[] | `lang` is `kor` (optional) | Korean case particles |
| `endings` | Ending[] | `lang` is `kor` (optional) | Korean grammatical endings |

### Particle item fields (Korean only)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `form` | string | Yes | Particle as attached |
| `type` | string | Yes | `topic \| subject \| object \| sentence-end \| other-particle` |
| `meaning` | string | Yes | Brief English explanation |

### Ending item fields (Korean only)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `form` | string | Yes | Ending as attached |
| `type` | string | Yes | `connective \| attributive \| nominal \| concessive \| sentence-final \| other-ending` |
| `meaning` | string | Yes | Brief English explanation |

---

## What changed from v3.1

1. **`translation` field is conditional**: omitted from `input_schema.required` and `input_schema.properties` when DeepL has already provided the translation. Claude does not produce a translation in this case.
2. **`romanization` field is conditional by language**: required for Japanese (Hepburn) and Chinese (Pinyin); absent from the schema for Korean (generated locally by `romanizeKorean()`); absent for Latin/undetermined.
3. **System prompt is dynamic**: framing-only base (v3.1) plus language and translation-context conditionals.
4. **`particles` and `endings` remain Korean-only and optional** — unchanged from v3.0/v3.1.

---

## Post-Response Merge

After the Claude response, the caller patches in the pre-translation if Claude omitted the field:

```js
if (preTranslation && !result.translation) {
  result.translation = preTranslation;
}
```

`validateResponse` then validates `result.translation` — it will always be present after this merge.

---

## Contract Stability Note

Per constitution Principle III: "Any change to the tool schema requires updating the contract document in the same commit." This amendment documents the dynamic schema introduced in `lib/analyzer.js:buildAnalysisTool`. The change to `buildSystemPrompt` is also documented here for completeness.

The v3.2 schema changes must be reflected in the live `lib/analyzer.js` in the same commit that ships this document.
