# Cost Display Clarity & API Key Support — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cost estimates visually clear across the GUI/reports, and support API key authentication for users without a Claude Code subscription.

**Architecture:** Two independent features sharing one plan. Feature 1 (cost clarity) modifies `formatCost()` in two files and adds tooltips. Feature 2 (API key support) adds a new `src/config.js` module for API key/model storage, wires it into `spawnClaude()` and `checks.js`, extends existing GUI server endpoints, and enhances the existing onboarding wizard + settings modal.

**Tech Stack:** Node.js ESM, Vitest, plain HTML/CSS/JS GUI (no framework), `node:fs`/`node:path` for config.

**Spec:** `docs/superpowers/specs/2026-03-13-cost-clarity-and-api-key-support-design.md`

**Existing GUI infrastructure to integrate with (DO NOT create parallel versions):**
- Config storage: `~/.nightytidy/config.json` — read via `POST /api/user-config`, write via `POST /api/save-config`
- Wizard: `<section id="screen-wizard">` with 4-check checklist (Node, Git, Claude CLI, Claude Auth)
- Settings modal: `<div id="settings-overlay">` with timeout + auto-sync + "Re-run Setup Wizard"
- Prerequisites: `POST /api/check-prerequisites` returns `{ checks: { node, git, claude, claudeAuth }, setupComplete }`
- Setup completion: `POST /api/complete-setup` sets `setupComplete: true`
- Init flow in `app.js`: `loadConfigAsync()` → `checkForActiveRun()` → show wizard or setup screen

---

## Chunk 1: Cost Display Clarity

### Task 1: Cost Estimate Suffix in `formatCost()` — GUI + Report

**Files:**
- Modify: `gui/resources/logic.js:128-131` — `formatCost()` function
- Modify: `src/report.js:180-183` — `formatCost()` function
- Test: `test/gui-logic.test.js:172-192` — existing formatCost tests
- Test: `test/report.test.js` — existing cost formatting tests
- Test: `test/report-extended.test.js` — may contain cost string assertions

- [ ] **Step 1: Update GUI formatCost tests for `(est.)` suffix**

In `test/gui-logic.test.js`, update the `formatCost` describe block. Change every expected output to include ` (est.)`:

```javascript
it.each([
  [0.1234, '$0.12 (est.)', 'typical cost'],
  [0, '$0.00 (est.)', 'zero cost'],
  [1.5, '$1.50 (est.)', 'pads to 2 decimals'],
  [0.00001, '$0.00 (est.)', 'rounds tiny cost'],
  [12.3456789, '$12.35 (est.)', 'rounds large cost'],
])('formats %s -> "%s" (%s)', (input, expected, _desc) => {
  expect(NtLogic.formatCost(input)).toBe(expected);
});
```

Null-input tests stay unchanged (they return `null`, not a formatted string).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/gui-logic.test.js -t "formatCost"`
Expected: FAIL — tests expect `(est.)` suffix but current code returns bare `$X.XX`

- [ ] **Step 3: Update GUI `formatCost()` implementation**

In `gui/resources/logic.js`, change line 131:

```javascript
function formatCost(costUSD) {
  if (costUSD === null || costUSD === undefined || !Number.isFinite(costUSD)) return null;
  return '$' + costUSD.toFixed(2) + ' (est.)';
}
```

- [ ] **Step 4: Run GUI logic tests to verify they pass**

Run: `npx vitest run test/gui-logic.test.js -t "formatCost"`
Expected: PASS

- [ ] **Step 5: Audit `formatCost()` call sites**

Search `gui/resources/logic.js` and `gui/resources/app.js` for all references to `formatCost`. Verify none do string matching or parsing on the output. Confirmed safe: all call sites use output for `.textContent` or HTML interpolation only. `parseCliOutput()` in `logic.js` does not reference `formatCost`. `test/report-edge-cases.test.js` has no cost string assertions — safe. Document this in the commit message.

- [ ] **Step 6: Update report.js `formatCost()` and cost column header tests**

In `test/report.test.js`:
1. Find tests checking cost strings like `$0.12` or `$1.50` and update to `$0.12 (est.)` etc.
2. Find `buildStepTable` tests checking cost column header `| Cost |` and update to `| Cost (est.) |`
3. Find `buildSummarySection` tests checking `**Total cost**:` and update.

Also check `test/report-extended.test.js` for any cost string assertions and update those too.

- [ ] **Step 7: Run report tests to verify they fail**

Run: `npx vitest run test/report.test.js test/report-extended.test.js`
Expected: FAIL — tests expect `(est.)` suffix and updated column header

- [ ] **Step 8: Update report.js implementation**

In `src/report.js`:

1. Change the `formatCost` function (~line 180):
```javascript
function formatCost(costUSD) {
  if (costUSD == null) return null;
  return `$${costUSD.toFixed(2)} (est.)`;
}
```

2. Change the cost column header in `buildStepTable()` (~line 247) from `'Cost'` to `'Cost (est.)'`.

- [ ] **Step 9: Run report tests to verify they pass**

Run: `npx vitest run test/report.test.js test/report-extended.test.js`
Expected: PASS

- [ ] **Step 10: Add report footer disclaimer**

In `src/report.js`, find the function that assembles the final markdown report. After the step table (and after cost/token summary if present), add a conditional disclaimer — only when cost data exists:

```javascript
if (metadata.totalCostUSD != null) {
  report += '\n> **Note:** Cost figures are estimates based on Anthropic API token pricing and do not reflect actual charges for Claude Code subscription users.\n';
}
```

Update the corresponding test to verify the disclaimer appears when costs exist and does NOT appear when costs are null.

- [ ] **Step 11: Run all report tests**

Run: `npx vitest run test/report.test.js test/report-extended.test.js test/report-edge-cases.test.js`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add gui/resources/logic.js src/report.js test/gui-logic.test.js test/report.test.js test/report-extended.test.js
git commit -m "feat: add (est.) suffix to cost displays in GUI and reports

Cost column header now shows 'Cost (est.)'. Report footer includes
disclaimer when cost data present. Audited all formatCost call sites."
```

