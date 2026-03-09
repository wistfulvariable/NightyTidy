import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'google-doc-sample.html');

// Read fixture BEFORE fs gets mocked — use importActual to get real fs
const actualFs = await vi.importActual('fs');
const FIXTURE_HTML = actualFs.readFileSync(FIXTURE_PATH, 'utf8');

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { createLoggerMock } from './helpers/mocks.js';
vi.mock('../src/logger.js', () => createLoggerMock());

import { readFileSync, writeFileSync, unlinkSync } from 'fs';

import {
  decodeEntities,
  stripTags,
  htmlToMarkdown,
  parseDocSections,
  filterPromptSections,
  normalizeName,
  headingToId,
  matchToManifest,
  computeStepsHash,
  fetchDocHtml,
  syncPrompts,
} from '../src/sync.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── decodeEntities ──────────────────────────────────────────────────

describe('decodeEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeEntities('foo &amp; bar')).toBe('foo & bar');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &#39; and &quot;', () => {
    expect(decodeEntities("it&#39;s &quot;fine&quot;")).toBe("it's \"fine\"");
  });

  it('decodes &nbsp; and \\u00a0', () => {
    expect(decodeEntities('a&nbsp;b\u00a0c')).toBe('a b c');
  });

  it('passes through text with no entities', () => {
    expect(decodeEntities('plain text')).toBe('plain text');
  });
});

// ── stripTags ───────────────────────────────────────────────────────

describe('stripTags', () => {
  it('removes HTML tags', () => {
    expect(stripTags('<span class="c2">hello</span>')).toBe('hello');
  });

  it('removes nested tags', () => {
    expect(stripTags('<p><span>text</span></p>')).toBe('text');
  });

  it('handles self-closing tags', () => {
    expect(stripTags('before<br/>after')).toBe('beforeafter');
  });

  it('returns empty string for tag-only content', () => {
    expect(stripTags('<span class="c2"></span>')).toBe('');
  });
});

// ── htmlToMarkdown ──────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  it('extracts text from simple paragraphs', () => {
    const html = '<p class="c0"><span class="c2">Hello world.</span></p>';
    expect(htmlToMarkdown(html)).toBe('Hello world.\n');
  });

  it('handles multiple paragraphs', () => {
    const html =
      '<p class="c0"><span class="c2">Line 1</span></p>' +
      '<p class="c0"><span class="c2">Line 2</span></p>';
    expect(htmlToMarkdown(html)).toBe('Line 1\nLine 2\n');
  });

  it('collapses consecutive empty paragraphs to one blank line', () => {
    const html =
      '<p class="c0"><span class="c2">Before</span></p>' +
      '<p class="c0 c1"><span class="c2"></span></p>' +
      '<p class="c0 c1"><span class="c2"></span></p>' +
      '<p class="c0"><span class="c2">After</span></p>';
    expect(htmlToMarkdown(html)).toBe('Before\n\nAfter\n');
  });

  it('preserves markdown syntax in text', () => {
    const html =
      '<p class="c0"><span class="c2">## Heading</span></p>' +
      '<p class="c0 c1"><span class="c2"></span></p>' +
      '<p class="c0"><span class="c2">- **Bold item**</span></p>';
    expect(htmlToMarkdown(html)).toBe('## Heading\n\n- **Bold item**\n');
  });

  it('decodes HTML entities in content', () => {
    const html = '<p class="c0"><span class="c2">Logging &amp; Error Message</span></p>';
    expect(htmlToMarkdown(html)).toBe('Logging & Error Message\n');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });

  it('returns empty string for only empty paragraphs', () => {
    const html = '<p class="c0 c1"><span class="c2"></span></p>';
    expect(htmlToMarkdown(html)).toBe('');
  });
});

// ── parseDocSections ────────────────────────────────────────────────

