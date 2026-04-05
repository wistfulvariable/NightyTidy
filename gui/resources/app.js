/**
 * NightyTidy Desktop GUI — Main application.
 * State machine driving 5 screens. Communicates with server.js via fetch API.
 */

/* global NtLogic, marked */

// ── Frontend Error Logging ──────────────────────────────────────────

function logToServer(level, message) {
  fetch('/api/log-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message }),
  }).catch(() => {});
}

window.onerror = (message, source, lineno, colno, error) => {
  const stack = error?.stack || '';
  logToServer('error', `${message} at ${source}:${lineno}:${colno}${stack ? '\n' + stack : ''}`);
};

window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logToServer('error', `Unhandled promise rejection: ${msg}`);
};

// ── API helpers ────────────────────────────────────────────────────

const API_DEFAULT_TIMEOUT_MS = 30_000;        // 30s for short API calls
const API_COMMAND_TIMEOUT_MS = 80 * 60_000;   // 80 min for run-command (step timeout is 75 min)

async function api(endpoint, body = {}, timeoutMs) {
  const timeout = timeoutMs ?? (endpoint === 'run-command' ? API_COMMAND_TIMEOUT_MS : API_DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      const msg = `API call to /api/${endpoint} timed out after ${Math.round(timeout / 1000)}s`;
      logToServer('error', msg);
      return { ok: false, error: msg, timedOut: true };
    }
    const msg = `API call to /api/${endpoint} failed: ${err.message}`;
    logToServer('error', msg);
    return { ok: false, error: msg, fetchError: true };
  } finally {
    clearTimeout(timer);
  }
}

// ── Markdown Rendering ────────────────────────────────────────────

