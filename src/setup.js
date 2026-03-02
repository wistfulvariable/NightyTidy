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

### Workflow

1. Present the available steps below and ask the user which ones they'd like to run (or all)
2. Run the appropriate command based on their selection
3. NightyTidy handles everything else — do not intervene in the process

### Commands

- **Run all steps**: \`nightytidy --all\`
- **Run specific steps**: \`nightytidy --steps 1,5,12\` (comma-separated numbers)
- **List steps**: \`nightytidy --list\`

### Available Steps

${generateStepList()}

### Important notes

- **Live progress window**: NightyTidy automatically opens a separate terminal window showing real-time progress. No user action needed \u2014 it appears on its own
- **Background execution is fine**: The progress window provides visibility even when stdout is not visible
- A safety git tag is created before starting — all changes can be undone
- All changes happen on a dedicated branch and are auto-merged when done
- A full run (all steps) typically takes 4–8 hours; individual steps take 15–30 minutes
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
