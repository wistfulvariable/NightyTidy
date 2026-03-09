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
  it.each([
    ['C:\\Projects\\MyApp', '--list --json', 'Windows', 'cd /d "C:\\Projects\\MyApp" && npx nightytidy --list --json', 'Windows with cd /d'],
    ['/home/user/project', '--list --json', 'Linux', 'cd "/home/user/project" && npx nightytidy --list --json', 'Linux with cd'],
    ['/Users/dev/app', '--init-run --all', 'Darwin', 'cd "/Users/dev/app" && npx nightytidy --init-run --all', 'macOS (same as Linux)'],
    ['C:\\My Projects\\App Name', '--run-step 5', 'Windows', 'cd /d "C:\\My Projects\\App Name" && npx nightytidy --run-step 5', 'paths with spaces'],
  ])('builds correct command for %s on %s (%s)', (dir, args, os, expected) => {
    expect(NtLogic.buildCommand(dir, args, os)).toBe(expected);
  });

  it('passes through arbitrary args', () => {
    const cmd = NtLogic.buildCommand('/tmp/test', '--init-run --steps 1,5,12 --timeout 60', 'Linux');
    expect(cmd).toContain('--init-run --steps 1,5,12 --timeout 60');
  });

  it.each([
    ['C:\\Projects\\MyApp', '--list --json', 'Windows', 'C:\\bin\\nightytidy.js', 'cd /d "C:\\Projects\\MyApp" && node "C:\\bin\\nightytidy.js" --list --json', 'Windows with binPath'],
    ['/home/user/project', '--list --json', 'Linux', '/opt/nightytidy/bin/nightytidy.js', 'cd "/home/user/project" && node "/opt/nightytidy/bin/nightytidy.js" --list --json', 'Linux with binPath'],
  ])('uses node + binPath when provided for %s on %s (%s)', (dir, args, os, binPath, expected) => {
    expect(NtLogic.buildCommand(dir, args, os, binPath)).toBe(expected);
  });

  it('falls back to npx when binPath is null', () => {
    const cmd = NtLogic.buildCommand('/tmp/test', '--list --json', 'Linux', null);
    expect(cmd).toContain('npx nightytidy');
  });
});

// ── parseCliOutput ─────────────────────────────────────────────────

describe('parseCliOutput', () => {
  describe('successful parsing', () => {
    it.each([
      ['{"steps":[{"number":1,"name":"Documentation"}]}', 'single JSON line'],
      ['warning: something\nanother warning\n{"success":true,"runBranch":"nightytidy/run-123"}', 'JSON after warning lines'],
      ['{"success":true}\n', 'JSON with trailing newline'],
      ['warning text\r\n{"success":true}\r\n', 'Windows CRLF line endings'],
    ])('returns ok:true for %s', (input) => {
      const result = NtLogic.parseCliOutput(input);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('extracts nested data from parsed JSON', () => {
      const result = NtLogic.parseCliOutput('{"steps":[{"number":1,"name":"Documentation"}]}');
      expect(result.data.steps).toHaveLength(1);
      expect(result.data.steps[0].name).toBe('Documentation');
    });
  });

  describe('error cases', () => {
    it.each([
      [null, /no output/i, 'null input'],
      ['', /no output/i, 'empty string'],
      ['   \n  \n  ', /empty output/i, 'whitespace-only'],
      ['Error: command not found\nSome other text', /could not parse/i, 'non-JSON output'],
    ])('returns ok:false for %s (%s)', (input, errorPattern) => {
      const result = NtLogic.parseCliOutput(input);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(errorPattern);
    });

    it('returns ok:false for non-string input', () => {
      const result = NtLogic.parseCliOutput(42);
      expect(result.ok).toBe(false);
    });
  });
});

// ── formatMs ───────────────────────────────────────────────────────

describe('formatMs', () => {
  it.each([
    [0, '0s', 'zero'],
    [-1000, '0s', 'negative'],
    [null, '0s', 'null'],
    [undefined, '0s', 'undefined'],
    [8000, '8s', 'seconds only'],
    [125000, '2m 5s', 'minutes and seconds'],
    [3661000, '1h 1m 1s', 'hours, minutes, seconds'],
    [3600000, '1h 0m 0s', 'exactly one hour'],
    [60000, '1m 0s', 'exactly one minute'],
    [1500, '1s', 'floors partial seconds'],
  ])('formats %s ms as "%s" (%s)', (ms, expected) => {
    expect(NtLogic.formatMs(ms)).toBe(expected);
  });
});

// ── escapeHtml ─────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it.each([
    ['foo & bar', 'foo &amp; bar', 'ampersands'],
    ['<script>alert("xss")</script>', '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'angle brackets and quotes'],
    ['say "hello"', 'say &quot;hello&quot;', 'double quotes'],
    [null, '', 'null'],
    [undefined, '', 'undefined'],
    ['', '', 'empty string'],
    ['Hello World', 'Hello World', 'clean strings'],
  ])('escapes %s -> "%s" (%s)', (input, expected) => {
    expect(NtLogic.escapeHtml(input)).toBe(expected);
  });
});

