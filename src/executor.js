import { createHash } from 'crypto';
import { runPrompt } from './claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from './git.js';
import { STEPS, DOC_UPDATE_PROMPT } from './prompts/loader.js';
import { notify } from './notifications.js';
import { info, warn, error as logError } from './logger.js';

// SHA-256 of all STEPS[].prompt content — update when prompts change.
// Detects unexpected modification of prompt data before passing to
// Claude Code with --dangerously-skip-permissions.
const STEPS_HASH = '1578cc610e97618b4eacdbfb79be29b7aa2715b0c4fa32b960eaa21f8ef2ab6a';

function verifyStepsIntegrity(steps) {
  const content = steps.map(s => s.prompt).join('');
  const hash = createHash('sha256').update(content).digest('hex');
  if (hash !== STEPS_HASH) {
    warn(
      'Steps integrity check: prompt content hash mismatch. ' +
      'If you regenerated prompts, update STEPS_HASH in executor.js. ' +
      `Expected: ${STEPS_HASH.slice(0, 16)}... Got: ${hash.slice(0, 16)}...`
    );
    return false;
  }
  info('Steps integrity check passed');
  return true;
}

// Safety preamble prepended to every Claude subprocess prompt.
// Prevents destructive operations that conflict with NightyTidy's orchestration.
export const SAFETY_PREAMBLE =
  'IMPORTANT CONSTRAINTS (from the NightyTidy orchestrator — always follow these):\n' +
  '- Do NOT delete any existing files. Create new files or modify existing ones only.\n' +
  '- Do NOT create, switch, or merge git branches. The orchestrator manages all branching.\n' +
  '- Do NOT run destructive git commands (reset, clean, checkout, rm).\n' +
  '- Commit your changes with a descriptive message when done.\n' +
  '---\n\n';

function makeStepResult(step, status, result, duration) {
  return {
    step: { number: step.number, name: step.name },
    status,
    output: result.output,
    duration,
    attempts: result.attempts,
    error: status === 'failed' ? result.error : null,
  };
}

export async function executeSingleStep(step, projectDir, { signal, timeout, onOutput } = {}) {
  const stepLabel = `Step ${step.number}: ${step.name}`;
  info(`${stepLabel} — starting`);

  const stepStart = Date.now();
  const preStepHash = await getHeadHash();

  // Run improvement prompt
  const result = await runPrompt(SAFETY_PREAMBLE + step.prompt, projectDir, {
    label: `Step ${step.number} — ${step.name}`,
    signal,
    timeout,
    onOutput,
  });

  if (!result.success) {
    const duration = Date.now() - stepStart;
    logError(`${stepLabel} — failed after ${result.attempts} attempts`);
    notify(
      `NightyTidy: Step ${step.number} Failed`,
      `Step ${step.number} (${step.name}) failed after ${result.attempts} attempts. Skipped — run continuing.`
    );
    return makeStepResult(step, 'failed', result, duration);
  }

  // Run doc update in the same Claude session that made the changes
  const docResult = await runPrompt(SAFETY_PREAMBLE + DOC_UPDATE_PROMPT, projectDir, {
    label: `Step ${step.number} — doc update`,
    signal,
    timeout,
    continueSession: true,
    onOutput,
  });

  if (!docResult.success) {
    warn(`${stepLabel}: Doc update failed after retries — improvement changes preserved but docs may be stale`);
  }

  // Commit verification
  const committed = await hasNewCommit(preStepHash);
  if (committed) {
    info(`${stepLabel}: committed by Claude Code \u2713`);
  } else {
    try {
      await fallbackCommit(step.number, step.name);
    } catch (err) {
      warn(`${stepLabel}: fallback commit failed — ${err.message}`);
    }
  }

  const duration = Date.now() - stepStart;
  info(`${stepLabel} — completed (${Math.round(duration / 1000)}s)`);

  return makeStepResult(step, 'completed', result, duration);
}

export async function executeSteps(selectedSteps, projectDir, { signal, timeout, onStepStart, onStepComplete, onStepFail, onOutput } = {}) {
  verifyStepsIntegrity(STEPS);

  const results = [];
  const totalSteps = selectedSteps.length;
  const runStart = Date.now();
  let completedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < totalSteps; i++) {
    if (signal?.aborted) {
      info('Abort signal received — stopping after previous step');
      break;
    }

    const step = selectedSteps[i];
    onStepStart?.(step, i, totalSteps);

    const stepResult = await executeSingleStep(step, projectDir, { signal, timeout, onOutput });
    results.push(stepResult);

    if (stepResult.status === 'failed') {
      failedCount++;
      onStepFail?.(step, i, totalSteps);
    } else {
      completedCount++;
      onStepComplete?.(step, i, totalSteps);
    }
  }

  const totalDuration = Date.now() - runStart;

  return {
    results,
    totalDuration,
    completedCount,
    failedCount,
  };
}
