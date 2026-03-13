# Cost Display Clarity & API Key Support

**Date**: 2026-03-13
**Status**: Draft
**Scope**: Two features — (1) clarify that cost displays are estimates, (2) support API key authentication for users without a Claude Code subscription.

---

## 1. Cost Display Clarity

### Problem

Dollar amounts shown in the GUI, reports, and orchestrator output are calculated from token counts using Anthropic API pricing. Claude Code subscription users pay a flat monthly fee — the dollar amounts are not actual charges. This is not communicated anywhere.

### Solution

Every dollar amount gets two treatments:

1. **Suffix**: `$7.94` becomes `$7.94 (est.)`
2. **Tooltip**: Hovering shows *"Estimated cost based on Anthropic API token pricing. Not an actual charge for Claude Code subscription users."*

### Where It Applies

| Location | Change |
|----------|--------|
| GUI: per-step cost | Suffix + tooltip |
| GUI: running totals bar | Suffix + tooltip |
| GUI: summary screen | Suffix + tooltip |
| Markdown report: cost column header | `(est.)` suffix |
| Markdown report: footer | One-line disclaimer |
| Orchestrator JSON | Add `costIsEstimate: true` field |

### What Doesn't Change

- Token counts — those are actual measured values, not estimates.
- Cost extraction logic from Claude Code output.

### Implementation Notes

- **Two separate `formatCost()` functions** exist: `gui/resources/logic.js` (browser) and `src/report.js` (Node). Both get the `(est.)` suffix. All call sites of `formatCost()` in `logic.js` must be audited during implementation to confirm none do string matching on the output (e.g., in `parseCliOutput()`). The suffix is appended by `formatCost()` itself, so it propagates everywhere automatically.
- **`costIsEstimate: true`** is added once at the top level of orchestrator JSON responses (e.g., `--init-run`, `--finish-run`), not repeated per-step.

### Files Changed

- `gui/resources/logic.js` — `formatCost()` appends ` (est.)`
- `gui/resources/app.js` — add `title` attribute to cost elements for tooltip
- `gui/resources/styles.css` — tooltip styling (dotted underline on cost elements to hint hover)
- `src/report.js` — `formatCost()` appends ` (est.)`, cost column header updated, footer disclaimer added
- `src/orchestrator.js` — add `costIsEstimate: true` to top-level JSON responses

---

## 2. API Key Support

### Problem

NightyTidy currently requires a Claude Code subscription. Users without a subscription (potential public users) cannot use the tool, even if they have an Anthropic API key.

### Solution

