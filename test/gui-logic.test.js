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

  describe('with skipped parameter', () => {
    it('skips steps in the skipped array', () => {
      expect(NtLogic.getNextStep([1, 5, 12], [], [], [1])).toBe(5);
    });

    it('skips steps across completed, failed, and skipped', () => {
      expect(NtLogic.getNextStep([1, 5, 12], [1], [5], [12])).toBe(null);
    });

    it('returns next non-skipped step', () => {
      expect(NtLogic.getNextStep([1, 5, 12], [], [], [1, 5])).toBe(12);
    });

    it('handles undefined skipped (backward compat)', () => {
      expect(NtLogic.getNextStep([1, 5, 12], [1], [], undefined)).toBe(5);
    });

    it('handles empty skipped array', () => {
      expect(NtLogic.getNextStep([1, 5, 12], [], [], [])).toBe(1);
    });
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
    [142, '142', 'below 1000 raw number'],
    [999, '999', 'just under 1000'],
    [1000, '1k', 'exactly 1000'],
    [1500, '2k', '1500 rounds to 2k'],
    [30500, '31k', 'rounds to nearest thousand'],
    [100000, '100k', 'even thousands'],
    [999499, '999k', 'just under 1M boundary'],
    [999500, '1,000k', 'rounds up to 1000k at boundary'],
    [1000000, '1.0M', 'exactly 1M with one decimal'],
    [1234567, '1.2M', 'millions with one decimal'],
    [1965300, '2.0M', 'rounds to 2.0M'],
    [5500000, '5.5M', 'mid millions one decimal'],
    [9999999, '10.0M', 'rounds up to 10.0M'],
    [10000000, '10M', '10M with zero decimals'],
    [12345678, '12M', 'tens of millions rounds'],
    [150000000, '150M', 'hundreds of millions'],
    [1500000000, '1,500M', 'billions with commas'],
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

// ── formatTime ──────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats a timestamp to locale time string', () => {
    // Use a known date: 2025-01-15 14:05:30
    const ts = new Date(2025, 0, 15, 14, 5, 30).getTime();
    const result = NtLogic.formatTime(ts);
    // Locale-dependent, but should contain "2:05:30" and "PM"
    expect(result).toMatch(/2:05:30/);
    expect(result).toMatch(/PM/);
  });

  it('formats a morning timestamp', () => {
    const ts = new Date(2025, 5, 10, 9, 15, 0).getTime();
    const result = NtLogic.formatTime(ts);
    expect(result).toMatch(/9:15:00/);
    expect(result).toMatch(/AM/);
  });

  it('formats midnight correctly', () => {
    const ts = new Date(2025, 0, 1, 0, 0, 0).getTime();
    const result = NtLogic.formatTime(ts);
    expect(result).toMatch(/12:00:00/);
    expect(result).toMatch(/AM/);
  });

  it('formats noon correctly', () => {
    const ts = new Date(2025, 0, 1, 12, 0, 0).getTime();
    const result = NtLogic.formatTime(ts);
    expect(result).toMatch(/12:00:00/);
    expect(result).toMatch(/PM/);
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [0, 'zero'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
  ])('returns empty string for %s (%s)', (input, _desc) => {
    expect(NtLogic.formatTime(input)).toBe('');
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

// ── preprocessClaudeOutput ──────────────────────────────────────────

describe('preprocessClaudeOutput', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(NtLogic.preprocessClaudeOutput(null)).toBe('');
    expect(NtLogic.preprocessClaudeOutput(undefined)).toBe('');
    expect(NtLogic.preprocessClaudeOutput('')).toBe('');
  });

  it('returns single-line text unchanged', () => {
    expect(NtLogic.preprocessClaudeOutput('Hello world')).toBe('Hello world');
  });

  it('returns consecutive tool lines without inserting blank lines', () => {
    const input = '▸ Read: file.js\n▸ Glob: **/*.ts\n▸ Bash: npm test';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(input);
  });

  it('returns consecutive prose lines without inserting blank lines', () => {
    const input = 'Phase 0 complete.\nNow performing discovery.\nAll checks passed.';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(input);
  });

  it('inserts blank line when tool line follows prose line', () => {
    const input = 'Looking at the project.\n▸ Read: CLAUDE.md';
    const expected = 'Looking at the project.\n\n▸ Read: CLAUDE.md';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(expected);
  });

  it('inserts blank line when prose line follows tool line', () => {
    const input = '▸ Read: CLAUDE.md\nThe project uses ESM modules.';
    const expected = '▸ Read: CLAUDE.md\n\nThe project uses ESM modules.';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(expected);
  });

  it('handles mixed tool/prose/tool sequence with correct boundaries', () => {
    const input = [
      '▸ Read: file1.js',
      '▸ Read: file2.js',
      'The code looks good. Let me check the tests.',
      '▸ Bash: npm test',
      '▸ Glob: test/**/*.test.js',
    ].join('\n');

    const expected = [
      '▸ Read: file1.js',
      '▸ Read: file2.js',
      '',
      'The code looks good. Let me check the tests.',
      '',
      '▸ Bash: npm test',
      '▸ Glob: test/**/*.test.js',
    ].join('\n');

    expect(NtLogic.preprocessClaudeOutput(input)).toBe(expected);
  });

  it('does not double-insert when blank line already exists at boundary', () => {
    const input = '▸ Read: file.js\n\nThe code looks good.';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(input);
  });

  it('preserves existing blank lines between prose paragraphs', () => {
    const input = 'First paragraph.\n\nSecond paragraph.';
    expect(NtLogic.preprocessClaudeOutput(input)).toBe(input);
  });

  it('normalizes \\r\\n to \\n', () => {
    const input = '▸ Read: file.js\r\nThe project looks good.';
    const result = NtLogic.preprocessClaudeOutput(input);
    expect(result).not.toContain('\r');
    expect(result).toBe('▸ Read: file.js\n\nThe project looks good.');
  });

  it('handles ► and ▹ as tool indicators', () => {
    const input = '► Read: file.js\nSome text.\n▹ Glob: *.md\nMore text.';
    const result = NtLogic.preprocessClaudeOutput(input);
    expect(result).toBe('► Read: file.js\n\nSome text.\n\n▹ Glob: *.md\n\nMore text.');
  });

  it('handles realistic multi-section Claude output', () => {
    const input = [
      '▸ Read: C:\\Projects\\App\\CLAUDE.md',
      '▸ Read: C:\\Projects\\App\\MEMORY.md',
      '▸ Glob: .claude/memory/*.md',
      '▸ Glob: **/.cursorrules',
      'This project has a comprehensive documentation system.',
      'Let me read all memory files to understand coverage.',
      '▸ Read: C:\\Projects\\App\\memory\\design.md',
      '▸ Read: C:\\Projects\\App\\memory\\auth.md',
      '▸ TodoWrite',
      '**Phase 0 Complete**: Documentation system validated.',
      'Now performing deep codebase discovery.',
      '▸ Bash: wc -l "CLAUDE.md"',
    ].join('\n');

    const result = NtLogic.preprocessClaudeOutput(input);
    const lines = result.split('\n');

    // Tool block → prose transition: blank line after ▸ Glob: **/.cursorrules
    const cursorrIdx = lines.indexOf('▸ Glob: **/.cursorrules');
    expect(lines[cursorrIdx + 1]).toBe('');
    expect(lines[cursorrIdx + 2]).toBe('This project has a comprehensive documentation system.');

    // Prose → tool transition: blank line before ▸ Read: design.md
    const designIdx = lines.findIndex(l => l.includes('design.md'));
    expect(lines[designIdx - 1]).toBe('');

    // Tool → prose transition: blank line before **Phase 0 Complete**
    const phaseIdx = lines.findIndex(l => l.includes('Phase 0 Complete'));
    expect(lines[phaseIdx - 1]).toBe('');

    // Prose → tool transition: blank line before ▸ Bash
    const bashIdx = lines.findIndex(l => l.includes('Bash: wc'));
    expect(lines[bashIdx - 1]).toBe('');
  });

  it('handles non-string input gracefully', () => {
    expect(NtLogic.preprocessClaudeOutput(42)).toBe('');
    expect(NtLogic.preprocessClaudeOutput({})).toBe('');
    expect(NtLogic.preprocessClaudeOutput(true)).toBe('');
  });
});

