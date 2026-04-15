# Read/Write Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to control whether each NightyTidy step runs as read-only analysis or write-mode implementation, with preset run profiles and per-step overrides.

**Architecture:** Mode metadata (`write`, `read`, `read-locked`) lives in `manifest.json`. At execution time, a mode preamble is injected between `SAFETY_PREAMBLE` and the step prompt. A post-step commit guard catches cases where Claude ignores the read-only preamble. CLI gets a `--mode` preset flag; GUI gets preset buttons and per-step toggle badges.

**Tech Stack:** Node.js ESM, Vitest, Commander.js, Inquirer, Chrome app-mode GUI

**Design doc:** `docs/plans/2026-04-15-read-write-mode-design.md`

---

## Task 1: Add `mode` to manifest.json

**Files:**
- Modify: `src/prompts/manifest.json` (all 44 entries)

**Step 1: Add mode field to every manifest entry**

Add `"mode": "write"` to all 44 entries, then override these specific entries:

Read-locked (5):
- `04-test-architecture` → `"mode": "read-locked"`
- `41-backup-check` → `"mode": "read-locked"`
- `42-product-polish-ux-friction` → `"mode": "read-locked"`
- `43-feature-discovery-opportunity` → `"mode": "read-locked"`
- `44-strategic-opportunities` → `"mode": "read-locked"`

Read (5):
- `06-test-quality` → `"mode": "read"`
- `17-function-centralization-discovery` → `"mode": "read"`
- `18-architectural-complexity` → `"mode": "read"`
- `19-scar-tissue-analysis` → `"mode": "read"`
- `32-implicit-ordering-hidden-dependencies` → `"mode": "read"`

All other 34 entries → `"mode": "write"`

**Step 2: Verify manifest is valid JSON**

Run: `node -e "const m = require('./src/prompts/manifest.json'); console.log(m.steps.length + ' steps, modes: ' + [...new Set(m.steps.map(s=>s.mode))].join(', '))"`
Expected: `44 steps, modes: write, read-locked, read`

**Step 3: Commit**

```bash
git add src/prompts/manifest.json
git commit -m "feat: add mode field to manifest.json (write/read/read-locked)"
```

---

## Task 2: Pass `mode` through loader.js

**Files:**
- Modify: `src/prompts/loader.js:23-29`
- Test: `test/steps.test.js`

**Step 1: Write the failing tests**

Add to `test/steps.test.js` — inside the `describe('STEPS')` block (after line 32):

```js
it('each entry has a mode field', () => {
  for (const step of STEPS) {
    expect(step).toHaveProperty('mode');
    expect(['write', 'read', 'read-locked']).toContain(step.mode);
  }
});

it('has exactly 5 read-locked steps', () => {
  const locked = STEPS.filter(s => s.mode === 'read-locked');
  expect(locked.map(s => s.number)).toEqual([4, 41, 42, 43, 44]);
});

it('has exactly 5 read steps', () => {
  const readSteps = STEPS.filter(s => s.mode === 'read');
  expect(readSteps.map(s => s.number)).toEqual([6, 17, 18, 19, 32]);
});

it('remaining steps are write mode', () => {
  const writeSteps = STEPS.filter(s => s.mode === 'write');
  expect(writeSteps).toHaveLength(34);
});
```

