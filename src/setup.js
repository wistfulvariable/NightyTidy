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

NightyTidy is installed and available as a global command. It runs AI-driven improvement steps against this codebase, handling git branching, execution, reporting, and merging automatically.

### When to use

Only when the user explicitly asks to "run NightyTidy" or "run nightytidy". Do NOT run NightyTidy for general requests like "improve my code" or "tidy up" — only when the user mentions NightyTidy by name.

### Workflow — MANDATORY (follow every step)

**CRITICAL: You MUST follow ALL steps below in order. NEVER skip any step.**

1. Show the user the numbered step list below (copy the full list into your response)
2. Ask: "Which steps would you like to run? Pick numbers (e.g. 1,5,12), say 'all', or tell me what areas you care about."
3. Wait for the user's response — do NOT proceed until they answer
4. Run the matching command **in the background** (it takes hours):
   - User says "all" or similar → \`nightytidy --all\`
   - User picks specific numbers → \`nightytidy --steps 1,5,12\` (comma-separated)
5. **CRITICAL — ALWAYS do this**: After launching, read the file \`nightytidy-dashboard.url\` from the project root (wait a few seconds for it to appear) and share the URL with the user. Tell them: "Open this link in your browser to see live progress, step-by-step status, and a stop button." NEVER skip this — the user has no other way to monitor progress.
6. Do not intervene after that — NightyTidy handles git, execution, and reporting

### Available Steps

${generateStepList()}

### Commands (reference)

- \`nightytidy --all\` — run all steps
- \`nightytidy --steps 1,5,12\` — run specific steps by number
- \`nightytidy --list\` — list steps in terminal

### Important notes

- **Live dashboard**: After launch, \`nightytidy-dashboard.url\` contains a localhost URL. The user can open it in a browser for real-time progress with SSE streaming, step-by-step status, and a stop button
- A safety git tag is created before starting — all changes can be undone
- All changes happen on a dedicated branch and are auto-merged when done
- A full run (all steps) typically takes 4\u20138 hours; individual steps take 15\u201330 minutes
- Progress is logged to \`nightytidy-run.log\`; results saved in \`NIGHTYTIDY-REPORT.md\`
- The computer must not go to sleep during the run

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