const markedInstance = new marked.Marked({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown text to sanitised HTML.
 * Links open in a new tab. Empty/null input returns empty string.
 */
function renderMarkdown(text) {
  if (!text) return '';
  return markedInstance.parse(NtLogic.preprocessClaudeOutput(text));
}

/**
 * Track last-rendered text to avoid unnecessary DOM updates during polling.
 */
let lastRenderedOutput = '';

/**
 * Track when output last changed. Used to show the "working" indicator
 * when Claude Code is executing tools with no visible output.
 */
let lastOutputChangeTime = 0;
const WORKING_INDICATOR_DELAY_MS = 8000; // Show after 8s of no output change

// ── Onboarding (first-run walkthrough) ──────────────────────────────

const ONBOARDING_STORAGE_KEY = 'nightytidy-onboarding-seen';
const ONBOARDING_SLIDE_COUNT = 6;
let onboardingSlide = 0;
let onboardingFocusTrapCleanup = null;

function shouldShowOnboarding() {
  try {
    return !localStorage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return false; // localStorage unavailable — skip onboarding
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch { /* ignore */ }
}

function showOnboarding() {
  onboardingSlide = 0;
  renderOnboardingSlide();
  const overlay = document.getElementById('onboarding-overlay');
  overlay.classList.remove('hidden');
  onboardingFocusTrapCleanup = trapFocus(overlay.querySelector('.modal'));
  document.getElementById('btn-onboarding-next').focus();
}

function dismissOnboarding() {
  markOnboardingSeen();
  const overlay = document.getElementById('onboarding-overlay');
  overlay.classList.add('hidden');
  if (onboardingFocusTrapCleanup) {
    onboardingFocusTrapCleanup();
    onboardingFocusTrapCleanup = null;
  }
  document.getElementById('btn-select-folder').focus();
}

function nextOnboardingSlide() {
  if (onboardingSlide >= ONBOARDING_SLIDE_COUNT - 1) {
    dismissOnboarding();
    return;
  }
  onboardingSlide++;
  renderOnboardingSlide();
}

function goToOnboardingSlide(index) {
  if (index < 0 || index >= ONBOARDING_SLIDE_COUNT) return;
  onboardingSlide = index;
  renderOnboardingSlide();
}

function renderOnboardingSlide() {
  const slides = document.querySelectorAll('.onboarding-slide');
  slides.forEach((s, i) => {
    s.classList.toggle('active', i === onboardingSlide);
  });
  const dots = document.querySelectorAll('.onboarding-dot');
  dots.forEach((d, i) => {
    d.classList.toggle('active', i === onboardingSlide);
    d.setAttribute('aria-selected', i === onboardingSlide ? 'true' : 'false');
  });
  const nextBtn = document.getElementById('btn-onboarding-next');
  nextBtn.textContent = onboardingSlide === ONBOARDING_SLIDE_COUNT - 1 ? 'Get Started' : 'Next';
}

// ── State ──────────────────────────────────────────────────────────

const SCREENS = {
  SETUP: 'setup',
  STEPS: 'steps',
  RUNNING: 'running',
  FINISHING: 'finishing',
  SUMMARY: 'summary',
};

const FINISH_STEP_NUM = 0;  // Virtual step number for the finish phase

const state = {
  screen: SCREENS.SETUP,
  projectDir: null,
  bin: null,              // absolute path to bin/nightytidy.js (from /api/config)
  steps: [],              // from --list --json: [{ number, name, description }]
  selectedSteps: [],      // step numbers user checked
  timeout: 75,            // minutes
  runInfo: null,          // from --init-run response
  completedSteps: [],     // step numbers completed
  failedSteps: [],        // step numbers failed
  stepResults: [],        // [{ step, name, status, duration, attempts }]
  currentProcessId: null, // process ID for kill
  pollTimer: null,        // setInterval ID
  elapsedTimer: null,     // setInterval ID for elapsed time
  runStartTime: null,     // timestamp ms
  finishResult: null,     // from --finish-run response
  finishFailed: false,     // finish-run was skipped, timed out, or errored
  stopping: false,        // stop button was clicked
  skippingStep: null,     // step number being skipped (null when not skipping)
  skippedSteps: [],       // step numbers that were skipped
  viewingStepOutput: null, // step number whose output is shown in drawer (null = none)
  drawerReportPath: null,  // report file path shown in drawer (null = none)
  initPollTimer: null,     // setInterval ID for init overlay progress polling
  currentStepNum: null,    // step number currently running (for live elapsed timer)
  stepStartTime: null,     // timestamp ms when current step started
  paused: false,           // run is paused due to rate limit
  pausedStepNum: null,     // step number that triggered the pause
  resumeCountdown: null,   // target timestamp for auto-resume
  countdownTimer: null,    // setInterval ID for countdown display
  backoffAttempt: 0,       // exponential backoff tier index
  manualResumeResolve: null, // resolve function for manual resume promise
  _pauseTimer: null,       // setTimeout ID for auto-resume (clearable on manual resume)
  retrying: false,         // step is being auto-retried after failure
  prodding: false,         // step is being prodded (session resume after failure)
  simulateRateLimitStep: null, // step number to fake rate-limit on (debug: ?test-rate-limit)
  simulationMode: false,       // when true, ALL CLI calls are faked (debug: ?test-rate-limit)
};

// ── Init Overlay (shown during --init-run) ────────────────────────

const INIT_POLL_INTERVAL = 400; // ms — slightly faster than step polling

function showInitOverlay() {
  // Hide step selection UI immediately
  for (const id of ['step-checklist', 'options-bar', 'start-bar', 'steps-header']) {
    const el = document.querySelector(`.${id}`) || document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // Build checklist from INIT_PHASES
  const container = document.getElementById('init-checklist');
  container.innerHTML = NtLogic.INIT_PHASES.map(phase => `
    <div class="init-phase init-phase-pending" id="init-phase-${phase.key}">
      <span class="init-phase-icon">&#9675;</span>
      <span class="init-phase-label">${NtLogic.escapeHtml(phase.label)}</span>
    </div>
  `).join('');

  document.getElementById('init-overlay').style.display = 'block';
  startInitPolling();
}

function hideInitOverlay() {
  stopInitPolling();
  document.getElementById('init-overlay').style.display = 'none';
  // Restore step selection UI
  for (const id of ['step-checklist', 'options-bar', 'start-bar', 'steps-header']) {
    const el = document.querySelector(`.${id}`) || document.getElementById(id);
    if (el) el.style.display = '';
  }
}

function startInitPolling() {
  stopInitPolling();
  state.initPollTimer = setInterval(pollInitProgress, INIT_POLL_INTERVAL);
}

function stopInitPolling() {
  if (state.initPollTimer) {
    clearInterval(state.initPollTimer);
    state.initPollTimer = null;
  }
}

async function pollInitProgress() {
  if (!state.projectDir) return;
  const progressPath = `${state.projectDir}\\nightytidy-progress.json`;
  try {
    const result = await api('read-file', { path: progressPath }, 3000);
    if (result.ok && result.content) {
      renderInitChecklist(JSON.parse(result.content));
    }
  } catch {
    // Swallow — init polling is best-effort
  }
}

function renderInitChecklist(progress) {
  if (!progress || progress.status !== 'initializing') return;

  const currentIdx = NtLogic.getInitPhaseIndex(progress.initPhase);

  for (let i = 0; i < NtLogic.INIT_PHASES.length; i++) {
    const phase = NtLogic.INIT_PHASES[i];
    const el = document.getElementById(`init-phase-${phase.key}`);
    if (!el) continue;
    const iconEl = el.querySelector('.init-phase-icon');

    if (i < currentIdx) {
      if (!el.classList.contains('init-phase-done')) {
        el.className = 'init-phase init-phase-done';
        iconEl.textContent = '\u2713';
      }
    } else if (i === currentIdx) {
      if (!el.classList.contains('init-phase-active')) {
        el.className = 'init-phase init-phase-active';
        iconEl.innerHTML = '<span class="spinner"></span>';
      }
    } else {
      if (!el.classList.contains('init-phase-pending')) {
        el.className = 'init-phase init-phase-pending';
        iconEl.innerHTML = '&#9675;';
      }
    }
  }
}

function markInitPhaseFailed() {
  stopInitPolling();
  const activeEl = document.querySelector('.init-phase-active');
  if (activeEl) {
    activeEl.className = 'init-phase init-phase-failed';
    const iconEl = activeEl.querySelector('.init-phase-icon');
    if (iconEl) iconEl.textContent = '\u2717';
  }
}

// ── Screen Management ──────────────────────────────────────────────

function showScreen(name) {
  closeDrawer();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
  state.screen = name;
}

function showError(screenPrefix, message) {
  const el = document.getElementById(`${screenPrefix}-error`);
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

function clearError(screenPrefix) {
  const el = document.getElementById(`${screenPrefix}-error`);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ── CLI Command Runner ─────────────────────────────────────────────

let processCounter = 0;

/**
 * Run a nightytidy CLI command in the project directory.
 * Returns the parsed JSON result or an error.
 */
async function runCli(args) {
  const cmd = NtLogic.buildCommand(state.projectDir, args, 'Windows', state.bin);
  const id = `proc-${++processCounter}`;
  state.currentProcessId = id;

  const startTime = Date.now();
  logToServer('info', `runCli START: ${args} (id=${id})`);

  const result = await api('run-command', { command: cmd, id });
  state.currentProcessId = null;

  const elapsed = Date.now() - startTime;
  logToServer('info', `runCli END: ${args} (id=${id}, ${Math.round(elapsed / 1000)}s, ok=${result.ok})`);

  if (!result.ok) {
    const detail = result.timedOut ? 'timed out' : result.fetchError ? 'fetch error' : 'command failed';
    logToServer('warn', `CLI ${detail}: ${args} — ${result.error || 'no error message'}`);

    if (result.timedOut) {
      return { ok: false, data: null, error: `NightyTidy command timed out after ${Math.round(elapsed / 1000)}s. The step may still be running — check nightytidy-run.log.` };
    }
    return { ok: false, data: null, error: 'NightyTidy command did not complete. Check that the project folder is valid and try again.' };
  }

  if (result.exitCode !== 0) {
    logToServer('info', `CLI exit code ${result.exitCode} for: ${args} (stderr: ${(result.stderr || '').slice(0, 500)})`);
  }

  const parsed = NtLogic.parseCliOutput(result.stdout);
  if (!parsed.ok) {
    logToServer('warn', `CLI output parse failed for: ${args} (stdout length=${(result.stdout || '').length}, stderr length=${(result.stderr || '').length})`);
    return { ok: false, data: null, error: 'Could not read NightyTidy output. The command may have failed — check nightytidy-run.log for details.' };
  }

  return parsed;
}

/**
 * Run a shell command in the project directory.
 * @param {string} shellCmd - Command to run after cd-ing into projectDir
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
async function runShellInProject(shellCmd) {
  const full = `cd /d "${state.projectDir}" && ${shellCmd}`;
  return api('run-command', { command: full, id: `shell-${++processCounter}` });
}

// ── Git Readiness Check ─────────────────────────────────────────────

/**
 * Check if the selected project folder is git-ready (is a repo + has commits).
 * @returns {Promise<{ready: boolean, reason: string|null}>}
 *   reason: 'no-repo' | 'no-commits' | null
 */
async function checkGitReady() {
  // Check if folder is inside a git repo
  const repoCheck = await runShellInProject('git rev-parse --is-inside-work-tree');
  if (!repoCheck.ok || repoCheck.exitCode !== 0) {
    return { ready: false, reason: 'no-repo' };
  }

  // Check if repo has at least one commit
  const commitCheck = await runShellInProject('git log --oneline -1');
  if (!commitCheck.ok || commitCheck.exitCode !== 0) {
    return { ready: false, reason: 'no-commits' };
  }

  return { ready: true, reason: null };
}

/**
 * Show a git-specific error with an action button on the given screen.
 */
function showGitSetupError(screenPrefix, reason) {
  const el = document.getElementById(`${screenPrefix}-error`);
  if (!el) return;

  if (reason === 'no-repo') {
    el.innerHTML = '<span>This folder isn\u2019t a git project yet.</span>' +
      ' <button class="btn btn-success btn-sm" id="btn-git-init">Initialize Git</button>';
  } else if (reason === 'no-commits') {
    el.innerHTML = '<span>Your project has git but no commits yet.</span>' +
      ' <button class="btn btn-success btn-sm" id="btn-git-commit">Create Initial Commit</button>';
  }
  el.classList.add('visible');

  document.getElementById('btn-git-init')?.addEventListener('click', initializeGit);
  document.getElementById('btn-git-commit')?.addEventListener('click', createInitialCommit);
}

/**
 * Show a stale run-state error with a Reset button to clean up.
 */
function showStaleStateError(screenPrefix) {
  const el = document.getElementById(`${screenPrefix}-error`);
  if (!el) return;
  el.innerHTML = '<span>A previous run was interrupted. Clean up the leftover state to start fresh.</span>' +
    ' <button class="btn btn-success btn-sm" id="btn-reset-state">Reset</button>';
  el.classList.add('visible');
  document.getElementById('btn-reset-state')?.addEventListener('click', resetStaleState);
}

async function resetStaleState() {
  const btn = document.getElementById('btn-reset-state');
  if (btn) { btn.disabled = true; btn.textContent = 'Resetting...'; }

  const stateFile = state.projectDir.replace(/[\\/]$/, '') + '\\nightytidy-run-state.json';
  const lockFile = state.projectDir.replace(/[\\/]$/, '') + '\\nightytidy.lock';
  await api('delete-file', { path: stateFile });
  await api('delete-file', { path: lockFile });

  clearError('steps');
}

/**
 * Initialize git + create initial commit in the project folder.
 */
async function initializeGit() {
  clearError('setup');
  clearError('steps');
  const btn = document.getElementById('btn-git-init');
  if (btn) { btn.disabled = true; btn.textContent = 'Initializing...'; }

  const result = await runShellInProject('git init && git add -A && git commit -m "Initial commit"');

  if (!result.ok || result.exitCode !== 0) {
    showError('setup', 'Git initialization failed. ' + (result.stderr || '').trim());
    return;
  }

  await loadSteps();
}

/**
 * Create an initial commit in a repo that has no commits.
 */
async function createInitialCommit() {
  clearError('setup');
  clearError('steps');
  const btn = document.getElementById('btn-git-commit');
  if (btn) { btn.disabled = true; btn.textContent = 'Committing...'; }

  const result = await runShellInProject('git add -A && git commit -m "Initial commit"');

  if (!result.ok || result.exitCode !== 0) {
    showError('setup', 'Could not create initial commit. ' + (result.stderr || '').trim());
    return;
  }

  await loadSteps();
}

// ── Screen 1: Setup ────────────────────────────────────────────────

async function selectFolder() {
  clearError('setup');

  // Immediate visual feedback: disable button during OS dialog
  const selectBtn = document.getElementById('btn-select-folder');
  const originalText = selectBtn.textContent;
  selectBtn.disabled = true;
  selectBtn.textContent = 'Opening...';

  try {
    // Prefetch config in parallel while folder dialog is open (perceived speed optimization)
    const configPromise = !state.bin ? api('config') : Promise.resolve({ ok: true, bin: state.bin });

    const result = await api('select-folder');

    // Restore button state
    selectBtn.disabled = false;
    selectBtn.textContent = originalText;

    if (!result.ok || !result.folder) return; // User cancelled

    // Apply prefetched config
    const config = await configPromise;
    if (config.ok && config.bin) state.bin = config.bin;

    state.projectDir = result.folder;
    showFolderPath(result.folder);
    await loadSteps();
  } catch (err) {
    // Restore button state on error
    selectBtn.disabled = false;
    selectBtn.textContent = originalText;

    logToServer('error', `Folder selection failed: ${err.message}`);
    showError('setup', 'Folder selection did not complete. Please try again or type the path manually.');
  }
}

function showFolderPath(path) {
  document.getElementById('folder-display').style.display = 'flex';
  document.getElementById('folder-path').textContent = path;
}

/**
 * Check for a paused run state file and show the resume banner if found.
 */
async function checkForPausedRun() {
  if (!state.projectDir) return;

  const statePath = state.projectDir + '\\nightytidy-run-state.json';
  const result = await api('read-file', { path: statePath }, 5000);
  if (!result.ok || !result.content) return;

  let runState;
  try { runState = JSON.parse(result.content); } catch { return; }

  // Show resume banner if there are incomplete steps (any selectedSteps not in completedSteps).
  // Failed steps count as "remaining" because they will be retried on resume.
  if (!runState.selectedSteps?.length) return;

  const completedNums = new Set((runState.completedSteps || []).map(s => s.number));
  const remaining = runState.selectedSteps.filter(n => !completedNums.has(n));
  if (remaining.length === 0) return;

  const completed = completedNums.size;
  const total = runState.selectedSteps.length;

  const banner = document.getElementById('resume-banner');
  const text = document.getElementById('resume-banner-text');
  text.textContent = `Previous run found: ${completed} of ${total} steps completed, ${remaining.length} remaining.`;
  banner.classList.remove('hidden');
}

async function handleResumeRun() {
  const banner = document.getElementById('resume-banner');
  banner.classList.add('hidden');
  logToServer('info', 'User clicked Resume Run — loading saved state');

  // Read the saved state file
  const statePath = state.projectDir + '\\nightytidy-run-state.json';
  const result = await api('read-file', { path: statePath }, 5000);
  if (!result.ok || !result.content) {
    showError('steps', 'Could not read saved run state. Start a fresh run instead.');
    return;
  }

  let runState;
  try { runState = JSON.parse(result.content); } catch {
    showError('steps', 'Saved run state is corrupted. Start a fresh run instead.');
    return;
  }

  // Populate GUI state from saved run state.
  // Rate-limited failures are treated as "pending" — they'll be retried.
  // Genuinely failed steps stay failed (skipped by getNextStep).
  const genuinelyFailed = (runState.failedSteps || []).filter(s => s.errorType !== 'rate_limit');
  const rateLimited = (runState.failedSteps || []).filter(s => s.errorType === 'rate_limit');

  state.selectedSteps = runState.selectedSteps || [];
  state.timeout = runState.timeout ? Math.round(runState.timeout / 60000) : 75;
  state.completedSteps = (runState.completedSteps || []).map(s => s.number);
  state.failedSteps = genuinelyFailed.map(s => s.number);
  state.stepResults = [
    ...(runState.completedSteps || []).map(s => ({
      step: s.number, name: s.name, status: 'completed',
      duration: s.duration, output: s.output || '', error: null,
      costUSD: s.cost?.costUSD || null,
      inputTokens: s.cost?.inputTokens || null,
      outputTokens: s.cost?.outputTokens || null,
    })),
    ...genuinelyFailed.map(s => ({
      step: s.number, name: s.name, status: 'failed',
      duration: s.duration, output: s.output || '', error: s.error,
      costUSD: s.cost?.costUSD || null,
      inputTokens: s.cost?.inputTokens || null,
      outputTokens: s.cost?.outputTokens || null,
    })),
  ];
  state.runInfo = runState;
  state.runStartTime = runState.startTime || Date.now();
  state.stopping = false;
  state.skippedSteps = [];
  state.backoffAttempt = 0;
  resetCachedTotals();
  for (const r of state.stepResults) updateCachedTotals(r);

  const retrying = rateLimited.length;
  const remaining = state.selectedSteps.length - state.completedSteps.length - state.failedSteps.length;
  logToServer('info', `Resume: ${state.completedSteps.length} completed, ${state.failedSteps.length} failed, ${retrying} rate-limited (will retry), ${remaining} remaining`);

  showScreen(SCREENS.RUNNING);

  // Show "Resuming" subtitle
  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = 'Resuming';
  subtitle.className = 'subtitle subtitle-resuming';
  document.title = 'Resuming \u2014 NightyTidy';

  renderRunningStepList();

  // Mark already-completed and genuinely-failed steps in the UI
  for (const num of state.completedSteps) updateStepItemStatus(num, 'completed');
  for (const num of state.failedSteps) updateStepItemStatus(num, 'failed');

  updateProgressBar();
  startProgressPolling();
  startElapsedTimer();
  runNextStep();
}

function handleStartFresh() {
  const banner = document.getElementById('resume-banner');
  banner.classList.add('hidden');
  logToServer('info', 'User clicked Start Fresh — cleaning up old run state');
  const base = state.projectDir + '\\';
  api('delete-file', { path: base + 'nightytidy-run-state.json' }).catch(() => {});
  api('delete-file', { path: base + 'nightytidy.lock' }).catch(() => {});
  api('delete-file', { path: base + 'nightytidy-progress.json' }).catch(() => {});
}

async function loadSteps() {
  const loadingEl = document.getElementById('setup-loading');
  loadingEl.style.display = 'block';
  clearError('setup');

  // Check git readiness before loading steps — surface issues early
  const gitStatus = await checkGitReady();
  if (!gitStatus.ready) {
    loadingEl.style.display = 'none';
    showGitSetupError('setup', gitStatus.reason);
    return;
  }

  // Show skeleton placeholders immediately for perceived speed
  showStepsSkeleton();
  showScreen(SCREENS.STEPS);

  // Sync prompts from Google Doc before listing steps (mirrors CLI behavior).
  // Non-blocking: if sync fails (no network, etc.), we still show cached steps.
  const syncResult = await runCli('--sync');
  if (syncResult.ok) logToServer('info', 'Prompt sync completed before step list');
  else logToServer('warn', `Prompt sync failed (using cached steps): ${syncResult.error || 'unknown'}`);

  const result = await runCli('--list --json');
  loadingEl.style.display = 'none';

  if (!result.ok) {
    showScreen(SCREENS.SETUP);
    showError('setup', result.error);
    return;
  }

  if (!result.data || !result.data.steps || !result.data.steps.length) {
    showScreen(SCREENS.SETUP);
    showError('setup', 'No steps returned from NightyTidy CLI');
    return;
  }

  state.steps = result.data.steps;
  renderStepChecklist();

  // Check for a paused run that can be resumed
  await checkForPausedRun();
}

/**
 * Show skeleton loading placeholders in the step checklist.
 * Creates instant visual feedback while actual steps are loading.
 */
function showStepsSkeleton() {
  const container = document.getElementById('step-checklist');
  const projectPath = document.getElementById('steps-project-path');
  projectPath.textContent = state.projectDir;

  // Show 10 skeleton lines as placeholders (roughly half of 36 steps visible at once)
  let skeletonHtml = '';
  for (let i = 0; i < 10; i++) {
    const widthClass = i % 3 === 0 ? 'short' : i % 2 === 0 ? 'medium' : '';
    skeletonHtml += `
      <div class="step-check-item">
        <span class="skeleton" style="width:14px;height:14px;flex-shrink:0;"></span>
        <span class="skeleton" style="width:22px;height:1em;"></span>
        <span class="skeleton skeleton-line ${widthClass}" style="flex:1;"></span>
      </div>
    `;
  }
  container.innerHTML = skeletonHtml;

  // Disable start button until real steps load
  document.getElementById('btn-start-run').disabled = true;
  document.getElementById('step-count-badge').textContent = 'Loading steps...';
}

// ── Screen 2: Step Selection ───────────────────────────────────────

function renderStepChecklist() {
  const container = document.getElementById('step-checklist');
  const projectPath = document.getElementById('steps-project-path');
  projectPath.textContent = state.projectDir;

  container.innerHTML = state.steps.map(s => `
    <label class="step-check-item">
      <input type="checkbox" value="${s.number}" checked>
      <span class="step-num">${s.number}.</span>
      <span class="step-label">${NtLogic.escapeHtml(s.name)}</span>
    </label>
  `).join('');

  updateStepCount();
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateStepCount);
  });
}

function getCheckedSteps() {
  const checks = document.querySelectorAll('#step-checklist input[type="checkbox"]:checked');
  return Array.from(checks).map(cb => parseInt(cb.value, 10));
}

function updateStepCount() {
  const count = getCheckedSteps().length;
  document.getElementById('step-count-badge').textContent = `${count} step${count !== 1 ? 's' : ''} selected`;
  document.getElementById('btn-start-run').disabled = count === 0;
}

function selectAllSteps(checked) {
  document.querySelectorAll('#step-checklist input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
  updateStepCount();
}

async function startRun() {
  clearError('steps');
  const selected = getCheckedSteps();
  if (!selected.length) return;

  // Immediate visual feedback: disable button and show loading state
  const startBtn = document.getElementById('btn-start-run');
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';

  state.selectedSteps = selected;
  state.timeout = parseInt(document.getElementById('timeout-input').value, 10) || 75;
  state.completedSteps = [];
  state.failedSteps = [];
  state.stepResults = [];
  state.stopping = false;
  resetCachedTotals();

  const stepArgs = NtLogic.buildStepArgs(selected, state.steps.length);
  const timeoutArg = state.timeout !== 75 ? ` --timeout ${state.timeout}` : '';
  const args = `--init-run ${stepArgs}${timeoutArg} --skip-dashboard --skip-sync`;

  showInitOverlay();

  let result;
  if (state.simulationMode) {
    // Simulation: animate init phases quickly, skip real CLI
    for (let i = 0; i < NtLogic.INIT_PHASES.length; i++) {
      const el = document.getElementById(`init-phase-${NtLogic.INIT_PHASES[i].key}`);
      if (el) { el.classList.remove('init-phase-pending'); el.classList.add('init-phase-done'); }
      await new Promise(r => setTimeout(r, 200));
    }
    result = { ok: true, data: { success: true, runBranch: 'nightytidy/sim-test', tagName: 'nightytidy-sim-test', selectedSteps: state.selectedSteps } };
  } else {
    result = await runCli(args);
  }

  // On failure, briefly show which phase failed before hiding overlay
  const initFailed = !result.ok || (result.data && !result.data.success);
  if (initFailed) {
    markInitPhaseFailed();
    await new Promise(r => setTimeout(r, 1200));
  }
  hideInitOverlay();

  // Restore button state (in case of error return to steps screen)
  startBtn.disabled = false;
  startBtn.textContent = 'Start Run';

  if (!result.ok) {
    logToServer('error', `Init run failed: ${result.error}`);
    showError('steps', result.error);
    return;
  }

  if (!result.data.success) {
    const errMsg = result.data.error || 'Failed to initialize run';
    const gitReason = NtLogic.detectGitError(errMsg);
    if (gitReason) {
      showGitSetupError('steps', gitReason);
    } else if (NtLogic.detectStaleState(errMsg)) {
      showStaleStateError('steps');
    } else {
      showError('steps', errMsg);
    }
    return;
  }

  state.runInfo = result.data;
  state.runStartTime = Date.now();
  saveRunState();

  logToServer('info', `Run initialized: ${state.selectedSteps.length} steps, timeout=${state.timeout}m, branch=${result.data.runBranch || 'unknown'}`);

  showScreen(SCREENS.RUNNING);
  renderRunningStepList();
  updateProgressBar();
  if (!state.simulationMode) startProgressPolling(); // no progress file in simulation
  startElapsedTimer();
  if (state.simulationMode) {
    const subtitle = document.getElementById('running-subtitle');
    subtitle.textContent = 'SIMULATION MODE';
    subtitle.className = 'subtitle subtitle-resuming';
    document.title = 'Simulation \u2014 NightyTidy';
  }
  runNextStep();
}

// ── Screen 3: Running ──────────────────────────────────────────────

function renderRunningStepList() {
  document.getElementById('running-project-path').textContent = state.projectDir || '';
  const container = document.getElementById('running-step-list');
  const stepsHtml = state.selectedSteps.map(num => {
    const step = state.steps.find(s => s.number === num);
    const name = step ? step.name : `Step ${num}`;
    return `
      <div class="step-item step-pending" id="run-step-${num}" role="listitem">
        <span class="step-icon"><span aria-hidden="true">&#9675;</span><span class="sr-only">Pending</span></span>
        <span class="step-num">${num}.</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
        <span class="step-cost"></span>
        <span class="step-tokens"></span>
        <span class="step-duration"></span>
      </div>
    `;
  }).join('');

  // Virtual "Final Report" step — always visible at the bottom
  const finishHtml = `
    <div class="step-item step-pending step-finish" id="run-step-${FINISH_STEP_NUM}" role="listitem">
      <span class="step-icon"><span aria-hidden="true">&#9675;</span><span class="sr-only">Pending</span></span>
      <span class="step-num"></span>
      <span class="step-name">Final Report</span>
      <span class="step-cost"></span>
      <span class="step-tokens"></span>
      <span class="step-duration"></span>
    </div>
  `;
  container.innerHTML = stepsHtml + finishHtml;
}

function updateStepItemStatus(stepNum, status, duration) {
  const el = document.getElementById(`run-step-${stepNum}`);
  if (!el) return;

  el.className = `step-item step-${status}`;
  const iconEl = el.querySelector('.step-icon');
  const durEl = el.querySelector('.step-duration');
  const costEl = el.querySelector('.step-cost');
  const tokensEl = el.querySelector('.step-tokens');

  switch (status) {
    case 'running':
      iconEl.innerHTML = '<span class="spinner" role="img" aria-label="Running"></span>';
      break;
    case 'completed':
    case 'failed': {
      iconEl.innerHTML = status === 'completed'
        ? '<span aria-hidden="true">\u2713</span><span class="sr-only">Completed</span>'
        : '<span aria-hidden="true">\u2717</span><span class="sr-only">Failed</span>';
      if (duration) durEl.textContent = NtLogic.formatMs(duration);
      const r = state.stepResults.find(r => r.step === stepNum);
      if (costEl) {
        const costStr = r ? NtLogic.formatCost(r.costUSD) : null;
        if (costStr) costEl.textContent = costStr;
      }
      if (tokensEl && r) {
        const total = (r.inputTokens || 0) + (r.outputTokens || 0);
        const tokStr = NtLogic.formatTokens(total);
        if (tokStr) tokensEl.textContent = tokStr + ' tokens';
      }
      el.classList.add('step-clickable');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.onclick = () => viewStepOutput(stepNum);
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); viewStepOutput(stepNum); } };
      break;
    }
    case 'skipped':
      iconEl.innerHTML = '<span aria-hidden="true">\u27A0</span><span class="sr-only">Skipped</span>';
      if (duration) durEl.textContent = NtLogic.formatMs(duration);
      el.classList.add('step-clickable');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.onclick = () => viewStepOutput(stepNum);
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); viewStepOutput(stepNum); } };
      break;
    default:
      iconEl.innerHTML = '<span aria-hidden="true">&#9675;</span><span class="sr-only">Pending</span>';
  }
}

