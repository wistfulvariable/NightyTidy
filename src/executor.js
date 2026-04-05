import { createHash } from 'crypto';
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import { runPrompt, ERROR_TYPE, sleep } from './claude.js';
import { getHeadHash, hasNewCommit, fallbackCommit } from './git.js';
import { STEPS, DOC_UPDATE_PROMPT } from './prompts/loader.js';
import { notify } from './notifications.js';
import { info, warn, error as logError } from './logger.js';

/**
 * @fileoverview Core step execution loop for NightyTidy.
 *
 * Executes improvement prompts sequentially, handles retries, rate-limit
 * pause/resume, fast-completion detection, and doc updates.
 *
 * Error contract: This module NEVER throws. Failed steps are recorded in
 * results. Rate-limit failures trigger pause/auto-resume with exponential backoff.
 */

/**
 * @typedef {import('./claude.js').CostData} CostData
 * @typedef {import('./claude.js').ErrorType} ErrorType
 */

/**
 * @typedef {Object} Step
 * @property {number} number - Step number (1-based)
 * @property {string} name - Human-readable step name
 * @property {string} prompt - The improvement prompt text
 */

/**
 * @typedef {Object} StepResult
 * @property {{number: number, name: string}} step - Step identifier
 * @property {'completed' | 'failed'} status - Step completion status
 * @property {string} output - Claude's output text
 * @property {number} duration - Step duration in milliseconds
 * @property {number} attempts - Number of attempts made
 * @property {string|null} error - Error message if failed
 * @property {CostData|null} cost - Cost and token usage data
 * @property {boolean} [suspiciousFast] - True if step was retried for fast completion
 * @property {ErrorType} [errorType] - Error type if failed
 * @property {number|null} [retryAfterMs] - Suggested retry delay for rate limits
 */

/**
 * @typedef {Object} ExecutionResults
 * @property {StepResult[]} results - Array of step results
 * @property {number} totalDuration - Total execution time in milliseconds
 * @property {number} completedCount - Number of successfully completed steps
 * @property {number} failedCount - Number of failed steps
 */

/**
 * @typedef {Object} ExecuteStepsOptions
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {number} [timeout] - Timeout per step in milliseconds
 * @property {(step: Step, index: number, total: number) => void} [onStepStart]
 * @property {(step: Step, index: number, total: number) => void} [onStepComplete]
 * @property {(step: Step, index: number, total: number) => void} [onStepFail]
 * @property {(chunk: string) => void} [onOutput] - Streaming output callback
 * @property {(retryAfterMs: number|null) => void} [onRateLimitPause]
 * @property {() => void} [onRateLimitResume]
 */

// SHA-256 of all STEPS[].prompt content — update when prompts change.
// Detects unexpected modification of prompt data before passing to
// Claude Code with --dangerously-skip-permissions.
const STEPS_HASH = 'c7bc7408a5dcad59767e09a349a5ce1ba00b28720daddb256a7699e3932b8f95';

// Hard cap on total step duration (all retries + doc-update combined).
// Without this, retries × phases can exceed the user's expected timeout.
// Must match claude.js DEFAULT_TIMEOUT — kept as a separate constant
// to avoid adding claude.js mock requirements to all test files.
const DEFAULT_STEP_TIMEOUT_MS = 75 * 60 * 1000; // 75 minutes

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

export const PROD_PREAMBLE =
  'RECOVERY CONTEXT: Your previous attempt at this task was interrupted. ' +
  'You are resuming in the same session. Before starting fresh:\n' +
  '- Check what work was already done (look at recent git changes, modified files)\n' +
  '- Continue from where you left off rather than starting over\n' +
  '- If substantial work was already committed, focus on completing remaining items\n' +
  '- If no meaningful work was done, proceed with the full task\n\n' +
  'Here is the task:\n\n';

/**
 * Verify the integrity of step prompts against the stored hash.
 * Warns but does not block if hash mismatches (user may have legitimate changes).
 *
 * @param {Step[]} steps - Array of step objects to verify
 * @returns {boolean} True if hash matches, false if mismatch
 */
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

