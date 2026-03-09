/**
 * Google Doc prompt sync — fetches published Google Doc, parses prompt
 * sections, and updates local markdown files + manifest.
 *
 * Error contract: warns but never throws. Returns { success, summary, error }.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import { info, warn, debug } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const STEPS_DIR = path.join(PROMPTS_DIR, 'steps');
const MANIFEST_PATH = path.join(PROMPTS_DIR, 'manifest.json');
const EXECUTOR_PATH = path.join(__dirname, 'executor.js');

const FETCH_TIMEOUT_MS = 30_000;

/** Headings in the Google Doc that are NOT prompts (overview/explanation tabs). */
const NON_PROMPT_HEADINGS = new Set([
  'overnight ai refactoring/codebase improvement prompts',
  'overview',
  'author/date',
  'author & date',
  'the core idea',
  'why overnight works',
  'how to use',
  'suggested order',
  'running these multiple times is profitable',
  'safety rails built into every prompt',
  'conclusion',
  'meta prompts',
]);

/**
 * Safety: if sync would remove more than this fraction of existing prompts,
 * abort — something went wrong with parsing.
 */
const MAX_REMOVAL_FRACTION = 0.5;

// ── HTML parsing helpers ────────────────────────────────────────────

/** Decode common HTML entities to plain text. */
export function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ');
}

/** Strip all HTML tags from a string. */
export function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Convert a Google Docs HTML section body into clean markdown text.
 *
 * Google Docs published HTML stores markdown as plain text inside
 * <p><span> wrappers — no semantic HTML formatting. We extract each
 * <p> as a line, strip tags, decode entities, and collapse blank lines.
 */
export function htmlToMarkdown(sectionHtml) {
  const lines = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(sectionHtml)) !== null) {
    const text = decodeEntities(stripTags(pMatch[1])).trim();
    lines.push(text);
  }

  // Collapse consecutive empty lines to a single blank line
  const collapsed = [];
  let prevEmpty = false;
  for (const line of lines) {
    const isEmpty = line === '';
    if (isEmpty && prevEmpty) continue;
    collapsed.push(line);
    prevEmpty = isEmpty;
  }

  // Trim leading/trailing blank lines and ensure single trailing newline
  const result = collapsed.join('\n').trim();
  return result ? result + '\n' : '';
}

// ── Section parsing ─────────────────────────────────────────────────

/**
 * Parse Google Doc HTML into sections split by title paragraphs.
 * Google Docs uses <p class="... title"> for tab headings.
 *
 * Returns [{ heading, htmlContent, index }] where index is the
 * sequential position in the document (0-based).
 */
export function parseDocSections(html) {
  // Match <p ... title ...> elements — Google Docs tab separators.
  // The "title" appears as a CSS class in the class attribute.
  const titleRegex = /<p[^>]*\btitle\b[^>]*>([\s\S]*?)<\/p>/gi;
  const titleMatches = [];
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    const heading = decodeEntities(stripTags(match[1])).trim();
    titleMatches.push({
      heading,
      pos: match.index,
      endPos: match.index + match[0].length,
    });
  }

  // Extract content between consecutive title paragraphs
  const sections = [];
  for (let i = 0; i < titleMatches.length; i++) {
    const start = titleMatches[i].endPos;
    const end = i + 1 < titleMatches.length
      ? titleMatches[i + 1].pos
      : html.length;
    sections.push({
      heading: titleMatches[i].heading,
      htmlContent: html.substring(start, end),
      index: i,
    });
  }

  return sections;
}

/**
 * Filter sections to only those that are improvement prompts
 * (not explanation/overview tabs).
 *
 * Two-layer filter:
 * 1. Blocklist: skip known non-prompt headings
 * 2. Content check: section body contains prompt-like content
 */
export function filterPromptSections(sections) {
  return sections.filter(section => {
    const normalizedHeading = section.heading.toLowerCase().trim();

    // Layer 1: skip known non-prompt headings
    if (NON_PROMPT_HEADINGS.has(normalizedHeading)) {
      debug(`Skipping non-prompt tab: "${section.heading}"`);
      return false;
    }

    // Layer 2: check for prompt-like content (relaxed — just verify
    // it has substantial text, not just an empty section)
    const plainText = decodeEntities(stripTags(section.htmlContent)).trim();
    if (plainText.length < 100) {
      debug(`Skipping short section: "${section.heading}" (${plainText.length} chars)`);
      return false;
    }

    return true;
  });
}

