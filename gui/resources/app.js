/**
 * NightyTidy Desktop GUI — Main application.
 * State machine driving 5 screens. Communicates with server.js via fetch API.
 */

/* global NtLogic, marked */

// ── API helpers ────────────────────────────────────────────────────

async function api(endpoint, body = {}) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
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

// ── State ──────────────────────────────────────────────────────────

const SCREENS = {
  SETUP: 'setup',
  STEPS: 'steps',
  RUNNING: 'running',
  FINISHING: 'finishing',
  SUMMARY: 'summary',
};

const state = {
  screen: SCREENS.SETUP,
  projectDir: null,
  bin: null,              // absolute path to bin/nightytidy.js (from /api/config)
  steps: [],              // from --list --json: [{ number, name, description }]
  selectedSteps: [],      // step numbers user checked
  timeout: 45,            // minutes
  runInfo: null,          // from --init-run response
  completedSteps: [],     // step numbers completed
  failedSteps: [],        // step numbers failed
  stepResults: [],        // [{ step, name, status, duration, attempts }]
  currentProcessId: null, // process ID for kill
  pollTimer: null,        // setInterval ID
  elapsedTimer: null,     // setInterval ID for elapsed time
  runStartTime: null,     // timestamp ms
  finishResult: null,     // from --finish-run response
  stopping: false,        // stop button was clicked
  viewingStepOutput: null, // step number whose stored output is shown (null = live mode)
  initMsgTimer: null,      // setInterval ID for init overlay rotating messages
  currentStepNum: null,    // step number currently running (for live elapsed timer)
  stepStartTime: null,     // timestamp ms when current step started
};

// ── Init Overlay (shown during --init-run) ────────────────────────

const INIT_MESSAGES = [
  'Preparing your run\u2026',
  'Validating git repository\u2026',
  'Checking Claude Code CLI\u2026',
  'Creating safety branch\u2026',
  'Setting up progress tracking\u2026',
  'Almost ready\u2026',
];