---

### Task 2: Cost Tooltips in GUI + Orchestrator `costIsEstimate` Flag

**Files:**
- Modify: `gui/resources/app.js` — add `title` attribute to cost elements
- Modify: `gui/resources/styles.css` — dotted underline on cost elements
- Modify: `src/orchestrator.js` — add `costIsEstimate: true` to top-level JSON responses
- Test: `test/orchestrator.test.js` — add `costIsEstimate` assertion

- [ ] **Step 1: Add tooltip to per-step cost elements in app.js**

In `gui/resources/app.js`, find the cost rendering at ~line 857-860 where `costEl.textContent` is set. The existing code checks `if (costStr)` — add tooltip inside that guard:

```javascript
if (costStr) {
  costEl.textContent = costStr;
  costEl.title = 'Estimated cost based on Anthropic API token pricing. Not an actual charge for Claude Code subscription users.';
}
```

- [ ] **Step 2: Add tooltip to running totals cost in app.js**

In `gui/resources/app.js`, find the running totals HTML at ~line 930. Update the cost span:

```javascript
html += `<span class="cost" title="Estimated cost based on Anthropic API token pricing. Not an actual charge for Claude Code subscription users.">${NtLogic.formatCost(cachedTotalCost)}</span>`;
```

- [ ] **Step 3: Add tooltip to summary screen cost elements in app.js**

Find ALL cost display locations in the summary screen:
1. The total cost stat card (~line 1901-1906)
2. The per-step cost column in the summary step list table

Add the same `title` attribute to each cost-displaying element.

- [ ] **Step 4: Add dotted underline CSS for cost tooltips**

In `gui/resources/styles.css`, add after the existing `.step-cost` rule (~line 583):

```css
.step-cost[title],
.running-totals .cost[title],
.stat-value[title] {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: help;
}
```

- [ ] **Step 5: Add orchestrator `costIsEstimate` test**

In `test/orchestrator.test.js`, find the first success-path `finishRun` test (~line 582 where `result` is captured). Add:

```javascript
expect(result.costIsEstimate).toBe(true);
```

- [ ] **Step 6: Run orchestrator test to verify it fails**

Run: `npx vitest run test/orchestrator.test.js -t "finishRun"`
Expected: FAIL — `costIsEstimate` not present

- [ ] **Step 7: Add `costIsEstimate: true` to orchestrator JSON responses**

In `src/orchestrator.js`, find the `finishRun()` return object (~lines 837-860). Add `costIsEstimate: true` at top level. Do NOT add to `initRun()` — it doesn't return cost data.

- [ ] **Step 8: Run orchestrator tests**

Run: `npx vitest run test/orchestrator.test.js`
Expected: PASS

- [ ] **Step 9: Run full test suite to catch ripple effects**

Run: `npx vitest run`
Expected: ALL PASS. The `(est.)` suffix propagates through `formatCost()` everywhere. If any tests fail from string matching on cost output, fix them.

- [ ] **Step 10: Commit**

```bash
git add gui/resources/app.js gui/resources/styles.css src/orchestrator.js test/orchestrator.test.js
git commit -m "feat: add cost estimate tooltips in GUI and costIsEstimate flag in orchestrator"
```

---

## Chunk 2: Configuration Module

