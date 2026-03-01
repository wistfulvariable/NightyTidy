import { runPrompt } from './claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from './git.js';
import { DOC_UPDATE_PROMPT } from './prompts/steps.js';
import { notify } from './notifications.js';
import { info, warn, error as logError } from './logger.js';

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

export async function executeSteps(selectedSteps, projectDir, { signal, onStepStart, onStepComplete, onStepFail } = {}) {
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
    const stepLabel = `Step ${step.number}/${totalSteps}: ${step.name}`;

    onStepStart?.(step, i, totalSteps);
    info(`${stepLabel} — starting`);

    const stepStart = Date.now();
    const preStepHash = await getHeadHash();

    // Run improvement prompt
    const result = await runPrompt(step.prompt, projectDir, {
      label: `Step ${step.number} — ${step.name}`,
    });

    if (!result.success) {
      const duration = Date.now() - stepStart;
      logError(`${stepLabel} — failed after ${result.attempts} attempts`);
      notify(
        `NightyTidy: Step ${step.number} Failed`,
        `Step ${step.number} (${step.name}) failed after ${result.attempts} attempts. Skipped — run continuing.`
      );
      results.push(makeStepResult(step, 'failed', result, duration));
      failedCount++;
      onStepFail?.(step, i, totalSteps);
      continue;
    }

    // Run doc update prompt
    const docResult = await runPrompt(DOC_UPDATE_PROMPT, projectDir, {
      label: `Step ${step.number} — doc update`,
    });

    if (!docResult.success) {
      warn(`${stepLabel}: Doc update failed after retries — improvement changes preserved but docs may be stale`);
    }

    // Commit verification
    const committed = await hasNewCommit(preStepHash);
    if (committed) {
      info(`${stepLabel}: committed by Claude Code \u2713`);
    } else {
      await fallbackCommit(step.number, step.name);
    }

    const duration = Date.now() - stepStart;
    info(`${stepLabel} — completed (${Math.round(duration / 1000)}s)`);

    results.push(makeStepResult(step, 'completed', result, duration));
    completedCount++;
    onStepComplete?.(step, i, totalSteps);
  }

  const totalDuration = Date.now() - runStart;

  return {
    results,
    totalDuration,
    completedCount,
    failedCount,
  };
}
