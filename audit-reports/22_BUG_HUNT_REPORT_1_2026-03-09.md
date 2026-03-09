# Bug Hunt Report -- Audit #22 (2026-03-09)

Thorough audit of all source files in `src/`, `gui/`, and `bin/`. Every file read, every comparison and async call inspected.

## Files Audited

| Directory | Files Read | Lines |
|-----------|-----------|-------|
| `bin/` | 1 | 3 |
| `src/` | 17 | ~2,400 |
| `gui/` | 4 | ~730 |
| **Total** | **22** | **~3,130** |

---

## Findings Summary

| ID | Severity | Confidence | File | Bug | Fix? |
|----|----------|-----------|------|-----|------|
| BH-01 | Medium | 95% | `gui/server.js` | `shutdownHandler` calls `process.exit(0)` immediately, making `server.close()` drain and force timer dead code | Document only |
| BH-02 | Low | 85% | `gui/server.js` | `handleRunCommand` -- both `close` and `error` events can fire, calling `sendJson` twice on the same response | Document only |
| BH-03 | Low | 90% | `gui/server.js` | `handleReadFile` allows reading arbitrary files with no path validation (not sandboxed) | Document only |
| BH-04 | Low | 85% | `gui/server.js` | `handleRunCommand` passes unsanitized user input to shell -- command injection if server is network-exposed | Document only |
| BH-05 | Low | 90% | `checks.js` | `runCommand` -- both `error` and `close` events can fire, resolving and rejecting the same promise | Document only |
| BH-06 | Low | 80% | `dashboard.js` | `handleStop` -- after `req.destroy()` the `end` event may still fire, writing to an already-sent response | Document only |
| BH-07 | Low | 80% | `dashboard-standalone.js` | Same `handleStop` double-response pattern as dashboard.js | Document only |
| BH-08 | Low | 75% | `orchestrator.js` | `buildExecutionResults` missing `totalDuration` field -- `report.js` `generateReport` needs it for report header but in `finishRun` it is calculated separately and not passed | Document only |
| BH-09 | Info | 90% | `orchestrator.js:179` | Variable `info` shadows the imported `info` from logger.js when parsing dashboard server stdout | Fix |
| BH-10 | Low | 85% | `gui/resources/app.js` | `runCli` hardcodes `'Windows'` platform -- GUI on macOS/Linux would generate wrong `cd` command | Document only |
| BH-11 | Low | 80% | `dashboard-standalone.js` | `progressPath` uses forward-slash path join (`${projectDir}/nightytidy-progress.json`) instead of `path.join`, could fail on Windows with paths containing mixed separators | Document only |
| BH-12 | Info | 90% | `gui/resources/app.js` | `resetApp` sets `pollTimer = null` and `elapsedTimer = null` without calling `clearInterval` first -- timers leak if reset is called while running | Document only |

---

## Detailed Findings

### BH-01: `gui/server.js` -- shutdownHandler exits immediately, bypassing cleanup

**Location**: `gui/server.js:372-377`

```js
function shutdownHandler() {
  cleanup();
  const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_EXIT_MS);
  forceTimer.unref();
  process.exit(0);  // <-- exits immediately
}
```

**Bug**: `cleanup()` calls `server.close()`, which is async and waits for connections to drain. But `process.exit(0)` runs synchronously on the very next line, killing the process before `server.close()` can complete. The force timer (`setTimeout`) is dead code because the process exits before it could ever fire.

**Impact**: Active HTTP responses (e.g., a long-running `run-command`) will be abruptly terminated rather than gracefully drained. The comment says "the 5s timeout guarantees the process terminates" but the process already exits at line 376.

**Confidence**: 95%

**Classification**: Document only. Fixing this requires changing the shutdown flow to wait for `server.close()` callback, which is a behavioral change. The current behavior (immediate exit) is acceptable for a local dev tool.

---

### BH-02: `gui/server.js` -- double `sendJson` on error+close

**Location**: `gui/server.js:157-165`

```js
proc.on('close', (exitCode) => {
  if (id) activeProcesses.delete(id);
  sendJson(res, { ok: true, exitCode: exitCode ?? 1, stdout, stderr });
});

proc.on('error', (err) => {
  if (id) activeProcesses.delete(id);
  sendJson(res, { ok: false, error: err.message });
});
```

**Bug**: When a spawn error occurs (e.g., ENOENT), Node.js emits both `error` and `close` events. This would call `sendJson` twice on the same `res` object. The second `res.writeHead()` will throw "Cannot set headers after they are sent" -- but this exception is uncaught and would crash the server.

**Impact**: Low -- only triggers on spawn failures which are unlikely in normal operation.

**Confidence**: 85%

**Classification**: Document only. Proper fix requires a `settled` flag pattern like `claude.js` uses, which is a structural change.