Also update existing tests:
- Line 8: `expect(STEPS).toHaveLength(43)` → `expect(STEPS).toHaveLength(44)`
- Line 24: `Array.from({ length: 43 }, ...)` → `Array.from({ length: 44 }, ...)`
- Line 41: `expect(manifest.steps).toHaveLength(43)` → `expect(manifest.steps).toHaveLength(44)`

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/steps.test.js`
Expected: FAIL — `mode` field missing, counts wrong

**Step 3: Write minimal implementation**

In `src/prompts/loader.js`, change `loadAllSteps()` (lines 23-29):

```js
function loadAllSteps() {
  const m = JSON.parse(loadFile('manifest.json'));
  return m.steps.map((entry, index) => ({
    number: index + 1,
    name: entry.name,
    prompt: loadFile('steps', `${entry.id}.md`),
    mode: entry.mode || 'write',
  }));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/steps.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/prompts/loader.js test/steps.test.js
git commit -m "feat: expose mode field from manifest through STEPS array"
```

---

## Task 3: Add mode preambles + commit guard to executor.js

**Files:**
- Modify: `src/executor.js:66-130` (constants area), `src/executor.js:196-322` (executeSingleStep), `src/executor.js:409` (executeSteps)
- Test: `test/executor.test.js`

**Step 1: Write the failing tests**

Add new `describe('mode preambles')` block in `test/executor.test.js`:

```js
describe('mode preambles', () => {
  it('injects WRITE_PREAMBLE for write mode steps', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(true);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'do stuff', mode: 'write' }, '/tmp/proj');
    const prompt = mockClaude.runPrompt.mock.calls[0][0];
    expect(prompt).toContain('MODE: IMPLEMENTATION');
    expect(prompt).not.toContain('MODE OVERRIDE');
  });

  it('injects READ_PREAMBLE for read mode steps', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'analysis', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(false);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'analyze stuff', mode: 'read' }, '/tmp/proj', { mode: 'read' });
    const prompt = mockClaude.runPrompt.mock.calls[0][0];
    expect(prompt).toContain('MODE OVERRIDE');
    expect(prompt).toContain('READ-ONLY');
  });

  it('skips doc-update phase for read mode', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'analysis', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(false);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'analyze', mode: 'read' }, '/tmp/proj', { mode: 'read' });
    // Only 1 call (improvement), not 2 (improvement + doc-update)
    expect(mockClaude.runPrompt).toHaveBeenCalledTimes(1);
  });

  it('skips fallback commit for read mode', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'analysis', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(false);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'analyze', mode: 'read' }, '/tmp/proj', { mode: 'read' });
    expect(mockGit.fallbackCommit).not.toHaveBeenCalled();
  });

  it('skips fast-completion detection for read mode', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'fast', attempts: 1, cost: null, duration: 30_000 });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(false);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'analyze', mode: 'read' }, '/tmp/proj', { mode: 'read' });
    // Only 1 call — no fast-retry
    expect(mockClaude.runPrompt).toHaveBeenCalledTimes(1);
  });

  it('detects mode violation when read step produces commits', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'oops I committed', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(true); // mode violation!
    const result = await executeSingleStep({ number: 1, name: 'Test', prompt: 'analyze', mode: 'read' }, '/tmp/proj', { mode: 'read' });
    expect(result.status).toBe('completed');
    expect(result.modeViolation).toBe(true);
  });

  it('defaults to write mode when mode not specified', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(true);
    await executeSingleStep({ number: 1, name: 'Test', prompt: 'do stuff' }, '/tmp/proj');
    const prompt = mockClaude.runPrompt.mock.calls[0][0];
    expect(prompt).toContain('MODE: IMPLEMENTATION');
  });
});
```

Add test for `executeSteps` with `stepModes`:

```js
describe('executeSteps with stepModes', () => {
  it('passes mode from stepModes map to each step', async () => {
    mockClaude.runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1, cost: null });
    mockGit.getHeadHash.mockResolvedValue('abc');
    mockGit.hasNewCommit.mockResolvedValue(false);
    const steps = [
      { number: 1, name: 'A', prompt: 'a', mode: 'write' },
      { number: 2, name: 'B', prompt: 'b', mode: 'write' },
    ];
    await executeSteps(steps, '/tmp/proj', { stepModes: { 1: 'read', 2: 'write' } });
    const call1 = mockClaude.runPrompt.mock.calls[0][0];
    expect(call1).toContain('MODE OVERRIDE');
    const call2 = mockClaude.runPrompt.mock.calls[2][0]; // call index 2 because write mode has doc-update
    expect(call2).toContain('MODE: IMPLEMENTATION');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/executor.test.js -t "mode preambles"`
Expected: FAIL

**Step 3: Write implementation**

In `src/executor.js`:

After `SAFETY_PREAMBLE` (line 130), add:

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

Modify `executeSingleStep()` signature (line 196):

```js
export async function executeSingleStep(step, projectDir, { signal, timeout, onOutput, continueSession, promptOverride, mode } = {}) {
```

Add mode resolution after `info()` call (after line 198):

```js
const effectiveMode = mode || step.mode || 'write';
const modePreamble = effectiveMode === 'read' ? READ_PREAMBLE : WRITE_PREAMBLE;
```

Change prompt construction (line 222):

```js
const improvementPrompt = promptOverride || (SAFETY_PREAMBLE + modePreamble + step.prompt);
```

Wrap fast-completion detection (line 248) in mode check:

```js
if (effectiveMode !== 'read' && !continueSession && result.duration < FAST_COMPLETION_THRESHOLD_MS) {
```

Also update the fast-retry prompt (line 256) to include modePreamble:

```js
const retryResult = await runPrompt(
  SAFETY_PREAMBLE + modePreamble + FAST_RETRY_PREFIX + step.prompt,
```

Wrap doc-update (lines 273-284) in mode check:

```js
let docResult = { success: true, cost: null };
if (effectiveMode !== 'read') {
  docResult = await runPrompt(SAFETY_PREAMBLE + WRITE_PREAMBLE + DOC_UPDATE_PROMPT, projectDir, {
    label: `Step ${step.number} — doc update`,
    signal: effectiveSignal,
    timeout,
    continueSession: true,
    onOutput,
  });
  if (!docResult.success) {
    warn(`${stepLabel}: Doc update failed after retries — improvement changes preserved but docs may be stale`);
  }
}
```

Wrap commit verification (lines 290-312) in mode check + add commit guard:

```js
if (effectiveMode !== 'read') {
  // Existing commit verification + fallback commit + sweep logic
  const committed = await hasNewCommit(preStepHash);
  if (committed) {
    info(`${stepLabel}: committed by Claude Code ✓`);
  } else {
    try { await fallbackCommit(step.number, step.name); } catch (err) {
      warn(`${stepLabel}: automatic commit failed (${err.message}) — changes remain staged`);
    }
  }
  if (committed) {
    try {
      const swept = await fallbackCommit(step.number, step.name);
      if (swept) info(`${stepLabel}: swept uncommitted files ✓`);
    } catch (err) {
      warn(`${stepLabel}: sweep commit failed (${err.message}) — some files may remain unstaged`);
    }
  }
}

// Mode violation guard: read-mode step should NOT produce commits
let modeViolation = false;
if (effectiveMode === 'read') {
  const hadCommit = await hasNewCommit(preStepHash);
  if (hadCommit) {
    warn(`${stepLabel}: read-mode step produced commits — mode override may not have been respected`);
    modeViolation = true;
  }
}
```

Update the return (line 317-318) to include `modeViolation`:

```js
const extra = { ...(fastRetried ? { suspiciousFast: true } : {}), ...(modeViolation ? { modeViolation: true } : {}) };
```

Modify `executeSteps()` signature (line 409) to accept `stepModes`:

```js
export async function executeSteps(selectedSteps, projectDir, { signal, timeout, onStepStart, onStepComplete, onStepFail, onOutput, onRateLimitPause, onRateLimitResume, stepModes } = {}) {
```

Pass mode to `executeSingleStep` call (line 427):

```js
const stepMode = stepModes?.[step.number] || step.mode || 'write';
const stepResult = await executeSingleStep(step, projectDir, { signal, timeout, onOutput, mode: stepMode });
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/executor.test.js`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (some existing executor tests may need `READ_PREAMBLE`/`WRITE_PREAMBLE` added to mock exports)

**Step 6: Commit**

```bash
git add src/executor.js test/executor.test.js
git commit -m "feat: mode preambles, read-mode skip logic, and commit guard in executor"
```

---

## Task 4: Orchestrator state + mode passthrough

**Files:**
- Modify: `src/orchestrator.js:71` (STATE_VERSION), `src/orchestrator.js:494-530` (initRun), `src/orchestrator.js:565-722` (runStep)
- Test: `test/orchestrator.test.js`

**Step 1: Write the failing tests**

Add to `test/orchestrator.test.js`:

```js
describe('stepModes in state', () => {
  it('initRun stores stepModes in state', async () => {
    // ... setup mocks ...
    const result = await initRun('/tmp', { steps: '1,2', modes: { 1: 'read', 2: 'write' } });
    expect(result.success).toBe(true);
    const state = readState('/tmp');
    expect(state.stepModes).toEqual({ 1: 'read', 2: 'write' });
  });

  it('initRun defaults stepModes from manifest when not provided', async () => {
    const result = await initRun('/tmp', { steps: '1,2' });
    expect(result.success).toBe(true);
    const state = readState('/tmp');
    expect(state.stepModes).toBeDefined();
    expect(state.stepModes[1]).toBe('write'); // step 1 default
  });

  it('runStep passes mode to executeSingleStep', async () => {
    // ... setup state with stepModes ...
    await runStep('/tmp', 1);
    expect(mockExecutor.executeSingleStep).toHaveBeenCalledWith(
      expect.anything(), '/tmp', expect.objectContaining({ mode: 'read' })
    );
  });

  it('readState handles old state files without stepModes', () => {
    // Write a v1 state without stepModes
    writeFileSync('/tmp/nightytidy-run-state.json', JSON.stringify({ version: 2, selectedSteps: [1], ... }));
    const state = readState('/tmp');
    // Should still be readable (migration)
    expect(state).not.toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/orchestrator.test.js -t "stepModes"`
Expected: FAIL

**Step 3: Write implementation**

In `src/orchestrator.js`:

Change STATE_VERSION (line 71):

```js
export const STATE_VERSION = 2;
```

Modify `readState()` (lines 91-101) to handle migration:

```js
export function readState(projectDir) {
  const fp = statePath(projectDir);
  if (!existsSync(fp)) return null;
  try {
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    // Accept current version or previous version (migrate)
    if (data.version !== STATE_VERSION && data.version !== STATE_VERSION - 1) return null;
    // Migrate: add stepModes from manifest defaults if missing
    if (!data.stepModes) {
      data.stepModes = {};
      for (const num of data.selectedSteps || []) {
        const step = STEPS.find(s => s.number === num);
        data.stepModes[num] = step?.mode || 'write';
      }
    }
    data.version = STATE_VERSION;
    return data;
  } catch {
    return null;
  }
}
```

Modify `initRun()` — add `modes` to options destructuring and store in state. In the function signature (around line 420), add `modes` to the options. In the state object (around line 494-506):

```js
const stepModes = modes || {};
// Fill in defaults from manifest for any step not explicitly specified
for (const num of selectedNums) {
  if (!stepModes[num]) {
    const step = STEPS.find(s => s.number === num);
    stepModes[num] = step?.mode || 'write';
  }
}

const state = {
  version: STATE_VERSION,
  originalBranch,
  runBranch,
  tagName,
  selectedSteps: selectedNums,
  stepModes,
  completedSteps: [],
  failedSteps: [],
  startTime: Date.now(),
  timeout: timeout || null,
  dashboardPid: null,
  dashboardUrl: null,
};
```

Modify `runStep()` — pass mode to `executeSingleStep()`. Around line 608:

```js
const stepMode = state.stepModes?.[stepNumber] || step.mode || 'write';
let result = await executeSingleStep(step, projectDir, { timeout: stepTimeout, onOutput, mode: stepMode });
```

Also pass mode in Tier 2 (prod) and Tier 3 (fresh) recovery calls (lines 625-652):

```js
// Tier 2
const prodResult = await executeSingleStep(step, projectDir, {
  timeout: stepTimeout, onOutput: prodOutput,
  continueSession: true, promptOverride: prodPrompt, mode: stepMode,
});

// Tier 3
const freshResult = await executeSingleStep(step, projectDir, {
  timeout: stepTimeout, onOutput: freshOutput, mode: stepMode,
});
```

**Step 4: Run tests**

Run: `npx vitest run test/orchestrator.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator.js test/orchestrator.test.js
git commit -m "feat: orchestrator stores stepModes in state, passes mode to executor"
```

---

## Task 5: CLI flags + interactive preset

**Files:**
- Modify: `src/cli.js:795-816` (Commander options), `src/cli.js:455-498` (selectSteps), `src/cli.js:555-568` (printStepList), `src/cli.js:829-836` (--list --json), `src/cli.js:839-842` (--init-run), `src/cli.js:627-706` (executeRunFlow), `src/cli.js:682` (executeSteps call), `src/cli.js:507` (welcome banner)
- Test: `test/cli.test.js`, `test/cli-extended.test.js`

**Step 1: Write failing tests**

Add to `test/cli-extended.test.js`:

```js
describe('--mode flag', () => {
  it('--mode audit sets all steps to read', () => {
    // Test that buildStepModes('audit', STEPS) returns all read
  });

  it('--mode improve sets non-locked to write and excludes locked', () => {
    // Test that buildStepModes('improve', STEPS) skips locked
  });

  it('--list --json includes mode and locked fields', () => {
    // Test JSON output shape
  });

  it('--list text output shows mode badge', () => {
    // Test printStepList output
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run test/cli-extended.test.js -t "--mode"`
Expected: FAIL

**Step 3: Write implementation**

Add Commander options (after line 816):

```js
.option('--mode <preset>', 'Run mode preset: default, audit, improve')
.option('--step-modes <json>', 'Per-step mode overrides as JSON (internal, used by GUI)')
```

Add helper function to build step modes from preset:

```js
function buildStepModesFromPreset(preset, steps) {
  const modes = {};
  for (const step of steps) {
    if (preset === 'audit') {
      modes[step.number] = 'read';
    } else if (preset === 'improve') {
      modes[step.number] = step.mode === 'read-locked' ? 'read' : 'write';
    } else {
      modes[step.number] = step.mode === 'read-locked' ? 'read' : step.mode;
    }
  }
  return modes;
}
```

Modify `selectSteps()` to return `{ steps, stepModes }` — after step selection, add mode selection prompt:

After existing step selection (line 497), before the return, add:

```js
// Mode selection (interactive only)
if (process.stdin.isTTY && !opts.mode) {
  const { default: select } = await import('@inquirer/select');
  const writeCount = selected.filter(s => s.mode !== 'read-locked' && s.mode !== 'read').length;
  const readCount = selected.length - writeCount;
  const preset = await select({
    message: 'Run mode:',
    choices: [
      { name: `Default (${writeCount} write, ${readCount} read)`, value: 'default' },
      { name: 'Audit Only (all read — analysis reports only)', value: 'audit' },
      { name: 'Improvement Only (write steps only, skip read-only analysis)', value: 'improve' },
    ],
  });
  opts.mode = preset;
}

const stepModes = buildStepModesFromPreset(opts.mode || 'default', selected);

// If 'improve' mode, filter out read-locked steps
if (opts.mode === 'improve') {
  selected = selected.filter(s => s.mode !== 'read-locked');
}

return { steps: selected, stepModes };
```

Update callers of `selectSteps()` to destructure `{ steps, stepModes }`.

Modify `--list --json` (line 829-836):

```js
if (opts.list && opts.json) {
  const steps = STEPS.map(s => ({
    number: s.number,
    name: s.name,
    description: extractStepDescription(s.prompt),
    mode: s.mode || 'write',
    locked: s.mode === 'read-locked',
  }));
  console.log(JSON.stringify({ steps }));
  process.exit(0);
}
```

Modify `printStepList()` (lines 555-568) to show mode:

```js
function printStepList() {
  console.log(chalk.cyan(`\nAvailable steps (${STEPS.length} total):\n`));
  const numWidth = String(STEPS.length).length;
  for (const step of STEPS) {
    const num = String(step.number).padStart(numWidth);
    const mode = step.mode || 'write';
    const modeTag = mode === 'read-locked' ? chalk.blue('[read-locked]')
      : mode === 'read' ? chalk.blue('[read]')
      : chalk.green('[write]');
    const desc = extractStepDescription(step.prompt);
    if (desc) {
      console.log(`  ${num}. ${step.name} ${modeTag}`);
      console.log(chalk.dim(`      ${desc}`));
    } else {
      console.log(`  ${num}. ${step.name} ${modeTag}`);
    }
  }
  console.log(chalk.dim(`\nUse --steps 1,5,12 to run specific steps, or --all to run everything.`));
}
```

Modify `--init-run` handler (line 839-842) to pass modes:

```js
if (opts.initRun) {
  let modes;
  if (opts.stepModes) {
    try { modes = JSON.parse(opts.stepModes); } catch {
      console.log(JSON.stringify({ success: false, error: '--step-modes must be valid JSON' }));
      process.exit(1);
    }
  } else if (opts.mode) {
    modes = buildStepModesFromPreset(opts.mode, STEPS);
  }
  const result = await initRun(projectDir, { steps: opts.steps, timeout: timeoutMs, skipDashboard: opts.skipDashboard, skipSync: opts.skipSync, modes });
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}
```

Modify `executeRunFlow()` to pass stepModes (line 682):

```js
const executionResults = await executeSteps(selected, projectDir, {
  signal: ctx.abortController.signal,
  timeout: ctx.timeoutMs,
  stepModes: ctx.stepModes,
  ...buildStepCallbacks(ctx.spinner, selected, ctx.dashState, { ctx, projectDir }),
});
```

Update welcome banner (line 507): `43` → `44`.

**Step 4: Run tests**

Run: `npx vitest run test/cli.test.js test/cli-extended.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js test/cli-extended.test.js
git commit -m "feat: add --mode preset flag, --step-modes for GUI, interactive mode prompt"
```

---

## Task 6: Sync mode preservation

**Files:**
- Modify: `src/sync.js:336-355` (buildNewManifest)
- Test: `test/sync.test.js`

**Step 1: Write failing tests**

Add to `test/sync.test.js`:

```js
describe('mode preservation during sync', () => {
  it('preserves mode field from existing manifest entries', () => {
    const sections = [{ heading: 'Documentation', htmlContent: '<p>prompt text</p>', index: 0 }];
    const manifest = { version: 1, sourceUrl: 'x', steps: [{ id: '01-documentation', name: 'Documentation', mode: 'write' }] };
    const result = matchToManifest(filterPromptSections(sections), manifest);
    // Verify the matched entry preserves the original entry with mode
    expect(result.matched[0].entry.mode).toBe('write');
  });

  it('never overwrites read-locked mode', () => {
    const oldManifest = { version: 1, sourceUrl: 'x', steps: [
      { id: '04-test-architecture', name: 'Test Architecture', mode: 'read-locked' }
    ]};
    // buildNewManifest should preserve mode
    // ... setup sections and matchResult ...
    // Verify output has mode: 'read-locked'
  });

  it('defaults new prompts to write mode', () => {
    // When a prompt is added that doesn't exist in manifest
    // It should get mode: 'write' by default
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run test/sync.test.js -t "mode preservation"`
Expected: FAIL

**Step 3: Write implementation**

In `src/sync.js`, modify `buildNewManifest()` (lines 316-356).

The key change is at line 340 — preserve mode from old entry:

```js
if (m) {
  const cleanName = stripNumberPrefix(m.entry.name);
  const newId = headingToId(stepNumber, cleanName);
  newSteps.push({ id: newId, name: cleanName, _oldId: m.entry.id, mode: m.entry.mode || 'write' });
} else if (a) {
  const cleanName = stripNumberPrefix(a.heading);
  const newId = headingToId(stepNumber, cleanName);
  newSteps.push({ id: newId, name: cleanName, _oldId: null, mode: 'write' });
}
```

And at line 353, preserve mode in the output:

```js
steps: newSteps.map(({ id, name, mode }) => ({ id, name, mode })),
```

**Step 4: Run tests**

Run: `npx vitest run test/sync.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync.js test/sync.test.js
git commit -m "feat: preserve mode field during prompt sync, default new prompts to write"
```

---

## Task 7: GUI mode preset bar + per-step toggle badges

**Files:**
- Modify: `gui/resources/index.html:56-64`
- Modify: `gui/resources/app.js:729-764` (renderStepChecklist, getCheckedSteps, updateStepCount, selectAllSteps)
- Modify: `gui/resources/logic.js` (add buildStepModes)
- Modify: `gui/resources/styles.css:235-268`
- Test: `test/gui-logic.test.js`

**Step 1: Write failing tests**

Add to `test/gui-logic.test.js`:

```js
describe('buildStepModes', () => {
  it('returns mode map from steps and checked numbers', () => {
    const steps = [
      { number: 1, name: 'A', mode: 'write' },
      { number: 2, name: 'B', mode: 'read' },
      { number: 3, name: 'C', mode: 'read-locked' },
    ];
    const overrides = { 1: 'read', 2: 'read', 3: 'read' };
    const result = NtLogic.buildStepModes(steps, [1, 2, 3], overrides);
    expect(result).toEqual({ 1: 'read', 2: 'read', 3: 'read' });
  });

  it('respects read-locked — cannot override to write', () => {
    const steps = [{ number: 3, name: 'C', mode: 'read-locked' }];
    const overrides = { 3: 'write' };
    const result = NtLogic.buildStepModes(steps, [3], overrides);
    expect(result[3]).toBe('read');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run test/gui-logic.test.js -t "buildStepModes"`
Expected: FAIL

**Step 3: Write implementation**

Add to `gui/resources/logic.js` before the `globalThis.NtLogic` export:

```js
function buildStepModes(steps, checkedSteps, overrides) {
  const modes = {};
  for (const num of checkedSteps) {
    const step = steps.find(s => s.number === num);
    if (!step) continue;
    if (step.mode === 'read-locked') {
      modes[num] = 'read';
    } else if (overrides && overrides[num]) {
      modes[num] = overrides[num];
    } else {
      modes[num] = step.mode === 'read-locked' ? 'read' : (step.mode || 'write');
    }
  }
  return modes;
}
```

Add `buildStepModes` to the `NtLogic` export object.

Modify `gui/resources/index.html` — add mode bar before step-checklist (after line 63):

```html
<div class="mode-bar" id="mode-bar">
  <span class="mode-label">Run mode:</span>
  <button class="mode-btn active" id="btn-mode-default" type="button">Default</button>
  <button class="mode-btn" id="btn-mode-audit" type="button">Audit Only</button>
  <button class="mode-btn" id="btn-mode-improve" type="button">Improvement</button>
</div>
```

Modify `gui/resources/app.js` — update `renderStepChecklist()` (line 729):

```js
function renderStepChecklist() {
  const container = document.getElementById('step-checklist');
  const projectPath = document.getElementById('steps-project-path');
  projectPath.textContent = state.projectDir;

  container.innerHTML = state.steps.map(s => {
    const mode = s.mode || 'write';
    const isLocked = mode === 'read-locked';
    const displayMode = isLocked ? 'read' : mode;
    const badgeClass = displayMode === 'read' ? 'mode-read' : 'mode-write';
    const badgeText = displayMode === 'read' ? 'R' : 'W';
    const lockIcon = isLocked ? ' \u{1F512}' : '';
    const lockedClass = isLocked ? ' mode-locked' : '';
    return `
    <label class="step-check-item">
      <input type="checkbox" value="${s.number}" checked>
      <span class="step-num">${s.number}.</span>
      <span class="step-label">${NtLogic.escapeHtml(s.name)}</span>
      <span class="mode-badge ${badgeClass}${lockedClass}" data-step="${s.number}" ${isLocked ? '' : 'role="button" tabindex="0"'}>${badgeText}${lockIcon}</span>
    </label>
  `}).join('');

  updateStepCount();
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateStepCount);
  });
  container.querySelectorAll('.mode-badge:not(.mode-locked)').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isRead = badge.classList.contains('mode-read');
      badge.classList.toggle('mode-read', !isRead);
      badge.classList.toggle('mode-write', isRead);
      badge.textContent = isRead ? 'W' : 'R';
      updateStepCount();
    });
  });
}
```

Update `updateStepCount()`:

```js
function updateStepCount() {
  const checked = getCheckedSteps();
  const badges = document.querySelectorAll('#step-checklist .mode-badge');
  let writeCount = 0, readCount = 0;
  badges.forEach(b => {
    const stepNum = parseInt(b.dataset.step, 10);
    if (checked.includes(stepNum)) {
      if (b.classList.contains('mode-write')) writeCount++;
      else readCount++;
    }
  });
  const total = checked.length;
  document.getElementById('step-count-badge').textContent =
    `${writeCount} write + ${readCount} read = ${total} selected`;
  document.getElementById('btn-start-run').disabled = total === 0;
}
```

Add mode preset button handlers + mode data collection in `startRun()`. In `bindEvents()` (after line 2189), add:

```js
document.getElementById('btn-mode-default').addEventListener('click', () => applyModePreset('default'));
document.getElementById('btn-mode-audit').addEventListener('click', () => applyModePreset('audit'));
document.getElementById('btn-mode-improve').addEventListener('click', () => applyModePreset('improve'));
```

Add `applyModePreset()`:

```js
function applyModePreset(preset) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-mode-${preset}`).classList.add('active');

  document.querySelectorAll('#step-checklist .mode-badge').forEach(badge => {
    const stepNum = parseInt(badge.dataset.step, 10);
    const step = state.steps.find(s => s.number === stepNum);
    if (!step) return;
    const isLocked = step.mode === 'read-locked';
    const cb = badge.closest('.step-check-item').querySelector('input[type="checkbox"]');

    if (preset === 'audit') {
      badge.classList.remove('mode-write');
      badge.classList.add('mode-read');
      badge.textContent = isLocked ? 'R \u{1F512}' : 'R';
    } else if (preset === 'improve') {
      if (isLocked) {
        cb.checked = false;
      } else {
        badge.classList.remove('mode-read');
        badge.classList.add('mode-write');
        badge.textContent = 'W';
        cb.checked = true;
      }
    } else {
      // default
      const defaultMode = isLocked ? 'read' : (step.mode || 'write');
      badge.classList.toggle('mode-read', defaultMode === 'read');
      badge.classList.toggle('mode-write', defaultMode === 'write');
      badge.textContent = defaultMode === 'read' ? (isLocked ? 'R \u{1F512}' : 'R') : 'W';
      cb.checked = true;
    }
  });
  updateStepCount();
}
```

Add `getStepModes()`:

```js
function getStepModes() {
  const modes = {};
  document.querySelectorAll('#step-checklist .mode-badge').forEach(badge => {
    const stepNum = parseInt(badge.dataset.step, 10);
    modes[stepNum] = badge.classList.contains('mode-write') ? 'write' : 'read';
  });
  return modes;
}
```

Modify `startRun()` (line 786) to include `--step-modes`:

```js
const modes = getStepModes();
const modesArg = ` --step-modes '${JSON.stringify(modes)}'`;
const args = `--init-run ${stepArgs}${timeoutArg}${modesArg} --skip-dashboard --skip-sync`;
```

Also add `stepModes` to `saveRunState()` and `reconnectToRun()`.

Add CSS to `gui/resources/styles.css` after `.step-check-item .step-label` (line 268):

```css
.mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}
.mode-label {
  color: var(--text-dim);
  font-size: 0.78rem;
}
.mode-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-btn:hover { border-color: var(--cyan); }
.mode-btn.active {
  background: var(--cyan);
  color: var(--bg);
  border-color: var(--cyan);
}
.mode-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  transition: all 0.15s;
}
.mode-badge.mode-write {
  background: rgba(80, 200, 120, 0.15);
  color: #50c878;
  border: 1px solid rgba(80, 200, 120, 0.3);
}
.mode-badge.mode-read {
  background: rgba(100, 149, 237, 0.15);
  color: #6495ed;
  border: 1px solid rgba(100, 149, 237, 0.3);
}
.mode-badge.mode-locked {
  opacity: 0.6;
  cursor: default;
}
```

**Step 4: Run tests**

Run: `npx vitest run test/gui-logic.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add gui/resources/index.html gui/resources/app.js gui/resources/logic.js gui/resources/styles.css test/gui-logic.test.js
git commit -m "feat: GUI mode preset bar, per-step toggle badges, and step count breakdown"
```

---

## Task 8: Update documentation + step counts

**Files:**
- Modify: `CLAUDE.md` (step count references, manifest format, CLI flags, state format)
- Modify: `scripts/check-docs-freshness.js` (if step count is hardcoded — it's dynamic, uses STEPS.length)
- Modify: `.claude/memory/prompts.md` (step count reference)

**Step 1: Update CLAUDE.md**

Search and replace all instances of "43" that refer to step count:
- Project description line: "43 AI-driven" → "44 AI-driven"
- Manifest description: "43 entries" → "44 entries"
- Welcome banner: "43 codebase improvement steps" → "44 codebase improvement steps"
- Prompt files count: "43 individual markdown" → "44 individual markdown"
- Step count in module map: any "43 steps" → "44 steps"
- Test descriptions referencing step counts
- Project structure `steps/` comment

Add to manifest format docs:
```
Each entry has: `id` (kebab-case filename), `name` (display name), `mode` ("write" | "read" | "read-locked")
```

Add to Conventions or Security section:
```
- **Mode preambles**: executor.js injects READ_PREAMBLE or WRITE_PREAMBLE between SAFETY_PREAMBLE and the step prompt. Read mode skips doc-update, fallback commit, and fast-completion detection. Post-step commit guard warns if a read-mode step produces commits.
```

Add `--mode` and `--step-modes` to the CLI commands table.

Update orchestrator state format to mention `stepModes`.

**Step 2: Update prompts.md**

Update "Exactly 43 entries" → "Exactly 44 entries" (or whatever the current phrasing is).

**Step 3: Verify docs freshness**

Run: `node scripts/check-docs-freshness.js`
Expected: PASS

**Step 4: Commit**

```bash
git add CLAUDE.md .claude/memory/prompts.md scripts/check-docs-freshness.js
git commit -m "docs: update step count to 44, document mode feature in CLAUDE.md"
```

---

## Task 9: Update contract tests + smoke tests

**Files:**
- Modify: `test/contracts.test.js`
- Modify: `test/smoke.test.js`

**Step 1: Update contracts.test.js**

Add tests verifying:
- `executor.js` exports `READ_PREAMBLE` and `WRITE_PREAMBLE`
- `executeSingleStep` accepts `mode` option
- `executeSteps` accepts `stepModes` option
- `orchestrator.js` `STATE_VERSION` is 2
- State file includes `stepModes`

Update any existing tests that reference step count 43.

**Step 2: Update smoke.test.js**

Update structural checks for manifest (should have `mode` field).
Update step count from 43 to 44 if hardcoded.

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add test/contracts.test.js test/smoke.test.js
git commit -m "test: update contract and smoke tests for mode feature + 44 steps"
```

---

## Task 10: Run full test suite + flaky check

**Step 1: Run full test suite with coverage**

Run: `npm run test:ci`
Expected: PASS, coverage thresholds met

**Step 2: Run flaky check**

Run: `npm run test:flaky`
Expected: 3/3 passes, no flakiness

**Step 3: Run docs freshness**

Run: `npm run check:docs`
Expected: PASS

**Step 4: Final commit if any fixups needed**

---

## Task 11: Edit Google Doc step #26

**Files:**
- External: Google Doc step 26 (Cost & Resource Optimization)

**Step 1: Use gog skill to edit the Google Doc**

Remove the "READ-ONLY for infrastructure" split language from step #26. Make it purely write mode — the step should analyze AND implement code-level optimizations on a branch.

**Step 2: Run sync to verify**

Run: `npx nightytidy --sync-dry-run`
Expected: Step 26 shows as updated, no other unexpected changes

---

## Execution Dependencies

```
Task 1 (manifest) ← no deps
Task 2 (loader) ← Task 1
Task 3 (executor) ← Task 2
Task 4 (orchestrator) ← Task 3
Task 5 (CLI) ← Task 4
Task 6 (sync) ← Task 1
Task 7 (GUI) ← Task 5
Task 8 (docs) ← Tasks 1-7
Task 9 (tests) ← Tasks 1-7
Task 10 (validation) ← Tasks 8-9
Task 11 (Google Doc) ← independent
```

Tasks 6 and 11 can run in parallel with the main chain (Tasks 1→2→3→4→5→7).
