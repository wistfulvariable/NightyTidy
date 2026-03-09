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

// A step completing under 2 minutes is suspicious — Claude likely bailed
// without doing real work. Triggers one automatic retry with context.
export const FAST_COMPLETION_THRESHOLD_MS = 120_000;

const FAST_RETRY_PREFIX =
  'IMPORTANT CONTEXT: You were asked to perform the task below previously, but you ' +
  'completed it in under 2 minutes. For a codebase improvement step, this is too fast ' +
  'and likely means you did not perform thorough work. This time, please:\n' +
  '- Read and understand the relevant code before making changes\n' +
  '- Make substantive, meaningful improvements\n' +
  '- If truly no changes are needed, provide a detailed explanation of what you reviewed and why\n' +
  '- Commit your changes when done\n\n' +
  'Here is the original task:\n\n';

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

function sumCosts(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return {
    costUSD: (a.costUSD || 0) + (b.costUSD || 0),
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0) || null,
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0) || null,
    numTurns: (a.numTurns || 0) + (b.numTurns || 0),
    durationApiMs: (a.durationApiMs || 0) + (b.durationApiMs || 0),
    sessionId: b.sessionId || a.sessionId,
  };
}

function makeStepResult(step, status, result, duration, extra = {}) {
  return {
    step: { number: step.number, name: step.name },
    status,
    output: result.output,
    duration,
    attempts: result.attempts,
    error: status === 'failed' ? result.error : null,
    cost: result.cost || null,
    ...extra,
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

  // Fast completion detection: retry once if suspiciously fast
  let improvementResult = result;
  let fastRetried = false;

  if (result.duration < FAST_COMPLETION_THRESHOLD_MS) {
    warn(
      `${stepLabel}: completed in ${Math.round(result.duration / 1000)}s — ` +
      `suspiciously fast (threshold: ${FAST_COMPLETION_THRESHOLD_MS / 1000}s). Retrying with context.`
    );
    fastRetried = true;

    const retryResult = await runPrompt(
      SAFETY_PREAMBLE + FAST_RETRY_PREFIX + step.prompt,
      projectDir,
      { label: `Step ${step.number} — ${step.name} (fast-retry)`, signal, timeout, onOutput },
    );

    if (retryResult.success) {
      info(`${stepLabel}: fast-retry succeeded — using retry result`);
      improvementResult = {
        ...retryResult,
        cost: sumCosts(result.cost, retryResult.cost),
        attempts: result.attempts + retryResult.attempts,
      };
    } else {
      warn(`${stepLabel}: fast-retry failed — falling back to original fast result`);
    }
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

  // Combine costs from improvement + doc-update calls
  const combinedCost = sumCosts(improvementResult.cost, docResult.cost);

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

  const extra = fastRetried ? { suspiciousFast: true } : {};
  return makeStepResult(step, 'completed', { ...improvementResult, cost: combinedCost }, duration, extra);
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