// ── Name normalization & matching ───────────────────────────────────

/** Normalize a heading or name for fuzzy comparison. */
export function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert a heading to a kebab-case ID suitable for filenames. */
export function headingToId(number, heading) {
  const padded = String(number).padStart(2, '0');
  const kebab = heading
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${padded}-${kebab}`;
}

/**
 * Match parsed prompt sections to existing manifest entries.
 *
 * Returns { matched, added, removed } where:
 * - matched: [{ entry, section, changed }]
 * - added: [{ heading, markdown, suggestedId, suggestedNumber }]
 * - removed: [{ entry }] — exist locally but not in doc
 */
export function matchToManifest(promptSections, manifest) {
  const matched = [];
  const added = [];

  // Build a map of normalized manifest names → entries
  const manifestMap = new Map();
  for (const entry of manifest.steps) {
    manifestMap.set(normalizeName(entry.name), entry);
  }

  // Track which manifest entries were matched
  const matchedManifestIds = new Set();

  for (let i = 0; i < promptSections.length; i++) {
    const section = promptSections[i];
    const normalizedHeading = normalizeName(section.heading);

    // Find matching manifest entry
    let matchedEntry = null;
    for (const [normalizedName, entry] of manifestMap) {
      if (normalizedName === normalizedHeading) {
        matchedEntry = entry;
        break;
      }
    }

    if (matchedEntry) {
      matchedManifestIds.add(matchedEntry.id);
      const markdown = htmlToMarkdown(section.htmlContent);
      const existingPath = path.join(STEPS_DIR, `${matchedEntry.id}.md`);
      let changed = false;
      try {
        const existing = readFileSync(existingPath, 'utf8');
        changed = existing.trim() !== markdown.trim();
      } catch {
        changed = true; // file doesn't exist yet
      }
      matched.push({ entry: matchedEntry, section, markdown, changed });
    } else {
      const markdown = htmlToMarkdown(section.htmlContent);
      const suggestedNumber = i + 1;
      const suggestedId = headingToId(suggestedNumber, section.heading);
      added.push({
        heading: section.heading,
        markdown,
        suggestedId,
        suggestedNumber,
      });
    }
  }

  // Find removed: manifest entries that weren't matched
  const removed = [];
  for (const entry of manifest.steps) {
    if (!matchedManifestIds.has(entry.id)) {
      removed.push({ entry });
    }
  }

  return { matched, added, removed };
}

// ── Hash computation ────────────────────────────────────────────────

/**
 * Compute STEPS_HASH using the same algorithm as executor.js:
 * SHA-256 of all prompt contents joined together.
 */
export function computeStepsHash(promptContents) {
  const content = promptContents.join('');
  return createHash('sha256').update(content).digest('hex');
}

// ── Fetch ───────────────────────────────────────────────────────────

/**
 * Fetch the published Google Doc HTML.
 * Returns { success, html, error }.
 */
export async function fetchDocHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'NightyTidy-Sync/1.0' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { success: false, html: null, error: `HTTP ${response.status} ${response.statusText}` };
    }

    const html = await response.text();
    return { success: true, html, error: null };
  } catch (err) {
    const message = err.name === 'AbortError'
      ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : err.message;
    return { success: false, html: null, error: message };
  }
}

// ── Main sync orchestrator ──────────────────────────────────────────

/**
 * Build a new manifest with correct ordering and IDs.
 *
 * Uses Google Doc ordering as the canonical order. New prompts are
 * inserted at their natural position. Removed prompts are excluded.
 * IDs are renumbered to maintain sequential NN- prefixes.
 */
function buildNewManifest(promptSections, matchResult, oldManifest) {
  const { matched, added } = matchResult;

  // Build ordered entries from doc sections
  const newSteps = [];
  const matchedByHeading = new Map();
  for (const m of matched) {
    matchedByHeading.set(normalizeName(m.section.heading), m);
  }
  const addedByHeading = new Map();
  for (const a of added) {
    addedByHeading.set(normalizeName(a.heading), a);
  }

  let stepNumber = 1;
  for (const section of promptSections) {
    const normalized = normalizeName(section.heading);
    const m = matchedByHeading.get(normalized);
    const a = addedByHeading.get(normalized);

    if (m) {
      // Existing entry — keep name, renumber ID
      const newId = headingToId(stepNumber, m.entry.name);
      newSteps.push({ id: newId, name: m.entry.name, _oldId: m.entry.id });
    } else if (a) {
      // New entry
      const newId = headingToId(stepNumber, a.heading);
      newSteps.push({ id: newId, name: a.heading, _oldId: null });
    }
    stepNumber++;
  }

  return {
    version: oldManifest.version || 1,
    sourceUrl: oldManifest.sourceUrl,
    steps: newSteps.map(({ id, name }) => ({ id, name })),
    _internal: newSteps, // includes _oldId for file rename tracking
  };
}

/**
 * Main sync entry point. Fetches, parses, matches, and optionally writes.
 *
 * options.dryRun — if true, report what would change without writing
 * options.url — override the source URL (defaults to manifest.json sourceUrl)
 */
export async function syncPrompts(options = {}) {
  try {
    const { dryRun = false, url: urlOverride } = options;

    // Load current manifest
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (err) {
      return { success: false, summary: null, error: `Failed to read manifest: ${err.message}` };
    }

    const url = urlOverride || manifest.sourceUrl;
    if (!url) {
      return {
        success: false,
        summary: null,
        error: 'No source URL configured. Add "sourceUrl" to manifest.json or pass --sync-url.',
      };
    }

    // Fetch
    info(`Fetching prompts from: ${url}`);
    const fetchResult = await fetchDocHtml(url);
    if (!fetchResult.success) {
      return { success: false, summary: null, error: `Fetch failed: ${fetchResult.error}` };
    }
    debug(`Fetched ${fetchResult.html.length} bytes`);

    // Parse sections
    const allSections = parseDocSections(fetchResult.html);
    debug(`Parsed ${allSections.length} sections from document`);
    if (allSections.length === 0) {
      return { success: false, summary: null, error: 'No sections found in document — HTML structure may have changed' };
    }

    // Filter to prompts only
    const promptSections = filterPromptSections(allSections);
    info(`Found ${promptSections.length} prompt sections (${allSections.length - promptSections.length} non-prompt tabs filtered)`);
    if (promptSections.length === 0) {
      return { success: false, summary: null, error: 'No prompt sections found — all sections were filtered out' };
    }

    // Match to manifest
    const matchResult = matchToManifest(promptSections, manifest);

    // Safety check: if removing more than 50% of prompts, abort
    const existingCount = manifest.steps.length;
    const removeCount = matchResult.removed.length;
    if (existingCount > 0 && removeCount > existingCount * MAX_REMOVAL_FRACTION) {
      return {
        success: false,
        summary: null,
        error: `Safety check failed: sync would remove ${removeCount} of ${existingCount} prompts (>${MAX_REMOVAL_FRACTION * 100}%). ` +
          'This likely indicates a parsing error. Aborting.',
      };
    }

    // Build summary
    const summary = {
      updated: matchResult.matched.filter(m => m.changed).map(m => ({ id: m.entry.id, name: m.entry.name })),
      added: matchResult.added.map(a => ({ id: a.suggestedId, name: a.heading })),
      removed: matchResult.removed.map(r => ({ id: r.entry.id, name: r.entry.name })),
      unchanged: matchResult.matched.filter(m => !m.changed).map(m => ({ id: m.entry.id, name: m.entry.name })),
      newStepsHash: null,
    };

    info(`Sync result: ${summary.updated.length} updated, ${summary.added.length} added, ${summary.removed.length} removed, ${summary.unchanged.length} unchanged`);

    if (dryRun) {
      return { success: true, summary, error: null };
    }

    // ── Write phase ──

    // Build new manifest with correct ordering
    const newManifestData = buildNewManifest(promptSections, matchResult, { ...manifest, sourceUrl: url });

    // Rename files that need new IDs (to maintain sequential numbering)
    const renames = new Map(); // oldId → newId
    for (const entry of newManifestData._internal) {
      if (entry._oldId && entry._oldId !== entry.id) {
        renames.set(entry._oldId, entry.id);
      }
    }

    // Write updated prompt files
    for (const m of matchResult.matched) {
      const newId = renames.get(m.entry.id) || m.entry.id;
      const filePath = path.join(STEPS_DIR, `${newId}.md`);
      writeFileSync(filePath, m.markdown);
      if (m.changed) {
        info(`Updated: ${newId}.md (${m.entry.name})`);
      }
      // If renamed, delete old file
      if (renames.has(m.entry.id)) {
        const oldPath = path.join(STEPS_DIR, `${m.entry.id}.md`);
        try { unlinkSync(oldPath); } catch { /* may not exist */ }
        debug(`Renamed: ${m.entry.id}.md → ${newId}.md`);
      }
    }

    // Write new prompt files
    for (const a of matchResult.added) {
      // Find the actual new ID from the manifest
      const newEntry = newManifestData._internal.find(
        e => normalizeName(e.name) === normalizeName(a.heading)
      );
      const id = newEntry ? newEntry.id : a.suggestedId;
      const filePath = path.join(STEPS_DIR, `${id}.md`);
      writeFileSync(filePath, a.markdown);
      info(`Added: ${id}.md (${a.heading})`);
    }

    // Delete removed prompt files
    for (const r of matchResult.removed) {
      const filePath = path.join(STEPS_DIR, `${r.entry.id}.md`);
      try {
        unlinkSync(filePath);
        info(`Removed: ${r.entry.id}.md (${r.entry.name})`);
      } catch {
        debug(`Could not delete ${r.entry.id}.md (may already be gone)`);
      }
    }

    // Write updated manifest
    const cleanManifest = {
      version: newManifestData.version,
      sourceUrl: newManifestData.sourceUrl,
      steps: newManifestData.steps,
    };
    writeFileSync(MANIFEST_PATH, JSON.stringify(cleanManifest, null, 2) + '\n');
    info('Updated manifest.json');

    // Update summary IDs to reflect new numbering
    summary.updated = matchResult.matched.filter(m => m.changed).map(m => {
      const newId = renames.get(m.entry.id) || m.entry.id;
      return { id: newId, name: m.entry.name };
    });
    summary.unchanged = matchResult.matched.filter(m => !m.changed).map(m => {
      const newId = renames.get(m.entry.id) || m.entry.id;
      return { id: newId, name: m.entry.name };
    });
    summary.added = matchResult.added.map(a => {
      const newEntry = newManifestData._internal.find(
        e => normalizeName(e.name) === normalizeName(a.heading)
      );
      return { id: newEntry ? newEntry.id : a.suggestedId, name: a.heading };
    });

    // Compute new STEPS_HASH from written files
    const allPromptContents = cleanManifest.steps.map(entry => {
      const filePath = path.join(STEPS_DIR, `${entry.id}.md`);
      return readFileSync(filePath, 'utf8');
    });
    const newHash = computeStepsHash(allPromptContents);
    summary.newStepsHash = newHash;

    // Update STEPS_HASH in executor.js
    try {
      const executorSource = readFileSync(EXECUTOR_PATH, 'utf8');
      const hashRegex = /(const STEPS_HASH = ')[a-f0-9]{64}(';)/;
      if (hashRegex.test(executorSource)) {
        const updatedSource = executorSource.replace(hashRegex, `$1${newHash}$2`);
        writeFileSync(EXECUTOR_PATH, updatedSource);
        info(`Updated STEPS_HASH in executor.js: ${newHash.slice(0, 16)}...`);
      } else {
        warn('Could not find STEPS_HASH pattern in executor.js — update manually');
      }
    } catch (err) {
      warn(`Failed to update executor.js: ${err.message}`);
    }

    return { success: true, summary, error: null };
  } catch (err) {
    warn(`Sync failed unexpectedly: ${err.message}`);
    return { success: false, summary: null, error: err.message };
  }
}
