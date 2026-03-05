# Project Setup

## Overview

Initialize the NightyTidy project: directory structure, package.json, dependencies, entry point, .gitignore, and CLAUDE.md. This is the first thing to build — everything else depends on the project existing.

## Dependencies

- None (this is the foundation)

## Initialize

```bash
mkdir nightytidy && cd nightytidy
npm init -y
```

## package.json

```json
{
  "name": "nightytidy",
  "version": "0.1.0",
  "description": "Automated overnight codebase improvement through Claude Code",
  "type": "module",
  "bin": {
    "nightytidy": "./bin/nightytidy.js"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Key points:
- `"type": "module"` — ESM throughout, no CommonJS
- `"bin"` — makes `nightytidy` available as a global command after `npm link` or `npm install -g`
- `engines` — Node 18+ required (LTS, needed for Claude Code anyway)

## Install Dependencies

```bash
npm install commander@^12 @inquirer/checkbox@^4 ora@^8 chalk@^5 simple-git@^3 node-notifier@^10
npm install -D vitest@^2
```

**6 runtime + 1 dev dependency.** That's the full list — nothing else should be added for MVP.

| Package | Purpose | Why This One |
|---------|---------|-------------|
| commander | CLI arg parsing | Lightest major CLI framework |
| @inquirer/checkbox | Interactive step selector | Standalone package, not full Inquirer suite |
| ora | Terminal spinner | Standard, tiny |
| chalk | Colored output | Standard, tiny |
| simple-git | Git operations | Clean async wrapper around git CLI |
| node-notifier | Desktop notifications | Only mature cross-platform option |
| vitest (dev) | Testing | Native ESM, fast, Jest-compatible API |

## Entry Point

Create `bin/nightytidy.js`:

```javascript
#!/usr/bin/env node
import { run } from '../src/cli.js';
run();
```

Make executable (macOS/Linux):
```bash
chmod +x bin/nightytidy.js
```

On Windows this isn't needed — npm handles the shim via `bin` in package.json.

## Directory Structure

```bash
mkdir -p bin src/prompts test
```

Create all source files as empty stubs so imports don't fail during incremental development:

```bash
touch src/cli.js src/executor.js src/claude.js src/git.js src/checks.js src/notifications.js src/logger.js src/report.js src/prompts/steps.js
```

## .gitignore

```
node_modules/
nightytidy-run.log
*.log
.env
.DS_Store
```

Note: `nightytidy-run.log` is the runtime log written into the user's project directory. NightyTidy's own repo should also ignore it in case someone runs NightyTidy against itself during development.

## CLAUDE.md

Create a `CLAUDE.md` in the project root. This file helps Claude Code understand NightyTidy's own codebase when using Claude Code to build NightyTidy. Include:

- **Project purpose**: One-sentence description
- **Tech stack**: Node.js, ESM, no build step
- **Module map**: Brief description of each `src/*.js` file's responsibility
- **Conventions**:
  - All code is ESM (`import`/`export`, no `require`)
  - No TypeScript
  - Logger is used everywhere — never bare `console.log` in production code
  - All async operations use async/await, not callbacks
  - Error handling: every public function either handles errors or explicitly throws
- **Testing**: Vitest, run with `npm test`
- **Key architectural rule**: NightyTidy orchestrates but doesn't do the work — Claude Code does. NightyTidy's job is sequencing, git management, and reporting.

Update this file as modules are built. It should always reflect the current state of the codebase.

## Local Development Link

```bash
npm link
```

After this, `nightytidy` is available as a command from any directory. Use this for manual testing against real projects.

## .env.example

Create if any environment variables are used. For MVP, the only one is:

```
NIGHTYTIDY_LOG_LEVEL=info   # Options: debug, info, warn, error
```

This is optional — the logger defaults to `info` if unset.

## First Commit

```bash
git init
git add -A
git commit -m "Initial project setup"
```

## Gaps & Assumptions

- **npm registry publishing** is mentioned in the PRD as a future step. For MVP, installation is via `npm link` (local) or direct `npm install -g` from the repo. Publishing to npm public registry is deferred.
- **No `.nvmrc` specified** — consider adding one with `18` to pin the Node version for contributors.
- **No CI/CD** — tests run locally only for MVP.
