import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { STEPS, DOC_UPDATE_PROMPT, CHANGELOG_PROMPT, CONSOLIDATION_PROMPT, REPORT_PROMPT, reloadSteps } from '../src/prompts/loader.js';

describe('STEPS', () => {
  it('has exactly 33 entries', () => {
    expect(STEPS).toHaveLength(33);
  });

  it('each entry has number, name, and prompt fields', () => {
    for (const step of STEPS) {
      expect(step).toHaveProperty('number');
      expect(step).toHaveProperty('name');
      expect(step).toHaveProperty('prompt');
      expect(typeof step.number).toBe('number');
      expect(typeof step.name).toBe('string');
      expect(typeof step.prompt).toBe('string');
    }
  });

  it('numbers are sequential from 1 to 33', () => {
    const numbers = STEPS.map((s) => s.number);
    const expected = Array.from({ length: 33 }, (_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });

  it('no prompt is empty', () => {
    for (const step of STEPS) {
      expect(step.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('manifest.json', () => {
  it('has version 1 and 33 step entries', () => {
    const manifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../src/prompts/manifest.json', import.meta.url)), 'utf8'
    ));
    expect(manifest.version).toBe(1);
    expect(manifest.steps).toHaveLength(33);
  });

  it('every manifest ID has a corresponding .md file in steps/', () => {
    const manifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../src/prompts/manifest.json', import.meta.url)), 'utf8'
    ));
    for (const entry of manifest.steps) {
      const filePath = fileURLToPath(new URL(`../src/prompts/steps/${entry.id}.md`, import.meta.url));
      expect(existsSync(filePath), `Missing file: ${entry.id}.md`).toBe(true);
    }
  });
});

describe('DOC_UPDATE_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof DOC_UPDATE_PROMPT).toBe('string');
    expect(DOC_UPDATE_PROMPT.trim().length).toBeGreaterThan(0);
  });
});

describe('CHANGELOG_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof CHANGELOG_PROMPT).toBe('string');
    expect(CHANGELOG_PROMPT.trim().length).toBeGreaterThan(0);
  });
});

describe('CONSOLIDATION_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof CONSOLIDATION_PROMPT).toBe('string');
    expect(CONSOLIDATION_PROMPT.trim().length).toBeGreaterThan(0);
  });
});

describe('REPORT_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof REPORT_PROMPT).toBe('string');
    expect(REPORT_PROMPT.trim().length).toBeGreaterThan(0);
  });
});

describe('reloadSteps', () => {
  it('is an exported function', () => {
    expect(typeof reloadSteps).toBe('function');
  });

  it('re-reads files and preserves STEPS structure', () => {
    const originalLength = STEPS.length;
    const originalFirst = STEPS[0]?.prompt;

    reloadSteps();

    // After reload from same files, data should be identical
    expect(STEPS).toHaveLength(originalLength);
    expect(STEPS[0]?.prompt).toBe(originalFirst);
  });
});
