/**
 * NightyTidy Desktop GUI — Main application.
 * State machine driving 5 screens. Communicates with server.js via fetch API.
 */

/* global NtLogic */

// ── API helpers ────────────────────────────────────────────────────

async function api(endpoint, body = {}) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

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
};

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
  const cmd = NtLogic.buildCommand(state.projectDir, args, 'Windows');
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

  const startBtn = document.getElementById('btn-start-run');
  startBtn.disabled = true;
  startBtn.textContent = 'Initializing...';
  const result = await runCli(args);
  startBtn.disabled = false;
  startBtn.textContent = 'Start Run';

  if (!result.ok) {
    showError('steps', result.error);
    return;
  }

  if (!result.data.success) {
    showError('steps', result.data.error || 'Failed to initialize run');
    return;
  }

  state.runInfo = result.data;
  state.runStartTime = Date.now();

  showScreen(SCREENS.RUNNING);
  renderRunningStepList();
  startProgressPolling();
  startElapsedTimer();
  runNextStep();
}

// ── Screen 3: Running ──────────────────────────────────────────────

function renderRunningStepList() {
  const container = document.getElementById('running-step-list');
  container.innerHTML = state.selectedSteps.map(num => {
    const step = state.steps.find(s => s.number === num);
    const name = step ? step.name : `Step ${num}`;
    return `
      <div class="step-item step-pending" id="run-step-${num}">
        <span class="step-icon">&#9675;</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
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

  switch (status) {
    case 'running':
      iconEl.innerHTML = '<span class="spinner"></span>';
      break;
    case 'completed':
      iconEl.textContent = '\u2713';
      if (duration) durEl.textContent = NtLogic.formatMs(duration);
      break;
    case 'failed':
      iconEl.textContent = '\u2717';
      if (duration) durEl.textContent = NtLogic.formatMs(duration);
      break;
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
}

function showCurrentStep(stepNum) {
  const step = state.steps.find(s => s.number === stepNum);
  const name = step ? step.name : `Step ${stepNum}`;
  document.getElementById('current-step-card').style.display = 'block';
  document.getElementById('current-step-name').textContent = `Step ${stepNum}: ${name}`;
}

function hideCurrentStep() {
  document.getElementById('current-step-card').style.display = 'none';
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
  clearOutput();

  const timeoutArg = state.timeout !== 45 ? ` --timeout ${state.timeout}` : '';
  const result = await runCli(`--run-step ${next}${timeoutArg}`);

  if (state.stopping) return;

  if (!result.ok) {
    state.failedSteps.push(next);
    state.stepResults.push({ step: next, status: 'failed', error: result.error });
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
    });

    updateStepItemStatus(next, status, duration);
  }

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

  if (progress.currentStepOutput) {
    const outputEl = document.getElementById('output-content');
    outputEl.textContent = progress.currentStepOutput;
    const panel = document.getElementById('output-panel');
    panel.scrollTop = panel.scrollHeight;
  }
}

function clearOutput() {
  document.getElementById('output-content').textContent = '';
}

// ── Stop Run ───────────────────────────────────────────────────────

async function stopRun() {
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

  hideCurrentStep();

  const badge = document.getElementById('running-status-badge');
  badge.className = 'status-badge status-stopped';
  badge.textContent = 'Stopped';

  await finishRun();
}

// ── Finish Run ─────────────────────────────────────────────────────

async function finishRun() {
  stopProgressPolling();
  stopElapsedTimer();
  hideCurrentStep();

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
  const completed = state.completedSteps.length;
  const failed = state.failedSteps.length;
  const total = state.selectedSteps.length;
  const totalDuration = state.runStartTime ? Date.now() - state.runStartTime : 0;

  const resultEl = document.getElementById('summary-result');
  const titleEl = document.getElementById('summary-title');

  if (state.stopping) {
    resultEl.className = 'summary-result partial';
    titleEl.textContent = 'Run Stopped';
  } else if (failed === 0 && completed > 0) {
    resultEl.className = 'summary-result success';
    titleEl.textContent = 'Run Complete';
  } else if (completed === 0) {
    resultEl.className = 'summary-result failure';
    titleEl.textContent = 'Run Failed';
  } else {
    resultEl.className = 'summary-result partial';
    titleEl.textContent = 'Run Complete (with failures)';
  }

  const statsEl = document.getElementById('summary-stats');
  const durationStr = finishData?.totalDurationFormatted || NtLogic.formatMs(totalDuration);
  statsEl.innerHTML = `
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
    return `
      <div class="step-item step-${status}">
        <span class="step-icon">${icon}</span>
        <span class="step-name">${NtLogic.escapeHtml(name)}</span>
        <span class="step-duration">${dur}</span>
      </div>
    `;
  }).join('');
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

  clearError('setup');
  clearError('steps');
  clearError('running');
  clearError('finishing');
  document.getElementById('output-content').textContent = '';
  document.getElementById('btn-stop-run').disabled = false;
  document.getElementById('btn-stop-run').textContent = 'Stop Run';
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-bar-track').setAttribute('aria-valuenow', '0');

  showScreen(SCREENS.SETUP);
}

// ── Event Binding ──────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-select-folder').addEventListener('click', selectFolder);
  document.getElementById('btn-change-folder').addEventListener('click', selectFolder);
  document.getElementById('btn-select-all').addEventListener('click', () => selectAllSteps(true));
  document.getElementById('btn-select-none').addEventListener('click', () => selectAllSteps(false));
  document.getElementById('btn-back-setup').addEventListener('click', () => showScreen(SCREENS.SETUP));
  document.getElementById('btn-start-run').addEventListener('click', startRun);
  document.getElementById('btn-stop-run').addEventListener('click', stopRun);
  document.getElementById('btn-new-run').addEventListener('click', resetApp);
  document.getElementById('btn-close-app').addEventListener('click', () => {
    api('exit').catch(() => {});
    window.close();
  });
}

// ── Init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  showScreen(SCREENS.SETUP);
});
