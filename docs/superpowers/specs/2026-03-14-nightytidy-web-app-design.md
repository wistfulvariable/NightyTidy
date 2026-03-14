# NightyTidy Web App — Design Specification

## Overview

A deployed web application at **nightytidy.com** that provides a polished, intuitive interface for NightyTidy. The web app connects to a local agent running on the user's machine via WebSocket. All code stays local; only run metadata (cost, duration, pass/fail) is stored in the cloud.

**Target users:** Developers, semi-technical vibe coders, and non-technical team leads/managers.

**Repository:** Separate repo (`nightytidy-web`). The local agent shells out to the NightyTidy CLI (`npx nightytidy --init-run`, `--run-step`, `--finish-run`).

---

## Architecture

```
nightytidy.com (Firebase Hosting + Cloud Functions)
├── Next.js Frontend (React)
├── Firebase Auth (GitHub OAuth)
├── Cloud Functions (webhook ingestion, status API)
└── Firestore (accounts, run history, status, settings)

         │
         │  HTTPS (webhook status updates)
         │  WebSocket (live execution — localhost only)
         │
Local Agent (user's machine)
├── WebSocket Server (localhost — browser comms)
├── Webhook Dispatcher (pushes to nightytidy.com + Slack/Discord/custom)
├── Project Manager (multi-repo registry)
├── Run Queue (sequential execution, persist across restarts)
├── Scheduler (cron-like automated runs)
├── NightyTidy CLI Bridge (subprocess orchestration)
└── Git Integration (diff, PR creation, rollback)
```

### Data Flow

- **Live execution:** Browser ↔ local agent via WebSocket. Code and output stay local.
- **Remote monitoring:** Agent pushes status webhooks to nightytidy.com Cloud Functions → Firestore. User checks dashboard from any device.
- **History sync:** Agent pushes run metadata (no code) to Firestore on run completion.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (React) |
| Auth | Firebase Auth (GitHub OAuth) |
| Hosting | Firebase Hosting |
| API | Firebase Cloud Functions |
| Database | Firestore |
| Charts | Recharts |
| Agent comms | WebSocket (ws library) |
| Agent scheduling | node-cron |
| Domain | nightytidy.com |

---

## Features

All features ship in a single release:

1. **Project management** — add/remove projects, multi-project support
2. **Step selection** — categories, presets, smart recommendations, cost estimates
3. **Run queue** — drag-to-reorder, pause, cancel
4. **Scheduling** — cron-like automated runs per project
5. **Live run monitoring** — summarized activity feed + raw output toggle
6. **Rate-limit handling** — pause/resume overlay with auto-recovery
7. **Run results** — stats, expandable step cards, syntax-highlighted diff viewer
8. **One-click merge** — merge to main branch from the web UI
9. **GitHub PR creation** — create PR with full report as body
10. **One-click rollback** — reset to safety tag
11. **Webhook notifications** — to nightytidy.com dashboard + Slack/Discord/ntfy/custom
12. **Remote monitoring** — check run status from any device (phone, another computer)
13. **Analytics dashboard** — cost trends, pass rates, most valuable steps, recommendations
14. **Settings** — account, agent, defaults, notifications, appearance (dark/light/system)

---

## Screens

### Screen 1: Landing / Login

- Marketing hero section with value proposition
- "Sign in with GitHub" button (Firebase Auth)
- "How it works" section: sign in → install agent → pick repo → start
- Stats badges: 33 steps, code never leaves machine, track anywhere

### Screen 1b: First-Time Setup

- Shown once after first login
- Prerequisite checklist with live status indicators:
  - Node.js (version check)
  - Claude Code CLI (installed + authenticated)
  - NightyTidy Agent (waiting for connection)
- Command to copy: `npx nightytidy agent`
- Auto-detects when agent connects, transitions to dashboard

### Screen 2: Dashboard (Home)

- **Top bar:** NightyTidy logo, agent connection indicator (green dot / red dot), user menu
- **Sidebar navigation:** Dashboard, Projects, Queue, Schedules, Analytics, Settings
- **Active run banner:** Shows current run with project name, step progress, cost, elapsed time, "View Live" button
- **Project cards:** Grid of registered projects with status badges (Running / Idle / Queued), last run date + result, next scheduled run
- **"+ Add Project" card:** Opens folder picker via agent
- **Run queue:** Ordered list with drag handles, position numbers, reorder/cancel controls
- **Recent activity feed:** Chronological event log across all projects

