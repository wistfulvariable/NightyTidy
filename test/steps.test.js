import { describe, it, expect } from 'vitest';
import { STEPS, DOC_UPDATE_PROMPT, CHANGELOG_PROMPT } from '../src/prompts/steps.js';

describe('STEPS', () => {
  it('has exactly 28 entries', () => {
    expect(STEPS).toHaveLength(28);
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

  it('numbers are sequential from 1 to 28', () => {
    const numbers = STEPS.map((s) => s.number);
    const expected = Array.from({ length: 28 }, (_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });

  it('no prompt is empty', () => {
    for (const step of STEPS) {
      expect(step.prompt.trim().length).toBeGreaterThan(0);
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