Allow users to authenticate via Anthropic API key. Claude Code CLI is still required (it's free to install) — it handles the actual agentic work. The API key is passed to Claude Code via the `ANTHROPIC_API_KEY` environment variable.

### Architecture Decision

NightyTidy does NOT call the Anthropic API directly. It continues to spawn `claude` CLI as a subprocess. Claude Code supports `ANTHROPIC_API_KEY` natively. This keeps the architecture unchanged and avoids reimplementing Claude Code's agentic capabilities.

---

## 3. Configuration & Storage

### Config File

**Location**: `~/.nightytidy/config.json`

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-6",
  "authMethod": "api_key",
  "setupComplete": true
}
```

### Key Precedence (highest to lowest)

1. `ANTHROPIC_API_KEY` environment variable
2. Config file `apiKey` field
3. Claude Code's own authentication (subscription)

**Implementation**: `spawnClaude()` calls `cleanEnv()` first, then only sets `ANTHROPIC_API_KEY` from config if it is NOT already present in the cleaned env. This ensures env var always wins over config file. See Section 8 for details.

### Security Measures

- On save, GUI shows warning: *"Your API key will be saved to ~/.nightytidy/config.json in plaintext. For better security, set the ANTHROPIC_API_KEY environment variable instead."*
- Key masked in UI after entry — shows `sk-ant-...xxxx` (last 4 chars only)
- Config file created with restrictive permissions (`0600` on Unix; user-only defaults on Windows)
- Location is `~/.nightytidy/` — outside any project directory, not at risk of accidental git commit
- "Delete API Key" button in Settings removes the key from the config file

### New Module: `src/config.js`

Reads/writes `~/.nightytidy/config.json`.

**Exports**: `loadConfig()`, `saveConfig()`, `getApiKey()`, `getModel()`, `AVAILABLE_MODELS`

**Error contract**: Never throws — returns defaults on missing/corrupt file. Logs warnings via `logger.debug()` wrapped in try/catch (same defensive pattern as `env.js` line 95) so it is safe to call before `initLogger()`.

**Dependencies**: `node:fs`, `node:path`, `../logger.js` (defensive — tolerates uninitialized logger).

**Validation**: `saveConfig()` validates API key format before writing — key must start with `sk-ant-`. Invalid keys are rejected with a returned error, not thrown.

**Model constants**: `AVAILABLE_MODELS` array is defined in `config.js` as the single source of truth. GUI and any future CLI references import from here. Model IDs will need manual updates when Anthropic releases new models — this is intentional (no dynamic fetching).

---

## 4. Model Selection

### Available Models

| Model | ID | Speed | Quality | Relative Cost |
|-------|----|-------|---------|---------------|
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fastest | Good | $ |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Fast | Great | $$ |
| Claude Opus 4.6 | `claude-opus-4-6` | Slower | Best | $$$$$ |

### Where It Appears

- Onboarding wizard (Screen 3): model picker with cost comparison table
- GUI Settings screen: dropdown to change model anytime
- CLI: not exposed — CLI users set env var or edit config file directly

### How It Works

- `config.js` stores the model ID
- `claude.js` appends `--model <modelId>` to spawn args when a model is configured
- If no model is configured (subscription users), no `--model` flag — Claude Code uses its default
- Default for new API key users: `claude-sonnet-4-6`

### What We Don't Do

- No per-step model override — same model for the whole run
- No real-time price-per-token display — cost comparison table is sufficient

---

## 5. Pre-Check Enhancement

### Current Behavior

`checks.js` throws terse errors when Claude Code isn't found or auth fails.

### New Behavior

Context-aware, actionable error messages with setup guidance.

#### Scenario 1 — Claude Code not installed

```
Claude Code CLI not found.

To install (free):
  npm install -g @anthropic-ai/claude-code

Then authenticate with either:
  - Claude Code subscription: run "claude" and follow the login prompts
  - Anthropic API key: set ANTHROPIC_API_KEY=sk-ant-... in your environment
    or configure it in the NightyTidy GUI Settings

Need an API key? Get one at console.anthropic.com
```

#### Scenario 2 — Installed but not authenticated

```
Claude Code is installed but not authenticated.

Authenticate with either:
  - Claude Code subscription: run "claude" and follow the login prompts
  - Anthropic API key: set ANTHROPIC_API_KEY=sk-ant-... in your environment
    or configure it in the NightyTidy GUI Settings

Need an API key? Get one at console.anthropic.com
```

#### Scenario 3 — API key invalid (caught by verification)

```
Your API key was rejected by Anthropic. Please check that:
  - The key starts with "sk-ant-"
  - The key hasn't been revoked at console.anthropic.com
  - Your account has available credits
