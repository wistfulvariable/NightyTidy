# Notifications

## Overview

Thin wrapper around `node-notifier` for cross-platform desktop notifications. Always on — no configuration, no opt-out. Notifications are the user's primary awareness channel during an unattended overnight run.

## Dependencies

- `01_Project_Setup.md` — node-notifier dependency
- `02_Logger.md` — logs when notifications are sent

## Module: `src/notifications.js`

### Exported Interface

```javascript
// Send a desktop notification. Fire-and-forget — never throws.
// title: notification title (short)
// message: notification body (1-2 sentences)
export function notify(title, message)
```

### Design Principles

1. **Fire-and-forget.** `notify()` never throws, never blocks, never fails the run. If the notification system is broken, log a warning and move on. The log file is the backup awareness channel.
2. **Always on.** No toggle, no config. Notifications are a mandatory feature.
3. **Concise.** Desktop notifications have limited space. Keep titles under 40 chars, messages under 120 chars.

### Notification Events

NightyTidy sends exactly 3 types of notifications (plus a 4th for merge conflicts):

#### 1. Run Started

**When**: After pre-run checks pass and the run branch is created, before the first step begins.

```
Title: "NightyTidy Started"
Message: "Running {N} steps. Check nightytidy-run.log for progress."
```

Example: `"Running 28 steps. Check nightytidy-run.log for progress."`

#### 2. Step Failure

**When**: Immediately when a step fails all retry attempts and is skipped.

```
Title: "NightyTidy: Step {N} Failed"
Message: "Step {N} ({Name}) failed after {X} attempts. Skipped — run continuing."
```

Example: `"Step 7 (File Decomposition) failed after 4 attempts. Skipped — run continuing."`

This notification is sent by the executor (see `07_Step_Executor.md`). It fires for each failed step individually — the user gets real-time awareness of failures, not a batch summary at the end.

#### 3. Run Complete

**When**: After all steps have been attempted and the final merge is done (or attempted).

**Success case** (all steps passed):
```
Title: "NightyTidy Complete ✓"
Message: "All {N} steps succeeded. See NIGHTYTIDY-REPORT.md for details."
```

**Partial success** (some steps failed):
```
Title: "NightyTidy Complete"
Message: "{X}/{N} steps succeeded, {Y} failed. See NIGHTYTIDY-REPORT.md"
```

**All failed** (rare):
```
Title: "NightyTidy Complete — Issues Found"
Message: "0/{N} steps succeeded. See NIGHTYTIDY-REPORT.md and nightytidy-run.log"
```

#### 4. Merge Conflict

**When**: The auto-merge at the end of the run encounters conflicts.

```
Title: "NightyTidy: Merge Conflict"
Message: "Changes are on branch {branchName}. See NIGHTYTIDY-REPORT.md for resolution steps."
```

This is distinct from the run-complete notification. Both are sent: first the run-complete, then the merge conflict notification if applicable.

### node-notifier Usage

```javascript
import notifier from 'node-notifier';

export function notify(title, message) {
  try {
    notifier.notify({
      title,
      message,
      sound: false,    // no sound by default (post-MVP possible feature)
      wait: false      // don't wait for user to dismiss
    });
    debug(`Notification sent: ${title}`);
  } catch (err) {
    warn(`Failed to send notification: ${err.message}`);
    // Never throw — notifications are best-effort
  }
}
```

### Platform Behavior

| Platform | Mechanism | Notes |
|----------|-----------|-------|
| Windows 10/11 | Toast notification (PowerShell-based) | Primary platform. node-notifier uses a bundled `snoreToast.exe` on Windows. Works without any system configuration. |
| macOS | Notification Center | Works out of the box. May require granting notification permissions to Terminal/iTerm on first use. |
| Linux | libnotify (`notify-send`) | Requires `libnotify-bin` installed. If not available, notification silently fails and is logged. |

**Windows-specific notes**:
- Toast notifications on Windows have a character limit (~200 chars for the body). Keep messages within this.
- node-notifier's Windows implementation uses `snoreToast` which is bundled — no extra install needed.
- Notifications appear in Windows Action Center and persist until dismissed.

### Notification Timing

- **Run Started**: Sent once, immediately before the step loop begins.
- **Step Failure**: Sent immediately upon failure determination (after all retries exhausted). The user might see these overnight if they glance at their phone/desktop.
- **Run Complete**: Sent once, after the merge (or merge attempt). This is the notification the user sees in the morning.
- **Merge Conflict**: Sent immediately after a failed merge, following the run-complete notification.

### Error Handling

Notification failures are **never** propagated. The pattern:

```javascript
try {
  notifier.notify({ ... });
} catch {
  // Log and continue. Never let a notification failure affect the run.
}
```

This is critical — node-notifier can fail for various platform reasons (missing libnotify on Linux, Terminal not allowed notifications on macOS, etc.). These must never crash the run.

## Testing Notes

- **Mock `node-notifier`** — verify `notify` is called with correct arguments for each event type.
- Test that `notify` doesn't throw even when `notifier.notify` throws.
- Test message formatting for each notification type:
  - Run started with varying step counts
  - Step failure with step number and name
  - Run complete: all success, partial success, all failed
  - Merge conflict with branch name

## Gaps & Assumptions

- **Sound on completion** — Listed as a post-MVP "Maybe" feature. MVP uses `sound: false`.
- **Notification grouping** — If 5 steps fail, the user gets 5 separate notifications. No grouping or batching. This is intentional — each failure is its own event.
- **App icon** — node-notifier supports a custom icon. Not included in MVP. Could add the NightyTidy logo later for brand polish.
- **macOS permission prompt** — First-time macOS users may need to grant Terminal notification permission. If they don't, notifications silently fail. No detection or guidance for this in MVP — the log file serves as fallback.
