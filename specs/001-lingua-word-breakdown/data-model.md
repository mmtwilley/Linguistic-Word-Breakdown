# Data Model: Linguistic Word Breakdown

**Branch**: `001-lingua-word-breakdown` | **Date**: 2026-05-03

---

## Entities

### AnalysisRequest

Represents the user's submitted input.

| Field   | Type   | Constraints                          |
|---------|--------|--------------------------------------|
| `text`  | string | Non-empty, non-whitespace-only; max 2000 chars (UI-enforced) |

**Validation rules**:
- Must not be empty or contain only whitespace — rejected client-side with prompt to user.
- No language constraint — any natural language is accepted.

---

### Token

Represents one word from the input with its linguistic properties.

| Field     | Type   | Constraints                                                              |
|-----------|--------|--------------------------------------------------------------------------|
| `word`    | string | Exact surface form from input; non-empty                                 |
| `lemma`   | string | Base dictionary form; non-empty                                          |
| `pos`     | string | One of: noun, verb, adj, adv, pron, prep, conj, det, num, punct, other  |
| `meaning` | string | Short English gloss; max ~5 words                                        |

**Ordering**: Tokens appear in the same order as words in the original input.

---

### AnalysisResult

The structured response returned by the AI model.

| Field         | Type      | Constraints                                      |
|---------------|-----------|--------------------------------------------------|
| `translation` | string    | Natural English rendering; non-empty             |
| `tokens`      | Token[]   | Ordered array; length equals word count of input |

**Wire format** (JSON):
```json
{
  "translation": "string",
  "tokens": [
    {
      "word": "string",
      "lemma": "string",
      "pos": "string",
      "meaning": "string"
    }
  ]
}
```

---

### StoredSettings

Persisted in `chrome.storage.local`. Loaded once on popup open.

| Field    | Type   | Constraints                      |
|----------|--------|----------------------------------|
| `apiKey` | string | Anthropic API key; may be empty if not yet configured |

---

## State Transitions (Popup UI)

```
[Idle] → user submits text → [Loading]
[Loading] → API success → [Results]
[Loading] → API error / parse error / validation error → [Error]
[Results] → user submits new text → [Loading]
[Error] → user clicks Retry → [Loading]
[Error] (401 only) → user clicks Settings → [Settings]
[Any] → user clicks Settings icon → [Settings]
[Settings] → user clicks Save → [Main] (if key saved) or [Settings] (if invalid)
[Settings] → user clicks Cancel → [previous state]

Error states show:
- Error message (type-specific)
- Retry button (always, except 401 which shows Settings link instead)
- Cancel button (dismiss error, return to [Idle] or [Results])
```

---

### Error States (Data Model)

| Error Type | Fields | User Sees |
|------------|--------|-----------|
| `TimeoutError` | message: string | "Request took too long..." + Retry |
| `ApiError` | status: number, message: string | Depends on status (401/429/5xx) |
| `NetworkError` | message: string | "Network error..." + Retry |
| `JsonError` | message: string | "Unexpected response format..." + Retry |
| `ValidationError` | field: string, message: string | "Incomplete response..." or field-specific message + Retry |

---

## POS Tag Vocabulary

| Tag    | Part of Speech    | Examples                    |
|--------|-------------------|-----------------------------|
| noun   | Noun              | house, ciudad, 水            |
| verb   | Verb              | run, hablar, 食べる           |
| adj    | Adjective         | big, rojo, 大きい             |
| adv    | Adverb            | quickly, muy, とても          |
| pron   | Pronoun           | she, ella, 彼女               |
| prep   | Preposition       | in, en, に                   |
| conj   | Conjunction       | and, pero, しかし              |
| det    | Determiner/Article| the, un, その                 |
| num    | Numeral           | three, tres, 三               |
| punct  | Punctuation       | ., !, ?                      |
| other  | Other/Unknown     | interjections, foreign words  |
