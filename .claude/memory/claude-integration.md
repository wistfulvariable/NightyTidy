# Claude Code Integration — Tier 2 Reference

Assumes CLAUDE.md loaded. Subprocess wrapper in `src/claude.js` (187 lines).

## Spawn Modes

Short prompts (< 8000 chars): `spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] })`
Long prompts (>= 8000 chars): `spawn('claude', [], { stdio: ['pipe', 'pipe', 'pipe'] })` + stdin write

## Windows Handling

1. All spawns use `shell: platform() === 'win32'` initially
2. On ENOENT error (Windows): re-spawn with `shell: true`
3. The ENOENT fallback logic in `runOnce()` is complex — duplicates timeout/event handling

## Success Criteria

`success = (exitCode === 0) && (stdout.trim().length > 0)`

- Exit 0 with empty/whitespace stdout → treated as failure → triggers retry
- Non-zero exit → failure → triggers retry

## Result Object Shape

```js
{
  success: boolean,
  output: string,      // stdout content
  error: string|null,  // error message or null on success
  exitCode: number,    // -1 for internal errors (timeout, spawn failure)
  duration: number,    // ms from first attempt to final result
  attempts: number,    // 1-based count of attempts made
}
```

## Timeout Behavior

1. `setTimeout` fires after `timeoutMs`
2. `child.kill()` called immediately
3. 5-second grace period, then `child.kill('SIGKILL')`
4. Resolves with `{ success: false, error: 'Claude Code timed out...' }`

## Retry Flow

```
attempt 1 → fail → sleep(10s) → attempt 2 → fail → sleep(10s) → attempt 3 → fail → sleep(10s) → attempt 4 → fail → return failure
```

Total attempts = `retries + 1` (default: 4 total).

## Public API

Single export: `runPrompt(prompt, cwd, options?)`

Options:
- `timeout` — override DEFAULT_TIMEOUT
- `retries` — override DEFAULT_RETRIES
- `label` — descriptive name for logging

## Internal Functions (not exported)

- `sleep(ms)` — Promise-based delay
- `spawnClaude(prompt, cwd, useShell)` — creates child process
- `runOnce(prompt, cwd, timeoutMs)` — single attempt with timeout