function updateProgressBar() {
  // +1 for the virtual "Final Report" step (always in the list)
  const total = state.selectedSteps.length + 1;
  const done = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('progress-bar-fill').style.width = `${pct}%`;
  document.getElementById('progress-bar-track').setAttribute('aria-valuenow', String(pct));
  document.getElementById('progress-counter').textContent = `${done} / ${total} steps`;
  document.getElementById('progress-pct').textContent = `${pct}%`;

  let detail = '';
  if (state.completedSteps.length > 0) detail += `${state.completedSteps.length} passed`;
  if (state.failedSteps.length > 0) {
    if (detail) detail += ', ';
    detail += `${state.failedSteps.length} failed`;
  }
  if (state.skippedSteps.length > 0) {
    if (detail) detail += ', ';
    detail += `${state.skippedSteps.length} skipped`;
  }
  document.getElementById('progress-detail').textContent = detail;
}

function updateElapsed() {
  if (!state.runStartTime) return;
  const elapsed = Date.now() - state.runStartTime;
  document.getElementById('progress-elapsed').textContent = NtLogic.formatMs(elapsed);

  // Update the current step's live elapsed time
  if (state.currentStepNum !== null && state.stepStartTime) {
    const stepElapsed = Date.now() - state.stepStartTime;
    const el = document.getElementById(`run-step-${state.currentStepNum}`);
    if (el) {
      const durEl = el.querySelector('.step-duration');
      if (durEl) durEl.textContent = NtLogic.formatMs(stepElapsed);
    }
  }

  // Running totals of cost & tokens (use cached values instead of O(n) reduce)
  const totalsEl = document.getElementById('running-totals');
  if (totalsEl) {
    let html = '';
    if (cachedTotalCost > 0) {
      html += `<span class="cost">${NtLogic.formatCost(cachedTotalCost)}</span>`;
    }
    if (cachedTotalTokens > 0) {
      html += `<span class="tokens">${NtLogic.formatTokens(cachedTotalTokens)} tokens</span>`;
    }
    totalsEl.innerHTML = html;
  }

  // Refresh the "Last update" display so the "ago" counter stays current
  if (lastOutputChangeTime) {
    updateLastUpdateDisplay();
  }
}