### Screen 3: Project Detail

- **Breadcrumb:** NightyTidy / ProjectName
- **Stats row:** Total runs, avg pass rate, total cost, total improvements
- **Tabs:** History, Presets, Schedule, Webhooks, Analytics
- **History tab:** Table with date, step count, result (passed/failed), cost, duration, "View Report" link
- **Presets section:** Named step combos (Quick Scan, Security Focus, Full Sweep) + "New Preset" button
- **Schedule section:** Cron config with preset selection, next run time, enable/disable
- **"Start New Run" button:** Navigates to Run Setup

### Screen 4: Run Setup

- **Preset loader dropdown** + Select All / None buttons
- **Smart recommendation banner:** "Recommended for Node.js projects: Steps 1, 2, 4, 8, 10, 13, 14, 22" with "Apply" button
- **Step checkboxes grouped by category:**
  - Code Quality, Security, Testing, Strategic, Infrastructure, Frontend, Ops
  - Each step shows: number, name, recommended badge (if applicable), estimated cost
- **Collapsible categories** for less-used groups
- **Bottom summary bar:** X steps selected, estimated cost, estimated time, timeout setting, "Save as Preset" link, "Start Run" button

### Screen 5: Live Run View

- **Progress header:** Current step name, step X of Y, cost so far, elapsed time
- **Progress bar:** Color-coded segments (green = passed, blue = running, gray = remaining)
- **Split panel layout:**
  - **Left:** Step list with status icons (checkmark / X / spinner / circle), duration per step
  - **Right:** Output panel with Summary / Raw Output toggle
    - Summary mode: Activity feed with icons (searching, editing, checking)
    - Raw mode: Full Claude Code stream output
- **Action buttons:** Pause, Skip Step, Stop Run
- **Estimated time remaining**

### Screen 5b: Rate Limit Pause Overlay

- Modal overlay with countdown timer
- Estimated resume time
- "Resume Now" and "Finish Partial" buttons
- Message: "You can close this page. The agent will resume automatically and send a webhook when complete."

### Screen 6: Run Results

- **Success/failure banner** with date and duration
- **Stats row:** Passed, failed, total cost, duration, files changed
- **Action buttons:** Merge to main, Create GitHub PR, Download Report, Rollback Everything
- **Tabs:** Step Results, Diff Viewer, Full Report
- **Step Results tab:** Expandable cards per step with status, files changed, cost, duration, summary. Failed steps show error + "Retry This Step" link
- **Diff Viewer tab:** File list (left) + syntax-highlighted unified diff (right) with add/remove/modify indicators
- **Full Report tab:** Rendered NIGHTYTIDY-REPORT markdown

### Screen 7: Settings

- **Tabs:** Account, Agent, Defaults, Notifications, Appearance
- **Account:** GitHub profile card, sign out
- **Agent:** Connection status, machine name, version, uptime, WebSocket address, reconnect instructions
- **Defaults:** Timeout per step, default preset, Google Doc sync URL, log level
- **Notifications:** Global webhook endpoints (nightytidy.com auto-configured, user-added Slack/Discord/custom), event type toggles (run started, completed, step failed, each step completed, rate limit, schedule triggered)
- **Appearance:** Dark / Light / System theme picker
- **Save Settings button**

---

## Local Agent Design

### Components

**1. WebSocket Server**
- Binds to `127.0.0.1:PORT` (random available port)
- Token-based auth on handshake (one-time token generated at startup)
- Handles commands from browser, streams events back
- Ping/pong health check every 10s

**2. Project Manager**
- Registry stored in `~/.nightytidy/projects.json`
- Each project: `{ path, name, lastRun, stepPresets, webhooks, schedule }`
- Validates project paths exist on disk, prunes stale entries
- Scans for existing `NIGHTYTIDY-REPORT_*.md` to populate initial history

**3. Run Queue**
- Sequential execution (one NightyTidy run at a time — Claude Code limitation)
- Multiple projects can queue
- State persisted to `~/.nightytidy/queue.json` (survives restart)
- Operations: enqueue, dequeue, reorder, pause, cancel

**4. Scheduler**
- Cron syntax per project (e.g., `"0 2 * * *"`)
- Stored in `~/.nightytidy/projects.json`
- Uses `node-cron` library
- Scheduled runs enter the queue like manual runs
- Fires webhook on schedule trigger

