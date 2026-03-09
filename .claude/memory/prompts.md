# Prompts — Tier 2 Reference

Assumes CLAUDE.md loaded. Prompt content lives in individual markdown files.

## Architecture

```
src/prompts/
  manifest.json       # Ordered list: [{ id, name }] — controls step order + display names
  loader.js           # Reads manifest + markdown files, exports STEPS, DOC_UPDATE_PROMPT, CHANGELOG_PROMPT
  steps/              # 33 individual markdown prompt files (01-documentation.md .. 33-strategic-opportunities.md)
  specials/           # Non-step prompts (doc-update.md, changelog.md)
```

## Exports (from loader.js)

| Export | Type | Description |
|--------|------|-------------|
| `STEPS` | `Array<{ number, name, prompt }>` | 33 improvement prompts, numbered 1-33 |
| `DOC_UPDATE_PROMPT` | `string` | One-liner asking Claude to update docs and commit |
| `CHANGELOG_PROMPT` | `string` | Multi-paragraph prompt for narrated changelog |

## Step Shape

```js
{
  number: 1,                    // Sequential 1-33 (from array position)
  name: "Documentation",       // From manifest.json `name` field
  prompt: `...`                 // Content of the corresponding .md file
}
```

## How Prompts Are Used

1. **executor.js** iterates `selectedSteps` and calls `runPrompt(step.prompt, ...)` for each
2. After each improvement prompt succeeds, `DOC_UPDATE_PROMPT` runs (non-fatal if it fails)
3. After ALL steps, `CHANGELOG_PROMPT` runs once in `cli.js` (not in executor)

## Source of Truth

The [Google Doc](https://docs.google.com/document/d/1Kg8MTNOzWSXd_sCEcenjX_8_DPDItH8wgp3oW2loV5A) with one tab per prompt is the canonical source. Markdown files were extracted from it.

## Modifying Prompts

1. Edit the markdown file in `src/prompts/steps/` or `src/prompts/specials/`
2. To add/remove/reorder steps, update `src/prompts/manifest.json`
3. Recompute `STEPS_HASH` in `src/executor.js` (SHA-256 of all prompts joined)
4. Update test expectations in `steps.test.js` if step count changes

## Validation Tests (steps.test.js)

- Exactly 33 entries
- Each has `number` (number), `name` (string), `prompt` (string)
- Numbers sequential 1-33
- No empty prompts
- `DOC_UPDATE_PROMPT` and `CHANGELOG_PROMPT` are non-empty strings
- Manifest has version 1 and 33 entries
- Every manifest ID has a corresponding `.md` file in `steps/`

## Loader Internals

- Synchronous `readFileSync` at module load time (ESM top-level)
- `__dirname` resolved via `fileURLToPath(import.meta.url)`
- Tests that mock `fs` must also mock `../src/prompts/loader.js` to prevent the loader from calling the mocked readFileSync