function showCurrentStep(stepNum) {
  const step = state.steps.find(s => s.number === stepNum);
  const name = step ? step.name : `Step ${stepNum}`;
  const done = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
  const total = state.selectedSteps.length;
  const position = done + 1;

  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = `Step ${position} of ${total} — ${name}`;
  subtitle.className = 'subtitle subtitle-running';

  document.title = `Step ${position}/${total} — NightyTidy`;

  document.getElementById('btn-skip-step').disabled = false;
  document.getElementById('btn-skip-step').textContent = 'Skip Step';
}

function hideCurrentStep() {
  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = '';
  subtitle.className = 'subtitle';

  document.title = 'NightyTidy';
}

async function runNextStep() {
  if (state.stopping) {
    logToServer('info', 'runNextStep: bailing — state.stopping=true');
    return;
  }
  if (state.paused) {
    logToServer('info', 'runNextStep: bailing — state.paused=true');
    return;
  }

  const next = NtLogic.getNextStep(state.selectedSteps, state.completedSteps, state.failedSteps, state.skippedSteps);
  logToServer('info', `runNextStep: next=${next} (completed=${state.completedSteps}, failed=${state.failedSteps}, skipped=${state.skippedSteps})`);
  if (next === null) {
    logToServer('info', 'runNextStep: all steps done, calling finishRun()');
    await finishRun();
    return;
  }

  showCurrentStep(next);
  updateStepItemStatus(next, 'running');
  backToLive();
  state.currentStepNum = next;
  state.stepStartTime = Date.now();
  lastOutputChangeTime = Date.now(); // Reset for new step

  // Debug simulation: fake a rate-limit response for the targeted step
  const simTarget = state.simulateRateLimitStep;
  if (simTarget != null && (simTarget === next || simTarget === -1)) {
    state.simulateRateLimitStep = null; // one-shot
    const step = state.steps.find(s => s.number === next);
    logToServer('warn', `SIMULATING rate limit on step ${next}`);
    const fakeResult = { ok: true, data: { step: next, name: step?.name || `Step ${next}`, status: 'failed', errorType: 'rate_limit', retryAfterMs: 120000, error: 'Simulated rate limit for testing', duration: 0, attempts: 1, output: '' } };
    // Fall through to the same code path that handles real results
    const rl = NtLogic.detectRateLimit(fakeResult.data);
    if (rl.detected) {
      updateStepItemStatus(next, 'pending');
      await enterPauseMode(next, rl.retryAfterMs);
      if (!state.stopping) runNextStep();
      return;
    }
  }

  let result;
  if (state.simulationMode) {
    // Simulation: fake a 3-second "run", then return success
    const step = state.steps.find(s => s.number === next);
    await new Promise(r => setTimeout(r, 3000));
    result = { ok: true, data: { step: next, name: step?.name || `Step ${next}`, status: 'completed', duration: 3000, attempts: 1, output: '[Simulated] Step completed successfully.', costUSD: 0.01, inputTokens: 500, outputTokens: 200 } };
  } else {
    const timeoutArg = state.timeout !== 75 ? ` --timeout ${state.timeout}` : '';
    result = await runCli(`--run-step ${next}${timeoutArg}`);
  }

  // Skip detection: user clicked "Skip Step" while this step was running
  if (state.skippingStep) {
    const skippedNum = state.skippingStep;
    state.skippingStep = null;
    state.skippedSteps.push(skippedNum);

    const liveSnapshot = lastRenderedOutput || '';
    const step = state.steps.find(s => s.number === skippedNum);
    const skippedResult = {
      step: skippedNum,
      name: step ? step.name : undefined,
      status: 'skipped',
      duration: state.stepStartTime ? Date.now() - state.stepStartTime : null,
      output: liveSnapshot,
      error: null,
      costUSD: null,
      inputTokens: null,
      outputTokens: null,
    };
    state.stepResults.push(skippedResult);
    updateCachedTotals(skippedResult);
    updateStepItemStatus(skippedNum, 'skipped', state.stepStartTime ? Date.now() - state.stepStartTime : null);
    resetSkipButton();

    state.currentStepNum = null;
    state.stepStartTime = null;
    updateProgressBar();
    runNextStep();
    return;
  }

  if (state.stopping) return;

  // Snapshot the last live output before it gets cleared (fallback if response has no output)
  const liveSnapshot = lastRenderedOutput || '';

  if (!result.ok) {
    // Check for rate-limit before recording as failed
    const rl = NtLogic.detectRateLimit({ error: result.error });
    if (rl.detected) {
      logToServer('warn', `Rate limit detected on step ${next}`);
      updateStepItemStatus(next, 'pending');
      await enterPauseMode(next, rl.retryAfterMs);
      if (!state.stopping) runNextStep();
      return;
    }

    logToServer('warn', `Step ${next} failed: ${result.error}`);
    state.failedSteps.push(next);
    const failedResult = { step: next, status: 'failed', error: result.error, output: liveSnapshot, costUSD: null, inputTokens: null, outputTokens: null };
    state.stepResults.push(failedResult);
    updateCachedTotals(failedResult);
    updateStepItemStatus(next, 'failed');
  } else {
    const data = result.data;
    const status = data.status || (data.success ? 'completed' : 'failed');
    const duration = data.duration || null;

    // Check for rate-limit on orchestrator-detected failures
    if (status === 'failed') {
      const rl = NtLogic.detectRateLimit(data);
      if (rl.detected) {
        logToServer('warn', `Rate limit detected on step ${next}`);
        updateStepItemStatus(next, 'pending');
        await enterPauseMode(next, rl.retryAfterMs);
        if (!state.stopping) runNextStep();
        return;
      }
    }

    if (status === 'completed') {
      state.completedSteps.push(next);
    } else {
      state.failedSteps.push(next);
    }

    const stepResult = {
      step: next,
      name: data.name,
      status,
      duration,
      durationFormatted: data.durationFormatted,
      attempts: data.attempts,
      output: data.output || liveSnapshot,
      error: data.error || null,
      costUSD: data.costUSD ?? null,
      inputTokens: data.inputTokens ?? null,
      outputTokens: data.outputTokens ?? null,
    };
    state.stepResults.push(stepResult);
    updateCachedTotals(stepResult);

    updateStepItemStatus(next, status, duration);
  }

  state.currentStepNum = null;
  state.stepStartTime = null;
  document.getElementById('btn-skip-step').disabled = true;
  updateProgressBar();
  runNextStep();
}

// ── Progress Polling ───────────────────────────────────────────────

const POLL_INTERVAL_FAST = 500;   // Normal polling interval (ms)
const POLL_INTERVAL_SLOW = 1000;  // Slower polling when no changes detected

function startProgressPolling() {
  stopProgressPolling();
  pollFailureCount = 0;
  state.pollInterval = POLL_INTERVAL_FAST;
  state.pollTimer = setInterval(pollProgress, state.pollInterval);
}

function stopProgressPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startElapsedTimer() {
  stopElapsedTimer();
  state.elapsedTimer = setInterval(updateElapsed, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) {
    clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }
}

let pollFailureCount = 0;
const POLL_FAILURE_WARN_THRESHOLD = 10; // Warn after 5s of consecutive failures (10 polls × 500ms)
const POLL_FAILURE_LOG_INTERVAL = 20;   // Log every 10s of continuous failure

async function pollProgress() {
  if (!state.projectDir) return;

  const sep = '\\'; // GUI is Windows-first
  const progressPath = `${state.projectDir}${sep}nightytidy-progress.json`;

  try {
    const result = await api('read-file', { path: progressPath }, 5000); // 5s timeout for polling
    if (result.ok && result.content) {
      const progress = JSON.parse(result.content);
      if (pollFailureCount >= POLL_FAILURE_WARN_THRESHOLD) {
        logToServer('info', `Progress polling recovered after ${pollFailureCount} failures`);
      }
      pollFailureCount = 0;
      renderProgressFromFile(progress);
    } else if (result.timedOut || result.fetchError) {
      pollFailureCount++;
      if (pollFailureCount === POLL_FAILURE_WARN_THRESHOLD) {
        logToServer('warn', `Progress polling failing for ${pollFailureCount} consecutive ticks: ${result.error}`);
      } else if (pollFailureCount > POLL_FAILURE_WARN_THRESHOLD && pollFailureCount % POLL_FAILURE_LOG_INTERVAL === 0) {
        logToServer('warn', `Progress polling still failing (${pollFailureCount} ticks): ${result.error}`);
      }
    }
    // result.ok but no content = file doesn't exist yet, normal for early ticks
  } catch (err) {
    pollFailureCount++;
    if (pollFailureCount === POLL_FAILURE_WARN_THRESHOLD) {
      logToServer('warn', `Progress polling error for ${pollFailureCount} consecutive ticks: ${err.message}`);
    } else if (pollFailureCount > POLL_FAILURE_WARN_THRESHOLD && pollFailureCount % POLL_FAILURE_LOG_INTERVAL === 0) {
      logToServer('warn', `Progress polling still erroring (${pollFailureCount} ticks): ${err.message}`);
    }
  }
}