// ── getNextStep ────────────────────────────────────────────────────

describe('getNextStep', () => {
  it.each([
    [[1, 5, 12], [], [], 1, 'first step when nothing done'],
    [[1, 5, 12], [1], [], 5, 'skips completed'],
    [[1, 5, 12], [], [1], 5, 'skips failed'],
    [[1, 5, 12], [1], [5], 12, 'skips both completed and failed'],
    [[1, 5, 12], [1, 5], [12], null, 'null when all done'],
    [[], [], [], null, 'null for empty selected'],
    [null, [], [], null, 'null for null selected'],
    [[1, 5], null, null, 1, 'handles null completed/failed'],
  ])('returns %s for %s', (selected, completed, failed, expected, _desc) => {
    expect(NtLogic.getNextStep(selected, completed, failed)).toBe(expected);
  });
});

// ── formatCost ────────────────────────────────────────────────────

describe('formatCost', () => {
  it.each([
    [0.1234, '$0.12', 'typical cost'],
    [0, '$0.00', 'zero cost'],
    [1.5, '$1.50', 'pads to 2 decimals'],
    [0.00001, '$0.00', 'rounds tiny cost'],
    [12.3456789, '$12.35', 'rounds large cost'],
  ])('formats %s -> "%s" (%s)', (input, expected, _desc) => {
    expect(NtLogic.formatCost(input)).toBe(expected);
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
  ])('returns null for %s (%s)', (input, _desc) => {
    expect(NtLogic.formatCost(input)).toBeNull();
  });
});

// ── formatTokens ─────────────────────────────────────────────────

describe('formatTokens', () => {
  it.each([
    [30500, '30.5k', 'thousands with decimal'],
    [1000, '1k', 'exactly 1000 drops .0'],
    [1500, '1.5k', 'thousands with one decimal'],
    [142, '142', 'below 1000 raw number'],
    [999, '999', 'just under 1000'],
    [100000, '100k', 'large number drops .0'],
    [1234567, '1234.6k', 'very large rounds'],
  ])('formats %s -> "%s" (%s)', (input, expected, _desc) => {
    expect(NtLogic.formatTokens(input)).toBe(expected);
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    [0, 'zero'],
    [Infinity, 'Infinity'],
  ])('returns null for %s (%s)', (input, _desc) => {
    expect(NtLogic.formatTokens(input)).toBeNull();
  });
});

// ── buildStepArgs ──────────────────────────────────────────────────

describe('buildStepArgs', () => {
  it.each([
    [[1, 2, 3, 4, 5], 5, '--all', 'all steps selected'],
    [[1, 5, 12], 33, '--steps 1,5,12', 'partial selection (comma-separated)'],
    [[7], 33, '--steps 7', 'single step'],
  ])('returns "%s" for %s (%s)', (selected, total, expected, _desc) => {
    expect(NtLogic.buildStepArgs(selected, total)).toBe(expected);
  });
});

describe('detectGitError', () => {
  it('returns "no-repo" for NightyTidy git project error', () => {
    const msg = "This folder isn't a git project. Navigate to your project folder and try again.\nIf you need to set one up, run: git init";
    expect(NtLogic.detectGitError(msg)).toBe('no-repo');
  });

  it('returns "no-repo" for raw git error message', () => {
    expect(NtLogic.detectGitError('fatal: not a git repository (or any of the parent directories): .git')).toBe('no-repo');
  });

  it('returns "no-commits" for NightyTidy no-commits error', () => {
    const msg = "Your project has no commits yet. NightyTidy needs at least one commit to create a safety tag.";
    expect(NtLogic.detectGitError(msg)).toBe('no-commits');
  });

  it('returns "no-commits" for variant wording', () => {
    expect(NtLogic.detectGitError('This repo has no commits')).toBe('no-commits');
  });

  it('returns null for unrelated errors', () => {
    expect(NtLogic.detectGitError('Claude Code not detected.')).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(NtLogic.detectGitError(null)).toBeNull();
    expect(NtLogic.detectGitError('')).toBeNull();
    expect(NtLogic.detectGitError(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(NtLogic.detectGitError(42)).toBeNull();
    expect(NtLogic.detectGitError({})).toBeNull();
  });
});

describe('detectStaleState', () => {
  it('detects "already in progress" error', () => {
    expect(NtLogic.detectStaleState('A run is already in progress. Call --finish-run first, or delete nightytidy-run-state.json to reset.')).toBe(true);
  });

  it('detects error mentioning run-state.json', () => {
    expect(NtLogic.detectStaleState('Delete nightytidy-run-state.json to reset')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(NtLogic.detectStaleState('Claude Code not detected.')).toBe(false);
  });

  it('returns false for null/empty/non-string values', () => {
    expect(NtLogic.detectStaleState(null)).toBe(false);
    expect(NtLogic.detectStaleState('')).toBe(false);
    expect(NtLogic.detectStaleState(undefined)).toBe(false);
    expect(NtLogic.detectStaleState(42)).toBe(false);
  });
});
