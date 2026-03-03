import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { STEPS } from './prompts/steps.js';
import { info, warn } from './logger.js';

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

**You are FORBIDDEN from running \`nightytidy --all\` on your own.** You MUST show the step list and ask the user which steps to run BEFORE executing anything. This is not optional.

Do this EVERY TIME:

1. Copy the full step list below into your response so the user can see it
2. Ask: "Which steps would you like to run? Pick numbers (e.g. 1,5,12), say 'all', or tell me what areas you care about."
3. **STOP and WAIT for the user's reply — do NOT proceed until they answer**
4. Only after the user responds, run the command in the background:
   - User says "all" → \`nightytidy --all\`
   - User picks numbers → \`nightytidy --steps 1,5,12\`

**If you run \`nightytidy --all\` without asking the user first, you have failed this instruction.**

### RULE 2 — ALWAYS SHARE THE DASHBOARD URL (NEVER SKIP)

After launching NightyTidy in the background, you MUST do this:

1. Wait 8 seconds for the dashboard to start
2. Read the file \`nightytidy-dashboard.url\` from the project root (it contains a localhost URL)
3. Share the URL with the user: "Here's your live dashboard: [URL]"
4. If the file doesn't exist yet, wait 5 more seconds and try again

**Do NOT skip this. Do NOT tell the user to find the URL themselves. YOU read the file and give them the link.**

### Available Steps

${generateStepList()}

### Commands (reference)

- \`nightytidy --all\` — run all steps (only after user says "all")
- \`nightytidy --steps 1,5,12\` — run specific steps by number
- \`nightytidy --list\` — list steps in terminal

### Notes

- Safety git tag created before starting — all changes can be undone
- All changes on a dedicated branch, auto-merged when done
- Full run (all steps): 4–8 hours. Individual steps: 15–30 minutes
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
