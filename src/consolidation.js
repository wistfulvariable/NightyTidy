import { runPrompt } from './claude.js';
import { info, warn } from './logger.js';
import { SAFETY_PREAMBLE } from './executor.js';
import { CONSOLIDATION_PROMPT } from './prompts/loader.js';

const OUTPUT_TRUNCATE_LIMIT = 6000;

function truncateOutput(text, limit = OUTPUT_TRUNCATE_LIMIT) {
  if (!text || text.length <= limit) return text || '';
  return text.slice(0, limit) + '\n\n[...truncated — full output in run log]';
}

function buildStepOutputsSection(results) {
  const sections = [];
  for (const r of results) {
    const status = r.status === 'completed' ? 'completed' : 'failed';
    const output = r.status === 'completed'
      ? truncateOutput(r.output)
      : 'No output (step failed)';
    sections.push(
      `### Step ${r.step.number}: ${r.step.name} (${status})\n${output}\n---`
    );
  }
  return sections.join('\n\n');
}

export function buildConsolidationPrompt(executionResults) {
  const stepOutputs = buildStepOutputsSection(executionResults.results);
  return stepOutputs + '\n\n' + CONSOLIDATION_PROMPT;
}

/**
 * Generate a consolidated action plan from step outputs via Claude.
 *
 * Returns the action plan text (with headings downgraded for embedding in the
 * report), or null on failure. Does NOT write any file — the caller embeds
 * the text into the report via generateReport().
 *
 * Error contract: Warns but NEVER throws — returns null on failure.
 *
 * @param {import('./executor.js').ExecutionResults} executionResults
 * @param {string} projectDir
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<string|null>}
 */
export async function generateActionPlan(executionResults, projectDir, { timeout } = {}) {
  if (executionResults.completedCount === 0) {
    info('Skipping action plan — no steps completed');
    return null;
  }

  try {
    const prompt = SAFETY_PREAMBLE + buildConsolidationPrompt(executionResults);
    info('Generating consolidated action plan...');

    const result = await runPrompt(prompt, projectDir, {
      label: 'Consolidation action plan',
      timeout,
    });

    if (!result.success || !result.output?.trim()) {
      warn('Action plan generation failed — report will not include action plan section.');
      return null;
    }

    // Downgrade headings by one level (H1→H2, H2→H3, etc.) so the action plan
    // can be embedded inside the report which already has its own H1.
    return result.output.trim().replace(/^(#+)/gm, '$1#');
  } catch (err) {
    warn(`Action plan generation error (${err.message}) — report will not include action plan section.`);
    return null;
  }
}