```

### Where This Lives

- `checks.js` — enhanced error messages in existing check functions
- GUI — same messages rendered in onboarding wizard or as error banners

### Files Changed

- `src/checks.js` — import `config.js`, config-aware auth check, new error messages
- `src/claude.js` — import `config.js`, inject API key and model at spawn time

---

## 6. First-Run Onboarding Wizard (GUI)

### Trigger

GUI launches and detects either:
- (a) Claude Code not installed, or
- (b) Claude Code installed but no valid authentication (no subscription, no env var, no config file key)

Detection via `/setup-status` endpoint on page load.

### Flow — 4 Screens

#### Screen 1 — Welcome

> "Welcome to NightyTidy! Let's get you set up. NightyTidy uses Claude Code to make AI-driven improvements to your codebase."

Two buttons:
- "I have a Claude Code subscription" → skip to Screen 4 (verification)
- "I'll use an API key" → Screen 2

If `ANTHROPIC_API_KEY` is already set in the environment (detected by `/setup-status`), show: "API key detected in environment. Ready to verify." → skip to Screen 4.

If Claude Code isn't installed, a banner at top:
> "Claude Code CLI not found. Install it first: `npm install -g @anthropic-ai/claude-code`"

With a "Check Again" button that re-calls `/setup-status`.

#### Screen 2 — API Key Entry

- Input field (password type, masked after entry, last 4 chars visible)
- Plaintext storage warning: *"Your API key will be saved to ~/.nightytidy/config.json in plaintext. For better security, set the ANTHROPIC_API_KEY environment variable instead."*
- Expandable section: **"How to set an environment variable"** with OS-specific instructions:
  - **Windows**: "Open Start, search 'Environment Variables', click 'Edit the system environment variables', click 'Environment Variables', under User variables click 'New', set name to `ANTHROPIC_API_KEY` and value to your key. Restart your terminal."
  - **macOS/Linux (bash/zsh)**: "Add `export ANTHROPIC_API_KEY=sk-ant-your-key` to `~/.bashrc` or `~/.zshrc`, then run `source ~/.bashrc` or open a new terminal."
- Link: "Need an API key? Get one at console.anthropic.com"
- Button: "Next"

#### Screen 3 — Model Selection

- Cost comparison table (from Section 4)
- Radio buttons for each model, default selected: Sonnet 4.6
- Note: *"You can change this anytime in Settings."*
- Button: "Next"

#### Screen 4 — Verification

- "Verifying your setup..." — spawns Claude Code with a minimal prompt via `/verify-setup` endpoint
- Timeout: 15 seconds
- Success: green checkmark, "You're all set!" → button to enter main GUI
- Failure: shows context-aware error from Section 5 with retry button

### Re-Entry

Once verification passes, `setupComplete: true` is saved to config. On subsequent launches, the GUI calls `/setup-status` which performs a lightweight auth check (not the full wizard). If auth has become invalid (revoked key, expired subscription), the user sees the main screen with an error banner and a link to Settings — NOT the full wizard again. The `setupComplete` flag means "user has been through onboarding" not "auth is currently valid." The pre-check in `checks.js` remains the actual auth validation gate at run time.

### Settings Screen

Accessible anytime from a gear icon in the GUI header (all screens except during active runs):

- API key field (masked, with change/delete buttons)
- Model dropdown
- Auth method indicator: "Using: API key" or "Using: Claude Code subscription" or "Using: ANTHROPIC_API_KEY env var"
- "How to set an environment variable" expandable section (same content as onboarding)

---

## 7. GUI Server Endpoints

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config` | Returns current config (API key masked to last 4 chars) |
| POST | `/config` | Saves config (API key, model, authMethod) |
| DELETE | `/config/api-key` | Removes API key from config file |
| POST | `/verify-setup` | Spawns Claude Code with minimal prompt, returns success/failure |
| GET | `/setup-status` | Returns `{ claudeInstalled, authenticated, setupComplete }` |

### Security

- All endpoints bound to `127.0.0.1` only (existing pattern)
- Body size limits on POST (existing 1MB limit applies)
- `/config` GET never returns the full API key — always masked
- `/verify-setup` has a 15-second timeout to avoid hanging
- `/verify-setup` allows only one concurrent verification — subsequent calls while one is running return `409 Conflict`. Debounced to one call per 10 seconds to prevent subprocess spam.

### GUI-Side (`app.js`)

