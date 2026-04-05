import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

vi.mock('../src/prompts/loader.js', () => {
  const names = [
    'Documentation', 'Test Coverage', 'Security Sweep', 'Performance',
    ...Array.from({ length: 39 }, (_, i) => `Step ${i + 5}`),
  ];
  return {
    STEPS: names.map((name, i) => ({ number: i + 1, name, prompt: `prompt ${i + 1}` })),
    DOC_UPDATE_PROMPT: 'mock doc update',
    CHANGELOG_PROMPT: 'mock changelog',
    reloadSteps: vi.fn(),
  };
});

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { generateIntegrationSnippet, setupProject } from '../src/setup.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateIntegrationSnippet', () => {
  it('returns a string containing the marker and all 43 steps', () => {
    const snippet = generateIntegrationSnippet();

    expect(snippet).toContain('## NightyTidy');
    expect(snippet).toContain('<!-- /nightytidy -->');
    expect(snippet).toContain('nightytidy --all');
    expect(snippet).toContain('nightytidy --init-run');
    expect(snippet).toContain('nightytidy --run-step');
    expect(snippet).toContain('nightytidy --finish-run');
    expect(snippet).toContain('nightytidy --list');

    // All 43 steps present
    for (let i = 1; i <= 43; i++) {
      expect(snippet).toContain(`${i}. **`);
    }
  });

  it('includes key step names', () => {
    const snippet = generateIntegrationSnippet();

    expect(snippet).toContain('Documentation');
    expect(snippet).toContain('Test Coverage');
    expect(snippet).toContain('Security Sweep');
    expect(snippet).toContain('Performance');
  });
});

describe('setupProject', () => {
  it('creates a new CLAUDE.md when none exists', () => {
    existsSync.mockReturnValue(false);

    const result = setupProject('/fake/project');

    expect(result).toBe('created');
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = writeFileSync.mock.calls[0];
    expect(filePath).toMatch(/CLAUDE\.md$/);
    expect(content).toContain('## NightyTidy');
    expect(content).toContain('<!-- /nightytidy -->');
  });

  it('appends to existing CLAUDE.md without NightyTidy section', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('# My Project\n\nExisting content.\n');

    const result = setupProject('/fake/project');

    expect(result).toBe('appended');
    expect(writeFileSync).toHaveBeenCalledOnce();
    const content = writeFileSync.mock.calls[0][1];
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('## NightyTidy');
  });

  it('replaces existing NightyTidy section when markers are present', () => {
    const existingContent =
      '# My Project\n\n' +
      '## NightyTidy — Automated Codebase Improvement\n\nOld content here.\n<!-- /nightytidy -->\n\n' +
      '## Other Section\n';

    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(existingContent);

    const result = setupProject('/fake/project');

    expect(result).toBe('updated');
    expect(writeFileSync).toHaveBeenCalledOnce();
    const content = writeFileSync.mock.calls[0][1];
    // Should have the new snippet, not the old content
    expect(content).not.toContain('Old content here.');
    expect(content).toContain('nightytidy --all');
    // Should preserve surrounding content
    expect(content).toContain('# My Project');
    expect(content).toContain('## Other Section');
  });

  it('is idempotent — running twice produces the same result', () => {
    existsSync.mockReturnValue(false);

    setupProject('/fake/project');
    const firstContent = writeFileSync.mock.calls[0][1];

    // Now simulate the file existing with the content we just wrote
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(firstContent);

    const result = setupProject('/fake/project');

    expect(result).toBe('updated');
    const secondContent = writeFileSync.mock.calls[0][1];
    // The NightyTidy section should appear exactly once
    const markerCount = (secondContent.match(/## NightyTidy/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it('preserves content before and after the NightyTidy section on update', () => {
    const before = '# Header\n\nSome rules.\n\n';
    const after = '\n\n## Footer\n\nMore stuff.\n';
    const existing = before +
      '## NightyTidy — Automated Codebase Improvement\nOld.\n<!-- /nightytidy -->' +
      after;

    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(existing);

    setupProject('/fake/project');

    const content = writeFileSync.mock.calls[0][1];
    expect(content).toContain('# Header');
    expect(content).toContain('Some rules.');
    expect(content).toContain('## Footer');
    expect(content).toContain('More stuff.');
  });
});