describe('parseDocSections', () => {
  it('parses title paragraphs from Google Doc HTML', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].heading).toBe('Overview');
  });

  it('extracts all section headings in order', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    const headings = sections.map(s => s.heading);
    expect(headings).toEqual([
      'Overview',
      'Meta Prompts',
      'For Creating a New Prompt',
      'Documentation',
      'Test Coverage',
      'Test Hardening',
      'Security Sweep',
      'Bug Hunt',
    ]);
  });

  it('captures content between consecutive title paragraphs', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    const docSection = sections.find(s => s.heading === 'Documentation');
    expect(docSection).toBeDefined();
    expect(docSection.htmlContent).toContain('three-tier documentation system');
    expect(docSection.htmlContent).toContain('Chat Output Requirement');
  });

  it('assigns sequential index to each section', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    sections.forEach((s, i) => {
      expect(s.index).toBe(i);
    });
  });

  it('returns empty array for HTML with no title paragraphs', () => {
    const html = '<html><body><p>No titles here</p></body></html>';
    expect(parseDocSections(html)).toEqual([]);
  });

  it('handles last section extending to end of document', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    const lastSection = sections[sections.length - 1];
    expect(lastSection.heading).toBe('Bug Hunt');
    expect(lastSection.htmlContent).toContain('Error Path Analysis');
  });
});

// ── filterPromptSections ────────────────────────────────────────────

describe('filterPromptSections', () => {
  it('filters out known non-prompt headings', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    const filtered = filterPromptSections(sections);
    const headings = filtered.map(s => s.heading);
    expect(headings).not.toContain('Overview');
    expect(headings).not.toContain('Meta Prompts');
    expect(headings).not.toContain('For Creating a New Prompt');
  });

  it('keeps prompt sections', () => {
    const sections = parseDocSections(FIXTURE_HTML);
    const filtered = filterPromptSections(sections);
    const headings = filtered.map(s => s.heading);
    expect(headings).toContain('Documentation');
    expect(headings).toContain('Test Coverage');
    expect(headings).toContain('Security Sweep');
    expect(headings).toContain('Bug Hunt');
  });

  it('filters case-insensitively', () => {
    const sections = [
      { heading: 'OVERVIEW', htmlContent: '<p>short</p>', index: 0 },
      { heading: 'documentation', htmlContent: '<p><span>You are running an overnight documentation generation pass. This is long enough to pass the content check.</span></p>', index: 1 },
    ];
    const filtered = filterPromptSections(sections);
    expect(filtered.length).toBe(1);
    expect(filtered[0].heading).toBe('documentation');
  });

  it('filters out sections with very short content', () => {
    const sections = [
      { heading: 'Unknown Tab', htmlContent: '<p><span>tiny</span></p>', index: 0 },
    ];
    const filtered = filterPromptSections(sections);
    expect(filtered.length).toBe(0);
  });

  it('returns empty array when all sections are non-prompts', () => {
    const sections = [
      { heading: 'Overview', htmlContent: '<p><span>some content that is long enough to pass</span></p>', index: 0 },
      { heading: 'Conclusion', htmlContent: '<p><span>some content that is long enough to pass</span></p>', index: 1 },
    ];
    const filtered = filterPromptSections(sections);
    expect(filtered.length).toBe(0);
  });
});

// ── normalizeName ───────────────────────────────────────────────────

describe('normalizeName', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeName('Logging & Error Message')).toBe('logging error message');
  });

  it('normalizes whitespace', () => {
    expect(normalizeName('  Test   Coverage  ')).toBe('test coverage');
  });

  it('handles special characters', () => {
    expect(normalizeName("Product Polish & UX Friction")).toBe('product polish ux friction');
  });

  it('handles already-normalized names', () => {
    expect(normalizeName('devops')).toBe('devops');
  });
});

// ── headingToId ─────────────────────────────────────────────────────