function renderProgressFromFile(progress) {
  if (!progress) return;

  // Detect prod signal from orchestrator (Tier 2: session resume)
  if (progress.prodding && !state.prodding) {
    state.prodding = true;
    state.retrying = false;
    lastRenderedOutput = '';
    lastOutputChangeTime = Date.now();
    hideWorkingIndicator();

    const outputEl = document.getElementById('output-content');
    outputEl.innerHTML = '<div class="prod-banner">' +
      '<strong>\u26A1 Prodding</strong> \u2014 resuming previous session to recover work\u2026' +
      '</div>';
    const panel = document.getElementById('output-panel');
    panel.scrollTop = panel.scrollHeight;

    const subtitle = document.getElementById('running-subtitle');
    if (subtitle && state.currentStepNum) {
      const step = state.steps.find(s => s.number === state.currentStepNum);
      const name = step ? step.name : `Step ${state.currentStepNum}`;
      const done = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
      subtitle.textContent = `Step ${done + 1} of ${state.selectedSteps.length} \u2014 Prodding: ${name}`;
      subtitle.className = 'subtitle subtitle-prodding';
    }
    document.title = 'Prodding\u2026 \u2014 NightyTidy';
    updateLastUpdateDisplay();
    return;
  }

  // Clear prod flag when transitioning
  if (!progress.prodding && state.prodding) {
    state.prodding = false;
  }

  // Detect auto-retry signal from orchestrator (Tier 3: fresh session)
  if (progress.retrying && !state.retrying) {
    state.retrying = true;
    state.prodding = false;
    lastRenderedOutput = '';
    lastOutputChangeTime = Date.now();
    hideWorkingIndicator();

    const outputEl = document.getElementById('output-content');
    outputEl.innerHTML = '<div class="retry-banner">' +
      '<strong>\u21BB Auto-recovering</strong> \u2014 retrying step with fresh session\u2026' +
      '</div>';
    const panel = document.getElementById('output-panel');
    panel.scrollTop = panel.scrollHeight;

    const subtitle = document.getElementById('running-subtitle');
    if (subtitle && state.currentStepNum) {
      const step = state.steps.find(s => s.number === state.currentStepNum);
      const name = step ? step.name : `Step ${state.currentStepNum}`;
      const done = state.completedSteps.length + state.failedSteps.length + state.skippedSteps.length;
      subtitle.textContent = `Step ${done + 1} of ${state.selectedSteps.length} \u2014 Retrying: ${name}`;
      subtitle.className = 'subtitle subtitle-retrying';
    }
    document.title = 'Retrying\u2026 \u2014 NightyTidy';
    updateLastUpdateDisplay();
    return;
  }

  // Clear retry flag once new output arrives
  if (!progress.retrying && state.retrying) {
    state.retrying = false;
  }

  if (progress.currentStepOutput) {
    // Only re-render when the content has actually changed (polling is every 500ms)
    if (progress.currentStepOutput !== lastRenderedOutput) {
      lastRenderedOutput = progress.currentStepOutput;
      lastOutputChangeTime = Date.now();
      // Use requestAnimationFrame for smoother DOM updates
      requestAnimationFrame(() => {
        const outputEl = document.getElementById('output-content');
        outputEl.innerHTML = renderMarkdown(progress.currentStepOutput);
        const panel = document.getElementById('output-panel');
        panel.scrollTop = panel.scrollHeight;
      });
      hideWorkingIndicator();
      updateLastUpdateDisplay();
    } else {
      // Output hasn't changed — show working indicator after delay
      updateWorkingIndicator();
    }
  } else {
    // No output yet — show working indicator after delay
    if (!lastOutputChangeTime) lastOutputChangeTime = Date.now();
    updateWorkingIndicator();
  }
}

function updateWorkingIndicator() {
  if (state.screen !== SCREENS.RUNNING) return;
  const elapsed = Date.now() - (lastOutputChangeTime || state.runStartTime || Date.now());
  updateLastUpdateDisplay();
  if (elapsed >= WORKING_INDICATOR_DELAY_MS) {
    showWorkingIndicator(elapsed);
  }
}

const WORKING_ESCALATION_MS = 2 * 60 * 1000; // 2 minutes — escalate message

function showWorkingIndicator(elapsedMs) {
  const el = document.getElementById('working-indicator');
  if (!el) return;
  el.style.display = 'flex';
  const textEl = el.querySelector('.working-text');
  if (textEl && elapsedMs > 0) {
    if (elapsedMs >= WORKING_ESCALATION_MS) {
      textEl.textContent = `Claude may be stuck \u2014 will auto-recover soon (${NtLogic.formatMs(elapsedMs)})`;
    } else {
      textEl.textContent = `Claude is working (${NtLogic.formatMs(elapsedMs)})`;
    }
  }
}

function hideWorkingIndicator() {
  const el = document.getElementById('working-indicator');
  if (!el) return;
  el.style.display = 'none';
  const textEl = el.querySelector('.working-text');
  if (textEl) textEl.textContent = 'Claude is working';
}

function updateLastUpdateDisplay() {
  const el = document.getElementById('last-update-time');
  if (!el) return;
  if (!lastOutputChangeTime) {
    el.textContent = '';
    return;
  }
  const timeStr = NtLogic.formatTime(lastOutputChangeTime);
  const ago = Date.now() - lastOutputChangeTime;
  if (ago < 2000) {
    el.textContent = `Last update: ${timeStr}`;
  } else {
    el.textContent = `Last update: ${timeStr} (${NtLogic.formatMs(ago)} ago)`;
  }
}

function clearOutput() {
  document.getElementById('output-content').innerHTML = '';
  lastRenderedOutput = '';
  hideWorkingIndicator();
  const tsEl = document.getElementById('last-update-time');
  if (tsEl) tsEl.textContent = '';
}

// ── Side Drawer (step output & report viewer) ──────────────────

let drawerRawMarkdown = '';

function openDrawer(title, htmlContent, rawMarkdown) {
  const drawer = document.getElementById('step-drawer');
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-content').innerHTML = htmlContent;
  drawerRawMarkdown = rawMarkdown || '';
  // Reset copy button state
  const copyBtn = document.getElementById('btn-copy-drawer');
  if (copyBtn) { copyBtn.textContent = '\u2398 Copy'; copyBtn.classList.remove('copied'); }
  drawer.classList.add('open');
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  const drawer = document.getElementById('step-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
  state.viewingStepOutput = null;
  state.drawerReportPath = null;
  // Remove step highlights from both running and summary lists
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('step-active'));
}

function isDrawerOpen() {
  const drawer = document.getElementById('step-drawer');
  return drawer && drawer.classList.contains('open');
}

function viewStepOutput(stepNum) {
  const result = state.stepResults.find(r => r.step === stepNum);
  if (!result) return;

  // Toggle: clicking same step again closes the drawer
  if (isDrawerOpen() && state.viewingStepOutput === stepNum) {
    closeDrawer();
    return;
  }

  state.viewingStepOutput = stepNum;
  state.drawerReportPath = null;
  const name = result.name || `Step ${stepNum}`;
  const raw = result.output || (result.error ? `Error: ${result.error}` : '(No output recorded)');
  openDrawer(`Step ${stepNum}: ${name}`, renderMarkdown(raw), raw);

  // Highlight active step in whichever list is visible
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('step-active'));
  const activeEl = document.getElementById(`run-step-${stepNum}`)
    || document.querySelector(`.step-item[data-step="${stepNum}"]`);
  if (activeEl) activeEl.classList.add('step-active');
}

function viewSummaryStepOutput(stepNum) {
  viewStepOutput(stepNum);
}

function backToLive() {
  closeDrawer();
}

function closeSummaryOutput() {
  closeDrawer();
}

async function viewReport(reportPath, title) {
  // Toggle: clicking same report again closes the drawer
  if (isDrawerOpen() && state.drawerReportPath === reportPath) {
    closeDrawer();
    return;
  }

  state.viewingStepOutput = null;
  state.drawerReportPath = reportPath;
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('step-active'));

  openDrawer(title || reportPath, '<p style="color:var(--text-dim)">Loading report\u2026</p>');

  // Prefer embedded content from finishRun response (no file read needed)
  const finishData = state.finishResult;
  if (finishData?.reportContent && reportPath === finishData.reportPath) {
    drawerRawMarkdown = finishData.reportContent;
    document.getElementById('drawer-content').innerHTML = renderMarkdown(finishData.reportContent);
    return;
  }

  // Fallback: read from disk via API
  const sep = (state.projectDir && state.projectDir.includes('/')) ? '/' : '\\';
  const fullPath = state.projectDir
    ? state.projectDir.replace(/[\\/]$/, '') + sep + reportPath
    : reportPath;

  logToServer('info', `viewReport: projectDir="${state.projectDir}", reportPath="${reportPath}", fullPath="${fullPath}"`);

  const result = await api('read-file', { path: fullPath });
  if (result.ok && result.content) {
    drawerRawMarkdown = result.content;
    document.getElementById('drawer-content').innerHTML = renderMarkdown(result.content);
  } else {
    logToServer('warn', `viewReport failed: error="${result.error}", path="${result.path || fullPath}"`);
    const pathHint = result.path ? `<br><small style="color:var(--text-dim)">Path: ${NtLogic.escapeHtml(result.path)}</small>` : '';
    document.getElementById('drawer-content').innerHTML = `<p style="color:var(--red)">Could not load report: ${NtLogic.escapeHtml(result.error || 'Unknown error')}${pathHint}</p>`;
  }
}

// ── Rate Limit Pause / Resume ──────────────────────────────────────

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

function enterPauseMode(stepNum, retryAfterMs) {
  logToServer('info', `enterPauseMode: step=${stepNum}, retryAfterMs=${retryAfterMs}, backoffAttempt=${state.backoffAttempt}`);
  state.paused = true;
  state.pausedStepNum = stepNum;

  const waitMs = retryAfterMs || BACKOFF_SCHEDULE_MS[Math.min(state.backoffAttempt, BACKOFF_SCHEDULE_MS.length - 1)];
  state.resumeCountdown = Date.now() + waitMs;
  state.backoffAttempt++;

  showPauseOverlay(stepNum, waitMs, retryAfterMs != null);
  startCountdownTimer();

  // Add paused visual to the step item
  const stepItem = document.getElementById(`run-step-${stepNum}`);
  if (stepItem) stepItem.classList.add('step-paused');

  return new Promise(resolve => {
    state.manualResumeResolve = resolve;
    state._pauseTimer = setTimeout(() => {
      if (state.paused) resolve();
    }, waitMs);
  }).then(() => {
    hidePauseOverlay();
    stopCountdownTimer();
    state.paused = false;
    state.pausedStepNum = null;
    state.resumeCountdown = null;
    state.manualResumeResolve = null;
    state._pauseTimer = null;

    // Remove paused visual
    const el = document.getElementById(`run-step-${stepNum}`);
    if (el) el.classList.remove('step-paused');
  });
}

function manualResume() {
  if (!state.paused) return;
  if (state._pauseTimer) clearTimeout(state._pauseTimer);
  state.backoffAttempt = 0; // Reset backoff on manual resume
  if (state.manualResumeResolve) state.manualResumeResolve();
}

function finishNow() {
  if (!state.paused) return;
  if (state._pauseTimer) clearTimeout(state._pauseTimer);
  state.stopping = true;
  if (state.manualResumeResolve) state.manualResumeResolve();
  // After promise resolves, runNextStep sees state.stopping and bails
  // Then we explicitly call finishRun
  hidePauseOverlay();
  stopCountdownTimer();
  state.paused = false;
  finishRun();
}

/**
 * Save & Close: kills process, saves state for --resume, and exits.
 * The CLI backend writes nightytidy-run-state.json during rate-limit pause,
 * so the state file already exists by the time this button is clicked.
 */
function saveAndClose() {
  if (!state.paused) return;
  logToServer('info', 'User clicked Save & Close — exiting for later resume');

  if (state._pauseTimer) clearTimeout(state._pauseTimer);
  hidePauseOverlay();
  stopCountdownTimer();
  state.paused = false;

  // Kill any running CLI process (may already be waiting on rate limit)
  if (state.currentProcessId) {
    api('kill-process', { id: state.currentProcessId }).catch(() => {});
  }
  clearSavedRunState();

  // Show a confirmation message before exiting
  const running = document.getElementById('screen-running');
  if (running) {
    running.innerHTML = `
      <div style="text-align:center;padding:48px 24px;">
        <h2 style="color:var(--green);margin-bottom:16px;">Progress Saved</h2>
        <p style="max-width:420px;margin:0 auto 16px;">Your progress has been saved. Just relaunch NightyTidy and select this same project folder &mdash; you'll see a <strong>Resume Run</strong> option.</p>
        <p style="color:var(--text-dim);font-size:0.85rem;">This window will close in a moment.</p>
      </div>`;
  }

  // Give user a moment to read, then exit
  setTimeout(() => {
    navigator.sendBeacon('/api/exit');
  }, 4000);
}