---

### BH-03: `gui/server.js` -- arbitrary file read with no path validation

**Location**: `gui/server.js:198-213`

```js
async function handleReadFile(req, res) {
  const body = await readBody(req);
  const { path: filePath } = body;
  // No path validation -- reads any file on the system
  const content = await readFile(resolve(filePath), 'utf-8');
  sendJson(res, { ok: true, content });
}
```

**Bug**: Unlike `serveStatic` which validates against `RESOURCES_DIR`, `handleReadFile` reads any file path the client sends. While the server binds to `127.0.0.1`, any local process could request sensitive files (SSH keys, env files, etc).

**Impact**: Low -- server is localhost-only. But it's a defense-in-depth gap.

**Confidence**: 90%

**Classification**: Document only. The current usage is specifically for reading `nightytidy-progress.json` from the project directory. Adding path validation would require defining allowed read scopes, which is a design decision.

---

### BH-04: `gui/server.js` -- shell command injection via `handleRunCommand`

**Location**: `gui/server.js:138-146`

The `command` parameter from the POST body is passed directly to a shell. While the server is localhost-only and the GUI constructs these commands, a malicious local process could POST arbitrary shell commands.

**Confidence**: 85%

**Classification**: Document only. This is by design for the GUI (it needs to run arbitrary nightytidy commands), but worth noting.

---

### BH-05: `checks.js` -- promise resolve+reject race in `runCommand`

**Location**: `checks.js:10-36`

```js
child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
child.on('close', (code) => {
  if (timer) clearTimeout(timer);
  resolve({ code, stdout, stderr });
});
```

**Bug**: On spawn failure, both `error` and `close` fire. The promise is rejected first (from error), then resolved (from close). JavaScript promises handle this safely (the second settlement is a no-op), but the `clearTimeout` and data processing in the `close` handler still execute unnecessarily.

**Impact**: None -- JavaScript promise semantics make this safe. But it's a code smell.

**Confidence**: 90%

**Classification**: Document only. No behavioral impact.

---

### BH-06: `dashboard.js` -- `handleStop` double-response after body too large

**Location**: `dashboard.js:64-92`

```js
req.on('data', chunk => {
  body += chunk;
  if (body.length > MAX_BODY_BYTES) {
    req.destroy();
    res.writeHead(413, ...);
    res.end(...);
    return;  // only returns from the data callback
  }
});
req.on('end', () => {
  // This still fires after req.destroy() on some Node versions
  // Could write to already-ended response
});
```

**Bug**: After `req.destroy()` and sending a 413 response, the `end` event handler may still fire (implementation-dependent). If it does, it would attempt to write headers/body to the already-ended response, throwing an uncaught error.

**Impact**: Low -- 1KB limit is rarely hit. If hit, the error would be caught by Node's default handler and logged to stderr.

**Confidence**: 80%

**Classification**: Document only. Same pattern exists in `dashboard-standalone.js:88-115` (BH-07).

---

### BH-08: `orchestrator.js` -- `buildExecutionResults` missing `totalDuration`

**Location**: `orchestrator.js:70-86`

```js
function buildExecutionResults(state) {
  // ...
  return {
    results: allStepResults.map(...),
    completedCount: state.completedSteps.length,
    failedCount: state.failedSteps.length,
    // Missing: totalDuration
  };
}
```

In `finishRun` (line 379-403), `buildExecutionResults` is called and its return value is passed to `generateReport`. The `report.js` `generateReport` function calculates duration from `metadata.endTime - metadata.startTime` (not from `executionResults.totalDuration`), so this is not actually a bug in the current code flow. However, in `cli.js` the `executeSteps` result includes `totalDuration` and it is used in `handleAbortedRun` (line 114). The inconsistency between the two code paths means `handleAbortedRun` could fail if called with orchestrator-style results.

**Impact**: None in current usage -- `handleAbortedRun` is only called from `cli.js` interactive mode, not from orchestrator mode.

**Confidence**: 75%

**Classification**: Document only.

---

### BH-09: Variable shadowing -- `info` from logger.js

**Location**: `orchestrator.js:179`

```js
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
  if (output.includes('\n')) {
    clearTimeout(timer);
    child.stdout.removeAllListeners();
    child.unref();
    try {
      const info = JSON.parse(output.trim());  // <-- shadows logger's info()
      return resolve({ url: info.url, pid: info.pid });
    } catch {
      resolve(null);
    }
  }
});
```

**Bug**: The local `const info` shadows the imported `info` function from `./logger.js` (imported at line 6). This is not a functional bug because the shadowed `info` is only used for `info.url` and `info.pid` property access (not as a logger call). However, it prevents logging within that try block if needed in the future, and is a code quality issue.