// ── detectRateLimit ──────────────────────────────────────────────────

describe('detectRateLimit', () => {
  it.each([
    [{ errorType: 'rate_limit', retryAfterMs: 60000 }, { detected: true, retryAfterMs: 60000 }, 'errorType with retryAfterMs'],
    [{ errorType: 'rate_limit' }, { detected: true, retryAfterMs: null }, 'errorType without retryAfterMs'],
    [{ error: 'rate limit exceeded' }, { detected: true, retryAfterMs: null }, 'error string: rate limit'],
    [{ error: '429 Too Many Requests' }, { detected: true, retryAfterMs: null }, 'error string: 429'],
    [{ error: 'quota exceeded for model' }, { detected: true, retryAfterMs: null }, 'error string: quota exceeded'],
    [{ error: 'API overloaded' }, { detected: true, retryAfterMs: null }, 'error string: overloaded'],
    [{ error: 'too many requests' }, { detected: true, retryAfterMs: null }, 'error string: too many requests'],
    [{ error: 'usage limit reached' }, { detected: true, retryAfterMs: null }, 'error string: usage limit'],
    [{ error: 'throttled by API' }, { detected: true, retryAfterMs: null }, 'error string: throttled'],
    [{ error: 'timeout after 45 minutes' }, { detected: false, retryAfterMs: null }, 'unrelated error: timeout'],
    [{ error: 'ENOENT' }, { detected: false, retryAfterMs: null }, 'unrelated error: ENOENT'],
    [{}, { detected: false, retryAfterMs: null }, 'empty object'],
    [null, { detected: false, retryAfterMs: null }, 'null'],
    [undefined, { detected: false, retryAfterMs: null }, 'undefined'],
  ])('returns %j for %j (%s)', (input, expected, _desc) => {
    expect(NtLogic.detectRateLimit(input)).toEqual(expected);
  });
});