function showPauseOverlay(stepNum, waitMs, hasRetryAfter) {
  const step = state.steps.find(s => s.number === stepNum);
  const name = step ? step.name : `Step ${stepNum}`;

  document.getElementById('pause-step-name').textContent = `Step ${stepNum}: ${name}`;
  document.getElementById('pause-countdown').textContent = NtLogic.formatCountdown(waitMs);

  const sourceText = hasRetryAfter
    ? 'API indicated a retry window.'
    : `Auto-retry in ${NtLogic.formatMs(waitMs)} (attempt ${state.backoffAttempt}).`;
  document.getElementById('pause-source').textContent = sourceText;

  const pauseOverlay = document.getElementById('pause-overlay');
  pauseOverlay.classList.remove('hidden');
  // Set up focus trap
  pauseFocusTrapCleanup = trapFocus(pauseOverlay.querySelector('.modal'));
  // Focus the Resume button (primary action)
  const resumeBtn = document.getElementById('btn-resume-now');
  if (resumeBtn) resumeBtn.focus();

  document.getElementById('btn-skip-step').disabled = true;

  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = 'Paused \u2014 Rate Limit';
  subtitle.className = 'subtitle subtitle-paused';
  document.title = 'Paused \u2014 NightyTidy';
}

function hidePauseOverlay() {
  document.getElementById('pause-overlay').classList.add('hidden');
  // Clean up focus trap
  if (pauseFocusTrapCleanup) { pauseFocusTrapCleanup(); pauseFocusTrapCleanup = null; }
  document.getElementById('btn-skip-step').disabled = false;

  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = '';
  subtitle.className = 'subtitle';
  document.title = 'NightyTidy';
}

function startCountdownTimer() {
  stopCountdownTimer();
  state.countdownTimer = setInterval(() => {
    if (!state.resumeCountdown) return;
    const remaining = Math.max(0, state.resumeCountdown - Date.now());
    document.getElementById('pause-countdown').textContent = NtLogic.formatCountdown(remaining);
    if (remaining <= 0) stopCountdownTimer();
  }, 1000);
}

function stopCountdownTimer() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

// ── Skip Step ─────────────────────────────────────────────────────

async function skipStep() {
  if (state.currentStepNum === null || state.skippingStep || state.stopping) return;
  state.skippingStep = state.currentStepNum;

  const btn = document.getElementById('btn-skip-step');
  btn.disabled = true;
  btn.textContent = 'Skipping...';

  if (state.currentProcessId) {
    try { await api('kill-process', { id: state.currentProcessId }); }
    catch { /* ignore — process may already be dead */ }
  }
  // runNextStep() will detect state.skippingStep when runCli returns
}

function resetSkipButton() {
  const btn = document.getElementById('btn-skip-step');
  btn.disabled = false;
  btn.textContent = 'Skip Step';
}

// ── Focus Trap (for modal accessibility) ────────────────────────────

function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  modalEl.addEventListener('keydown', handler);
  return () => modalEl.removeEventListener('keydown', handler);
}

let confirmStopFocusTrapCleanup = null;
let pauseFocusTrapCleanup = null;

// ── Stop Run ───────────────────────────────────────────────────────

let lastFocusedElement = null;

function confirmStopRun() {
  if (state.stopping) return;
  lastFocusedElement = document.activeElement;
  const overlay = document.getElementById('confirm-stop-overlay');
  overlay.classList.remove('hidden');
  // Set up focus trap
  confirmStopFocusTrapCleanup = trapFocus(overlay.querySelector('.modal'));
  // Focus the cancel button (safer default action)
  const cancelBtn = document.getElementById('btn-confirm-stop-cancel');
  if (cancelBtn) cancelBtn.focus();
}

function cancelStopRun() {
  document.getElementById('confirm-stop-overlay').classList.add('hidden');
  // Clean up focus trap
  if (confirmStopFocusTrapCleanup) { confirmStopFocusTrapCleanup(); confirmStopFocusTrapCleanup = null; }
  // Restore focus to the element that opened the modal
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

async function stopRun() {
  document.getElementById('confirm-stop-overlay').classList.add('hidden');
  // Clean up focus trap
  if (confirmStopFocusTrapCleanup) { confirmStopFocusTrapCleanup(); confirmStopFocusTrapCleanup = null; }
  if (state.stopping) return;
  state.stopping = true;
  logToServer('info', `stopRun: stopping run (currentStep=${state.currentStepNum}, processId=${state.currentProcessId})`);

  document.getElementById('btn-stop-run').disabled = true;
  document.getElementById('btn-stop-run').textContent = 'Stopping...';
  document.getElementById('btn-skip-step').disabled = true;

  // Kill the currently running process
  if (state.currentProcessId) {
    try {
      await api('kill-process', { id: state.currentProcessId });
    } catch { /* ignore */ }
  }

  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = 'Stopped';
  subtitle.className = 'subtitle subtitle-stopped';
  document.title = 'Stopped — NightyTidy';

  await finishRun();
}

// ── Finish Run (runs as a visual step on the RUNNING screen) ──────

const FINISH_TIMEOUT_MS = 900_000;  // Auto-skip after 15 minutes (finish-run makes 2 AI calls)

async function finishRun() {
  logToServer('info', 'finishRun: starting (inline as step)');

  // Scroll the step list so the finish step is visible
  const finishEl = document.getElementById(`run-step-${FINISH_STEP_NUM}`);
  if (finishEl) finishEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  updateStepItemStatus(FINISH_STEP_NUM, 'running');
  state.currentStepNum = FINISH_STEP_NUM;
  state.stepStartTime = Date.now();
  lastOutputChangeTime = Date.now();

  // Show subtitle
  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = 'Finalizing \u2014 Generating report';
  subtitle.className = 'subtitle subtitle-running';
  document.title = 'Finalizing... \u2014 NightyTidy';

  // Keep progress polling + elapsed timer active for live output
  if (!state.pollTimer) startProgressPolling();
  if (!state.elapsedTimer) startElapsedTimer();
  backToLive();
  updateProgressBar();

  // Configure skip button as escape hatch
  const skipBtn = document.getElementById('btn-skip-step');
  skipBtn.textContent = 'Skip Finishing';
  skipBtn.disabled = false;

  // Safety timeout (15 min auto-skip)
  const finishTimeoutId = setTimeout(() => {
    logToServer('warn', 'Finishing timed out after 15 minutes');
    if (state.currentProcessId) {
      api('kill-process', { id: state.currentProcessId }).catch(() => {});
    }
    completeFinish(null, true);
  }, FINISH_TIMEOUT_MS);

  let result;
  if (state.simulationMode) {
    await new Promise(r => setTimeout(r, 2000));
    result = { ok: true, data: { success: true, reportPath: '(simulated)', mergeResult: { success: true } } };
  } else {
    try {
      result = await runCli('--finish-run');
    } catch (err) {
      clearTimeout(finishTimeoutId);
      logToServer('error', `finishRun exception: ${err.message || err}`);
      completeFinish(null, true);
      return;
    }
  }

  clearTimeout(finishTimeoutId);

  // User clicked "Skip Finishing" while it was running
  if (state.skippingStep === FINISH_STEP_NUM) {
    state.skippingStep = null;
    completeFinish(null, false, true);
    return;
  }

  if (state.stopping) {
    completeFinish(null, false, true);
    return;
  }

  if (!result.ok) {
    logToServer('error', `Finish run failed: ${result.error}`);
    completeFinish(null, true);
    return;
  }

  completeFinish(result.data, false);
}

function completeFinish(data, failed, skipped) {
  clearSavedRunState();
  stopProgressPolling();
  stopElapsedTimer();

  const finishDuration = state.stepStartTime ? Date.now() - state.stepStartTime : null;
  state.currentStepNum = null;
  state.stepStartTime = null;

  // Reset skip button text for future runs
  const skipBtn = document.getElementById('btn-skip-step');
  skipBtn.textContent = 'Skip Step';
  skipBtn.disabled = true;

  if (data && data.success !== false) {
    state.finishResult = data;
    state.finishFailed = false;
    state.completedSteps.push(FINISH_STEP_NUM);

    const finishResult = {
      step: FINISH_STEP_NUM,
      name: 'Final Report',
      status: 'completed',
      duration: data.finishDuration || finishDuration,
      output: data.reportContent || lastRenderedOutput || '',
      costUSD: data.finishCostUSD ?? null,
      inputTokens: data.finishInputTokens ?? null,
      outputTokens: data.finishOutputTokens ?? null,
    };
    state.stepResults.push(finishResult);
    updateCachedTotals(finishResult);
    updateStepItemStatus(FINISH_STEP_NUM, 'completed', data.finishDuration || finishDuration);

    renderSummary(data);
  } else {
    state.finishFailed = true;

    const status = skipped ? 'skipped' : 'failed';
    if (skipped) {
      state.skippedSteps.push(FINISH_STEP_NUM);
    } else {
      state.failedSteps.push(FINISH_STEP_NUM);
    }

    const finishFailResult = {
      step: FINISH_STEP_NUM,
      name: 'Final Report',
      status,
      duration: finishDuration,
      output: lastRenderedOutput || '',
      costUSD: null,
      inputTokens: null,
      outputTokens: null,
    };
    state.stepResults.push(finishFailResult);
    updateCachedTotals(finishFailResult);
    updateStepItemStatus(FINISH_STEP_NUM, status, finishDuration);

    renderSummary(null);
  }

  updateProgressBar();
  showScreen(SCREENS.SUMMARY);
}

// ── Screen 5: Summary ──────────────────────────────────────────────

function renderSummary(finishData) {
  document.getElementById('summary-project-path').textContent = state.projectDir || '';
  const completed = state.completedSteps.length;
  const failed = state.failedSteps.length;
  const skipped = state.skippedSteps.length;
  const total = state.selectedSteps.length;
  const totalDuration = state.runStartTime ? Date.now() - state.runStartTime : 0;

  const resultEl = document.getElementById('summary-result');
  const titleEl = document.getElementById('summary-title');

  if (state.stopping) {
    resultEl.className = 'summary-result partial';
    titleEl.textContent = 'Run Stopped';
    document.title = 'Stopped — NightyTidy';
  } else if (state.finishFailed && failed === 0 && completed > 0) {
    resultEl.className = 'summary-result warning';
    titleEl.textContent = 'Run Complete (report pending)';
    document.title = 'Complete (report pending) — NightyTidy';
  } else if (failed === 0 && skipped === 0 && completed > 0) {
    resultEl.className = 'summary-result success';
    titleEl.textContent = 'Run Complete';
    document.title = 'Complete — NightyTidy';
  } else if (completed === 0) {
    resultEl.className = 'summary-result failure';
    titleEl.textContent = 'Run Failed';
    document.title = 'Failed — NightyTidy';
  } else {
    resultEl.className = 'summary-result partial';
    const issues = [failed > 0 ? 'failures' : '', skipped > 0 ? 'skips' : ''].filter(Boolean).join(' & ');
    titleEl.textContent = `Run Complete (with ${issues})`;
    document.title = 'Complete — NightyTidy';
  }

  const statsEl = document.getElementById('summary-stats');
  const durationStr = finishData?.totalDurationFormatted || NtLogic.formatMs(totalDuration);

  // Total cost: prefer finishData (includes overhead), fallback to sum of step costs
  let totalCostUSD = finishData?.totalCostUSD ?? null;
  if (totalCostUSD === null) {
    const stepCosts = state.stepResults.filter(r => r.costUSD != null).map(r => r.costUSD);
    if (stepCosts.length > 0) totalCostUSD = stepCosts.reduce((a, b) => a + b, 0);
  }
  const totalCostStr = NtLogic.formatCost(totalCostUSD);

  // Total tokens: prefer finishData, fallback to sum of step tokens
  let totalInputTokens = finishData?.totalInputTokens ?? null;
  let totalOutputTokens = finishData?.totalOutputTokens ?? null;
  if (totalInputTokens === null) {
    const stepInputs = state.stepResults.filter(r => r.inputTokens != null).map(r => r.inputTokens);
    if (stepInputs.length > 0) totalInputTokens = stepInputs.reduce((a, b) => a + b, 0);
  }
  if (totalOutputTokens === null) {
    const stepOutputs = state.stepResults.filter(r => r.outputTokens != null).map(r => r.outputTokens);
    if (stepOutputs.length > 0) totalOutputTokens = stepOutputs.reduce((a, b) => a + b, 0);
  }
  const totalTokens = (totalInputTokens || 0) + (totalOutputTokens || 0);
  const totalTokensStr = NtLogic.formatTokens(totalTokens);

  let statsHtml = `
    <div class="stat-card">
      <div class="value green">${completed}</div>
      <div class="label">Passed</div>
    </div>
    <div class="stat-card">
      <div class="value red">${failed}</div>
      <div class="label">Failed</div>
    </div>${skipped > 0 ? `
    <div class="stat-card">
      <div class="value yellow">${skipped}</div>
      <div class="label">Skipped</div>
    </div>` : ''}
    <div class="stat-card">
      <div class="value">${total}</div>
      <div class="label">Total Steps</div>
    </div>
    <div class="stat-card">
      <div class="value cyan">${NtLogic.escapeHtml(durationStr)}</div>
      <div class="label">Duration</div>
    </div>
  `;
  if (totalCostStr) {
    statsHtml += `
    <div class="stat-card">
      <div class="value yellow">${totalCostStr}</div>
      <div class="label">Total Cost</div>
    </div>
    `;
  }
  if (totalTokensStr) {
    statsHtml += `
    <div class="stat-card">
      <div class="value">${totalTokensStr}</div>
      <div class="label">Total Tokens</div>
    </div>
    `;
  }
  statsEl.innerHTML = statsHtml;

  const detailsEl = document.getElementById('summary-details');
  let details = '';
  if (finishData) {
    if (finishData.merged) {
      details += `<p><strong>Merged</strong> to original branch</p>`;
    } else if (finishData.mergeConflict) {
      details += `<p style="color:var(--yellow)"><strong>Merge conflict</strong> &mdash; changes remain on the run branch</p>`;
    }
    if (finishData.reportPath) {
      details += `<p>Report: <a href="#" class="link-btn report-link" data-report-path="${NtLogic.escapeHtml(finishData.reportPath)}" data-report-title="Run Report">${NtLogic.escapeHtml(finishData.reportPath)}</a></p>`;
    }
    if (finishData.tagName) {
      details += `<p>Safety tag: <strong>${NtLogic.escapeHtml(finishData.tagName)}</strong></p>`;
    }
    if (finishData.runBranch) {
      details += `<p>Run branch: <strong>${NtLogic.escapeHtml(finishData.runBranch)}</strong></p>`;
    }
  } else if (state.finishFailed) {
    details += `<p style="color:var(--yellow)"><strong>Report generation did not complete.</strong> Your code changes are safe on the run branch.</p>`;
    const branch = state.runInfo?.runBranch;
    const tag = state.runInfo?.tagName;
    if (branch) {
      details += `<p>Run branch: <strong>${NtLogic.escapeHtml(branch)}</strong></p>`;
    }
    if (tag) {
      details += `<p>Safety tag: <strong>${NtLogic.escapeHtml(tag)}</strong></p>`;
    }
    details += `<p style="color:var(--text-dim)">To generate the report manually, run: <code>npx nightytidy --finish-run</code> in the project directory.</p>`;
  }
  detailsEl.innerHTML = details;

  // Attach click handlers for report links
  detailsEl.querySelectorAll('.report-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const reportPath = link.getAttribute('data-report-path');
      const title = link.getAttribute('data-report-title');
      viewReport(reportPath, title);
    });
  });

  // Show log file path so users can find it for bug reports
  api('log-path').then(result => {
    if (result.ok && result.path) {
      const logEl = document.getElementById('summary-log-path');
      if (logEl) logEl.textContent = `GUI log: ${result.path}`;
    }
  }).catch(() => {});

  const listEl = document.getElementById('summary-step-list');
  listEl.innerHTML = state.stepResults.map(r => {
    const status = r.status || 'pending';
    const statusLabel = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'skipped' ? 'Skipped' : 'Pending';
    const icon = status === 'completed' ? '\u2713' : status === 'failed' ? '\u2717' : status === 'skipped' ? '\u27A0' : '&#9675;';
    const isFinishStep = r.step === FINISH_STEP_NUM;
    const name = isFinishStep ? 'Final Report' : (r.name || `Step ${r.step}`);
    const stepNumDisplay = isFinishStep ? '' : `${r.step}.`;
    const dur = r.duration ? NtLogic.formatMs(r.duration) : '';
    const cost = NtLogic.formatCost(r.costUSD) || '';
    const stepTotalTokens = (r.inputTokens || 0) + (r.outputTokens || 0);
    const tokens = NtLogic.formatTokens(stepTotalTokens);
    const tokensStr = tokens ? tokens + ' tokens' : '';
    const finishClass = isFinishStep ? ' step-finish' : '';
    return `
      <div class="step-item step-${status}${finishClass} step-clickable" data-step="${r.step}" role="listitem button" tabindex="0" aria-label="${name}: ${statusLabel}">
        <span class="step-icon" aria-hidden="true">${icon}</span>
        <span class="step-num">${stepNumDisplay}</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
        <span class="step-cost">${cost}</span>
        <span class="step-tokens">${tokensStr}</span>
        <span class="step-duration">${dur}</span>
      </div>
    `;
  }).join('');

  // Attach click and keyboard handlers for viewing step output
  listEl.querySelectorAll('.step-item[data-step]').forEach(el => {
    const stepNum = parseInt(el.getAttribute('data-step'), 10);
    el.addEventListener('click', () => viewSummaryStepOutput(stepNum));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        viewSummaryStepOutput(stepNum);
      }
    });
  });
}

