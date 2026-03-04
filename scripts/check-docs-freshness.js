#!/usr/bin/env node

/**
 * Documentation freshness checker.
 *
 * Catches drift between code and documentation by verifying key counts
 * and file references in CLAUDE.md / memory files match reality.
 *
 * Run: node scripts/check-docs-freshness.js
 * Exit 0 = all checks pass, Exit 1 = drift detected.
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEMORY_DIR = path.join(ROOT, '.claude', 'memory');

let failures = 0;

function check(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    failures++;
  } else {
    console.log(`  OK: ${label} (${actual})`);
  }
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

// ── 1. Test file count ──────────────────────────────────────────────────────

const testFiles = readdirSync(path.join(ROOT, 'test'))
  .filter((f) => f.endsWith('.test.js'));

const testingMd = readText(path.join(MEMORY_DIR, 'testing.md'));
const testFileCountMatch = testingMd.match(/(\d+) tests, (\d+) files/);
const documentedFileCount = testFileCountMatch
  ? parseInt(testFileCountMatch[2], 10)
  : -1;

console.log('\n── Test file count ──');
check('test file count in testing.md', documentedFileCount, testFiles.length);

// ── 2. Source file count in module map ───────────────────────────────────────

const srcFiles = readdirSync(path.join(ROOT, 'src'))
  .filter((f) => f.endsWith('.js'));
const promptFiles = readdirSync(path.join(ROOT, 'src', 'prompts'))
  .filter((f) => f.endsWith('.js'));
const totalSrcFiles = srcFiles.length + promptFiles.length;

const claudeMd = readText(path.join(ROOT, 'CLAUDE.md'));
const moduleMapRows = claudeMd
  .split('\n')
  .filter((line) => line.startsWith('| `src/') || line.startsWith('| `bin/'));

console.log('\n── Module map coverage ──');
check(
  'source files documented in CLAUDE.md module map',
  moduleMapRows.length - 1, // subtract bin/nightytidy.js
  totalSrcFiles,
);

// ── 3. Memory file index matches actual files ────────────────────────────────

const memoryFiles = readdirSync(MEMORY_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');

const memoryMd = readText(path.join(MEMORY_DIR, 'MEMORY.md'));
const indexedFiles = memoryMd
  .split('\n')
  .filter((line) => /^\| `[a-z-]+\.md`/.test(line))
  .map((line) => line.match(/`([a-z-]+\.md)`/)?.[1])
  .filter(Boolean);

console.log('\n── Memory file index ──');
check('memory files on disk', memoryFiles.length, indexedFiles.length);

for (const f of memoryFiles) {
  if (!indexedFiles.includes(f)) {
    console.error(`FAIL: ${f} exists on disk but not in MEMORY.md index`);
    failures++;
  }
}
for (const f of indexedFiles) {
  if (!memoryFiles.includes(f)) {
    console.error(`FAIL: ${f} indexed in MEMORY.md but missing from disk`);
    failures++;
  }
}

// ── 4. Sub-memory table in CLAUDE.md matches MEMORY.md ──────────────────────

const claudeIndexedFiles = claudeMd
  .split('\n')
  .filter((line) => /^\| `[a-z-]+\.md`/.test(line))
  .map((line) => line.match(/`([a-z-]+\.md)`/)?.[1])
  .filter(Boolean);

console.log('\n── CLAUDE.md sub-memory table ──');
check(
  'sub-memory entries in CLAUDE.md',
  claudeIndexedFiles.length,
  indexedFiles.length,
);

// ── 5. Step count in prompts.md ──────────────────────────────────────────────

const { STEPS } = await import(
  'file://' + path.join(ROOT, 'src', 'prompts', 'steps.js').replace(/\\/g, '/')
);
const promptsMd = readText(path.join(MEMORY_DIR, 'prompts.md'));
const promptCountMatch = promptsMd.match(/Exactly (\d+) entries/);
const documentedStepCount = promptCountMatch
  ? parseInt(promptCountMatch[1], 10)
  : -1;

console.log('\n── Step count ──');
check('step count in prompts.md', documentedStepCount, STEPS.length);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? '✅ All checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