### Task 3: Create `src/config.js` Module

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`
- Modify: `test/contracts.test.js` — add config.js contract

**Important: Test isolation** — `config.js` has module-level cached state (`cachedConfig`). Every test describe block MUST use `vi.resetModules()` in `beforeEach` and dynamic `import()` to get a fresh module instance. Also export a `resetConfig()` function for test use.

- [ ] **Step 1: Write config.js contract test**

In `test/contracts.test.js`, add a new describe block. **Note:** config.js has a top-level `await import('./logger.js')` — the existing contract test pattern uses `vi.doMock` which runs after top-level await. Since the logger call is wrapped in try/catch, this is safe (the real logger import fails or is mocked, either way config.js handles it). If the existing contracts file already has a hoisted `vi.mock('../src/logger.js')`, the `doMock` below may be unnecessary — follow whatever pattern the other contract blocks use:

```javascript
describe('contract: config.js — never throws, returns defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../src/logger.js', () => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/logger.js');
    vi.restoreAllMocks();
  });

  it('loadConfig returns object with defaults when config file missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig('/nonexistent/path');
    expect(config).toBeDefined();
    expect(config).toHaveProperty('apiKey');
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('authMethod');
    expect(config).toHaveProperty('setupComplete');
  });

  it('getApiKey returns null when no config exists', async () => {
    const { getApiKey } = await import('../src/config.js');
    expect(getApiKey()).toBeNull();
  });

  it('getModel returns null when no config exists', async () => {
    const { getModel } = await import('../src/config.js');
    expect(getModel()).toBeNull();
  });
});
```

- [ ] **Step 2: Run contract test to verify it fails**

Run: `npx vitest run test/contracts.test.js -t "config.js"`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write config.js unit tests**

Create `test/config.test.js`. **Critical**: every describe block uses `vi.resetModules()` in `beforeEach` to get fresh module state:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Hoisted mock — prevents real logger import
vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));

describe('config.js', () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();  // CRITICAL: fresh module instance every test
    tempDir = mkdtempSync(join(tmpdir(), 'nightytidy-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns defaults when config dir does not exist', async () => {
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig(join(tempDir, 'nonexistent'));
      expect(config.apiKey).toBeNull();
      expect(config.model).toBeNull();
      expect(config.authMethod).toBeNull();
      expect(config.setupComplete).toBe(false);
    });

    it('returns defaults when config file is corrupt JSON', async () => {
      const configDir = join(tempDir, '.nightytidy');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), 'not json!!!');
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig(configDir);
      expect(config.apiKey).toBeNull();
    });

    it('reads valid config file', async () => {
      const configDir = join(tempDir, '.nightytidy');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        apiKey: 'sk-ant-test123',
        model: 'claude-sonnet-4-6',
        authMethod: 'api_key',
        setupComplete: true,
      }));
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig(configDir);
      expect(config.apiKey).toBe('sk-ant-test123');
      expect(config.model).toBe('claude-sonnet-4-6');
      expect(config.setupComplete).toBe(true);
    });
  });

  describe('saveConfig', () => {
    it('creates config dir and writes file', async () => {
      const configDir = join(tempDir, '.nightytidy');
      const { saveConfig, loadConfig } = await import('../src/config.js');
      const result = saveConfig(configDir, { apiKey: 'sk-ant-abc123', model: 'claude-sonnet-4-6' });
      expect(result.error).toBeUndefined();
      expect(existsSync(join(configDir, 'config.json'))).toBe(true);
      const saved = loadConfig(configDir);
      expect(saved.apiKey).toBe('sk-ant-abc123');
    });

    it('rejects invalid API key format', async () => {
      const configDir = join(tempDir, '.nightytidy');
      const { saveConfig } = await import('../src/config.js');
      const result = saveConfig(configDir, { apiKey: 'invalid-key' });
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/sk-ant-/);
    });

    it('allows saving without API key (subscription mode)', async () => {
      const configDir = join(tempDir, '.nightytidy');
      const { saveConfig } = await import('../src/config.js');
      const result = saveConfig(configDir, { model: 'claude-sonnet-4-6', setupComplete: true });
      expect(result.error).toBeUndefined();
    });

    it('returns error on filesystem failure (read-only dir)', async () => {
      const { saveConfig } = await import('../src/config.js');
      // Use a path that will fail (e.g., root-level on Unix, or non-writable)
      const result = saveConfig('/dev/null/impossible/path', { model: 'claude-sonnet-4-6' });
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/Failed to save config/);
    });
  });

  describe('getApiKey / getModel', () => {
    it('returns null when no config loaded and default path has no file', async () => {
      const { getApiKey, getModel } = await import('../src/config.js');
      // Will attempt loadConfig() with default ~/.nightytidy path
      // If no config file exists there, returns null
      expect(getApiKey()).toBeNull();
      expect(getModel()).toBeNull();
    });

    it('returns values after loadConfig', async () => {
      const configDir = join(tempDir, '.nightytidy');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        apiKey: 'sk-ant-xyz789',
        model: 'claude-opus-4-6',
      }));
      const { loadConfig, getApiKey, getModel } = await import('../src/config.js');
      loadConfig(configDir);
      expect(getApiKey()).toBe('sk-ant-xyz789');
      expect(getModel()).toBe('claude-opus-4-6');
    });
  });

  describe('resetConfig', () => {
    it('clears cached state', async () => {
      const configDir = join(tempDir, '.nightytidy');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        apiKey: 'sk-ant-cached',
      }));
      const { loadConfig, getApiKey, resetConfig } = await import('../src/config.js');
      loadConfig(configDir);
      expect(getApiKey()).toBe('sk-ant-cached');
      resetConfig();
      // After reset, getApiKey triggers fresh loadConfig from default path
      // which likely has no apiKey, so returns null (or whatever is at default)
    });
  });

  describe('AVAILABLE_MODELS', () => {
    it('exports frozen array of model objects', async () => {
      const { AVAILABLE_MODELS } = await import('../src/config.js');
      expect(Array.isArray(AVAILABLE_MODELS)).toBe(true);
      expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(3);
      for (const model of AVAILABLE_MODELS) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('relativeCost');
      }
      // Verify frozen
      expect(() => AVAILABLE_MODELS.push({})).toThrow();
    });
  });
});
```

- [ ] **Step 4: Run config tests to verify they fail**

Run: `npx vitest run test/config.test.js`
Expected: FAIL — module doesn't exist

- [ ] **Step 5: Implement `src/config.js`**

Create `src/config.js`:

```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Defensive logger import — tolerates uninitialized logger
let debug = () => {};
try { ({ debug } = await import('./logger.js')); } catch { /* logger may not be initialized */ }

const DEFAULT_CONFIG_DIR = join(homedir(), '.nightytidy');
const CONFIG_FILE = 'config.json';

const DEFAULTS = {
  apiKey: null,
  model: null,
  authMethod: null,
  setupComplete: false,
};

export const AVAILABLE_MODELS = Object.freeze([
  Object.freeze({ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', speed: 'Fastest', quality: 'Good', relativeCost: '$' }),
  Object.freeze({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', speed: 'Fast', quality: 'Great', relativeCost: '$$' }),
  Object.freeze({ id: 'claude-opus-4-6', name: 'Claude Opus 4.6', speed: 'Slower', quality: 'Best', relativeCost: '$$$$$' }),
]);

let cachedConfig = null;

export function loadConfig(configDir = DEFAULT_CONFIG_DIR) {
  try {
    const filePath = join(configDir, CONFIG_FILE);
    if (!existsSync(filePath)) {
      try { debug(`Config file not found at ${filePath}, using defaults`); } catch { /* */ }
      return { ...DEFAULTS };
    }
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedConfig = { ...DEFAULTS, ...parsed };
    return { ...cachedConfig };
  } catch (err) {
    try { debug(`Failed to load config: ${err.message}`); } catch { /* */ }
    return { ...DEFAULTS };
  }
}

export function saveConfig(configDir = DEFAULT_CONFIG_DIR, updates = {}) {
  try {
    if (updates.apiKey && !updates.apiKey.startsWith('sk-ant-')) {
      return { error: 'Invalid API key format. Key must start with "sk-ant-".' };
    }
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    const existing = loadConfig(configDir);
    const merged = { ...existing, ...updates };
    const filePath = join(configDir, CONFIG_FILE);
    writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    cachedConfig = merged;
    try { debug(`Config saved to ${filePath}`); } catch { /* */ }
    return { error: undefined };
  } catch (err) {
    try { debug(`Failed to save config: ${err.message}`); } catch { /* */ }
    return { error: `Failed to save config: ${err.message}` };
  }
}

export function getApiKey() {
  if (!cachedConfig) loadConfig();
  return cachedConfig?.apiKey ?? null;
}

export function getModel() {
  if (!cachedConfig) loadConfig();
  return cachedConfig?.model ?? null;
}

/** Reset cached state — for testing only. */
export function resetConfig() {
  cachedConfig = null;
}
```