**5. NightyTidy CLI Bridge**
- Shells out to existing orchestrator API:
  - `npx nightytidy --list --json`
  - `npx nightytidy --init-run --steps 1,5,12 --skip-dashboard`
  - `npx nightytidy --run-step N`
  - `npx nightytidy --finish-run`
- Parses JSON responses, streams stdout over WebSocket
- Handles rate-limit responses (pause/resume)

**6. Webhook Dispatcher**
- Events: run_started, step_started, step_completed, step_failed, run_completed, run_failed, rate_limit_hit, rate_limit_resumed, schedule_triggered
- Payload format (generic):
  ```json
  {
    "event": "step_completed",
    "project": "MyApp",
    "step": { "number": 5, "name": "Security Audit", "status": "completed", "duration": 180000 },
    "run": { "progress": "5/33", "costSoFar": 2.10, "startedAt": "2026-03-14T02:00:00Z" },
    "agent": { "machine": "Steve-Desktop" }
  }
  ```
- Targets: nightytidy.com webhook endpoint (auto-configured) + user-added endpoints
- Slack/Discord payloads formatted per-platform
- Retry: 3 attempts with exponential backoff (1s, 5s, 15s)

**7. Git Integration**
- Diff generation for web UI (via `git diff` subprocess)
- GitHub PR creation via `gh` CLI
- Rollback via `git reset --hard <safety-tag>`

### Agent Lifecycle

```
npx nightytidy agent
├── Read/create ~/.nightytidy/config.json
├── Authenticate with Firebase (first run: browser OAuth flow, then cached)
├── Start WebSocket server on localhost
├── Register token in Firestore (so web app knows how to connect)
├── Load project registry + queue
├── Start scheduler
├── Print: "Agent running — open nightytidy.com to connect"
│
├── [On WebSocket connect] ← browser presents token
├── [On command] ← execute, stream results
├── [On schedule trigger] ← enqueue run
├── [On webhook event] ← dispatch to all endpoints
│
└── [On SIGINT/SIGTERM] ← graceful shutdown, persist queue
```

### Agent Distribution

- **Launch:** CLI for now (`npx nightytidy agent`)
- **Future:** System tray app (Phase 2, separate effort)

---

## WebSocket Protocol

### Browser → Agent (Commands)

| Message Type | Payload | Purpose |
|-------------|---------|---------|
| `list-projects` | — | Get all registered projects |
| `add-project` | `{ path }` | Register a new project |
| `remove-project` | `{ projectId }` | Unregister a project |
| `select-folder` | — | Open native folder picker |
| `start-run` | `{ projectId, steps[], timeout }` | Start a NightyTidy run |
| `stop-run` | `{ runId }` | Stop a running run |
| `pause-run` | `{ runId }` | Pause a running run |
| `resume-run` | `{ runId }` | Resume a paused run |
| `skip-step` | `{ runId }` | Skip the current step |
| `rollback` | `{ projectId, tag }` | Reset to safety tag |
| `create-pr` | `{ projectId, branch }` | Create GitHub PR |
| `merge` | `{ projectId, branch }` | Merge run branch to main |
| `get-diff` | `{ projectId, branch }` | Get file diffs for results view |
| `retry-step` | `{ projectId, stepNum }` | Re-run a single failed step |
| `get-queue` | — | Get current queue state |
| `reorder-queue` | `{ order[] }` | Reorder queued runs |
| `ping` | — | Health check |

### Agent → Browser (Events)

| Message Type | Payload | Purpose |
|-------------|---------|---------|
| `connected` | `{ machine, version }` | Initial handshake response |
| `projects` | `{ projects[] }` | Project list response |
| `folder-selected` | `{ path }` | Folder picker result |
| `run-started` | `{ runId, projectId, branch }` | Run initialized |
| `step-started` | `{ runId, step }` | Step execution began |
| `step-output` | `{ runId, text, mode }` | Live output (summary or raw) |
| `step-completed` | `{ runId, step, cost }` | Step finished successfully |
| `step-failed` | `{ runId, step, error }` | Step failed |
| `run-completed` | `{ runId, results }` | Run finished |
| `run-failed` | `{ runId, error }` | Run errored |
| `rate-limit` | `{ runId, retryAfterMs, step }` | Rate limit hit |
| `rate-limit-resumed` | `{ runId }` | Rate limit cleared |
| `queue-updated` | `{ queue[] }` | Queue state changed |
| `diff` | `{ files[] }` | Diff response |
| `pr-created` | `{ url }` | PR created on GitHub |
| `merged` | `{ projectId }` | Branch merged |
| `rolled-back` | `{ projectId }` | Rollback completed |
| `error` | `{ message }` | Error response |
| `pong` | — | Health check response |

