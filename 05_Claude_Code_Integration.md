# Claude Code Integration

## Overview

Subprocess wrapper for invoking Claude Code via `claude -p "prompt"`. This is the most critical module — it's the bridge between NightyTidy and the engine that does all the actual work. Each invocation spawns a fresh, stateless Claude Code session. Uses `child_process.spawn` (not `execFile`) to handle long-running sessions and large output without buffer limits.

## Dependencies

- `02_Logger.md` — logs subprocess activity
- `01_Project_Setup.md` — Node.js child_process (built-in)

## Module: `src/claude.js`

### Exported Interface

```javascript
// Execute a prompt via Claude Code. Returns the result.
// prompt: the full prompt string
// cwd: the project directory to run in
// options: { timeout, retries } (optional overrides)
export async function runPrompt(prompt, cwd, options = {})
```

### Return Value

```javascript
{
  success: true | false,
  output: "Claude Code's full stdout as a string",
  error: "error message if failed, null if success",
  exitCode: 0,          // raw exit code
  duration: 184000,     // milliseconds
  attempts: 1           // how many attempts (1 = succeeded first try)
}
```

### How It Works

#### Spawning Claude Code

```javascript
const child = spawn('claude', ['-p', prompt], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false   // IMPORTANT: no shell — avoids injection from prompt content
});
```

Key decisions:
- **`shell: false`** — Prompts contain arbitrary text. Running through a shell would allow prompt content to be interpreted as shell commands. Never use `shell: true` for prompt execution.
- **`stdio: ['ignore', 'pipe', 'pipe']`** — stdin ignored (non-interactive), stdout and stderr piped for capture.
- **`cwd`** — Set to the user's project directory so Claude Code operates on the right codebase.

**Windows note**: With `shell: false`, Node.js on Windows needs the exact executable name. `claude` should resolve if it's on PATH. If the user installed Claude Code via npm globally, it may be `claude.cmd`. If `spawn` fails with `ENOENT`, retry once with `{ shell: true }` as a Windows fallback, but log a warning that this is less secure.

#### Capturing Output

Collect stdout incrementally via the `data` event:

```javascript
let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
  // Also write chunk to logger at debug level for real-time log streaming
});
```

Same for stderr (capture but log at warn level).

#### Waiting for Completion

Resolve the promise on the `close` event:

```javascript
child.on('close', (code) => {
  // code 0 = success, anything else = failure
});
```

Also handle the `error` event (spawn failure — e.g., `claude` not found):

```javascript
child.on('error', (err) => {
  // ENOENT = claude not on PATH, EACCES = permissions, etc.
});
```

#### Timeout

**Default**: 30 minutes per prompt invocation.

Claude Code sessions for complex prompts can run 10-30+ minutes. The timeout is a safety net against infinite hangs, not a normal flow.

If the timeout fires:
1. Kill the child process (`child.kill('SIGTERM')`, then `SIGKILL` after 5 seconds if still alive)
2. Return `{ success: false, error: "Claude Code timed out after 30 minutes" }`

The timeout is per-attempt, not per-step (retries get their own full timeout).

On Windows, `SIGTERM` is not supported. Use `child.kill()` which sends `SIGTERM` on Unix and terminates the process tree on Windows. If the process doesn't die, `taskkill /F /PID` via a separate spawn may be needed as a last resort.

### Retry Logic

Retries are handled inside `runPrompt` so callers don't need to implement retry loops.

**Default**: 3 retries (so up to 4 total attempts: 1 initial + 3 retries).

**Retry flow**:
1. Attempt the prompt
2. If it fails (non-zero exit code or timeout), wait before retrying
3. Each retry spawns a completely fresh `claude -p` session
4. After all retries exhausted, return the failure result

**Backoff**: Fixed 10-second delay between retries. Exponential backoff is overkill — Claude Code failures are typically transient (API blip, rate limit) and resolve within seconds, or they're persistent (bad prompt, auth expired) and no amount of waiting helps.

**What counts as failure**:
- Non-zero exit code
- Timeout
- Spawn error (ENOENT, EACCES)
- Empty stdout with exit code 0 (Claude Code sometimes exits cleanly but produces no output — treat as failure)

**What does NOT trigger retry**:
- Successful exit (code 0) with non-empty stdout, even if the output content seems wrong. NightyTidy doesn't evaluate prompt quality — that's Claude Code's job.

### Logging

Every invocation logs:

```
[INFO]  Running Claude Code: Step 7 — File Decomposition (attempt 1/4)
[DEBUG] Prompt length: 2,847 chars
[DEBUG] Claude Code stdout: [streaming chunks logged in real time]
[INFO]  Claude Code completed: Step 7 — exit code 0, 184s
```

On failure:
```
[WARN]  Claude Code failed: Step 7 — exit code 1 (attempt 1/4)
[WARN]  Retrying Step 7 in 10s (attempt 2/4)
[ERROR] Claude Code failed: Step 7 — all 4 attempts exhausted
```

### Prompt Size Concerns

Some of the 28 prompts may be very long. The `-p` flag passes the prompt as a command-line argument, which has OS limits:

- **Linux/macOS**: ~2 MB argument limit (effectively unlimited for text prompts)
- **Windows**: ~8,191 character limit for a single command-line argument (cmd.exe) or ~32,767 characters (CreateProcess)

**Mitigation**: If any prompt exceeds 8,000 characters, pass it via stdin instead of `-p`:

```javascript
const child = spawn('claude', [], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.write(prompt);
child.stdin.end();
```

Check prompt length before spawning and choose the appropriate method. Log which method is used at debug level.

### Concurrency

There is none. `runPrompt` is called sequentially by the executor — one prompt at a time, one Claude Code session at a time. No concurrent invocations, no session pooling, no queue.

## Testing Notes

- **Mock `child_process.spawn`** entirely. Do not spawn real Claude Code processes in tests.
- Test cases:
  - Successful execution (exit 0, non-empty stdout)
  - Failed execution (exit 1) with retry and eventual success
  - Failed execution with all retries exhausted
  - Timeout scenario
  - Spawn error (ENOENT)
  - Empty stdout with exit 0 (treated as failure)
  - Long prompt (>8,000 chars) triggers stdin mode
- Verify retry count and backoff timing.
- Verify the returned object shape in all cases.

## Gaps & Assumptions

- **Claude Code exit codes** — The PRD doesn't document what specific exit codes Claude Code returns for different failure modes (rate limit, auth expired, API error). For MVP, treat any non-zero exit code as a generic failure. If specific codes are discovered during testing, add targeted handling.
- **Claude Code stderr** — Unknown what Claude Code writes to stderr. Capture it and log at warn level. Don't use it for success/failure determination — only exit code matters.
- **Rate limiting** — If Claude Code has built-in rate limiting that causes it to wait internally, NightyTidy's timeout needs to be generous enough to accommodate. The 30-minute timeout should cover this, but monitor during first real runs.
- **Prompt encoding** — Prompts are English text with no special encoding concerns. If prompts ever contain non-ASCII characters, ensure they're passed as UTF-8 (Node.js default).
- **`--no-input` or equivalent flag** — Claude Code may have a flag to suppress interactive prompts during `-p` mode. Investigate during development. If Claude Code ever prompts for input during a `-p` session, it will hang until timeout since stdin is ignored.
