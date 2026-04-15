# Prompts — Tier 2 Reference

Assumes CLAUDE.md loaded. Prompt content lives in individual markdown files.

## Architecture

```
src/prompts/
  manifest.json       # Ordered list: [{ id, name, mode }] — controls step order + display names + run mode
  loader.js           # Reads manifest + markdown files, exports STEPS, DOC_UPDATE_PROMPT, CHANGELOG_PROMPT
  steps/              # 44 individual markdown prompt files (01-documentation.md .. 44-strategic-opportunities.md)
  specials/           # Non-step prompts (doc-update.md, changelog.md)
```

## Exports (from loader.js)

| Export | Type | Description |
|--------|------|-------------|
| `STEPS` | `Array<{ number, name, prompt, mode }>` | 44 improvement prompts, numbered 1-44. `mode` is `write`, `read`, or `read-locked` |
| `DOC_UPDATE_PROMPT` | `string` | One-liner asking Claude to update docs and commit |
| `CHANGELOG_PROMPT` | `string` | Multi-paragraph prompt for narrated changelog |

## Step Shape

```js
{
  number: 1,                    // Sequential 1-44 (from array position)
  name: "Documentation",       // From manifest.json `name` field
  prompt: `...`,                // Content of the corresponding .md file
  mode: "write"                // "write" | "read" | "read-locked" (from manifest.json)
}
```

## How Prompts Are Used

1. **executor.js** iterates `selectedSteps` and calls `runPrompt(step.prompt, ...)` for each
2. After each improvement prompt succeeds, `DOC_UPDATE_PROMPT` runs (non-fatal if it fails)
3. After ALL steps, `CHANGELOG_PROMPT` runs once in `cli.js` (not in executor)

## Source of Truth

The [Google Doc](https://docs.google.com/document/d/1Kg8MTNOzWSXd_sCEcenjX_8_DPDItH8wgp3oW2loV5A) with one tab per prompt is the canonical source. `npx nightytidy --sync` fetches, parses, and updates local files. Sync runs automatically before every CLI/orchestrator run (skip with `--skip-sync`).

## Sync — Number Prefix Stripping

Google Doc tab headings sometimes include number prefixes (e.g. "07. Test Efficiency"). The sync system (`sync.js`) automatically strips these via `stripNumberPrefix()` to produce clean manifest names ("Test Efficiency") and IDs ("07-test-efficiency"). Without this, names get "07. " baked in and IDs get doubled ("07-07-test-efficiency"). The stripping applies in three places: `headingToId()`, `normalizeName()`, and `buildNewManifest()`.

## Modifying Prompts

- **Preferred**: Edit the Google Doc, then run `npx nightytidy --sync`
- **Manual**: Edit markdown in `src/prompts/steps/` (will be overwritten on next sync)
- To add/remove/reorder steps, update `src/prompts/manifest.json`
- Recompute `STEPS_HASH` in `src/executor.js` (SHA-256 of all prompts joined)
- Update test expectations in `steps.test.js` if step count changes

## Validation Tests (steps.test.js)

- Exactly 44 entries
- Each has `number` (number), `name` (string), `prompt` (string), `mode` (string)
- Numbers sequential 1-44
- No empty prompts
- 5 read-locked steps (#4, #41-44), 5 read steps (#6, #17-19, #32), 34 write steps
- `DOC_UPDATE_PROMPT` and `CHANGELOG_PROMPT` are non-empty strings
- Manifest has version 1 and 44 entries
- Every manifest ID has a corresponding `.md` file in `steps/`

## Loader Internals

- Synchronous `readFileSync` at module load time (ESM top-level)
- `__dirname` resolved via `fileURLToPath(import.meta.url)`
- Tests that mock `fs` must also mock `../src/prompts/loader.js` to prevent the loader from calling the mocked readFileSync
