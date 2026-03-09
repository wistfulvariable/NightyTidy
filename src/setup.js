import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { STEPS } from './prompts/loader.js';
import { info } from './logger.js';

const MARKER_START = '## NightyTidy — Automated Codebase Improvement';
const MARKER_END = '<!-- /nightytidy -->';

function generateStepList() {
  return STEPS.map(s => `${s.number}. **${s.name}**`).join('\n');
}

export function generateIntegrationSnippet() {
  return `${MARKER_START}

NightyTidy runs AI-driven improvement steps against this codebase. It handles git branching, execution, reporting, and merging automatically.

**Only run when the user explicitly mentions "NightyTidy" by name.** Not for general "improve my code" requests.

### RULE 1 — ALWAYS ASK WHICH STEPS (NEVER SKIP)

**You are FORBIDDEN from running steps without asking.** You MUST show the step list and ask the user which steps to run BEFORE executing anything. This is not optional.

Do this EVERY TIME:

1. Run \`nightytidy --list --json\` to get the step list
2. Present the steps to the user in a readable format
3. Ask: "Which steps would you like to run? Pick numbers (e.g. 1,5,12), say 'all', or tell me what areas you care about."
4. **STOP and WAIT for the user's reply — do NOT proceed until they answer**

**If you run steps without asking the user first, you have failed this instruction.**

### RULE 2 — USE ORCHESTRATOR MODE (STEP BY STEP)

**You MUST use the step-by-step orchestrator commands.** Never use \`--all\` or run nightytidy in background mode.

After the user selects steps:

1. **Initialize**: \`nightytidy --init-run --steps 1,5,12\` (or omit \`--steps\` for all)
2. **Run each step**: \`nightytidy --run-step <N>\` — report the result to the user after each step. If a step fails, ask if they want to continue with the remaining steps.
3. **Finish**: \`nightytidy --finish-run\` — generates the report, merges the branch, and cleans up.

All commands output JSON. Parse it to present results conversationally to the user.

### Available Steps

${generateStepList()}

### Commands (reference)

- \`nightytidy --list --json\` — list all steps as JSON
- \`nightytidy --init-run [--steps N,N,N]\` — initialize a run (pre-checks, git setup, state file)
- \`nightytidy --run-step <N>\` — run a single step
- \`nightytidy --finish-run\` — generate report, merge, cleanup
- \`nightytidy --list\` — list steps in terminal (human-readable)
- \`nightytidy --all\` — run all steps non-interactively (terminal only, NOT for Claude Code)

### Notes

- Safety git tag created before starting — all changes can be undone
- All changes on a dedicated branch, auto-merged when done
- Individual steps: 5–30 minutes each. Full run (all steps): 4–8 hours
- Progress logged to \`nightytidy-run.log\`; results in \`NIGHTYTIDY-REPORT.md\`

${MARKER_END}`;
}

export function setupProject(projectDir) {
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  const snippet = generateIntegrationSnippet();

  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, 'utf8');

    // Already has NightyTidy section — replace it
    if (existing.includes(MARKER_START)) {
      const startIdx = existing.indexOf(MARKER_START);
      const endIdx = existing.indexOf(MARKER_END);

      if (endIdx !== -1) {
        const updated = existing.slice(0, startIdx) + snippet + existing.slice(endIdx + MARKER_END.length);
        writeFileSync(claudeMdPath, updated, 'utf8');
        info('NightyTidy section updated in CLAUDE.md');
        return 'updated';
      }
    }

    // Append to existing file
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    writeFileSync(claudeMdPath, existing + separator + snippet + '\n', 'utf8');
    info('NightyTidy section appended to CLAUDE.md');
    return 'appended';
  }

  // Create new CLAUDE.md
  writeFileSync(claudeMdPath, snippet + '\n', 'utf8');
  info('CLAUDE.md created with NightyTidy integration');
  return 'created';
}