---

## Data Models (Firestore)

### `users/{uid}`

```
displayName: string
githubUsername: string
avatarUrl: string
createdAt: timestamp
settings: {
  defaultTimeout: number (default: 45)
  defaultPreset: string | null
  googleDocUrl: string | null
  logLevel: "debug" | "info" | "warn" | "error" (default: "info")
  theme: "dark" | "light" | "system" (default: "dark")
  notifyOn: string[] (default: ["run_started", "run_completed", "step_failed", "rate_limit", "schedule_triggered"])
}
```

### `users/{uid}/webhooks/{webhookId}`

```
url: string
label: string
icon: string (emoji)
active: boolean
createdAt: timestamp
```

### `users/{uid}/projects/{projectId}`

```
name: string
path: string (local path — never sent to Firestore, stored locally only)
addedAt: timestamp
lastRunAt: timestamp | null
schedule: {
  cron: string | null
  preset: string | null
  enabled: boolean
} | null
```

### `users/{uid}/projects/{projectId}/presets/{presetId}`

```
name: string
steps: number[]
icon: string (emoji)
createdAt: timestamp
```

### `users/{uid}/projects/{projectId}/webhooks/{webhookId}`

```
url: string
label: string
icon: string (emoji)
active: boolean
```

### `users/{uid}/runs/{runId}`

```
projectId: string
projectName: string
status: "running" | "completed" | "failed" | "cancelled"
startedAt: timestamp
finishedAt: timestamp | null
selectedSteps: number[]
completedSteps: number
failedSteps: number
totalCost: number
duration: number (ms)
filesChanged: number
gitBranch: string
gitTag: string
```

### `users/{uid}/runs/{runId}/steps/{stepNum}`

```
name: string
status: "completed" | "failed" | "skipped"
duration: number (ms)
cost: number
attempts: number
filesChanged: number
summary: string | null
error: string | null
```

---

## Cloud Functions

### `POST /api/webhook/ingest`

Receives status updates from local agents.

**Auth:** Firebase Auth token in `Authorization: Bearer <token>` header.

**Request body:**
```json
{
  "event": "step_completed",
  "projectId": "abc123",
  "project": "PRDStack",
  "run": {
    "id": "run-2026-03-14-0200",
    "progress": "14/33",
    "costSoFar": 3.28,
    "startedAt": "2026-03-14T02:00:00Z",
    "elapsedMs": 2700000
  },
  "step": {
    "number": 14,
    "name": "Security Audit",
    "status": "completed",
    "duration": 738000,
    "cost": 0.20,
    "filesChanged": 5
  },
  "agent": {
    "machine": "Steve-Desktop",
    "version": "1.0.0"
  }
}
```

**Actions:**
1. Validate Firebase Auth token → extract `uid`
2. Write/update `users/{uid}/runs/{runId}` with latest status
3. Write step result to `users/{uid}/runs/{runId}/steps/{stepNum}`
4. Return `200 OK`

### `GET /api/status/{runId}`

Returns current run status from Firestore. Used for remote monitoring when browser is not on the same machine as agent.

**Auth:** Firebase Auth token.

### `GET /api/runs`

Returns paginated run history. Optional `?projectId=` filter.

**Auth:** Firebase Auth token.

---

## Security Model

### Authentication & Authorization

| Layer | Mechanism |
|-------|-----------|
| Web app → Firestore | Firebase Auth (GitHub OAuth). Security rules: users read/write own data only |
| Browser → Local agent | One-time token on WebSocket handshake. Token stored in Firestore for auto-connect |
| Agent → Cloud Functions | Firebase Auth token (agent authenticates on first setup, caches credentials) |
| Agent → NightyTidy CLI | Local subprocess, no auth needed |

### Data Privacy

| Data | Where | Leaves Machine? |
|------|-------|-----------------|
| Source code | Local filesystem | Never |
| Git diffs | Agent memory → WebSocket → browser | Never (localhost only) |
| Claude Code output (raw) | Agent memory → WebSocket → browser | Never (localhost only) |
| Run metadata (cost, duration, pass/fail) | Local → Firestore | Yes (no code content) |
| Project paths | Local `~/.nightytidy/` | Never (only project names sent to Firestore) |
| Webhook payloads | Agent → external services | Yes (metadata only, no code) |