// ── Reset ──────────────────────────────────────────────────────────

function resetApp() {
  clearSavedRunState();
  stopInitPolling();
  stopProgressPolling();
  stopElapsedTimer();

  state.steps = [];
  state.selectedSteps = [];
  state.timeout = 75;
  state.runInfo = null;
  state.completedSteps = [];
  state.failedSteps = [];
  state.stepResults = [];
  state.currentProcessId = null;
  state.pollTimer = null;
  state.elapsedTimer = null;
  state.runStartTime = null;
  state.finishResult = null;
  state.finishFailed = false;
  state.stopping = false;
  state.skippingStep = null;
  state.skippedSteps = [];
  state.viewingStepOutput = null;
  state.drawerReportPath = null;
  closeDrawer();
  state.currentStepNum = null;
  state.stepStartTime = null;
  state.paused = false;
  state.pausedStepNum = null;
  state.resumeCountdown = null;
  stopCountdownTimer();
  state.backoffAttempt = 0;
  state.manualResumeResolve = null;
  if (state._pauseTimer) clearTimeout(state._pauseTimer);
  state._pauseTimer = null;
  state.retrying = false;
  state.prodding = false;
  resetCachedTotals();

  document.getElementById('update-banner').classList.add('hidden');
  clearError('setup');
  clearError('steps');
  clearError('running');
  clearError('finishing');
  document.getElementById('output-content').innerHTML = '';
  lastRenderedOutput = '';
  const tsEl = document.getElementById('last-update-time');
  if (tsEl) tsEl.textContent = '';
  document.getElementById('btn-stop-run').disabled = false;
  document.getElementById('btn-stop-run').textContent = 'Stop Run';
  resetSkipButton();
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-bar-track').setAttribute('aria-valuenow', '0');
  document.title = 'NightyTidy';

  showScreen(SCREENS.SETUP);
}

// ── Window Close Protection ────────────────────────────────────────

function isRunInProgress() {
  return state.screen === SCREENS.RUNNING || state.currentStepNum === FINISH_STEP_NUM || state.paused;
}

// Native browser dialog when user tries to close window during a run
// (title bar X, Alt+F4, Ctrl+W). Message cannot be customized in modern Chrome.
window.addEventListener('beforeunload', (e) => {
  if (isRunInProgress()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Always shut down the backend server when the window closes.
// sendBeacon is fire-and-forget — works even as the page is torn down.
window.addEventListener('unload', () => {
  navigator.sendBeacon('/api/exit');
});

// ── Event Binding ──────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-select-folder').addEventListener('click', selectFolder);
  document.getElementById('btn-change-folder').addEventListener('click', selectFolder);
  document.getElementById('btn-select-all').addEventListener('click', () => selectAllSteps(true));
  document.getElementById('btn-select-none').addEventListener('click', () => selectAllSteps(false));
  document.getElementById('btn-back-setup').addEventListener('click', () => showScreen(SCREENS.SETUP));
  document.getElementById('btn-start-run').addEventListener('click', startRun);
  document.getElementById('btn-resume-run').addEventListener('click', handleResumeRun);
  document.getElementById('btn-start-fresh').addEventListener('click', handleStartFresh);
  document.getElementById('btn-skip-step').addEventListener('click', skipStep);
  document.getElementById('btn-stop-run').addEventListener('click', confirmStopRun);
  document.getElementById('btn-confirm-stop-yes').addEventListener('click', stopRun);
  document.getElementById('btn-confirm-stop-cancel').addEventListener('click', cancelStopRun);
  document.getElementById('btn-confirm-stop-close').addEventListener('click', cancelStopRun);
  document.getElementById('btn-resume-now').addEventListener('click', manualResume);
  document.getElementById('btn-finish-now').addEventListener('click', finishNow);
  document.getElementById('btn-save-close').addEventListener('click', saveAndClose);
  document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);
  document.getElementById('btn-copy-drawer').addEventListener('click', async () => {
    if (!drawerRawMarkdown) return;
    try {
      await navigator.clipboard.writeText(drawerRawMarkdown);
      const btn = document.getElementById('btn-copy-drawer');
      btn.textContent = '\u2714 Copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '\u2398 Copy'; btn.classList.remove('copied'); }, 2000);
    } catch (err) {
      logToServer('warn', `Clipboard copy failed: ${err.message}`);
    }
  });
  document.getElementById('btn-new-run').addEventListener('click', resetApp);
  document.getElementById('btn-close-app').addEventListener('click', () => {
    api('exit').catch(() => {});
    window.close();
  });

  // Onboarding
  document.getElementById('btn-onboarding-skip').addEventListener('click', dismissOnboarding);
  document.getElementById('btn-onboarding-next').addEventListener('click', nextOnboardingSlide);
  document.querySelectorAll('.onboarding-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      goToOnboardingSlide(parseInt(dot.dataset.dot, 10));
    });
  });

  // Keyboard accessibility — Escape key to close drawer and modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Onboarding overlay — Escape dismisses
      const onboardingOverlay = document.getElementById('onboarding-overlay');
      if (!onboardingOverlay.classList.contains('hidden')) {
        dismissOnboarding();
        return;
      }
      const confirmOverlay = document.getElementById('confirm-stop-overlay');
      if (!confirmOverlay.classList.contains('hidden')) {
        cancelStopRun();
        return;
      }
      // Don't allow Escape on pause overlay — require explicit action
      if (isDrawerOpen()) {
        closeDrawer();
        return;
      }
    }
  });

  // Click outside modal to close
  document.getElementById('onboarding-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'onboarding-overlay') {
      dismissOnboarding();
    }
  });
  document.getElementById('confirm-stop-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'confirm-stop-overlay') {
      cancelStopRun();
    }
  });

  document.getElementById('btn-update-now').addEventListener('click', handleUpdateNow);
  document.getElementById('btn-update-dismiss').addEventListener('click', () => {
    document.getElementById('update-banner').classList.add('hidden');
  });
}

