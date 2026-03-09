/**
 * Loads improvement prompts from individual markdown files.
 *
 * Reads manifest.json for step ordering and display names,
 * then loads each prompt's content from steps/*.md files.
 * Exports the same interface as the old steps.js: STEPS array
 * of { number, name, prompt } plus DOC_UPDATE_PROMPT, CHANGELOG_PROMPT, and CONSOLIDATION_PROMPT.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFile(...segments) {
  return readFileSync(path.join(__dirname, ...segments), 'utf8');
}

const manifest = JSON.parse(loadFile('manifest.json'));

export const STEPS = manifest.steps.map((entry, index) => ({
  number: index + 1,
  name: entry.name,
  prompt: loadFile('steps', `${entry.id}.md`),
}));

export const DOC_UPDATE_PROMPT = loadFile('specials', 'doc-update.md');

export const CHANGELOG_PROMPT = loadFile('specials', 'changelog.md');

export const CONSOLIDATION_PROMPT = loadFile('specials', 'consolidation.md');
