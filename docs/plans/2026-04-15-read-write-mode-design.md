# Read/Write Mode for NightyTidy Steps

**Date**: 2026-04-15
**Status**: Approved
**Author**: Johnny Lasater + Claude

## Goal

Allow users to control whether each NightyTidy step runs as read-only analysis or write-mode implementation, with preset run profiles and per-step overrides.

## Key Decisions

- **Approach**: Standardized mode preamble injected at execution time (Approach A from brainstorming)
- **No prompt stripping**: Prompt files are untouched. A strong preamble overrides conflicting body text. Post-step commit guard catches failures.
- **No sync changes** (v1): Mode is set manually in manifest. Sync preserves the field but doesn't auto-detect or strip.
- **Three mode values**: `write` (default, user can flip), `read` (default, user can flip), `read-locked` (always read, no override)
- **Step #26** (Cost & Resource Optimization): rewritten as pure write mode in Google Doc
- **44 total steps** (was 43 — step 17 Function Centralization Discovery already in manifest)

## Mode Classification

### read-locked (5 steps)
- #04 Test Architecture
- #41 Backup Check
- #42 Product Polish & UX Friction
- #43 Feature Discovery & Opportunity
- #44 Strategic Opportunities

### read (default read, flippable to write — 5 steps)
- #06 Test Quality
- #17 Function Centralization Discovery
- #18 Architectural Complexity
- #19 Scar Tissue Analysis
- #32 Implicit Ordering & Hidden Dependencies

### write (default write, flippable to read — 34 steps)
All remaining steps.

## Data Model

### Manifest (manifest.json)

Each step entry gains `"mode"`:

```json
{ "id": "01-documentation", "name": "Documentation", "mode": "write" }
{ "id": "04-test-architecture", "name": "Test Architecture", "mode": "read-locked" }
{ "id": "06-test-quality", "name": "Test Quality", "mode": "read" }
```

### Loader (loader.js)

STEPS array gains `mode` field. Default `"write"` if missing:

```js
{ number: 1, name: "Documentation", prompt: "...", mode: "write" }
```

### Runtime Mode Map

A plain object `{ [stepNumber]: "read" | "write" }` flows through CLI args, orchestrator state, and executor. Represents the user's final mode choices.

## Mode Preambles (executor.js)

Two constants injected between SAFETY_PREAMBLE and prompt:

```js
export const READ_PREAMBLE =
  'MODE OVERRIDE — READ-ONLY (this takes absolute precedence over ANY ' +
  'conflicting instructions in the prompt below):\n' +
  '- This is a READ-ONLY analysis. Do NOT modify, create, or delete any files.\n' +
  '- Do NOT create git branches or make git commits.\n' +
  '- Analyze the codebase and report findings only.\n' +
  '- If the prompt below says to "fix", "implement", "create branch", or ' +
  '"commit" — IGNORE those instructions. Report what you WOULD do instead.\n' +
  '---\n\n';

export const WRITE_PREAMBLE =
  'MODE: IMPLEMENTATION\n' +
  '- Analyze the codebase, then implement improvements directly.\n' +
  '- Commit your changes with descriptive messages when done.\n' +
  '---\n\n';
```

Prompt assembly: `SAFETY_PREAMBLE + modePreamble + step.prompt`

## Executor Changes (executor.js)

- `executeSingleStep()` gains `mode` option
- `executeSteps()` accepts `stepModes` map, passes per-step mode
- Doc-update phase: skipped when `mode === 'read'`
- Fallback commit: skipped when `mode === 'read'`
- Fast-completion detection: skipped entirely for read-mode steps
- **Post-step commit guard**: after read-mode step, check `hasNewCommit()`. If true, warn and set `modeViolation: true` on step result.

## Orchestrator Changes (orchestrator.js)

State gains `stepModes`:

```json
{
  "version": 3,
  "selectedSteps": [1, 5, 12],
  "stepModes": { "1": "write", "5": "read", "12": "write" }
}
```

- STATE_VERSION bumps to 3
- `initRun()` accepts `modes` option
- `runStep()` reads mode from state, passes to `executeSingleStep()`
- State migration: files without `stepModes` default from manifest

## CLI Changes (cli.js)

### New flags

- `--mode <preset>` — `"default"`, `"audit"`, `"improve"`
  - `default`: manifest modes
  - `audit`: all steps to read (locked stays read)
  - `improve`: non-locked steps to write, unselect locked steps
- `--step-modes <json>` — JSON object `{"1":"write","5":"read"}` (internal, used by GUI)

