# Data Model: Streaming & History Memory Optimization

**Feature**: 006-memory-perf-opt | **Date**: 2026-05-31

---

## Storage Overview

| Store | API | Key | Format | Max size |
|-------|-----|-----|--------|----------|
| Unified history/cache | `chrome.storage.local` | `lingua_history_v1` | JSON array of `AnalysisEntry` (tokens columnar + conditionally compressed) | ~90KB typical / ~262KB worst-case uncompressed (75 entries) |
| API key (existing) | `chrome.storage.local` | `apiKey` | string | ~60B |
| DeepL key (existing) | `chrome.storage.local` | `deeplKey` | string | ~60B |

---

## AnalysisEntry

The top-level record stored in the `lingua_history_v1` array. One record per unique normalized input text. Serves as both cache lookup entry and history display item.

```
AnalysisEntry {
  id:              string         — compact unique identifier (base-36 ms timestamp at creation)
  version:         number         — schema version; currently 1
  ts:              number         — Unix millisecond timestamp of most recent analysis for this input
  lang:            string         — ISO 639-3 language code: "kor" | "jpn" | "cmn" | "lat" | "und"
  input:           string         — full normalized (trimmed) input text; primary cache key
  snippet:         string         — input.slice(0, 60); used for history list preview only
  translation:     string         — full English translation of the input text
  tokens:          TokenStore | CompressedTokens — token data; empty TokenStore when translationOnly
  translationOnly: boolean?       — true when entry was produced by translateOnly() (large text); absent on full-analysis entries
}
```

**Uniqueness rule**: One `AnalysisEntry` per normalized `input` value. Re-analyzing the same text updates `ts` and moves the entry to position 0 of the array (newest-first order); no duplicate is created.

**`translationOnly` flag**: Present and `true` on entries produced by `translateOnly()` (inputs > `LARGE_TEXT_THRESHOLD`). Absent or `false` on full-analysis entries. When `true`, `tokens` is an empty `TokenStore` (`rows: []`); the UI renders the translation banner only and suppresses the word-cards panel.

**Version check**: On read, any entry with `version !== 1` MUST be silently skipped. It is retained in the array and removed by normal LRU eviction.

---

## TokenStore

The structured token payload stored inside `AnalysisEntry.tokens` when uncompressed. Field names are recorded once in `schema`; each element of `rows` is a positional value array aligned to that schema.

```
TokenStore {
  schema: string[],   — fixed for schema version 1:
                        ["word","lemma","pos","meaning","rom","ipa","particles","endings"]
  rows:   any[][]     — one inner array per token; position i holds the value for schema[i]
}
```

Row position semantics (schema version 1, immutable — new fields MUST append at position 8+):

```
row[0]  word:          string              — surface form (always present)
row[1]  lemma:         string              — base/dictionary form (always present)
row[2]  pos:           string              — part-of-speech tag (always present; allowlisted)
row[3]  meaning:       string              — English gloss ≤5 words (always present)
row[4]  rom:           string              — romanization string, or "" if absent
row[5]  ipa:           string              — IPA pronunciation, or "" if absent
row[6]  particles:     ParticleTuple[] | null   — Korean particles, or null
row[7]  endings:       EndingTuple[]  | null    — Korean verb endings, or null
```

## CompressedTokens

The compressed form of a `TokenStore`, stored when `JSON.stringify(tokenStore).length > COMPRESS_THRESHOLD`. The `c` flag is the discriminant.

```
CompressedTokens {
  c: 1,       — discriminant: 1 = compressed; absent on raw TokenStore objects
  d: string   — base64-encoded gzip of JSON.stringify(TokenStore)
}
```

### ParticleTuple

```
ParticleTuple = [form: string, type: string, meaning: string]
```

`type` must be one of: `topic | subject | object | sentence-end | other-particle`

### EndingTuple

```
EndingTuple = [form: string, type: string, meaning: string]
```

`type` must be one of: `connective | attributive | nominal | concessive | sentence-final | other-ending`

---

## Conversion Functions

### buildEntry(analysisResult, text, lang) → AnalysisEntry

Produces a new `AnalysisEntry` from a full `AnalysisResult` object (the shape returned by `analyzeText`). `tokens` is assigned by `packTokens` (see below).

```
id              = Date.now().toString(36)
version         = 1
ts              = Date.now()
lang            = lang.code                  (from detectScript result)
input           = text.trim()
snippet         = text.trim().slice(0, SNIPPET_LENGTH)
translation     = analysisResult.translation
tokens          = await packTokens(analysisResult.tokens)   // empty TokenStore when tokens is []
translationOnly = analysisResult.tokens.length === 0 ? true : undefined
```

`translationOnly` is set to `true` only when `tokens` is empty (large-text path); it is left `undefined` (absent from JSON) for full-analysis entries to avoid schema bloat on existing entries.

### packTokens(tokens) → Promise<TokenStore | CompressedTokens>

Builds a `TokenStore` then compresses it if it exceeds `COMPRESS_THRESHOLD`:

