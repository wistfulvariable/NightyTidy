# Logger

## Overview

Custom logging utility (~50 lines). Writes timestamped, leveled log entries to both a file (`nightytidy-run.log` in the project directory) and optionally to stdout. Built first because every other module depends on it.

## Dependencies

- None (this is the first module built)

## Module: `src/logger.js`

### Exported Interface

```javascript
// Initialize with the project directory path
export function initLogger(projectDir)

// Log at specific levels
export function debug(message)
export function info(message)
export function warn(message)
export function error(message)
```

### Log Levels

| Level | When to Use | Color (stdout) |
|-------|-------------|----------------|
| `debug` | Detailed diagnostic info — Claude Code raw output, git command details | dim/gray |
| `info` | Normal operations — step started, step completed, branch created | default/white |
| `warn` | Non-fatal issues — retry triggered, disk space low | yellow |
| `error` | Failures — step failed all retries, merge conflict, Claude Code unreachable | red |

### Level Filtering

Controlled by `NIGHTYTIDY_LOG_LEVEL` environment variable:
- `debug` — show everything
- `info` — show info, warn, error (default if env var unset)
- `warn` — show warn, error only
- `error` — show errors only

Level hierarchy: `debug < info < warn < error`. A message is shown if its level is ≥ the configured level.

### Log File Behavior

- **Path**: `{projectDir}/nightytidy-run.log`
- **Mode**: Overwrite on each run (not append across runs). A new run starts a fresh log.
- **Write method**: `fs.appendFileSync` for each entry — simple, no buffering concerns, and survives crashes (each line is flushed immediately)
- **Encoding**: UTF-8

### Log Entry Format

```
[2026-02-27T23:14:07.123Z] [INFO]  Step 3/28: Test Hardening — started
[2026-02-27T23:14:07.456Z] [ERROR] Step 3/28: Test Hardening — Claude Code exited with code 1
[2026-02-27T23:47:12.789Z] [WARN]  Step 3/28: Test Hardening — retry 2/3
```

Format: `[ISO timestamp] [LEVEL]  message`

- Timestamps are always UTC ISO 8601
- Level is padded to 5 chars for alignment (`INFO `, `WARN `, `ERROR`, `DEBUG`)
- Two spaces after level for readability

### Stdout Behavior

- All log entries also print to stdout (in addition to the file)
- Stdout entries are colored using chalk (see color column in level table above)
- Stdout respects the same level filter as the file
- The executor's ora spinner should be paused before writing to stdout to avoid garbled output, then resumed. This is the caller's responsibility, not the logger's.

### Initialization

`initLogger(projectDir)` must be called once at startup before any logging. It:
1. Resolves the log file path: `path.join(projectDir, 'nightytidy-run.log')`
2. Creates/overwrites the log file with an empty string (clears previous run)
3. Stores the path and resolved log level in module-level variables

If `initLogger` hasn't been called, all log functions should throw with a clear message: `"Logger not initialized. Call initLogger(projectDir) first."`

### Usage Pattern

```javascript
import { initLogger, info, error } from './logger.js';

initLogger('/Users/dorian/my-project');
info('NightyTidy starting');
error('Claude Code not found');
```

## Implementation Notes

- This is ~50 lines of code. Do not use winston, pino, or any logging library.
- Use `fs.appendFileSync` — not async. The synchronous write is intentional: log entries must survive crashes, and the performance cost is negligible for a tool that writes a few hundred lines over several hours.
- Import chalk at the top of the module for coloring stdout output.
- The log file is designed to be watched in real time: `tail -f nightytidy-run.log` from another terminal.

## Gaps & Assumptions

- **Log rotation**: Not needed. Each run overwrites the previous log. If users want to preserve logs across runs, that's a post-MVP feature (run history).
- **Structured logging (JSON)**: Not needed. The log is human-readable, designed for `tail -f`. Machine-parseable logs are out of scope.
- **Max log file size**: No cap. A full 28-step run will produce a few hundred to a few thousand lines — negligible disk usage.