### Attack Mitigations

| Vector | Mitigation |
|--------|-----------|
| WebSocket hijacking | Token auth on handshake + localhost binding |
| CSRF on agent | Agent accepts WebSocket only, not HTTP POST |
| Malicious webhook endpoint | User-configured, agent-side (no server secrets) |
| Firestore data access | Security rules: `request.auth.uid == userId` |
| Agent impersonation | Firebase Auth token required for cloud API calls |
| MitM (agent ↔ browser) | Localhost only — no network exposure |
| MitM (agent ↔ cloud) | HTTPS only |
| DoS on agent | Rate limit WebSocket commands (10/sec) |

---

## Analytics & Smart Recommendations

### Metrics

| Metric | Source | Display |
|--------|--------|---------|
| Total cost | Sum of `runs.totalCost` | Dollar amount + trend |
| Cost per run | `runs.totalCost` over time | Line chart (Recharts) |
| Step pass rate | `steps.status` across runs | Bar chart per step |
| Most valuable steps | Highest (passRate * filesChanged) / cost | Ranked list |
| Improvement count | Sum of `runs.filesChanged` | Running total |
| Avg run duration | `runs.duration` over time | Line chart |
| Runs per project | Count by `projectId` | Bar chart |
| Cost by project | Sum by `projectId` | Bar chart |

### Smart Recommendations

Value score per step: `(passRate * avgFilesChanged) / avgCost`

Project type detection by agent (scans repo root):
- `package.json` → Node.js
- `Cargo.toml` → Rust
- `go.mod` → Go
- `requirements.txt` / `pyproject.toml` → Python
- `*.csproj` → C#/.NET
- React deps → Frontend-heavy

Cold start defaults: steps 1, 2, 8, 10, 13, 22.

Recommendations improve as run data accumulates.

---

## Webhook Forwarding

The agent handles all external webhook delivery. The cloud layer does not forward to external services.

### Flow

```
Agent detects event
├── POST to nightytidy.com/api/webhook/ingest (authenticated)
└── For each user-configured endpoint:
    ├── Slack: formatted blocks payload
    ├── Discord: formatted embed payload
    └── Custom: generic JSON payload
```

### Slack Format Example

```json
{
  "blocks": [{
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": ":white_check_mark: *PRDStack* — Step 14 \"Security Audit\" completed\n$0.20 · 12m 18s · 5 files changed\nProgress: 14/33 · $3.28 total"
    }
  }]
}
```

### Retry Policy

3 attempts with exponential backoff (1s, 5s, 15s). Failed deliveries logged, never block execution.

---

## File Structure (nightytidy-web repo)

