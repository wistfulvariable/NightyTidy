# Claude Code Integration — Tier 2 Reference

Assumes CLAUDE.md loaded. Subprocess wrapper in `src/claude.js`.

## Constants

| Constant | Value |
|----------|-------|
| `DEFAULT_TIMEOUT` | 45 min (2,700,000 ms) — overridable via `--timeout` |
| `DEFAULT_RETRIES` | 3 (total attempts = 4) |
| `RETRY_DELAY` | 10,000 ms between retries |
| `STDIN_THRESHOLD` | 8,000 chars → switches to stdin pipe mode |

## Spawn Modes

- **Short** (< 8000 chars): `-p "prompt"` flag, stdin `'ignore'`
- **Long** (≥ 8000 chars): stdin `'pipe'`, write prompt + end

## Platform Rules

- **Windows**: Always `shell: true` (claude is `.cmd`). Set upfront — no ENOENT fallback. Avoids 0xC0000142 under sustained use.
- **CLAUDECODE env var**: Stripped via `cleanEnv()` before every spawn. Prevents nesting block.
- **Permissions**: All calls include `--dangerously-skip-permissions` (no TTY for tool approval).

## Safety Preamble

`SAFETY_PREAMBLE` from `executor.js` prepended to every prompt. Prevents Claude from: deleting files, creating/switching branches, running destructive git commands.

## Success Criteria

`success = (exitCode === 0) && (stdout.trim().length > 0)`

Exit 0 with empty stdout → failure → retry. Non-zero exit → failure → retry.

## Result Object

```js
{ success, output, error, exitCode, duration, attempts }
```

`exitCode: -1` for internal errors. `attempts`: 1-based count.

## Timeout → Retry → Abort

- **Timeout**: SIGTERM → 5s grace → SIGKILL → `{ success: false, error: 'timed out' }`
- **Retry**: `attempt 1 → fail → sleep(10s) → ... → attempt 4 → return failure`
- **Abort signal**: threads `runPrompt → runOnce → waitForChild → child.kill()`. Retry sleep short-circuits. Already-aborted signal skips spawn entirely.

## Auth Check (in checks.js)

Two-phase: silent `claude -p "Say OK"` (30s timeout) → interactive `stdio: 'inherit'` fallback.

## API

Export: `runPrompt(prompt, cwd, { timeout?, retries?, label?, signal? })`

Internal: `cleanEnv()`, `sleep(ms, signal)`, `spawnClaude()`, `waitForChild()`, `runOnce()`