- [ ] **Step 6: Run config tests**

Run: `npx vitest run test/config.test.js`
Expected: PASS

- [ ] **Step 7: Run contract tests**

Run: `npx vitest run test/contracts.test.js -t "config.js"`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/config.js test/config.test.js test/contracts.test.js
git commit -m "feat: add config.js module for API key and model configuration"
```

---

### Task 4: Wire Config into `spawnClaude()` and `checks.js`

**Files:**
- Modify: `src/claude.js:188-220` — inject API key + model in `spawnClaude()`
- Modify: `src/checks.js:162-196` — config-aware auth check + actionable errors
- Test: `test/claude.test.js` — test API key env injection + model flag
- Test: `test/checks-extended.test.js` — test config-aware auth

**Testing strategy for claude.test.js**: The existing file uses hoisted `vi.mock()` with static imports. Add a hoisted mock for `config.js` with default null returns (won't affect existing 73 tests), then override per-test with `vi.mocked()`. Tests call `runPrompt()` (the exported function) and inspect `spawn.mock.calls[0]` to verify env and args passed to the private `spawnClaude()`.

- [ ] **Step 1: Add hoisted config mock + write tests in claude.test.js**

At the top of `test/claude.test.js`, alongside existing hoisted mocks, add:

```javascript
vi.mock('../src/config.js', () => ({
  getApiKey: vi.fn(() => null),
  getModel: vi.fn(() => null),
  AVAILABLE_MODELS: [],
  loadConfig: vi.fn(() => ({})),
  resetConfig: vi.fn(),
}));
```

Then add a describe block at the end:

```javascript
describe('config integration', () => {
  const { getApiKey, getModel } = await import('../src/config.js');

  afterEach(() => {
    vi.mocked(getApiKey).mockReturnValue(null);
    vi.mocked(getModel).mockReturnValue(null);
  });

  it('injects ANTHROPIC_API_KEY from config when not in env', async () => {
    vi.mocked(getApiKey).mockReturnValue('sk-ant-test-key');
    // Set up fake child that emits close immediately
    // Call runPrompt('test', '/tmp', { timeout: 5000, retries: 0, label: 'cfg-test' })
    // Inspect spawn.mock.calls[0][2].env — should contain ANTHROPIC_API_KEY: 'sk-ant-test-key'
  });

  it('does NOT override ANTHROPIC_API_KEY if already in process.env', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';
    vi.mocked(getApiKey).mockReturnValue('sk-ant-config-key');
    try {
      // Call runPrompt, inspect spawn env
      // env.ANTHROPIC_API_KEY should be 'sk-ant-env-key' (from cleanEnv passthrough), NOT 'sk-ant-config-key'
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  it('appends --model flag when model is configured', async () => {
    vi.mocked(getModel).mockReturnValue('claude-sonnet-4-6');
    // Call runPrompt, inspect spawn.mock.calls[0][1] (args array)
    // Should include '--model', 'claude-sonnet-4-6'
  });

  it('does not add --model flag when model is null', async () => {
    vi.mocked(getModel).mockReturnValue(null);
    // Call runPrompt, inspect args — should NOT contain '--model'
  });
});
```

- [ ] **Step 2: Run claude config tests to verify they fail**

Run: `npx vitest run test/claude.test.js -t "config integration"`
Expected: FAIL — config not imported in claude.js yet

- [ ] **Step 3: Modify `spawnClaude()` in claude.js**

In `src/claude.js`, add import at top:

```javascript
import { getApiKey, getModel } from './config.js';
```

In `spawnClaude()`, find the `env: cleanEnv()` line (~line 211). Change to build env as a local variable:

```javascript
const env = cleanEnv();

// Inject API key from config if not already in environment (env var takes precedence)
if (!env.ANTHROPIC_API_KEY) {
  const configKey = getApiKey();
  if (configKey) env.ANTHROPIC_API_KEY = configKey;
}

// Inject model from config if configured
const configModel = getModel();
if (configModel) {
  args.push('--model', configModel);
}

const child = spawn('claude', args, {
  cwd,
  stdio: [stdinMode, 'pipe', 'pipe'],
  shell: useShell,
  env,  // was: env: cleanEnv()
});
```

Note: `cleanEnv()` already returns a new object, so mutating `env` is safe.

- [ ] **Step 4: Run claude config tests**

Run: `npx vitest run test/claude.test.js -t "config integration"`
Expected: PASS

- [ ] **Step 5: Run ALL claude tests to verify no regressions**

Run: `npx vitest run test/claude.test.js`
Expected: ALL 73+ tests PASS. The hoisted config mock returns nulls by default, so existing tests are unaffected.

- [ ] **Step 6: Write checks.js tests for config-aware auth + actionable errors**

In `test/checks-extended.test.js`, add:

```javascript
describe('config-aware authentication', () => {
  it('uses API key from config when checking auth', async () => {
    // Mock config.js getApiKey to return 'sk-ant-test'
    // Mock spawn to succeed (exit 0, stdout 'OK')
    // Call the auth check
    // Inspect spawn call — env should include ANTHROPIC_API_KEY
  });

  it('shows actionable error when Claude Code not installed', async () => {
    // Mock spawn to emit 'error' with code ENOENT
    // Assert: thrown error message includes 'npm install -g @anthropic-ai/claude-code'
    // Assert: message includes 'ANTHROPIC_API_KEY'
    // Assert: message includes 'console.anthropic.com'
  });

  it('shows actionable error when auth fails', async () => {
    // Mock spawn to return exit code 1, empty stdout
    // Mock interactive auth to also fail
    // Assert: thrown error includes 'ANTHROPIC_API_KEY' and 'console.anthropic.com'
  });
});
```

- [ ] **Step 7: Run checks config tests to verify they fail**

Run: `npx vitest run test/checks-extended.test.js -t "config-aware"`
Expected: FAIL

- [ ] **Step 8: Modify `checks.js` for config-aware auth + actionable errors**

In `src/checks.js`, add import:

```javascript
import { getApiKey } from './config.js';
```

In `checkClaudeAuthenticated()`, replace the `env: cleanEnv()` in the `runCommand` call. Build env locally first:

```javascript
const env = cleanEnv();
const configKey = getApiKey();
if (configKey && !env.ANTHROPIC_API_KEY) {
  env.ANTHROPIC_API_KEY = configKey;
}

const result = await runCommand('claude', ['-p', 'Say OK'], {
  timeoutMs: AUTH_TIMEOUT_MS,
  stdio: ['ignore', 'pipe', 'pipe'],
  env,  // was: env: cleanEnv()
});
```

Update error messages to be actionable per spec Section 5 (Scenarios 1-3). Replace the terse `throw new Error(...)` messages with multi-line guidance strings.

- [ ] **Step 9: Run all checks tests**

Run: `npx vitest run test/checks-extended.test.js test/checks.test.js test/checks-timeout.test.js`
Expected: PASS

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
git add src/claude.js src/checks.js test/claude.test.js test/checks-extended.test.js
git commit -m "feat: wire config into spawnClaude and checks for API key + model support"
```

---

## Chunk 3: GUI Server Endpoints

### Task 5: Extend Existing GUI Server Endpoints for API Key/Model Support

**Files:**
- Modify: `gui/server.js` — extend existing endpoints + add 1 new endpoint
- Test: `test/gui-server.test.js` — add endpoint tests

**IMPORTANT: Reuse existing endpoints. Do NOT create new `/config`, `/verify-setup`, or `/setup-status` paths.** The spec (Section 7) originally defined standalone endpoints — this plan supersedes those paths with the `/api/`-prefixed equivalents below to avoid collisions with existing infrastructure. The existing infrastructure:
- `POST /api/user-config` → extend to include `apiKey` (masked), `model`, `authMethod`, `availableModels`
- `POST /api/save-config` → already accepts `{ config: {...} }` — extend to handle `apiKey`, `model`, `authMethod`
- `POST /api/check-prerequisites` → extend to include `envKeyDetected` flag
- `POST /api/complete-setup` → already works, no changes needed
- **NEW: `POST /api/verify-auth`** — spawns Claude Code to test auth, returns `{ ok, error }`
- **NEW: `POST /api/delete-api-key`** — removes API key from config

- [ ] **Step 1: Write tests for extended `/api/user-config`**

In `test/gui-server.test.js`:

```javascript
describe('POST /api/user-config (API key support)', () => {
  it('returns config with masked API key and availableModels', async () => {
    // Setup: save config with apiKey 'sk-ant-abcdef123456'
    // POST /api/user-config
    // Assert: response.config.apiKey === 'sk-ant-...3456'
    // Assert: response.config.model present
    // Assert: response.config.availableModels is array with 3+ entries
  });

  it('returns null apiKey when no key configured', async () => {
    // POST /api/user-config with no apiKey in config
    // Assert: response.config.apiKey === null
  });

  it('returns envKeyDetected when ANTHROPIC_API_KEY env var set', async () => {
    // Set env var temporarily
    // POST /api/user-config
    // Assert: response.config.envKeyDetected === true
  });
});
```

- [ ] **Step 2: Write tests for extended `/api/save-config`**

```javascript
describe('POST /api/save-config (API key support)', () => {
  it('saves API key and model', async () => {
    // POST { config: { apiKey: 'sk-ant-test123', model: 'claude-sonnet-4-6' } }
    // Assert: 200, { ok: true }
    // POST /api/user-config → verify saved values (apiKey masked)
  });

  it('rejects invalid API key format', async () => {
    // POST { config: { apiKey: 'bad-key' } }
    // Assert: 400, { ok: false, error: /sk-ant-/ }
  });

  it('allows saving model without apiKey', async () => {
    // POST { config: { model: 'claude-sonnet-4-6' } }
    // Assert: 200, { ok: true }
  });

  it('preserves existing config fields when saving new ones', async () => {
    // Save timeout=60 first, then save apiKey
    // Verify timeout is still 60
  });
});
```

- [ ] **Step 3: Write tests for new `/api/delete-api-key`**

```javascript
describe('POST /api/delete-api-key', () => {
  it('removes API key from config', async () => {
    // Setup: save config with apiKey
    // POST /api/delete-api-key
    // POST /api/user-config → apiKey is null
  });

  it('succeeds even when no config file exists', async () => {
    // POST /api/delete-api-key with no config
    // Assert: 200, { ok: true }
  });
});
```

- [ ] **Step 4: Write tests for new `/api/verify-auth`**

```javascript
describe('POST /api/verify-auth', () => {
  it('returns success when Claude Code responds', async () => {
    // Mock spawn to succeed quickly
    // Assert: { ok: true }
  });

  it('returns failure with actionable error when auth fails', async () => {
    // Mock spawn to fail
    // Assert: { ok: false, error: string }
  });

  it('returns 409 when verification already in progress', async () => {
    // Start first verification (slow mock)
    // Immediately start second
    // Assert: second returns 409
  });

  it('enforces 10s cooldown between calls', async () => {
    // Complete first verification
    // Immediately call again
    // Assert: 429 with { ok: false, error: /cooldown/ }
  });

  it('includes security headers on error responses', async () => {
    // Trigger 409 or 429
    // Assert: response includes SECURITY_HEADERS
  });

  it('kills subprocess on 15s timeout', async () => {
    // Mock spawn to hang
    // Assert: returns failure after ~15s, process.kill called
  });
});
```

- [ ] **Step 5: Write tests for extended `/api/check-prerequisites`**

```javascript
describe('POST /api/check-prerequisites (API key support)', () => {
  it('includes envKeyDetected in response', async () => {
    // Assert: response.checks has envKeyDetected field
  });

  it('reports authenticated when API key in config', async () => {
    // Save config with valid API key, mock Claude auth to succeed
    // Assert: response.checks.claudeAuth.ok === true
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run test/gui-server.test.js -t "API key"`
Expected: FAIL — endpoints not yet extended

- [ ] **Step 7: Implement endpoint changes in `gui/server.js`**

In `gui/server.js`, add import at top:

```javascript
import { loadConfig, saveConfig, getApiKey, AVAILABLE_MODELS, resetConfig } from '../src/config.js';
```

**Extend `handleGetConfig()` (~line 697):**
- After loading config, mask apiKey (show `sk-ant-...` + last 4 chars, or null if no key)
- Add `availableModels: AVAILABLE_MODELS` to response
- Add `envKeyDetected: !!process.env.ANTHROPIC_API_KEY`

**Extend `handleSaveConfig()` (~line 702):**
- Before merging, validate apiKey format if present (reject non-`sk-ant-` keys with 400)
- Call `saveConfig()` from `config.js` (or continue using existing file write — but prefer `config.js` for consistency)

**Add `handleDeleteApiKey()` route:**
- Load config, set `apiKey: null, authMethod: null`, save
- Return `{ ok: true }`

**Add `handleVerifyAuth()` route:**
- Guard: `let verifyInProgress = false`, `let lastVerifyTime = 0`
- If `verifyInProgress`, return 409 `{ ok: false, error: 'Verification already in progress' }`
- If `Date.now() - lastVerifyTime < 10000`, return 429 `{ ok: false, error: 'Please wait before retrying' }`
- Spawn `claude -p "Say OK"` with 15s timeout (AbortController)
- On success: `{ ok: true }`
- On failure: `{ ok: false, error: <actionable message> }`
- All responses include `SECURITY_HEADERS`

**Extend `handleCheckPrerequisites()` (~line 651):**
- Add `envKeyDetected: !!process.env.ANTHROPIC_API_KEY` to response
- Use config API key for auth check if no env var

**Route new endpoints** in the request handler switch (~line 837+):
```javascript
if (url.pathname === '/api/delete-api-key' && req.method === 'POST') return handleDeleteApiKey(res);
if (url.pathname === '/api/verify-auth' && req.method === 'POST') return handleVerifyAuth(res);
```

- [ ] **Step 8: Run endpoint tests**

Run: `npx vitest run test/gui-server.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add gui/server.js test/gui-server.test.js
git commit -m "feat: extend GUI server endpoints for API key/model support"
```

---

## Chunk 4: Onboarding Wizard & Settings UI

### Task 6: Enhance Existing Wizard + Settings Modal

**Files:**
- Modify: `gui/resources/index.html` — extend existing `#screen-wizard` + extend `#settings-overlay`
- Modify: `gui/resources/styles.css` — new styles for wizard sub-screens + settings additions

**IMPORTANT: Modify the EXISTING wizard and settings — do NOT create new sections with duplicate IDs.**

The existing `#screen-wizard` has a 4-check checklist (Node, Git, Claude, Auth) + Continue button. We need to add sub-screens for API key entry and model selection WITHIN this section, shown conditionally.

The existing `#settings-overlay` has timeout + auto-sync. We add API key, model, and auth method fields.

- [ ] **Step 1: Extend wizard HTML in index.html**

In `gui/resources/index.html`, inside the existing `<section id="screen-wizard">`, add sub-screen divs AFTER the wizard-checklist. These are hidden by default and shown via JS:

```html
<!-- API Key entry sub-screen (hidden by default) -->
<div class="wizard-subscreen" id="wizard-apikey" style="display:none">
  <h2>API Key Setup</h2>
  <p class="warning-box">Your API key will be saved to ~/.nightytidy/config.json in plaintext.
  For better security, set the ANTHROPIC_API_KEY environment variable instead.</p>

  <label for="wizard-apikey-input">Anthropic API Key</label>
  <input type="password" id="wizard-apikey-input" class="settings-input" placeholder="sk-ant-...">
  <p class="hint">Need an API key? <a href="https://console.anthropic.com" target="_blank" rel="noopener">Get one at console.anthropic.com</a></p>

  <details class="env-instructions">
    <summary>How to set an environment variable instead</summary>
    <div class="env-instructions-content">
      <h4>Windows</h4>
      <p>Open Start → search "Environment Variables" → Edit the system environment variables → Environment Variables → under User variables, click New → name: <code>ANTHROPIC_API_KEY</code>, value: your key. Restart your terminal.</p>
      <h4>macOS / Linux</h4>
      <p>Add <code>export ANTHROPIC_API_KEY=sk-ant-your-key</code> to <code>~/.bashrc</code> or <code>~/.zshrc</code>, then run <code>source ~/.bashrc</code> or open a new terminal.</p>
    </div>
  </details>

  <button class="btn btn-primary" id="btn-wizard-apikey-next" type="button">Next</button>
</div>

<!-- Model selection sub-screen (hidden by default) -->
<div class="wizard-subscreen" id="wizard-model" style="display:none">
  <h2>Choose a Model</h2>
  <div class="model-cards" id="wizard-model-cards">
    <!-- Populated by JS from AVAILABLE_MODELS -->
  </div>
  <p class="hint">You can change this anytime in Settings.</p>
  <button class="btn btn-primary" id="btn-wizard-model-next" type="button">Next</button>
</div>

<!-- Env key detected banner (hidden by default, shown on wizard-checklist screen) -->
<div class="wizard-env-detected" id="wizard-env-detected" style="display:none">
  <p>✓ API key detected in your environment. Ready to verify.</p>
</div>
```

- [ ] **Step 2: Extend settings modal in index.html**

Inside the existing `<div class="modal modal-settings">`, add new settings groups BEFORE the existing actions div:

```html
<div class="settings-group settings-divider">
  <h3>Authentication</h3>
  <div class="auth-indicator" id="settings-auth-indicator">
    <!-- Populated by JS: "Using: API key" / "Using: subscription" / "Using: env var" -->
  </div>

  <label for="settings-apikey">API Key</label>
  <div class="input-with-actions">
    <input type="password" id="settings-apikey" class="settings-input" placeholder="sk-ant-..." disabled>
    <button class="link-btn" id="btn-settings-change-key" type="button">Change</button>
    <button class="link-btn danger" id="btn-settings-delete-key" type="button">Delete</button>
  </div>

  <label for="settings-model">Model</label>
  <select id="settings-model" class="settings-input">
    <!-- Populated by JS from availableModels -->
  </select>
</div>

<details class="env-instructions">
  <summary>How to set an environment variable</summary>
  <!-- Same content as wizard -->
</details>
```

- [ ] **Step 3: Add CSS for new wizard + settings elements**

In `gui/resources/styles.css`:

```css
/* Wizard sub-screens */
.wizard-subscreen { max-width: 480px; margin: 0 auto; }
.wizard-subscreen h2 { margin-bottom: 1rem; }

/* Warning box for plaintext storage */
.warning-box {
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid var(--yellow);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: var(--yellow);
}

/* Env var instructions expandable */
.env-instructions { margin: 1rem 0; }
.env-instructions summary { cursor: pointer; color: var(--cyan); }
.env-instructions-content { padding: 12px 0; font-size: 0.85rem; }
.env-instructions-content h4 { color: var(--text); margin: 0.5rem 0 0.25rem; }
.env-instructions-content code { background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; }

/* Model cards */
.model-cards { display: flex; flex-direction: column; gap: 8px; margin: 1rem 0; }
.model-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border: 1px solid var(--border); border-radius: 6px;
  cursor: pointer; transition: border-color 0.15s;
}
.model-card:hover, .model-card.selected { border-color: var(--cyan); }
.model-card input[type="radio"] { margin: 0; }
.model-card .model-name { font-weight: 600; }
.model-card .model-meta { font-size: 0.8rem; color: var(--text-muted); }
.model-card .model-cost { margin-left: auto; color: var(--yellow); }

/* Env detected banner */
.wizard-env-detected {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid var(--green);
  border-radius: 6px;
  padding: 12px;
  margin: 1rem 0;
  color: var(--green);
}

/* Settings auth section */
.settings-divider { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem; }
.auth-indicator { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.input-with-actions { display: flex; gap: 8px; align-items: center; }
.input-with-actions .settings-input { flex: 1; }
.link-btn.danger { color: var(--red); }
```

- [ ] **Step 4: Commit**

```bash
git add gui/resources/index.html gui/resources/styles.css
git commit -m "feat: add API key/model wizard sub-screens and settings UI"
```

---

### Task 7: Wizard + Settings Logic in app.js

**Files:**
- Modify: `gui/resources/app.js` — wizard sub-screen logic, settings API key/model handlers
- Modify: `gui/resources/logic.js` — add `maskApiKey()` pure function
- Test: `test/gui-logic.test.js` — test `maskApiKey()`

**IMPORTANT: Integrate with the existing init flow.** The existing sequence is:
1. `loadConfigAsync()` → loads bin path + user config
2. `checkForActiveRun()` → page-refresh recovery (MUST take priority over wizard)
3. Show wizard if `!setupComplete`, otherwise show setup screen

The API key wizard is a sub-flow WITHIN the existing wizard, not a replacement. The existing `runPrerequisiteChecks()` handles Node/Git/Claude/Auth checks. We add auth method branching after checks complete.

- [ ] **Step 1: Add `maskApiKey()` to logic.js + test**

In `gui/resources/logic.js`, add:

```javascript
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 11) return key;  // too short to mask meaningfully
  return key.slice(0, 7) + '...' + key.slice(-4);
}
```

Export in the `NtLogic` object.

In `test/gui-logic.test.js`, add:

```javascript
describe('maskApiKey', () => {
  it('masks middle of key', () => {
    expect(NtLogic.maskApiKey('sk-ant-abcdefghij1234')).toBe('sk-ant-...1234');
  });
  it('returns null for null', () => {
    expect(NtLogic.maskApiKey(null)).toBeNull();
  });
  it('returns null for undefined', () => {
    expect(NtLogic.maskApiKey(undefined)).toBeNull();
  });
  it('returns short key unchanged', () => {
    expect(NtLogic.maskApiKey('sk-ant-abc')).toBe('sk-ant-abc');
  });
});
```

- [ ] **Step 2: Run maskApiKey tests**

Run: `npx vitest run test/gui-logic.test.js -t "maskApiKey"`
Expected: FAIL → implement → PASS

- [ ] **Step 3: Extend wizard logic in app.js**

Modify `runPrerequisiteChecks()` and wizard Continue button behavior:

After all 4 checks complete, if Claude Auth check FAILED:
- Show two buttons: "I have a subscription" (re-run auth check after user signs in) and "Use an API key" (show `#wizard-apikey` sub-screen)
- If `check-prerequisites` response has `envKeyDetected: true`, show the `#wizard-env-detected` banner and skip to verification

Wire the wizard sub-screens:
- `#btn-wizard-apikey-next`: validate key starts with `sk-ant-`, POST `/api/save-config` with `{ config: { apiKey } }`, show `#wizard-model`
- `#btn-wizard-model-next`: POST `/api/save-config` with `{ config: { model } }`, run verification
- Verification: POST `/api/verify-auth`, show spinner, on success → POST `/api/complete-setup`, show existing setup screen

Populate `#wizard-model-cards` dynamically from the `/api/user-config` response's `availableModels`.

- [ ] **Step 4: Extend settings modal logic in app.js**

Modify `openSettings()`:
- GET `/api/user-config`, populate API key (masked), model dropdown, auth indicator
- Auth indicator text: "Using: API key" / "Using: Claude Code subscription" / "Using: ANTHROPIC_API_KEY env var"

Add handlers:
- `#btn-settings-change-key`: enable input, focus it
- `#btn-settings-delete-key`: POST `/api/delete-api-key`, refresh display
- Model dropdown `change`: update state

Modify `saveSettings()`:
- Include `model` in the save payload
- If API key input was changed (not masked), include `apiKey` in payload

- [ ] **Step 5: Handle active run priority**

Ensure `checkForActiveRun()` still runs BEFORE wizard logic. In the init flow, active run recovery always takes priority — if a run is in progress, skip wizard and go straight to the running screen.

- [ ] **Step 6: Run all GUI tests**

Run: `npx vitest run test/gui-logic.test.js test/gui-server.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add gui/resources/app.js gui/resources/logic.js test/gui-logic.test.js
git commit -m "feat: implement wizard API key/model flow and settings auth management"
```

---

## Chunk 5: Documentation & Final Verification

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `config.js` to Error Handling Strategy table**

Add row: `| config.js | **Never throws** → returns defaults on missing/corrupt file |`

- [ ] **Step 2: Add `config.js` to Module Map**

Add row: `| src/config.js | API key + model configuration (~/.nightytidy/config.json) | logger |`

- [ ] **Step 3: Update Module Dependency Graph**

Add `config.js` under `cli.js`'s tree:
```
├── src/config.js            → logger (API key + model config)
```
Update `claude.js` and `checks.js` entries to show `→ config` dependency.
Update `gui/server.js` entry to show `→ config` dependency.

- [ ] **Step 4: Add ANTHROPIC_API_KEY to Environment Variables table**

Add row: `| ANTHROPIC_API_KEY | (none) | Anthropic API key — alternative to Claude Code subscription. Passed through to Claude Code subprocess. |`

- [ ] **Step 5: Add config file security notes to Security section**

Add bullet: **Config file security**: `~/.nightytidy/config.json` may contain a plaintext API key. File created with `0600` permissions on Unix; on Windows, inherits user-directory ACLs. Located outside project directories to prevent accidental git commit. GUI warns users about plaintext storage and recommends env var. `resetConfig()` exported for test isolation.

- [ ] **Step 6: Update Project Structure**

Add `src/config.js` entry with description.

- [ ] **Step 7: Update test file listing**

Add `config.test.js` with test count. Update any existing test counts that changed.

- [ ] **Step 8: Update Generated Files table**

Note: `~/.nightytidy/config.json` now may contain `apiKey`, `model`, `authMethod` fields in addition to existing `setupComplete`, `defaultTimeout`, `autoSync`.

- [ ] **Step 9: Run docs freshness check**

Run: `npm run check:docs`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with config.js module, API key support, and security notes"
```

---

### Task 9: Final Integration Test

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run coverage check**

Run: `npm run test:ci`
Expected: PASS — coverage thresholds met (90% statements, 80% branches, 80% functions)

- [ ] **Step 3: Run docs freshness check**

Run: `npm run check:docs`
Expected: PASS

- [ ] **Step 4: Run flaky test check**

Run: `npm run test:flaky`
Expected: PASS — all 3 runs green

- [ ] **Step 5: Manual end-to-end test — full checklist**

1. Remove `~/.nightytidy/config.json` (back it up first)
2. Launch GUI (`npm run gui`)
3. Verify wizard appears with prerequisite checks
4. If auth check fails, verify "Use an API key" button appears
5. Click "Use an API key" → verify API key sub-screen appears
6. Enter an invalid key → verify client-side validation rejects it
7. Enter a valid key (or use env var) → verify model selection appears
8. Select a model → verify verification step runs
9. On success → verify transition to main setup screen
10. Open Settings (gear icon) → verify API key shown masked, model shown, auth indicator correct
11. Delete API key → verify it disappears
12. Close and relaunch GUI → verify wizard does NOT reappear (setupComplete=true)
13. Set `ANTHROPIC_API_KEY` env var before launch → verify wizard detects it and shows "env key detected"
14. Start a dry run (`--dry-run`) → verify cost shows `$X.XX (est.)` suffix
15. Hover any cost → verify tooltip with estimate disclaimer appears
16. After run → verify report contains `(est.)` suffix and footer disclaimer
17. Restore original `~/.nightytidy/config.json`

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