```
store = {
  schema: ["word","lemma","pos","meaning","rom","ipa","particles","endings"],
  rows: tokens.map(t => [
    t.word,
    t.lemma,
    t.pos,
    t.meaning,
    t.romanization  ?? "",
    t.pronunciation ?? "",
    t.particles ? t.particles.map(p => [p.form, p.type, p.meaning]) : null,
    t.endings   ? t.endings.map(e => [e.form, e.type, e.meaning])   : null,
  ])
}
json = JSON.stringify(store)
if json.length <= COMPRESS_THRESHOLD: return store
return { c: 1, d: await gzipBase64(json) }
```

### unpackTokens(packed) → Promise<token[]>

Resolves `TokenStore | CompressedTokens` back to a plain token array:

```
store = packed.c === 1
  ? JSON.parse(await ungzipBase64(packed.d))
  : packed
return store.rows.map(row => ({
  word:    row[0],
  lemma:   row[1],
  pos:     row[2],
  meaning: row[3],
  ...(row[4] ? { romanization:  row[4] } : {}),
  ...(row[5] ? { pronunciation: row[5] } : {}),
  ...(row[6] ? { particles: row[6].map(([form,type,meaning]) => ({form,type,meaning})) } : {}),
  ...(row[7] ? { endings:   row[7].map(([form,type,meaning]) => ({form,type,meaning})) } : {}),
}))
```

### gzipBase64(json) / ungzipBase64(b64) — native Compression Streams

```js
// gzipBase64(json: string) → Promise<string>
async function gzipBase64(json) {
  const stream = new Blob([json]).stream()
    .pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// ungzipBase64(b64: string) → Promise<string>
async function ungzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
```

No external library. `CompressionStream` / `DecompressionStream` are available from Chromium 80.

---

## Storage Operations

### Read (cache lookup)

```
1. chrome.storage.local.get('lingua_history_v1')
2. Find first entry where entry.version === 1 && entry.input === normalizedText
3. If found: return { ...entry, tokens: await unpackTokens(entry.tokens) }
4. If not found: return null
```

Note: `unpackTokens` is async due to the `DecompressionStream` path. Callers must `await`.

### Write (add/update entry)

```
1. newEntry.tokens = await packTokens(analysisResult.tokens)  // compress if > threshold
2. chrome.storage.local.get('lingua_history_v1')  → history (default [])
3. existingIdx = history.findIndex(e => e.input === entry.input)
4. If existingIdx >= 0: history.splice(existingIdx, 1)   // remove old
5. history.unshift(newEntry)                              // prepend newest
6. If history.length > MAX_ENTRIES (75): history.splice(MAX_ENTRIES)
7. bytes = new TextEncoder().encode(JSON.stringify(history)).length
8. If bytes > QUOTA_CEILING (4 * 1024 * 1024):
     history.splice(Math.floor(MAX_ENTRIES / 2))          // aggressive trim
9. await chrome.storage.local.set({ lingua_history_v1: history })
   — on rejection: throw new StorageError(message)
```

### Read (history display, page N)

```
1. chrome.storage.local.get('lingua_history_v1')  → history (default [])
2. Filter to entries where entry.version === 1
3. Return history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
   — display fields only: id, ts, lang, snippet; do NOT unpack tokens for list view
4. Unpack tokens only when user clicks entry (restore to main view): await unpackTokens(entry.tokens)
```

---

## State Transitions

```
[no entry]
    │
    ▼ user submits new text (cache miss)
[analysis running: stream in progress]
    │
    ▼ translation extracted from stream (early)
[analysis running: translation visible, tokens loading]
    │
    ▼ stream complete, entry stored
[AnalysisEntry in lingua_history_v1, position 0]
    │
    ├─ user submits same text again → update ts, move to position 0
    ├─ new entries added until count > 75 → this entry evicted
    └─ user clears history → entry removed
```

---

## Constants

### lib/history.js

| Constant | Value | Purpose |
|----------|-------|---------|
| `HISTORY_KEY` | `'lingua_history_v1'` | chrome.storage.local key |
| `MAX_ENTRIES` | `75` | LRU cap |
| `QUOTA_CEILING` | `4 * 1024 * 1024` | 4 MB byte ceiling for pre-write check |
| `SNIPPET_LENGTH` | `60` | Characters kept for history preview |
| `PAGE_SIZE` | `10` | History list entries per page |
| `SCHEMA_VERSION` | `1` | Current AnalysisEntry schema version |
| `COMPRESS_THRESHOLD` | `500` | Byte length above which `packTokens` compresses the token store |

### lib/analyzer.js

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_RESPONSE_BYTES` | `51200` | 50 KB streaming response byte cap (full analysis) |
| `LARGE_TEXT_THRESHOLD` | `2000` | Chars above which `translateOnly()` is used instead of `analyzeText()` |
| `MAX_LARGE_INPUT_CHARS` | `10000` | Hard input ceiling for translation-only path; replaces former `MAX_INPUT_CHARS` in `validateInput()` |