describe('headingToId', () => {
  it('generates zero-padded kebab-case ID', () => {
    expect(headingToId(1, 'Documentation')).toBe('01-documentation');
  });

  it('handles multi-word headings', () => {
    expect(headingToId(5, 'Test Consolidation')).toBe('05-test-consolidation');
  });

  it('strips ampersands and special chars', () => {
    expect(headingToId(16, 'Logging & Error Message')).toBe('16-logging-error-message');
  });

  it('handles double-digit numbers', () => {
    expect(headingToId(33, 'Strategic Opportunities')).toBe('33-strategic-opportunities');
  });
});

// ── matchToManifest ─────────────────────────────────────────────────

describe('matchToManifest', () => {
  const baseManifest = {
    steps: [
      { id: '01-documentation', name: 'Documentation' },
      { id: '02-test-coverage', name: 'Test Coverage' },
      { id: '03-security-sweep', name: 'Security Sweep' },
    ],
  };

  function makeSection(heading, content = 'You are running an overnight pass. Lots of content here to pass length check.') {
    return {
      heading,
      htmlContent: `<p class="c0"><span class="c2">${content}</span></p>`,
      index: 0,
    };
  }

  beforeEach(() => {
    // Mock readFileSync to return existing prompt content
    readFileSync.mockImplementation((filePath) => {
      if (typeof filePath === 'string' && filePath.endsWith('.md')) {
        return 'You are running an overnight pass. Lots of content here to pass length check.\n';
      }
      throw new Error(`Unexpected read: ${filePath}`);
    });
  });

  it('matches sections to manifest entries by name', () => {
    const sections = [makeSection('Documentation'), makeSection('Test Coverage')];
    const result = matchToManifest(sections, baseManifest);
    expect(result.matched.length).toBe(2);
    expect(result.matched[0].entry.id).toBe('01-documentation');
    expect(result.matched[1].entry.id).toBe('02-test-coverage');
  });

  it('detects unchanged content', () => {
    const sections = [makeSection('Documentation')];
    const result = matchToManifest(sections, baseManifest);
    expect(result.matched[0].changed).toBe(false);
  });

  it('detects changed content', () => {
    const sections = [makeSection('Documentation', 'Updated content that is different from what was stored. This is a new version of the prompt.')];
    const result = matchToManifest(sections, baseManifest);
    expect(result.matched[0].changed).toBe(true);
  });

  it('identifies new sections as added', () => {
    const sections = [makeSection('Documentation'), makeSection('New Step')];
    const result = matchToManifest(sections, baseManifest);
    expect(result.added.length).toBe(1);
    expect(result.added[0].heading).toBe('New Step');
    expect(result.added[0].suggestedId).toContain('new-step');
  });

  it('identifies missing manifest entries as removed', () => {
    const sections = [makeSection('Documentation')]; // Missing Test Coverage and Security Sweep
    const result = matchToManifest(sections, baseManifest);
    expect(result.removed.length).toBe(2);
    expect(result.removed.map(r => r.entry.name)).toEqual(['Test Coverage', 'Security Sweep']);
  });

  it('handles empty manifest', () => {
    const sections = [makeSection('Documentation')];
    const result = matchToManifest(sections, { steps: [] });
    expect(result.matched.length).toBe(0);
    expect(result.added.length).toBe(1);
  });

  it('handles empty sections list', () => {
    const result = matchToManifest([], baseManifest);
    expect(result.matched.length).toBe(0);
    expect(result.removed.length).toBe(3);
  });

  it('handles file read errors for new files gracefully', () => {
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const sections = [makeSection('Documentation')];
    const result = matchToManifest(sections, baseManifest);
    // Should mark as changed since file doesn't exist
    expect(result.matched[0].changed).toBe(true);
  });
});

// ── computeStepsHash ────────────────────────────────────────────────