/**
 * Sum two cost objects, handling null values gracefully.
 *
 * @param {CostData|null} a - First cost object
 * @param {CostData|null} b - Second cost object
 * @returns {CostData|null} Combined cost, or null if both inputs are null
 */
export function sumCosts(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  // Sum token counts. Use null only if BOTH inputs were null (no data),
  // not if the sum happens to be zero (which is valid counted data).
  const inputSum = (a.inputTokens ?? 0) + (b.inputTokens ?? 0);
  const outputSum = (a.outputTokens ?? 0) + (b.outputTokens ?? 0);
  const hasInputData = a.inputTokens != null || b.inputTokens != null;
  const hasOutputData = a.outputTokens != null || b.outputTokens != null;
  return {
    costUSD: (a.costUSD || 0) + (b.costUSD || 0),
    inputTokens: hasInputData ? inputSum : null,
    outputTokens: hasOutputData ? outputSum : null,
    numTurns: (a.numTurns || 0) + (b.numTurns || 0),
    durationApiMs: (a.durationApiMs || 0) + (b.durationApiMs || 0),
    sessionId: b.sessionId || a.sessionId,
  };
}

/**
 * Create a standardized step result object.
 *
 * @param {Step} step - The step that was executed
 * @param {'completed' | 'failed'} status - Completion status
 * @param {import('./claude.js').RunPromptResult} result - Claude result
 * @param {number} duration - Step duration in milliseconds
 * @param {Object} [extra={}] - Additional fields to include
 * @returns {StepResult} Normalized step result
 */
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

/**
 * Execute a single improvement step with doc update.
 *
 * Runs the improvement prompt, optionally retries if suspiciously fast,
 * runs the doc update in the same session, and handles fallback commits.
 *
 * @param {Step} step - The step to execute
 * @param {string} projectDir - Target project directory
 * @param {Object} [options] - Execution options
 * @param {AbortSignal} [options.signal] - Abort signal
 * @param {number} [options.timeout] - Timeout in milliseconds
 * @param {(chunk: string) => void} [options.onOutput] - Streaming callback
 * @returns {Promise<StepResult>} Step result (never throws)
 */
export async function executeSingleStep(step, projectDir, { signal, timeout, onOutput, continueSession, promptOverride } = {}) {
  const stepLabel = `Step ${step.number}: ${step.name}`;
  info(`${stepLabel} — starting`);

  // Step-level timeout: hard cap on total step duration (improvement + retries
  // + fast-retry + doc-update combined). Without this, a step with 4 retry
  // attempts across 3 phases can silently run for 9× the user's expected
  // timeout. The abort signal cancels all in-flight work when the cap is hit.
  const stepTimeoutMs = timeout || DEFAULT_STEP_TIMEOUT_MS;
  const stepAbort = new AbortController();
  const stepTimer = setTimeout(() => {
    warn(`${stepLabel} — step timeout (${Math.round(stepTimeoutMs / 60000)} min) reached. Aborting step.`);
    stepAbort.abort();
  }, stepTimeoutMs);
  stepTimer.unref();

  // Merge external signal (e.g., SIGINT) with step-level timeout.
  const effectiveSignal = signal
    ? AbortSignal.any([signal, stepAbort.signal])
    : stepAbort.signal;

  try {
    const stepStart = Date.now();
    const preStepHash = await getHeadHash();

    // Run improvement prompt
    const improvementPrompt = promptOverride || (SAFETY_PREAMBLE + step.prompt);
    const result = await runPrompt(improvementPrompt, projectDir, {
      label: `Step ${step.number} — ${step.name}${continueSession ? ' (prod)' : ''}`,
      signal: effectiveSignal,
      timeout,
      onOutput,
      continueSession: continueSession || false,
    });

    if (!result.success) {
      const duration = Date.now() - stepStart;
      logError(`${stepLabel} — failed after ${result.attempts} attempts`);
      notify(
        `NightyTidy: Step ${step.number} Failed`,
        `Step ${step.number} (${step.name}) failed after ${result.attempts} attempts. Skipped — run continuing.`
      );
      const failExtra = {};
      if (result.errorType) failExtra.errorType = result.errorType;
      if (result.retryAfterMs) failExtra.retryAfterMs = result.retryAfterMs;
      return makeStepResult(step, 'failed', result, duration, failExtra);
    }

    // Fast completion detection: retry once if suspiciously fast
    let improvementResult = result;
    let fastRetried = false;

    if (!continueSession && result.duration < FAST_COMPLETION_THRESHOLD_MS) {
      warn(
        `${stepLabel}: completed in ${Math.round(result.duration / 1000)}s — ` +
        `suspiciously fast (threshold: ${FAST_COMPLETION_THRESHOLD_MS / 1000}s). Retrying with context.`
      );
      fastRetried = true;

      const retryResult = await runPrompt(
        SAFETY_PREAMBLE + FAST_RETRY_PREFIX + step.prompt,
        projectDir,
        { label: `Step ${step.number} — ${step.name} (fast-retry)`, signal: effectiveSignal, timeout, onOutput },
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
      signal: effectiveSignal,
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
        warn(`${stepLabel}: automatic commit failed (${err.message}) — changes remain staged`);
      }
    }

    // Sweep: always stage+commit any remaining untracked/unstaged files.
    // Claude often commits its code changes but forgets to git-add report
    // or audit files it created. Without this sweep, those files stay
    // untracked and are lost if the user stops the run.
    if (committed) {
      try {
        const swept = await fallbackCommit(step.number, step.name);
        if (swept) info(`${stepLabel}: swept uncommitted files \u2713`);
      } catch (err) {
        warn(`${stepLabel}: sweep commit failed (${err.message}) — some files may remain unstaged`);
      }
    }

    const duration = Date.now() - stepStart;
    info(`${stepLabel} — completed (${Math.round(duration / 1000)}s)`);

    const extra = fastRetried ? { suspiciousFast: true } : {};
    return makeStepResult(step, 'completed', { ...improvementResult, cost: combinedCost }, duration, extra);
  } finally {
    clearTimeout(stepTimer);
  }
}

