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
- **Env allowlist**: `cleanEnv()` filters env vars through an allowlist (system, locale, Anthropic/Claude/Git prefixes). CLAUDECODE explicitly blocked. Unknown vars logged via debug().
- **Permissions**: All calls include `--dangerously-skip-permissions` (no TTY for tool approval).

## Safety Preamble

`SAFETY_PREAMBLE` from `executor.js` prepended to every prompt. Prevents Claude from: deleting files, creating/switching branches, running destructive git commands.

## Success Criteria

`success = (exitCode === 0) && (stdout.trim().length > 0)`

Exit 0 with empty stdout → failure → retry. Non-zero exit → failure → retry.

## Output Format

All calls include `--output-format stream-json --verbose`. Claude CLI v2.1.29+ requires `--verbose` when combining `--print` with `--output-format stream-json` (without it, CLI exits 1 immediately). NDJSON events arrive at **turn boundaries** (not token-by-token). Event types: `system` (init/hooks), `assistant` (full turn content), `user` (tool results), `result` (final summary with cost). The `stream_event` handler in `formatStreamEvent` is forward-compat code — CLI v2.1.29 never emits it. `user` events produce brief "← result received" markers for GUI liveness. `parseJsonOutput()` extracts cost from the `result` event. Falls back gracefully if output isn't valid JSON (old CLI → `cost: null`).

## Result Object

```js
{ success, output, error, exitCode, duration, attempts, cost }
// cost: { costUSD, inputTokens, outputTokens, numTurns, durationApiMs, sessionId } | null
```

- `costUSD`: server-computed total cost (not calculated locally — no model pricing needed)
- `inputTokens`: sum of `usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens` (total input context)
- `outputTokens`: `usage.output_tokens`
- `exitCode: -1` for internal errors. `attempts`: 1-based count. `cost: null` on failure, abort, or when CLI doesn't support JSON output.

## Timeout → Retry → Abort

- **Timeout**: SIGTERM → 5s grace → SIGKILL → `{ success: false, error: 'timed out' }`
- **Retry**: `attempt 1 → fail → sleep(10s) → ... → attempt 4 → return failure`
- **Abort signal**: threads `runPrompt → runOnce → waitForChild → child.kill()`. Retry sleep short-circuits. Already-aborted signal skips spawn entirely.

## Auth Check (in checks.js)

Two-phase: silent `claude -p "Say OK"` (30s timeout) → interactive `stdio: 'inherit'` fallback.

## API

Export: `runPrompt(prompt, cwd, { timeout?, retries?, label?, signal? })`

Internal: `sleep(ms, signal)`, `spawnClaude()`, `setupTimeout()`, `setupAbortHandler()`, `waitForChild()`, `runOnce()`

Shared: `cleanEnv()` from `src/env.js` — imported by both `claude.js` and `checks.js`. Uses allowlist approach (see env.test.js for coverage).
