/**
 * Unit tests for gui/resources/logic.js — pure functions with no DOM or API deps.
 *
 * These functions are shared between the browser GUI and this test file.
 * logic.js exports via module.exports for Node.js compatibility.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// logic.js is a plain browser script that assigns to globalThis.NtLogic.
// We load and eval it to make functions available in the test context.
let NtLogic;

beforeAll(() => {
  const code = readFileSync(join(__dirname, '..', 'gui', 'resources', 'logic.js'), 'utf-8');
  new Function(code)();
  NtLogic = globalThis.NtLogic;
});

// ── buildCommand ───────────────────────────────────────────────────

describe('buildCommand', () => {
  it('builds Windows command with cd /d and quoted path', () => {
    const cmd = NtLogic.buildCommand('C:\\Projects\\MyApp', '--list --json', 'Windows');
    expect(cmd).toBe('cd /d "C:\\Projects\\MyApp" && npx nightytidy --list --json');
  });

  it('builds Linux/macOS command with cd and quoted path', () => {
    const cmd = NtLogic.buildCommand('/home/user/project', '--list --json', 'Linux');
    expect(cmd).toBe('cd "/home/user/project" && npx nightytidy --list --json');
  });

  it('builds macOS command with cd (same as Linux)', () => {
    const cmd = NtLogic.buildCommand('/Users/dev/app', '--init-run --all', 'Darwin');
    expect(cmd).toBe('cd "/Users/dev/app" && npx nightytidy --init-run --all');
  });

  it('handles paths with spaces', () => {
    const cmd = NtLogic.buildCommand('C:\\My Projects\\App Name', '--run-step 5', 'Windows');
    expect(cmd).toBe('cd /d "C:\\My Projects\\App Name" && npx nightytidy --run-step 5');
  });

  it('passes through arbitrary args', () => {
    const cmd = NtLogic.buildCommand('/tmp/test', '--init-run --steps 1,5,12 --timeout 60', 'Linux');
    expect(cmd).toContain('--init-run --steps 1,5,12 --timeout 60');
  });
});

// ── parseCliOutput ─────────────────────────────────────────────────

describe('parseCliOutput', () => {
  it('parses a single JSON line', () => {
    const result = NtLogic.parseCliOutput('{"steps":[{"number":1,"name":"Documentation"}]}');
    expect(result.ok).toBe(true);
    expect(result.data.steps).toHaveLength(1);
    expect(result.data.steps[0].name).toBe('Documentation');
  });

  it('parses JSON from last line when preceded by warnings', () => {
    const stdout = 'warning: something\nanother warning\n{"success":true,"runBranch":"nightytidy/run-123"}';
    const result = NtLogic.parseCliOutput(stdout);
    expect(result.ok).toBe(true);
    expect(result.data.success).toBe(true);
    expect(result.data.runBranch).toBe('nightytidy/run-123');
  });

  it('returns error for null input', () => {
    const result = NtLogic.parseCliOutput(null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no output/i);
  });

  it('returns error for empty string', () => {
    const result = NtLogic.parseCliOutput('');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no output/i);
  });

  it('returns error for whitespace-only string', () => {
    const result = NtLogic.parseCliOutput('   \n  \n  ');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty output/i);
  });

  it('returns error for non-JSON output', () => {
    const result = NtLogic.parseCliOutput('Error: command not found\nSome other text');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not parse/i);
  });

  it('returns error for non-string input', () => {
    const result = NtLogic.parseCliOutput(42);
    expect(result.ok).toBe(false);
  });

  it('handles JSON with trailing newline', () => {
    const result = NtLogic.parseCliOutput('{"success":true}\n');
    expect(result.ok).toBe(true);
    expect(result.data.success).toBe(true);
  });

  it('handles Windows CRLF line endings', () => {
    const stdout = 'warning text\r\n{"success":true}\r\n';
    const result = NtLogic.parseCliOutput(stdout);
    expect(result.ok).toBe(true);
    expect(result.data.success).toBe(true);
  });
});

// ── formatMs ───────────────────────────────────────────────────────

describe('formatMs', () => {
  it('formats zero as "0s"', () => {
    expect(NtLogic.formatMs(0)).toBe('0s');
  });

  it('formats negative as "0s"', () => {
    expect(NtLogic.formatMs(-1000)).toBe('0s');
  });

  it('formats null/undefined as "0s"', () => {
    expect(NtLogic.formatMs(null)).toBe('0s');
    expect(NtLogic.formatMs(undefined)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(NtLogic.formatMs(8000)).toBe('8s');
  });

  it('formats minutes and seconds', () => {
    expect(NtLogic.formatMs(125000)).toBe('2m 5s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(NtLogic.formatMs(3661000)).toBe('1h 1m 1s');
  });

  it('formats exactly one hour', () => {
    expect(NtLogic.formatMs(3600000)).toBe('1h 0m 0s');
  });

  it('formats exactly one minute', () => {
    expect(NtLogic.formatMs(60000)).toBe('1m 0s');
  });

  it('floors partial seconds', () => {
    expect(NtLogic.formatMs(1500)).toBe('1s');
  });
});

// ── escapeHtml ─────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(NtLogic.escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes angle brackets', () => {
    expect(NtLogic.escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes double quotes', () => {
    expect(NtLogic.escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('returns empty string for null/undefined', () => {
    expect(NtLogic.escapeHtml(null)).toBe('');
    expect(NtLogic.escapeHtml(undefined)).toBe('');
    expect(NtLogic.escapeHtml('')).toBe('');
  });

  it('passes through clean strings unchanged', () => {
    expect(NtLogic.escapeHtml('Hello World')).toBe('Hello World');
  });
});

// ── getNextStep ────────────────────────────────────────────────────

describe('getNextStep', () => {
  it('returns first step when nothing done', () => {
    expect(NtLogic.getNextStep([1, 5, 12], [], [])).toBe(1);
  });

  it('skips completed steps', () => {
    expect(NtLogic.getNextStep([1, 5, 12], [1], [])).toBe(5);
  });

  it('skips failed steps', () => {
    expect(NtLogic.getNextStep([1, 5, 12], [], [1])).toBe(5);
  });

  it('skips both completed and failed steps', () => {
    expect(NtLogic.getNextStep([1, 5, 12], [1], [5])).toBe(12);
  });

  it('returns null when all steps done', () => {
    expect(NtLogic.getNextStep([1, 5, 12], [1, 5], [12])).toBeNull();
  });

  it('returns null for empty selected', () => {
    expect(NtLogic.getNextStep([], [], [])).toBeNull();
  });

  it('returns null for null selected', () => {
    expect(NtLogic.getNextStep(null, [], [])).toBeNull();
  });

  it('handles null completed/failed arrays', () => {
    expect(NtLogic.getNextStep([1, 5], null, null)).toBe(1);
  });
});

// ── buildStepArgs ──────────────────────────────────────────────────

describe('buildStepArgs', () => {
  it('returns --all when all steps selected', () => {
    expect(NtLogic.buildStepArgs([1, 2, 3, 4, 5], 5)).toBe('--all');
  });

  it('returns --steps with comma-separated numbers for partial selection', () => {
    expect(NtLogic.buildStepArgs([1, 5, 12], 33)).toBe('--steps 1,5,12');
  });

  it('returns --steps for single step', () => {
    expect(NtLogic.buildStepArgs([7], 33)).toBe('--steps 7');
  });
});