// Exponential backoff schedule for rate-limit waits (ms)
const BACKOFF_SCHEDULE_MS = [
  2 * 60_000,     // 2 min
  5 * 60_000,     // 5 min
  15 * 60_000,    // 15 min
  30 * 60_000,    // 30 min
  60 * 60_000,    // 1 hr
  120 * 60_000,   // 2 hr
  120 * 60_000,   // 2 hr (repeat — covers 5hr+ usage caps)
  120 * 60_000,   // 2 hr (repeat)
  120 * 60_000,   // 2 hr (repeat — ~9.9hr total coverage)
];

/**
 * Wait for a rate-limit to clear using exponential backoff and API probes.
 *
 * Uses exponential backoff (2min → 2hr cap) and periodic API probes to
 * detect when the rate limit has cleared.
 *
 * @param {number|null} retryAfterMs - Suggested retry delay from API, or null
 * @param {AbortSignal|undefined} signal - Abort signal for cancellation
 * @param {string} projectDir - Project directory for probe prompts
 * @returns {Promise<boolean>} True if API available, false if gave up or aborted
 */
async function waitForRateLimit(retryAfterMs, signal, projectDir) {
  if (signal?.aborted) return false;

  // If API gave us a retry-after, use it (plus 10s buffer)
  if (retryAfterMs && retryAfterMs > 0) {
    info(`Rate limit: API says retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    await sleep(retryAfterMs + 10_000, signal);
    return !signal?.aborted;
  }

  // Otherwise, exponential backoff with probe attempts
  for (let attempt = 0; attempt < BACKOFF_SCHEDULE_MS.length; attempt++) {
    const waitMs = BACKOFF_SCHEDULE_MS[attempt];
    info(`Rate limit: waiting ${Math.ceil(waitMs / 60_000)} minutes before probe (attempt ${attempt + 1}/${BACKOFF_SCHEDULE_MS.length})`);

    await sleep(waitMs, signal);
    if (signal?.aborted) return false;

    // Probe: run a tiny prompt to check if rate limit is lifted
    info('Rate limit: probing API availability...');
    const probe = await runPrompt('Reply with the single word OK.', projectDir, {
      label: 'rate-limit-probe',
      retries: 0,
      timeout: 60_000,
    });

    if (probe.success) {
      info('Rate limit: probe succeeded — API available again');
      return true;
    }

    if (probe.errorType !== ERROR_TYPE.RATE_LIMIT) {
      // Different error — let the main loop handle it
      info('Rate limit: probe returned non-rate-limit error — resuming');
      return true;
    }

    warn(`Rate limit: probe still rate-limited (attempt ${attempt + 1}/${BACKOFF_SCHEDULE_MS.length})`);
  }

  // Exhausted all backoff attempts
  logError('Rate limit: exhausted all retry attempts — stopping run');
  return false;
}

/**
 * Execute multiple improvement steps sequentially.
 *
 * Handles:
 * - Sequential step execution with callbacks
 * - Rate-limit pause/resume with exponential backoff
 * - Abort signal support for graceful cancellation
 * - Progress callbacks for UI updates
 *
 * Error contract: NEVER throws. Failed steps are recorded in results.
 *
 * @param {Step[]} selectedSteps - Steps to execute
 * @param {string} projectDir - Target project directory
 * @param {ExecuteStepsOptions} [options] - Execution options
 * @returns {Promise<ExecutionResults>} Results object (never throws)
 */
export async function executeSteps(selectedSteps, projectDir, { signal, timeout, onStepStart, onStepComplete, onStepFail, onOutput, onRateLimitPause, onRateLimitResume } = {}) {
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

    // Success path — increment and notify
    if (stepResult.status === 'completed') {
      completedCount++;
      onStepComplete?.(step, i, totalSteps);
      continue;
    }

    // Rate-limit: pause and wait, then retry the same step
    if (stepResult.errorType === ERROR_TYPE.RATE_LIMIT) {
      info('Rate limit detected — pausing run');
      onRateLimitPause?.(stepResult.retryAfterMs, {
        results: [...results],
        completedCount,
        failedCount,
        currentStepIndex: i,
      });

      const resumed = await waitForRateLimit(stepResult.retryAfterMs, signal, projectDir);
      if (!resumed) {
        info('Rate limit wait ended — stopping run');
        break;
      }
      onRateLimitResume?.();
      info('Rate limit cleared — resuming run');

      // Remove the failed result and retry the same step
      results.pop();
      i--;
      continue;
    }

    // Other failure — record and notify
    failedCount++;
    onStepFail?.(step, i, totalSteps);
  }

  const totalDuration = Date.now() - runStart;

  return {
    results,
    totalDuration,
    completedCount,
    failedCount,
  };
}

/**
 * Build the filename for a step prompt.
 * @param {Step} step
 * @returns {string}
 */
function promptFilename(step) {
  return `${String(step.number).padStart(2, '0')}-${step.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.md`;
}

/**
 * Copy ALL step prompts into the target project's audit-reports/refactor-prompts/ folder.
 *
 * Writes every prompt from STEPS, removes stale files left over from renames,
 * and overwrites existing files so updates are always reflected.
 * Synchronous — never throws (warns on failure).
 *
 * @param {string} projectDir - Target project root directory
 */
export function copyPromptsToProject(projectDir) {
  try {
    const promptsDir = path.join(projectDir, 'audit-reports', 'refactor-prompts');
    mkdirSync(promptsDir, { recursive: true });

    // Build set of current filenames so we can detect stale leftovers
    const currentFiles = new Set(STEPS.map(promptFilename));

    // Remove stale files (e.g. from renamed prompts)
    for (const existing of readdirSync(promptsDir)) {
      if (existing.endsWith('.md') && !currentFiles.has(existing)) {
        unlinkSync(path.join(promptsDir, existing));
        info(`Removed stale prompt file: ${existing}`);
      }
    }

    // Write all current prompts (creates new + overwrites updated)
    for (const step of STEPS) {
      writeFileSync(path.join(promptsDir, promptFilename(step)), step.prompt, 'utf8');
    }

    info(`Synced ${STEPS.length} prompts to audit-reports/refactor-prompts/`);
  } catch (err) {
    warn(`Failed to copy prompts to project: ${err.message}`);
  }
}