**Impact**: None currently. Could confuse future maintainers.

**Confidence**: 90%

**Fix**: Rename the local variable to avoid shadowing. This is mechanical and safe.

---

### BH-10: `gui/resources/app.js` -- hardcoded Windows platform

**Location**: `gui/resources/app.js:79`

```js
async function runCli(args) {
  const cmd = NtLogic.buildCommand(state.projectDir, args, 'Windows');
```

**Bug**: The platform argument is hardcoded to `'Windows'`. On macOS or Linux, `buildCommand` would generate `cd /d "..."` (Windows-only syntax) instead of `cd "..."`.

**Impact**: Low -- the GUI `server.js` comment says "Windows-first" and the GUI is primarily designed for Windows. However, the `server.js` itself handles all platforms (Chrome detection, folder dialog, etc.), so this would break the GUI on non-Windows platforms.

**Confidence**: 85%

**Classification**: Document only. Fixing requires platform detection in the browser, which could use the server API or a new endpoint.

---

### BH-11: `dashboard-standalone.js` -- non-portable path construction

**Location**: `dashboard-standalone.js:22-23`

```js
const progressPath = `${projectDir}/nightytidy-progress.json`;
const urlFilePath = `${projectDir}/nightytidy-dashboard.url`;
```

**Bug**: Uses forward-slash string concatenation instead of `path.join()`. While Node.js on Windows usually handles forward slashes in file paths, this is inconsistent with the rest of the codebase which uses `path.join()` for path construction. Edge cases with UNC paths or paths ending in backslash could produce double separators.

**Impact**: Very low -- the paths work in practice on all platforms.

**Confidence**: 80%

**Classification**: Document only.

---

### BH-12: `gui/resources/app.js` -- timer leak in `resetApp`

**Location**: `gui/resources/app.js:537-562`

```js
function resetApp() {
  // ...
  state.pollTimer = null;    // <-- does NOT call clearInterval first
  state.elapsedTimer = null;  // <-- does NOT call clearInterval first
  // ...
}
```

**Bug**: If `resetApp()` is called while timers are still running (e.g., user clicks "New Run" during a run), the `pollTimer` and `elapsedTimer` intervals continue firing in the background because their references are overwritten without clearing. The `stopProgressPolling()` and `stopElapsedTimer()` functions exist but are not called before nulling.

Note: `finishRun()` does call these stop functions, but `resetApp()` can also be reached directly via the "New Run" button on the summary screen. If the user clicks "New Run" before `finishRun` fully completes (e.g., during error state), the timers would leak.

**Impact**: Low -- leaked timers would make API calls to a potentially invalid server and update UI elements. No crash, just wasted resources.

**Confidence**: 90%

**Classification**: Document only. The `resetApp` function is only accessible from the summary screen, which is shown after `finishRun` completes. The timers should already be stopped by then. However, in error paths (e.g., finish-run fails), the timers could theoretically still be running.

---

## Patterns Searched With No Issues Found

| Pattern | Result |
|---------|--------|
| `==` vs `===` in code | Clean -- all comparisons use strict equality |
| `parseInt` without radix | Clean -- all calls use radix 10 |
| `.sort()` without comparator | Clean -- no bare sort calls |
| `async forEach` | Clean -- no async forEach patterns |
| Unhandled `.then()` (missing `.catch()`) | Clean -- no raw `.then()` chains |
| Variable shadowing (critical) | One instance (BH-09), non-functional |
| Off-by-one in loops | Clean -- all loop bounds correct |
| Missing `await` on async calls | Clean -- all async calls properly awaited |

---

## Bugs Fixed

### BH-09 Fix: Rename shadowed `info` variable in orchestrator.js

The local `const info = JSON.parse(...)` shadows the imported `info` logger function. Renamed to `parsed` for clarity.

---

## Overall Assessment

The codebase is well-written with consistent patterns. The audit found:

- **0 high-severity bugs**
- **1 medium-severity issue** (BH-01: shutdown handler exits immediately, but acceptable for local dev tool)
- **9 low-severity issues** (mostly edge cases in error paths that don't trigger in normal usage)
- **2 informational findings** (shadowing, timer leak in error path)

The `gui/server.js` has the most findings (4), which is expected for a server handling HTTP requests from arbitrary clients. The core NightyTidy modules (`executor.js`, `claude.js`, `git.js`, `report.js`) are clean.

Key defensive patterns that prevent bugs:
- `settled` flag in `claude.js` prevents double-resolution
- CSRF tokens on all POST endpoints
- Atomic file writes (write-to-temp-then-rename) for state
- Error contracts enforced by contract tests
- `robustCleanup()` for Windows temp dir handling

---

*Generated by NightyTidy Audit #22 -- Bug Hunt*
