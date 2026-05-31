# Quickstart: Tiered API Pipeline

**Branch**: `005-tiered-api-pipeline` | **Date**: 2026-05-30

This document covers development notes for the DeepL integration. For general extension setup, see [001 quickstart](../001-lingua-word-breakdown/quickstart.md).

---

## Files Changed in This Branch

| File | Change |
|------|--------|
| `popup/popup.html` | DeepL key field + "optional" label + hint text in settings-view |
| `popup/popup.js` | `cachedDeeplKey`; `getKeys()`; saveBtn saves/clears both keys; cancelBtn gap (see note) |
| `lib/analyzer.js` | `buildAnalysisTool()`; `buildSystemPrompt()`; `deeplKey` param; full pipeline |
| `lib/lang-detect.js` | NEW — `detectScript()`, `SCRIPT` enum |
| `lib/translator.js` | NEW — `translateWithDeepL()` |
| `lib/romanizer.js` | NEW — `romanizeKorean()` |
| `background/service-worker.js` | `cachedDeeplKey`; `getKeys()`; passes `deeplKey` to `analyzeText` |
| `manifest.json` | `+host_permissions: api-free.deepl.com`; `+CSP connect-src` |

---

## Outstanding Fixes Before Shipping

Three small fixes identified during planning are not yet applied:

| Task | File | Fix |
|------|------|-----|
| T-W01 | `lib/analyzer.js` | Replace empty `catch {}` for DeepL errors with `catch (err) { console.warn('[Lingua] DeepL translation failed, falling back to Claude:', err.message); }` |
| T-W02 | `.specify/memory/constitution.md` | Apply PA-003 amendment — add DeepL host permission to Principle V's allowed list |
| T-W03 | `popup/popup.js` | Add `deeplKeyInput.value = '';` to `cancelBtn` handler alongside the existing `apiKeyInput.value = '';` |

---

## Testing with DeepL Key

1. Get a free DeepL API key at deepl.com/pro-api (500k chars/month free; key ends in `:fx`)
2. Load the extension unpacked at `chrome://extensions`
3. Open the popup → Settings → enter your DeepL key → Save
4. Submit Korean text (e.g., `안녕하세요, 제 이름은 마빈입니다.`)
5. **Expected**: Result shows translation (from DeepL) + full word breakdown + romanization
6. Open DevTools → Network tab → confirm a request to `api-free.deepl.com` fired before the Anthropic request

---

## Testing Fallback Behavior

1. Open Settings → enter an invalid DeepL key (e.g., `invalid-key:fx`) → Save
2. Submit Korean text
3. **Expected**: Analysis still completes normally via Claude; no DeepL error shown to user
4. Open DevTools → Console → confirm `[Lingua] DeepL translation failed` warning (after T-W01 is applied)

---

## Testing Latin Text Bypass

1. Configure a valid DeepL key
2. Submit English text
3. **Expected**: No request to `api-free.deepl.com` in Network tab; analysis proceeds normally

---

## Testing Settings Cancel (DeepL field)

1. Open Settings → type text into the DeepL key field
2. Click Cancel (✕)
3. Reopen Settings
4. **Expected**: DeepL key field is empty (requires T-W03 to be applied)

---

## Running Unit Tests

```sh
npm test
```

New/updated test areas to cover (see tasks.md for specific task IDs):
- `detectScript()` — each script type, mixed input, empty string
- `romanizeKorean()` — syllable blocks, non-Hangul passthrough
- `translateWithDeepL()` — success, non-2xx error, null translation field
- `analyzeText()` pipeline — DeepL success path, DeepL fallback path, Latin bypass
- `buildAnalysisTool()` — schema shape for each lang × preTranslation combination

---

## Key Implementation Notes

- **DeepL Free tier subdomain**: `api-free.deepl.com` (not `api.deepl.com`). Free keys end in `:fx`. Using the wrong subdomain returns HTTP 403.
- **Korean romanization**: generated locally after the Claude response by `romanizeKorean()`. Claude is told to omit romanization for Korean in both the system prompt and tool schema — requesting it from Claude wastes tokens and produces inconsistent output.
- **Schema conditioning**: `buildAnalysisTool` omits the `translation` field from `input_schema` when `preTranslation` is set. The pre-translation is merged back into the result after `toolUse.input` is extracted.
- **Cache semantics**: saving with an empty DeepL field calls `chrome.storage.local.remove('deeplKey')` and sets `cachedDeeplKey = null`. This is the "Clear" mechanism — no separate Clear button exists in the UI.
