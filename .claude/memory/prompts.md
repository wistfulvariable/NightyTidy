# Prompts — Tier 2 Reference

Assumes CLAUDE.md loaded. Do NOT edit `src/prompts/steps.js` manually.

## File: `src/prompts/steps.js`

- **5400+ lines**, auto-generated from external `extracted-prompts.json`
- First line: `// Auto-generated from extracted-prompts.json — do not edit manually`

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `STEPS` | `Array<{ number, name, prompt }>` | 28 improvement prompts, numbered 1-28 |
| `DOC_UPDATE_PROMPT` | `string` | One-liner asking Claude to update docs and commit |
| `CHANGELOG_PROMPT` | `string` | Multi-paragraph prompt for narrated changelog |

## Step Shape

```js
{
  number: 1,        // Sequential 1-28
  name: "Documentation",  // Short human-readable label
  prompt: `...`     // Full prompt text (can be thousands of chars)
}
```

## How Prompts Are Used

1. **executor.js** iterates `selectedSteps` and calls `runPrompt(step.prompt, ...)` for each
2. After each improvement prompt succeeds, `DOC_UPDATE_PROMPT` runs (non-fatal if it fails)
3. After ALL steps, `CHANGELOG_PROMPT` runs once in `cli.js` (not in executor)

## DOC_UPDATE_PROMPT

Single sentence asking Claude to update documentation and git commit. Short enough to always use `-p` flag (under STDIN_THRESHOLD).

## CHANGELOG_PROMPT

Multi-paragraph prompt requesting:
- First-person narrative ("I did...")
- Non-technical language
- Review of full git log and diffs for the run

## Validation Tests (steps.test.js)

- Exactly 28 entries
- Each has `number` (number), `name` (string), `prompt` (string)
- Numbers sequential 1-28
- No empty prompts
- `DOC_UPDATE_PROMPT` and `CHANGELOG_PROMPT` are non-empty strings

## Adding New Prompts

The source of truth is `extracted-prompts.json` (not committed). To add/modify prompts:
1. Edit the external source
2. Regenerate `steps.js`
3. Update test expectations if step count changes
4. Do NOT hand-edit `steps.js`
