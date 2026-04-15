/**
 * Loads improvement prompts from individual markdown files.
 *
 * Reads manifest.json for step ordering and display names,
 * then loads each prompt's content from steps/*.md files.
 * Exports the same interface as the old steps.js: STEPS array
 * of { number, name, prompt } plus DOC_UPDATE_PROMPT, CHANGELOG_PROMPT, and CONSOLIDATION_PROMPT.
 *
 * Uses `export let` for ESM live bindings — reloadSteps() can
 * reassign these after a sync, and all importers see updated values.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFile(...segments) {
  return readFileSync(path.join(__dirname, ...segments), 'utf8');
}

function loadAllSteps() {
  const m = JSON.parse(loadFile('manifest.json'));
  return m.steps.map((entry, index) => ({
    number: index + 1,
    name: entry.name,
    prompt: loadFile('steps', `${entry.id}.md`),
    mode: entry.mode || 'write',
  }));
}

export let STEPS = loadAllSteps();

export let DOC_UPDATE_PROMPT = loadFile('specials', 'doc-update.md');

export let CHANGELOG_PROMPT = loadFile('specials', 'changelog.md');

export let CONSOLIDATION_PROMPT = loadFile('specials', 'consolidation.md');

export let REPORT_PROMPT = loadFile('specials', 'report.md');

/**
 * Re-read manifest and all prompt files from disk.
 * Uses ESM live bindings — all importers see the updated values
 * through their existing binding references.
 *
 * Call this after syncPrompts() writes new files to disk.
 */
export function reloadSteps() {
  STEPS = loadAllSteps();
  DOC_UPDATE_PROMPT = loadFile('specials', 'doc-update.md');
  CHANGELOG_PROMPT = loadFile('specials', 'changelog.md');
  CONSOLIDATION_PROMPT = loadFile('specials', 'consolidation.md');
  REPORT_PROMPT = loadFile('specials', 'report.md');
}
