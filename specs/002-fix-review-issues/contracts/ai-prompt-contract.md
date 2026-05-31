> **Superseded**: See [v3.2](../../003-tiered-api-pipeline/contracts/ai-prompt-contract.md) for the current conditional schema.

# AI Prompt Contract Amendment: System Prompt v3.1

**Version**: 3.1 (amendment to v3.0)
**Date**: 2026-05-30
**Amends**: `specs/001-lingua-word-breakdown/contracts/ai-prompt-contract.md` (v3.0)

---

## Change Summary

The system prompt is simplified to remove duplication with the tool schema field descriptions.
All other contract fields (endpoint, headers, request body shape, tool schema, error handling) are **unchanged**.

---

## System Prompt — v3.1 (replaces v3.0 verbatim content)

```
Analyze the input text for language learning using the linguistic_analysis tool. Produce a structured word-level breakdown. For non-Latin-script words (Korean, Chinese, Japanese), romanization and IPA pronunciation are required. For Korean, identify attached particles (조사) and verb/adjective endings (어미) as specified in the tool schema.
```

**What changed from v3.0**: The per-field rule definitions (particle type mappings, ending type mappings, romanization scheme names per language) have been removed from the system prompt. These rules are fully specified in the `ANALYSIS_TOOL.input_schema` field descriptions, which is the authoritative location. The system prompt now provides framing and cross-cutting reminders only.

**Why this is safe**: Claude's structured output for tool use is primarily driven by the tool schema. The `tool_choice: { type: 'tool' }` setting means Claude always invokes the tool; field descriptions in `input_schema` directly govern how Claude fills each field. Removing the duplicate rules from the system prompt does not change the information Claude has when deciding field values.

---

## Tool Schema — Unchanged

The `ANALYSIS_TOOL` declaration is identical to v3.0. No changes to `input_schema`, required fields, field names, or field types. See `specs/001-lingua-word-breakdown/contracts/ai-prompt-contract.md` for the full schema.

---

## Contract Stability Note

Per the constitution: "Any change to the tool schema requires updating the contract document in the same commit." This amendment changes the system prompt only, not the tool schema. The contract is updated regardless to maintain a complete and accurate record.

The v3.1 system prompt must be reflected in `lib/analyzer.js:SYSTEM_PROMPT` in the same commit that ships this change.