```
nightytidy-web/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Landing / login
│   ├── layout.tsx                # Root layout with sidebar
│   ├── dashboard/
│   │   └── page.tsx              # Dashboard home
│   ├── projects/
│   │   ├── page.tsx              # Projects list (redirects to dashboard)
│   │   └── [projectId]/
│   │       ├── page.tsx          # Project detail
│   │       └── new-run/
│   │           └── page.tsx      # Run setup
│   ├── runs/
│   │   └── [runId]/
│   │       ├── page.tsx          # Live run view
│   │       └── results/
│   │           └── page.tsx      # Run results
│   ├── analytics/
│   │   └── page.tsx              # Analytics dashboard
│   ├── settings/
│   │   └── page.tsx              # Settings
│   └── api/                      # (placeholder — Cloud Functions handle API)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   └── AgentIndicator.tsx
│   ├── dashboard/
│   │   ├── ProjectCard.tsx
│   │   ├── RunQueue.tsx
│   │   ├── ActiveRunBanner.tsx
│   │   └── ActivityFeed.tsx
│   ├── project/
│   │   ├── StatsRow.tsx
│   │   ├── RunHistoryTable.tsx
│   │   ├── PresetCard.tsx
│   │   ├── ScheduleConfig.tsx
│   │   └── WebhookConfig.tsx
│   ├── run/
│   │   ├── StepSelector.tsx
│   │   ├── StepCategory.tsx
│   │   ├── SmartRecommendation.tsx
│   │   ├── RunSummaryBar.tsx
│   │   ├── ProgressHeader.tsx
│   │   ├── StepList.tsx
│   │   ├── OutputPanel.tsx
│   │   ├── RateLimitOverlay.tsx
│   │   └── ActionButtons.tsx
│   ├── results/
│   │   ├── ResultsBanner.tsx
│   │   ├── StepResultCard.tsx
│   │   ├── DiffViewer.tsx
│   │   └── ReportViewer.tsx
│   ├── analytics/
│   │   ├── CostChart.tsx
│   │   ├── PassRateChart.tsx
│   │   └── ValueRanking.tsx
│   └── settings/
│       ├── AccountSection.tsx
│       ├── AgentSection.tsx
│       ├── DefaultsSection.tsx
│       ├── NotificationsSection.tsx
│       └── AppearanceSection.tsx
├── lib/
│   ├── firebase.ts               # Firebase client init
│   ├── auth.ts                   # GitHub OAuth helpers
│   ├── firestore.ts              # Firestore read/write helpers
│   ├── websocket.ts              # WebSocket client (connect to local agent)
│   └── types.ts                  # Shared TypeScript types
├── hooks/
│   ├── useAgent.ts               # WebSocket connection hook
│   ├── useProjects.ts            # Project CRUD hook
│   ├── useRuns.ts                # Run history hook
│   └── useSettings.ts            # Settings hook
├── functions/                    # Firebase Cloud Functions
│   ├── src/
│   │   ├── index.ts              # Function exports
│   │   ├── webhookIngest.ts      # POST /api/webhook/ingest
│   │   ├── status.ts             # GET /api/status/{runId}
│   │   └── runs.ts               # GET /api/runs
│   ├── package.json
│   └── tsconfig.json
├── agent/                        # Local agent (shipped via npm)
│   ├── index.js                  # Entry point
│   ├── websocket-server.js       # WebSocket server
│   ├── project-manager.js        # Project registry
│   ├── run-queue.js              # Sequential run queue
│   ├── scheduler.js              # Cron scheduling
│   ├── cli-bridge.js             # NightyTidy CLI subprocess wrapper
│   ├── webhook-dispatcher.js     # Webhook sending
│   ├── git-integration.js        # Diff, PR, rollback
│   └── firebase-auth.js          # Agent Firebase authentication
├── public/
│   └── favicon.ico
├── firebase.json                 # Firebase config
├── firestore.rules               # Firestore security rules
├── next.config.js
├── package.json
├── tsconfig.json
└── README.md
```

---

## Local Agent Files

The agent creates these files on the user's machine:

| File | Purpose |
|------|---------|
| `~/.nightytidy/config.json` | Agent config (Firebase auth cache, machine name) |
| `~/.nightytidy/projects.json` | Project registry (paths, schedules, presets) |
| `~/.nightytidy/queue.json` | Persisted run queue |
| `~/.nightytidy/agent.log` | Agent log file |

---

## Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /webhooks/{webhookId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /projects/{projectId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;

        match /presets/{presetId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }

        match /webhooks/{webhookId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }

      match /runs/{runId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;

        match /steps/{stepNum} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
  }
}
```

---

## Verification Criteria

- [ ] Landing page loads, GitHub OAuth works, redirects to dashboard
- [ ] First-time setup detects agent connection and transitions to dashboard
- [ ] Agent starts with `npx nightytidy agent`, connects via WebSocket
- [ ] Projects can be added (folder picker), removed, listed
- [ ] Step selection shows categories, presets, recommendations, cost estimates
- [ ] Run starts, progress streams live via WebSocket (both summary and raw modes)
- [ ] Rate-limit pause overlay appears with countdown, resume/finish buttons work
- [ ] Run results show stats, expandable step cards, diff viewer, full report
- [ ] Merge, Create PR, Rollback buttons execute via agent
- [ ] Run queue accepts multiple runs, reorder works, sequential execution
- [ ] Scheduler triggers runs at configured times
- [ ] Webhooks fire to nightytidy.com and external endpoints on all event types
- [ ] Remote monitoring: run status visible from another device via nightytidy.com dashboard
- [ ] Analytics charts render with real run data
- [ ] Smart recommendations appear based on project type and run history
- [ ] Settings save and persist across sessions
- [ ] Dark/light/system theme works
- [ ] Agent gracefully shuts down, persists queue, restarts cleanly
- [ ] No source code leaves the user's machine
- [ ] Firestore security rules prevent cross-user data access