// ── formatCountdown ──────────────────────────────────────────────────

describe('formatCountdown', () => {
  it.each([
    [0, '0s', 'zero'],
    [-1000, '0s', 'negative'],
    [null, '0s', 'null'],
    [undefined, '0s', 'undefined'],
    [45000, '45s', 'seconds only'],
    [135000, '2m 15s', 'minutes and seconds'],
    [3723000, '1h 2m 3s', 'hours, minutes, seconds'],
  ])('formats %s ms as "%s" (%s)', (ms, expected, _desc) => {
    expect(NtLogic.formatCountdown(ms)).toBe(expected);
  });
});

describe('INIT_PHASES', () => {
  it('exports a non-empty array of phases', () => {
    expect(NtLogic.INIT_PHASES).toBeDefined();
    expect(Array.isArray(NtLogic.INIT_PHASES)).toBe(true);
    expect(NtLogic.INIT_PHASES.length).toBeGreaterThan(0);
  });

  it('each phase has key and label strings', () => {
    for (const phase of NtLogic.INIT_PHASES) {
      expect(typeof phase.key).toBe('string');
      expect(phase.key.length).toBeGreaterThan(0);
      expect(typeof phase.label).toBe('string');
      expect(phase.label.length).toBeGreaterThan(0);
    }
  });

  it('phase keys are unique', () => {
    const keys = NtLogic.INIT_PHASES.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getInitPhaseIndex', () => {
  it('returns correct index for first and last phases', () => {
    expect(NtLogic.getInitPhaseIndex('lock')).toBe(0);
    expect(NtLogic.getInitPhaseIndex('dashboard')).toBe(NtLogic.INIT_PHASES.length - 1);
  });

  it('returns correct index for a middle phase', () => {
    const idx = NtLogic.getInitPhaseIndex('pre_checks');
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(NtLogic.INIT_PHASES.length - 1);
    expect(NtLogic.INIT_PHASES[idx].key).toBe('pre_checks');
  });

  it('returns -1 for unknown phase key', () => {
    expect(NtLogic.getInitPhaseIndex('nonexistent')).toBe(-1);
  });

  it('returns -1 for null/undefined', () => {
    expect(NtLogic.getInitPhaseIndex(null)).toBe(-1);
    expect(NtLogic.getInitPhaseIndex(undefined)).toBe(-1);
  });
});