function showInitOverlay() {
  // Hide step selection UI
  for (const id of ['step-checklist', 'options-bar', 'start-bar', 'steps-header']) {
    const el = document.querySelector(`.${id}`) || document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const overlay = document.getElementById('init-overlay');
  const statusEl = document.getElementById('init-status');
  statusEl.textContent = INIT_MESSAGES[0];
  overlay.style.display = 'block';

  let idx = 0;
  state.initMsgTimer = setInterval(() => {
    idx = (idx + 1) % INIT_MESSAGES.length;
    statusEl.style.opacity = '0';
    setTimeout(() => {
      statusEl.textContent = INIT_MESSAGES[idx];
      statusEl.style.opacity = '1';
    }, 200);
  }, 2000);
}

function hideInitOverlay() {
  if (state.initMsgTimer) {
    clearInterval(state.initMsgTimer);
    state.initMsgTimer = null;
  }
  document.getElementById('init-overlay').style.display = 'none';
  // Restore step selection UI
  for (const id of ['step-checklist', 'options-bar', 'start-bar', 'steps-header']) {
    const el = document.querySelector(`.${id}`) || document.getElementById(id);
    if (el) el.style.display = '';
  }
}

// ── Screen Management ──────────────────────────────────────────────

function showScreen(name) {
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

  const result = await api('run-command', { command: cmd, id });
  state.currentProcessId = null;

  if (!result.ok) {
    return { ok: false, data: null, error: 'NightyTidy command did not complete. Check that the project folder is valid and try again.' };
  }

  const parsed = NtLogic.parseCliOutput(result.stdout);
  if (!parsed.ok) {
    const detail = result.stderr ? `\n${result.stderr.trim()}` : '';
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
  try {
    const result = await api('select-folder');
    if (!result.ok || !result.folder) return; // User cancelled
    state.projectDir = result.folder;
    showFolderPath(result.folder);
    await loadSteps();
  } catch (err) {
    showError('setup', 'Folder selection did not complete. Please try again or type the path manually.');
  }
}

function showFolderPath(path) {
  document.getElementById('folder-display').style.display = 'flex';
  document.getElementById('folder-path').textContent = path;
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

  const result = await runCli('--list --json');
  loadingEl.style.display = 'none';

  if (!result.ok) {
    showError('setup', result.error);
    return;
  }

  if (!result.data || !result.data.steps || !result.data.steps.length) {
    showError('setup', 'No steps returned from NightyTidy CLI');
    return;
  }

  state.steps = result.data.steps;
  renderStepChecklist();
  showScreen(SCREENS.STEPS);
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

  state.selectedSteps = selected;
  state.timeout = parseInt(document.getElementById('timeout-input').value, 10) || 45;
  state.completedSteps = [];
  state.failedSteps = [];
  state.stepResults = [];
  state.stopping = false;

  const stepArgs = NtLogic.buildStepArgs(selected, state.steps.length);
  const timeoutArg = state.timeout !== 45 ? ` --timeout ${state.timeout}` : '';
  const args = `--init-run ${stepArgs}${timeoutArg}`;

  showInitOverlay();
  const result = await runCli(args);
  hideInitOverlay();

  if (!result.ok) {
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

  showScreen(SCREENS.RUNNING);
  renderRunningStepList();
  updateProgressBar();
  startProgressPolling();
  startElapsedTimer();
  runNextStep();
}

// ── Screen 3: Running ──────────────────────────────────────────────

function renderRunningStepList() {
  document.getElementById('running-project-path').textContent = state.projectDir || '';
  const container = document.getElementById('running-step-list');
  container.innerHTML = state.selectedSteps.map(num => {
    const step = state.steps.find(s => s.number === num);
    const name = step ? step.name : `Step ${num}`;
    return `
      <div class="step-item step-pending" id="run-step-${num}">
        <span class="step-icon">&#9675;</span>
        <span class="step-num">${num}.</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
        <span class="step-cost"></span>
        <span class="step-tokens"></span>
        <span class="step-duration"></span>
      </div>
    `;
  }).join('');
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
      iconEl.innerHTML = '<span class="spinner"></span>';
      break;
    case 'completed':
    case 'failed': {
      iconEl.textContent = status === 'completed' ? '\u2713' : '\u2717';
      if (duration) durEl.textContent = NtLogic.formatMs(duration);
      const r = state.stepResults.find(r => r.step === stepNum);
      if (costEl) {
        const costStr = r ? NtLogic.formatCost(r.costUSD) : null;
        if (costStr) costEl.textContent = costStr;
      }
      if (tokensEl && r) {
        const total = (r.inputTokens || 0) + (r.outputTokens || 0);
        const tokStr = NtLogic.formatTokens(total);
        if (tokStr) tokensEl.textContent = tokStr + ' tok';
      }
      el.classList.add('step-clickable');
      el.onclick = () => viewStepOutput(stepNum);
      break;
    }
    default:
      iconEl.innerHTML = '&#9675;';
  }
}

function updateProgressBar() {
  const total = state.selectedSteps.length;
  const done = state.completedSteps.length + state.failedSteps.length;
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
}

function showCurrentStep(stepNum) {
  const step = state.steps.find(s => s.number === stepNum);
  const name = step ? step.name : `Step ${stepNum}`;
  const done = state.completedSteps.length + state.failedSteps.length;
  const total = state.selectedSteps.length;
  const position = done + 1;

  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = `Step ${position} of ${total} — ${name}`;
  subtitle.className = 'subtitle subtitle-running';

  document.title = `Step ${position}/${total} — NightyTidy`;
}

function hideCurrentStep() {
  const subtitle = document.getElementById('running-subtitle');
  subtitle.textContent = '';
  subtitle.className = 'subtitle';

  document.title = 'NightyTidy';
}

async function runNextStep() {
  if (state.stopping) return;

  const next = NtLogic.getNextStep(state.selectedSteps, state.completedSteps, state.failedSteps);
  if (next === null) {
    await finishRun();
    return;
  }

  showCurrentStep(next);
  updateStepItemStatus(next, 'running');
  backToLive();
  state.currentStepNum = next;
  state.stepStartTime = Date.now();

  const timeoutArg = state.timeout !== 45 ? ` --timeout ${state.timeout}` : '';
  const result = await runCli(`--run-step ${next}${timeoutArg}`);

  if (state.stopping) return;

  // Snapshot the last live output before it gets cleared (fallback if response has no output)
  const liveSnapshot = lastRenderedOutput || '';

  if (!result.ok) {
    state.failedSteps.push(next);
    state.stepResults.push({ step: next, status: 'failed', error: result.error, output: liveSnapshot, costUSD: null, inputTokens: null, outputTokens: null });
    updateStepItemStatus(next, 'failed');
  } else {
    const data = result.data;
    const status = data.status || (data.success ? 'completed' : 'failed');
    const duration = data.duration || null;

    if (status === 'completed') {
      state.completedSteps.push(next);
    } else {
      state.failedSteps.push(next);
    }

    state.stepResults.push({
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
    });

    updateStepItemStatus(next, status, duration);
  }

  state.currentStepNum = null;
  state.stepStartTime = null;
  updateProgressBar();
  runNextStep();
}

// ── Progress Polling ───────────────────────────────────────────────

function startProgressPolling() {
  stopProgressPolling();
  state.pollTimer = setInterval(pollProgress, 500);
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

async function pollProgress() {
  if (!state.projectDir) return;

  const sep = '\\'; // GUI is Windows-first
  const progressPath = `${state.projectDir}${sep}nightytidy-progress.json`;

  try {
    const result = await api('read-file', { path: progressPath });
    if (result.ok && result.content) {
      const progress = JSON.parse(result.content);
      renderProgressFromFile(progress);
    }
  } catch {
    // File may not exist yet — skip this tick
  }
}

function renderProgressFromFile(progress) {
  if (!progress) return;

  // Skip live output updates when user is viewing a stored step's output
  if (state.viewingStepOutput !== null) return;

  if (progress.currentStepOutput) {
    // Only re-render when the content has actually changed (polling is every 500ms)
    if (progress.currentStepOutput !== lastRenderedOutput) {
      lastRenderedOutput = progress.currentStepOutput;
      const outputEl = document.getElementById('output-content');
      outputEl.innerHTML = renderMarkdown(progress.currentStepOutput);
      const panel = document.getElementById('output-panel');
      panel.scrollTop = panel.scrollHeight;
    }
  }
}

function clearOutput() {
  document.getElementById('output-content').innerHTML = '';
  lastRenderedOutput = '';
}

// ── Step Output Viewer ──────────────────────────────────────────

function viewStepOutput(stepNum) {
  const result = state.stepResults.find(r => r.step === stepNum);
  if (!result) return;

  state.viewingStepOutput = stepNum;
  const name = result.name || `Step ${stepNum}`;
  const outputEl = document.getElementById('output-content');
  const titleEl = document.getElementById('output-title');
  const backBtn = document.getElementById('btn-back-to-live');

  titleEl.textContent = `Step ${stepNum}: ${name}`;
  const raw = result.output || (result.error ? `Error: ${result.error}` : '(No output recorded)');
  outputEl.innerHTML = renderMarkdown(raw);
  backBtn.style.display = 'inline';

  // Highlight the active step in the running list
  document.querySelectorAll('#running-step-list .step-item').forEach(el => el.classList.remove('step-active'));
  const activeEl = document.getElementById(`run-step-${stepNum}`);
  if (activeEl) activeEl.classList.add('step-active');
}

function backToLive() {
  state.viewingStepOutput = null;
  const titleEl = document.getElementById('output-title');
  const backBtn = document.getElementById('btn-back-to-live');
  const outputEl = document.getElementById('output-content');

  titleEl.textContent = 'Claude Output';
  backBtn.style.display = 'none';
  outputEl.innerHTML = '';
  lastRenderedOutput = '';

  document.querySelectorAll('#running-step-list .step-item').forEach(el => el.classList.remove('step-active'));
}

function viewSummaryStepOutput(stepNum) {
  const result = state.stepResults.find(r => r.step === stepNum);
  if (!result) return;

  const panel = document.getElementById('summary-output-panel');
  const titleEl = document.getElementById('summary-output-title');
  const contentEl = document.getElementById('summary-output-content');

  // Toggle: clicking same step again closes the panel
  if (panel.style.display !== 'none' && state.viewingStepOutput === stepNum) {
    closeSummaryOutput();
    return;
  }

  state.viewingStepOutput = stepNum;
  const name = result.name || `Step ${stepNum}`;
  titleEl.textContent = `Step ${stepNum}: ${name}`;
  const raw = result.output || (result.error ? `Error: ${result.error}` : '(No output recorded)');
  contentEl.innerHTML = renderMarkdown(raw);
  panel.style.display = 'block';

  // Highlight active step
  document.querySelectorAll('#summary-step-list .step-item').forEach(el => el.classList.remove('step-active'));
  const activeEl = document.querySelector(`#summary-step-list .step-item[data-step="${stepNum}"]`);
  if (activeEl) activeEl.classList.add('step-active');
}

function closeSummaryOutput() {
  state.viewingStepOutput = null;
  document.getElementById('summary-output-panel').style.display = 'none';
  document.querySelectorAll('#summary-step-list .step-item').forEach(el => el.classList.remove('step-active'));
}

// ── Stop Run ───────────────────────────────────────────────────────

function confirmStopRun() {
  if (state.stopping) return;
  document.getElementById('confirm-stop-overlay').classList.remove('hidden');
}

function cancelStopRun() {
  document.getElementById('confirm-stop-overlay').classList.add('hidden');
}

async function stopRun() {
  document.getElementById('confirm-stop-overlay').classList.add('hidden');
  if (state.stopping) return;
  state.stopping = true;

  document.getElementById('btn-stop-run').disabled = true;
  document.getElementById('btn-stop-run').textContent = 'Stopping...';

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

// ── Finish Run ─────────────────────────────────────────────────────

async function finishRun() {
  stopProgressPolling();
  stopElapsedTimer();

  document.title = 'Finishing... — NightyTidy';
  showScreen(SCREENS.FINISHING);

  const result = await runCli('--finish-run');

  if (!result.ok) {
    showError('finishing', result.error);
    renderSummary(null);
    showScreen(SCREENS.SUMMARY);
    return;
  }

  state.finishResult = result.data;
  renderSummary(result.data);
  showScreen(SCREENS.SUMMARY);
}

// ── Screen 5: Summary ──────────────────────────────────────────────

function renderSummary(finishData) {
  document.getElementById('summary-project-path').textContent = state.projectDir || '';
  const completed = state.completedSteps.length;
  const failed = state.failedSteps.length;
  const total = state.selectedSteps.length;
  const totalDuration = state.runStartTime ? Date.now() - state.runStartTime : 0;

  const resultEl = document.getElementById('summary-result');
  const titleEl = document.getElementById('summary-title');

  if (state.stopping) {
    resultEl.className = 'summary-result partial';
    titleEl.textContent = 'Run Stopped';
    document.title = 'Stopped — NightyTidy';
  } else if (failed === 0 && completed > 0) {
    resultEl.className = 'summary-result success';
    titleEl.textContent = 'Run Complete';
    document.title = 'Complete — NightyTidy';
  } else if (completed === 0) {
    resultEl.className = 'summary-result failure';
    titleEl.textContent = 'Run Failed';
    document.title = 'Failed — NightyTidy';
  } else {
    resultEl.className = 'summary-result partial';
    titleEl.textContent = 'Run Complete (with failures)';
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
    </div>
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
      details += `<p>Report: <strong>${NtLogic.escapeHtml(finishData.reportPath)}</strong></p>`;
    }
    if (finishData.tagName) {
      details += `<p>Safety tag: <strong>${NtLogic.escapeHtml(finishData.tagName)}</strong></p>`;
    }
    if (finishData.runBranch) {
      details += `<p>Run branch: <strong>${NtLogic.escapeHtml(finishData.runBranch)}</strong></p>`;
    }
  }
  detailsEl.innerHTML = details;

  const listEl = document.getElementById('summary-step-list');
  listEl.innerHTML = state.stepResults.map(r => {
    const status = r.status || 'pending';
    const icon = status === 'completed' ? '\u2713' : status === 'failed' ? '\u2717' : '&#9675;';
    const name = r.name || `Step ${r.step}`;
    const dur = r.duration ? NtLogic.formatMs(r.duration) : '';
    const cost = NtLogic.formatCost(r.costUSD) || '';
    const stepTotalTokens = (r.inputTokens || 0) + (r.outputTokens || 0);
    const tokens = NtLogic.formatTokens(stepTotalTokens);
    const tokensStr = tokens ? tokens + ' tok' : '';
    return `
      <div class="step-item step-${status} step-clickable" data-step="${r.step}">
        <span class="step-icon">${icon}</span>
        <span class="step-num">${r.step}.</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
        <span class="step-cost">${cost}</span>
        <span class="step-tokens">${tokensStr}</span>
        <span class="step-duration">${dur}</span>
      </div>
    `;
  }).join('');

  // Attach click handlers for viewing step output
  listEl.querySelectorAll('.step-item[data-step]').forEach(el => {
    el.addEventListener('click', () => {
      const stepNum = parseInt(el.getAttribute('data-step'), 10);
      viewSummaryStepOutput(stepNum);
    });
  });
}

// ── Reset ──────────────────────────────────────────────────────────

function resetApp() {
  stopProgressPolling();
  stopElapsedTimer();

  state.steps = [];
  state.selectedSteps = [];
  state.timeout = 45;
  state.runInfo = null;
  state.completedSteps = [];
  state.failedSteps = [];
  state.stepResults = [];
  state.currentProcessId = null;
  state.pollTimer = null;
  state.elapsedTimer = null;
  state.runStartTime = null;
  state.finishResult = null;
  state.stopping = false;
  state.viewingStepOutput = null;
  state.currentStepNum = null;
  state.stepStartTime = null;

  clearError('setup');
  clearError('steps');
  clearError('running');
  clearError('finishing');
  document.getElementById('output-content').innerHTML = '';
  lastRenderedOutput = '';
  document.getElementById('btn-stop-run').disabled = false;
  document.getElementById('btn-stop-run').textContent = 'Stop Run';
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-bar-track').setAttribute('aria-valuenow', '0');
  document.title = 'NightyTidy';

  showScreen(SCREENS.SETUP);
}

// ── Window Close Protection ────────────────────────────────────────

function isRunInProgress() {
  return state.screen === SCREENS.RUNNING || state.screen === SCREENS.FINISHING;
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
  document.getElementById('btn-stop-run').addEventListener('click', confirmStopRun);
  document.getElementById('btn-confirm-stop-yes').addEventListener('click', stopRun);
  document.getElementById('btn-confirm-stop-cancel').addEventListener('click', cancelStopRun);
  document.getElementById('btn-back-to-live').addEventListener('click', backToLive);
  document.getElementById('btn-close-output').addEventListener('click', closeSummaryOutput);
  document.getElementById('btn-new-run').addEventListener('click', resetApp);
  document.getElementById('btn-close-app').addEventListener('click', () => {
    api('exit').catch(() => {});
    window.close();
  });
}

// ── Init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  showScreen(SCREENS.SETUP);

  // Heartbeat — lets the server detect if the browser window is gone
  // (e.g. Chrome crashed or was force-killed). Server self-terminates if stale.
  setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }, 5000);

  // Load server config (nightytidy binary path)
  try {
    const config = await api('config');
    if (config.ok && config.bin) state.bin = config.bin;
  } catch { /* fallback to npx */ }
});