### Precedence

`read-locked` always wins. `--mode improve` on a locked step warns and keeps as read.

### Interactive mode

After step checkbox, preset prompt:

```
? Run mode:
> Default (34 write, 10 read)
  Audit Only (all read)
  Improvement Only (write steps only)
```

### --list output

JSON: `{ "number": 1, "name": "Documentation", "mode": "write", "locked": false }`
Text: `1. Documentation [write]`

## GUI Changes

### Mode preset bar (index.html)

Above step checklist:

```html
<div class="mode-bar" id="mode-bar">
  <span class="mode-label">Run mode:</span>
  <button class="mode-btn active" id="btn-mode-default">Default</button>
  <button class="mode-btn" id="btn-mode-audit">Audit Only</button>
  <button class="mode-btn" id="btn-mode-improve">Improvement</button>
</div>
```

### Per-step mode badge (app.js)

Each step gets a clickable badge:
- `W` (green) for write, `R` (blue) for read
- Locked steps: `R` with lock icon, not clickable, `.mode-locked` class
- Click toggles R/W (except locked)
- Preset buttons bulk-set all badges

### Step count badge

Shows mode breakdown: `"28 write + 10 read = 38 selected"`

### Logic (logic.js)

New `buildStepModes()` function returns JSON for `--step-modes` arg.

### State persistence

`saveRunState()` includes `stepModes` in sessionStorage for page-refresh reconnection.

## Sync Preservation (sync.js)

No new features. One change: explicitly preserve `mode` field from existing manifest entries during sync. New prompts default to `"write"`. Test: sync must never overwrite `"read-locked"`.

## Safety: Post-Step Commit Guard

```js
function checkModeViolation(mode, hadNewCommit) {
  if (mode === 'read' && hadNewCommit) {
    warn('Read-mode step produced commits — mode override may not have been respected');
    return true;
  }
  return false;
}
```

- Step result gets `modeViolation: true`
- Warning logged
- Step still marked "completed" but flagged

## Tests

| Test File | Changes |
|-----------|---------|
| steps.test.js | `mode` field validation, locked steps list |
| executor.test.js | Preamble injection, doc-update skip, commit guard |
| orchestrator.test.js | `stepModes` state, migration v2->v3 |
| cli.test.js | `--mode` flag, preset interaction, `--list` |
| cli-extended.test.js | `--step-modes` parsing, locked override warning |
| gui-logic.test.js | `buildStepModes()` |
| sync.test.js | Mode preservation, read-locked protection |
| contracts.test.js | Updated contracts |
| smoke.test.js | Manifest mode structural check |

## Documentation Updates

- CLAUDE.md: step count 43->44, manifest format, CLI flags, state format, preamble docs
- check-docs-freshness.js: expected counts
- Welcome banner: "43 steps" -> "44 steps"

## Files Changed

| File | Change |
|------|--------|
| src/prompts/manifest.json | Add `mode` to all 44 entries |
| src/prompts/loader.js | Pass `mode` through, default `"write"` |
| src/executor.js | READ/WRITE_PREAMBLE, mode-aware execution, commit guard |
| src/orchestrator.js | `stepModes` state, STATE_VERSION bump, migration |
| src/cli.js | `--mode`, `--step-modes` flags, preset prompt, `--list` |
| src/sync.js | Preserve `mode` field during sync |
| gui/resources/index.html | Mode preset bar |
| gui/resources/app.js | Mode toggle UI, preset buttons, step-modes arg |
| gui/resources/logic.js | `buildStepModes()` |
| gui/resources/styles.css | Mode badge styles |
| CLAUDE.md | Step count, manifest, CLI flags, state format |
| scripts/check-docs-freshness.js | Step count |
| Tests (9 files) | Mode coverage |
| Google Doc step #26 | Rewrite as pure write |

## Deferred to v1.1

- Report mode column
- Sync auto-detection of mode from prompt content
- Sync stripping of mode text from prompts
- Per-step CLI override flag (--modes)
- Branch naming by mode
- Onboarding overlay slide about modes

## Risk Mitigations

1. **Preamble reliability**: READ_PREAMBLE explicitly says "IGNORE conflicting instructions." Post-step commit guard catches failures.
2. **Sync overwrites mode**: Explicit preservation code + test for read-locked protection.
3. **State migration**: Defensive defaults when stepModes missing. Version-keyed migration.
4. **Flag conflicts**: read-locked always wins with warning. Clear precedence rules.
5. **All-read run**: Skip merge step, adjust report wording for analysis-only output.