describe('computeStepsHash', () => {
  it('produces consistent SHA-256 for same input', () => {
    const hash1 = computeStepsHash(['prompt1', 'prompt2']);
    const hash2 = computeStepsHash(['prompt1', 'prompt2']);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hash for different input', () => {
    const hash1 = computeStepsHash(['prompt1']);
    const hash2 = computeStepsHash(['prompt2']);
    expect(hash1).not.toBe(hash2);
  });

  it('matches the executor.js algorithm (join then hash)', async () => {
    const { createHash } = await import('crypto');
    const prompts = ['aaa', 'bbb', 'ccc'];
    const expected = createHash('sha256').update(prompts.join('')).digest('hex');
    expect(computeStepsHash(prompts)).toBe(expected);
  });
});

// ── fetchDocHtml ────────────────────────────────────────────────────

describe('fetchDocHtml', () => {
  it('returns HTML on successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>doc content</html>'),
    }));

    const result = await fetchDocHtml('https://example.com/doc');
    expect(result.success).toBe(true);
    expect(result.html).toBe('<html>doc content</html>');
    expect(result.error).toBeNull();
  });

  it('returns error on non-200 status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    const result = await fetchDocHtml('https://example.com/missing');
    expect(result.success).toBe(false);
    expect(result.html).toBeNull();
    expect(result.error).toContain('404');
  });

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await fetchDocHtml('https://example.com/down');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('returns timeout error on AbortError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

    const result = await fetchDocHtml('https://example.com/slow');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('passes URL to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchDocHtml('https://example.com/myurl');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/myurl',
      expect.objectContaining({ headers: { 'User-Agent': 'NightyTidy-Sync/1.0' } })
    );
  });
});

// ── syncPrompts (integration) ───────────────────────────────────────