- On load, calls `/setup-status` — routes to wizard or main screen
- Wizard screens call `/config` POST and `/verify-setup` as user progresses
- Settings screen calls `/config` GET to populate, POST to save, DELETE to remove key
- Settings accessible from gear icon in header

---

## 8. Changes to Claude Code Subprocess

### `claude.js` Changes

API key and model injection happens inside `spawnClaude()` (which owns the `env` option on `spawn()`), not in `runPrompt()`:

1. `spawnClaude()` calls `cleanEnv()` to build the base environment
2. If `ANTHROPIC_API_KEY` is NOT already in the cleaned env, call `getApiKey()` — if it returns a key, add it to the env object
3. Call `getModel()` — if it returns a model ID, append `--model <modelId>` to the args array

This keeps all env construction in `spawnClaude()` where it belongs. `runPrompt()` is unchanged.

The existing `cleanEnv()` allowlist already passes `ANTHROPIC_*` through — no change needed to `env.js`.

### `checks.js` Changes

Auth check becomes config-aware:
- If `getApiKey()` returns a key, set it in the environment before running auth verification
- Error messages replaced with actionable ones from Section 5

### What Doesn't Change

- `cleanEnv()` allowlist
- Subprocess spawn pattern (still `claude` CLI, still NDJSON streaming)
- Error classification, retry logic, rate-limit handling
- Session continue (`--continue`)

### New Dependency Chain

```
claude.js → config.js (new, lightweight)
checks.js → config.js (new, lightweight)
gui/server.js → config.js (for settings endpoints)
```

`config.js` depends only on `node:fs` and `node:path`.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/config.js` | **NEW** — config read/write, getApiKey(), getModel() |
| `src/claude.js` | Import config, inject API key + model at spawn time |
| `src/checks.js` | Import config, config-aware auth check, actionable error messages |
| `src/report.js` | `formatCost()` suffix, cost column header, footer disclaimer |
| `src/orchestrator.js` | Add `costIsEstimate: true` to JSON responses |
| `gui/server.js` | 5 new endpoints (/config, /config/api-key, /verify-setup, /setup-status) |
| `gui/resources/logic.js` | `formatCost()` appends ` (est.)` |
| `gui/resources/app.js` | Tooltips on cost elements, onboarding wizard screens, settings screen, gear icon |
| `gui/resources/styles.css` | Tooltip styling, wizard screen styles, settings screen styles |
| `gui/resources/index.html` | Wizard + settings screen HTML sections |

### CLAUDE.md Updates Required

During implementation, update CLAUDE.md:
- **Error Handling Strategy table**: add `config.js` row — "Never throws — returns defaults"
- **Module Map**: add `config.js` entry
- **Module Dependency Graph**: add `claude.js → config.js`, `checks.js → config.js`, `gui/server.js → config.js`
- **Environment Variables table**: add note about `ANTHROPIC_API_KEY` support
- **Security section**: add config file security notes
- **Test file count**: update if new test files added

### Windows File Permissions Note

On Windows, `~/.nightytidy/config.json` inherits ACLs from `C:\Users\<name>` which is user-only by default. We do not explicitly set Windows ACLs — this is acceptable because the parent directory already restricts access. On Unix, `0600` is set explicitly via `fs.writeFileSync` mode option.

---

## Testing Strategy

- `config.js` — unit tests: read/write/defaults/corrupt file/missing dir/permissions
- `gui-server.test.js` — new endpoint tests: /config CRUD, /verify-setup, /setup-status, verify-setup concurrency guard
- `gui-logic.test.js` — updated `formatCost()` tests for `(est.)` suffix
- `checks.test.js` / `checks-extended.test.js` — config-aware auth check paths
- `claude.test.js` — model flag injection, API key env injection, env var precedence over config
- `report.test.js` — updated cost formatting in reports
- `contracts.test.js` — add `config.js` error contract verification
- Onboarding wizard — manual testing (4-screen flow with verification) + automated tests for `/setup-status` routing logic in `gui-server.test.js`