// ── Running totals cache (optimization: avoid O(n) reduce on every 1s tick) ───
let cachedTotalCost = 0;
let cachedTotalTokens = 0;
let cachedResultsCount = 0;

/**
 * Update running totals incrementally when a new result is added.
 * Called from step completion handlers.
 */
function updateCachedTotals(result) {
  if (result.costUSD != null && Number.isFinite(result.costUSD)) {
    cachedTotalCost += result.costUSD;
  }
  cachedTotalTokens += (result.inputTokens || 0) + (result.outputTokens || 0);
  cachedResultsCount++;
}

/**
 * Reset cached totals (called on new run).
 */
function resetCachedTotals() {
  cachedTotalCost = 0;
  cachedTotalTokens = 0;
  cachedResultsCount = 0;
}

// ── Run State Persistence (page-refresh recovery) ─────────────────

function saveRunState() {
  try {
    sessionStorage.setItem('nightytidy-run', JSON.stringify({
      projectDir: state.projectDir,
      bin: state.bin,
      selectedSteps: state.selectedSteps,
      steps: state.steps,
      timeout: state.timeout,
      runInfo: state.runInfo,
      runStartTime: state.runStartTime,
    }));
  } catch { /* sessionStorage may be unavailable */ }
}

function clearSavedRunState() {
  try { sessionStorage.removeItem('nightytidy-run'); } catch { /* ignore */ }
}

/**
 * Check sessionStorage for a saved run and verify it's still active
 * by reading the progress JSON file. Returns { runData, progress } or null.
 */
async function checkForActiveRun() {
  let saved;
  try { saved = sessionStorage.getItem('nightytidy-run'); } catch { return null; }
  if (!saved) return null;

  let runData;
  try { runData = JSON.parse(saved); } catch { return null; }
  if (!runData?.projectDir) return null;

  const progressPath = `${runData.projectDir}\\nightytidy-progress.json`;
  const result = await api('read-file', { path: progressPath }, 5000);
  if (!result.ok || !result.content) {
    clearSavedRunState();
    return null;
  }

  let progress;
  try { progress = JSON.parse(result.content); } catch { return null; }

  if (progress.status === 'completed' || !progress.steps) {
    clearSavedRunState();
    return null;
  }

  return { runData, progress };
}

/**
 * Reconnect to an in-progress run after a page refresh.
 * Restores state from sessionStorage + progress JSON, waits for any
 * currently-running step to finish, then resumes the step loop.
 */
async function reconnectToRun(runData, progress) {
  logToServer('info', 'Reconnecting to in-progress run after page refresh');

  state.projectDir = runData.projectDir;
  state.bin = runData.bin;
  state.selectedSteps = runData.selectedSteps;
  state.steps = runData.steps;
  state.timeout = runData.timeout;
  state.runInfo = runData.runInfo;
  state.runStartTime = runData.runStartTime || Date.now();
  state.completedSteps = [];
  state.failedSteps = [];
  state.stepResults = [];
  resetCachedTotals();

  let runningStepNum = null;

  for (const s of progress.steps) {
    if (s.status === 'completed') {
      state.completedSteps.push(s.number);
      const r = { step: s.number, name: s.name, status: 'completed', duration: s.duration || null, output: '', costUSD: null, inputTokens: null, outputTokens: null };
      state.stepResults.push(r);
      updateCachedTotals(r);
    } else if (s.status === 'failed') {
      state.failedSteps.push(s.number);
      const r = { step: s.number, name: s.name, status: 'failed', duration: s.duration || null, output: '', error: 'Failed before page refresh', costUSD: null, inputTokens: null, outputTokens: null };
      state.stepResults.push(r);
      updateCachedTotals(r);
    } else if (s.status === 'running') {
      runningStepNum = s.number;
    }
  }

  showScreen(SCREENS.RUNNING);
  renderRunningStepList();
  for (const r of state.stepResults) updateStepItemStatus(r.step, r.status, r.duration);
  updateProgressBar();
  startElapsedTimer();
  startProgressPolling();

  if (runningStepNum !== null) {
    updateStepItemStatus(runningStepNum, 'running');
    showCurrentStep(runningStepNum);
    state.currentStepNum = runningStepNum;
    state.stepStartTime = Date.now();
    lastOutputChangeTime = Date.now();
    await waitForStepCompletion(runningStepNum);
  }

  runNextStep();
}

/**
 * Poll progress.json until a specific step transitions out of 'running'.
 * Resolves once the step is completed/failed so the step loop can continue.
 */
function waitForStepCompletion(stepNum) {
  return new Promise(resolve => {
    const check = setInterval(async () => {
      if (!state.projectDir) { clearInterval(check); resolve(); return; }
      const progressPath = `${state.projectDir}\\nightytidy-progress.json`;
      try {
        const result = await api('read-file', { path: progressPath }, 5000);
        if (!result.ok || !result.content) return;
        const progress = JSON.parse(result.content);
        if (!progress.steps) return;

        const step = progress.steps.find(s => s.number === stepNum);
        if (!step || step.status === 'running') return;

        clearInterval(check);
        if (step.status === 'completed') {
          state.completedSteps.push(stepNum);
        } else {
          state.failedSteps.push(stepNum);
        }
        const stepResult = {
          step: stepNum, name: step.name, status: step.status,
          duration: step.duration || (state.stepStartTime ? Date.now() - state.stepStartTime : null),
          output: progress.currentStepOutput || '', costUSD: null, inputTokens: null, outputTokens: null,
        };
        state.stepResults.push(stepResult);
        updateCachedTotals(stepResult);
        updateStepItemStatus(stepNum, step.status, stepResult.duration);
        state.currentStepNum = null;
        state.stepStartTime = null;
        updateProgressBar();
        resolve();
      } catch { /* polling error — keep trying */ }
    }, 2000);
  });
}

// ── Init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Debug: ?test-rate-limit or ?test-rate-limit=N simulates a rate limit on step N (or first selected step)
  const params = new URLSearchParams(location.search);
  if (params.has('test-rate-limit')) {
    const val = parseInt(params.get('test-rate-limit'), 10);
    // val > 1 means a specific step number; val <= 1 or NaN means "first selected step"
    state.simulateRateLimitStep = val > 1 ? val : -1; // -1 = "first step" sentinel
    state.simulationMode = true; // all CLI calls faked — no real subprocess spawned
    logToServer('info', `Rate-limit simulation enabled for step ${state.simulateRateLimitStep === -1 ? '(first selected)' : state.simulateRateLimitStep}`);
  }

  // Show the UI immediately for instant perceived startup
  bindEvents();
  showScreen(SCREENS.SETUP);

  // Show first-run onboarding (before user can interact with setup)
  if (shouldShowOnboarding()) {
    showOnboarding();
  }

  // Start heartbeat systems immediately (fire-and-forget)
  initHeartbeat();

  // Load config in background (non-blocking)
  loadConfigAsync();

  // Check for NightyTidy updates (non-blocking)
  checkForUpdate();

  // Check for an active run (page-refresh recovery)
  checkForActiveRun().then(active => {
    if (active) reconnectToRun(active.runData, active.progress);
  });
});

function initHeartbeat() {
  // Heartbeat — lets the server detect if the browser window is gone.
  // Two layers: Web Worker (immune to tab throttling) + main-thread backup.
  // Chrome aggressively freezes setInterval in background tabs (even --app mode),
  // which was killing the server mid-run when the user alt-tabbed away.
  //
  // IMPORTANT: Blob Workers can't resolve relative URLs — must inject absolute origin.
  // Both layers run simultaneously (belt and suspenders).
  try {
    const origin = location.origin;
    const workerCode = `setInterval(() => { fetch('${origin}/api/heartbeat', { method: 'POST' }).catch(() => {}); }, 5000);`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    new Worker(URL.createObjectURL(blob));
  } catch {
    // Worker creation failed — main-thread heartbeat below still covers us
  }
  // Main-thread heartbeat always runs as backup (works when tab is focused).
  // If the Worker is also running, the server just gets double heartbeats — harmless.
  setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }, 5000);
}

async function loadConfigAsync() {
  // Load server config (nightytidy binary path) — non-blocking background load
  try {
    const config = await api('config');
    if (config.ok && config.bin) state.bin = config.bin;
  } catch { /* fallback to npx */ }
}

async function checkForUpdate() {
  const text = document.getElementById('update-banner-text');
  const banner = document.getElementById('update-banner');
  const btn = document.getElementById('btn-update-now');

  try {
    // Show checking status so the user knows something is happening
    text.textContent = 'Checking for updates...';
    btn.hidden = true;
    banner.classList.remove('hidden');

    const data = await api('check-update', {}, 15_000); // 15s timeout (fetch takes up to 10s)
    if (!data.updateAvailable) {
      banner.classList.add('hidden');
      return;
    }

    const count = data.behind === 1 ? '1 commit behind' : `${data.behind} commits behind`;
    text.textContent = `Update available (${count})`;
    btn.hidden = false;
  } catch {
    // Silent — update check is best-effort
    banner.classList.add('hidden');
  }
}

async function handleUpdateNow() {
  const btn = document.getElementById('btn-update-now');
  const text = document.getElementById('update-banner-text');

  btn.disabled = true;
  text.textContent = '';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  text.appendChild(spinner);
  text.appendChild(document.createTextNode(' Pulling latest changes from GitHub...'));

  try {
    const data = await api('pull-update', {}, 35_000); // 35s timeout (pull takes up to 30s)
    if (data.ok) {
      text.textContent = 'Updated! Please close and relaunch NightyTidy.';
      btn.hidden = true;
    } else {
      text.textContent = `Update failed: ${data.error || 'Unknown error'}`;
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  } catch {
    text.textContent = 'Update failed: could not reach server.';
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}