describe('syncPrompts', () => {
  const fakeManifest = {
    version: 1,
    sourceUrl: 'https://example.com/doc',
    steps: [
      { id: '01-documentation', name: 'Documentation' },
      { id: '02-test-coverage', name: 'Test Coverage' },
      { id: '03-test-hardening', name: 'Test Hardening' },
      { id: '04-security-sweep', name: 'Security Sweep' },
      { id: '05-bug-hunt', name: 'Bug Hunt' },
    ],
  };

  function setupMocks({ manifestJson, existingPrompts = {}, executorSource } = {}) {
    const manifest = manifestJson || JSON.stringify(fakeManifest);
    const executor = executorSource || "const STEPS_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';";

    readFileSync.mockImplementation((filePath, encoding) => {
      const fp = typeof filePath === 'string' ? filePath.replace(/\\/g, '/') : '';
      if (fp.includes('manifest.json')) return manifest;
      if (fp.includes('executor.js')) return executor;
      if (fp.endsWith('.md')) {
        // Check if we have specific content for this file
        for (const [key, value] of Object.entries(existingPrompts)) {
          if (fp.includes(key)) return value;
        }
        return 'Existing prompt content.\n';
      }
      throw new Error(`Unexpected readFileSync: ${filePath}`);
    });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(FIXTURE_HTML),
    }));
  });

  it('returns success with summary on dry run', async () => {
    setupMocks();
    const result = await syncPrompts({ dryRun: true });
    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary).toHaveProperty('updated');
    expect(result.summary).toHaveProperty('added');
    expect(result.summary).toHaveProperty('removed');
    expect(result.summary).toHaveProperty('unchanged');
  });

  it('does not write files on dry run', async () => {
    setupMocks();
    await syncPrompts({ dryRun: true });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('writes files on full sync', async () => {
    setupMocks();
    const result = await syncPrompts({ dryRun: false });
    expect(result.success).toBe(true);
    // Should write manifest.json + prompt files + executor.js
    expect(writeFileSync).toHaveBeenCalled();
    const writtenPaths = writeFileSync.mock.calls.map(c => c[0].replace(/\\/g, '/'));
    const hasManifest = writtenPaths.some(p => p.includes('manifest.json'));
    expect(hasManifest).toBe(true);
  });

  it('returns error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    setupMocks();
    const result = await syncPrompts();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network down');
  });

  it('returns error when manifest cannot be read', async () => {
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = await syncPrompts();
    expect(result.success).toBe(false);
    expect(result.error).toContain('manifest');
  });

  it('returns error when no source URL is configured', async () => {
    const noUrlManifest = JSON.stringify({ version: 1, steps: [] });
    readFileSync.mockImplementation((fp) => {
      if (typeof fp === 'string' && fp.replace(/\\/g, '/').includes('manifest.json')) return noUrlManifest;
      throw new Error('unexpected');
    });
    const result = await syncPrompts();
    expect(result.success).toBe(false);
    expect(result.error).toContain('source URL');
  });

  it('uses URL override when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(FIXTURE_HTML),
    });
    vi.stubGlobal('fetch', mockFetch);
    setupMocks();

    await syncPrompts({ dryRun: true, url: 'https://custom.url/doc' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.url/doc',
      expect.any(Object)
    );
  });

  it('aborts if removing more than 50% of prompts (safety guard)', async () => {
    // Fixture only has 5 prompts, but manifest has many more
    const bigManifest = {
      version: 1,
      sourceUrl: 'https://example.com/doc',
      steps: Array.from({ length: 20 }, (_, i) => ({
        id: `${String(i + 1).padStart(2, '0')}-step${i + 1}`,
        name: `Step ${i + 1}`,
      })),
    };
    setupMocks({ manifestJson: JSON.stringify(bigManifest) });

    const result = await syncPrompts();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Safety check');
    expect(result.error).toContain('50%');
  });

  it('never throws, even on unexpected errors', async () => {
    // Force an unexpected internal error
    readFileSync.mockImplementation((fp) => {
      if (typeof fp === 'string' && fp.replace(/\\/g, '/').includes('manifest.json')) {
        return JSON.stringify({ version: 1, sourceUrl: 'https://x.com', steps: [] });
      }
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('not valid html with no sections at all'),
    }));

    const result = await syncPrompts();
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    // Should not throw — returns error object
  });

  it('updates STEPS_HASH in executor.js', async () => {
    setupMocks();
    const result = await syncPrompts({ dryRun: false });
    expect(result.success).toBe(true);

    // Find the executor.js write call
    const executorWrite = writeFileSync.mock.calls.find(
      c => c[0].replace(/\\/g, '/').includes('executor.js')
    );
    expect(executorWrite).toBeDefined();
    // Should contain a new hash (not the fake one)
    expect(executorWrite[1]).toMatch(/const STEPS_HASH = '[a-f0-9]{64}'/);
    expect(executorWrite[1]).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('handles document with no title paragraphs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body><p>no titles</p></body></html>'),
    }));
    setupMocks();

    const result = await syncPrompts();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No sections found');
  });

  it('includes newStepsHash in summary after write', async () => {
    setupMocks();
    const result = await syncPrompts({ dryRun: false });
    expect(result.success).toBe(true);
    expect(result.summary.newStepsHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deletes removed prompt files', async () => {
    // Fixture has: Documentation, Test Coverage, Test Hardening, Security Sweep, Bug Hunt
    // Manifest has same 5. If we add an extra step to manifest that's NOT in fixture...
    const manifestWithExtra = {
      ...fakeManifest,
      steps: [
        ...fakeManifest.steps,
        { id: '06-extra-step', name: 'Extra Step' },
      ],
    };
    setupMocks({ manifestJson: JSON.stringify(manifestWithExtra) });

    const result = await syncPrompts({ dryRun: false });
    expect(result.success).toBe(true);
    expect(result.summary.removed.length).toBe(1);
    expect(result.summary.removed[0].name).toBe('Extra Step');

    // Should have called unlinkSync for the removed file
    const deletedPaths = unlinkSync.mock.calls.map(c => c[0].replace(/\\/g, '/'));
    expect(deletedPaths.some(p => p.includes('06-extra-step.md'))).toBe(true);
  });
});
