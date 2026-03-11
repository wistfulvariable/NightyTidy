/**
 * @fileoverview Report generation and CLAUDE.md auto-update.
 *
 * Generates NIGHTYTIDY-REPORT.md with run summary, step results, inline
 * action plan, and undo instructions. Also updates the target project's
 * CLAUDE.md with a "Last Run" section.
 *
 * Error contract: Warns but NEVER throws. Report failure must not crash a run.
 */

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { info, warn } from './logger.js';

const REPORT_PREFIX = 'NIGHTYTIDY-REPORT';

/**
 * Build a unique, numbered + timestamped filename for the report.
 * Scans the project directory for existing reports to auto-increment the number.
 * @param {string} projectDir - Target project directory
 * @param {number} [startTime] - Run start time (ms epoch); defaults to now
 * @returns {{ reportFile: string }}
 */
export function buildReportNames(projectDir, startTime = Date.now()) {
  const d = new Date(startTime);
  const pad2 = n => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;

  // Find next available number by scanning existing report files
  let maxNum = 0;
  try {
    const files = readdirSync(projectDir);
    const pattern = /^NIGHTYTIDY-REPORT_(\d+)_/;
    for (const f of files) {
      const m = f.match(pattern);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
  } catch { /* directory unreadable — start at 1 */ }

  const num = pad2(maxNum + 1);
  const suffix = `_${num}_${timestamp}`;

  return {
    reportFile: `${REPORT_PREFIX}${suffix}.md`,
  };
}

/**
 * @typedef {import('./executor.js').ExecutionResults} ExecutionResults
 * @typedef {import('./executor.js').StepResult} StepResult
 */

/**
 * @typedef {Object} ReportMetadata
 * @property {string} projectDir - Target project directory
 * @property {string} branchName - Run branch name
 * @property {string} tagName - Safety tag name
 * @property {string} originalBranch - Original branch name
 * @property {number} startTime - Run start timestamp (ms)
 * @property {number} endTime - Run end timestamp (ms)
 * @property {number|null} [totalCostUSD] - Total cost in USD
 * @property {number|null} [totalInputTokens] - Total input tokens (including cache)
 * @property {number|null} [totalOutputTokens] - Total output tokens
 */

/**
 * @typedef {Object} ReportOptions
 * @property {string|null} [actionPlanText] - Inline action plan markdown (headings already downgraded)
 * @property {string} [reportFile] - Custom report filename
 */

/** @type {string|undefined} */
let cachedVersion;

/**
 * Get the NightyTidy version from package.json.
 *
 * @returns {string} Version string (e.g., "0.1.0")
 */
export function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    cachedVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    cachedVersion = '0.1.0';
  }
  return cachedVersion;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 15m", "45m 12s")
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0m 00s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Format a timestamp to YYYY-MM-DD date string.
 *
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Date string (e.g., "2025-01-15")
 */
function formatDate(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0];
}

/** Phrases that indicate the output is a generic Claude greeting, not a changelog. */
const JUNK_MARKERS = [
  'what would you like',
  'let me know what you need',
  'i can help with',
  'how can i help',
  'what can i help',
];

/**
 * Strip conversational preamble that Claude sometimes adds despite instructions.
 * Returns null if the entire text appears to be a generic Claude greeting rather
 * than actual changelog content (detected via JUNK_MARKERS).
 *
 * @param {string|null} text - Raw narration text
 * @returns {string|null} Cleaned text, or null if input was null/junk
 */
export function cleanNarration(text) {
  if (!text) return text;
  let cleaned = text.trim();
  // Strip common conversational openers that end with a period or exclamation
  const preamblePattern = /^(?:I understand|I'm ready|I'll help|I can see|I can|I see|Sure|Here is|Here's|Based on|Certainly|Of course|Absolutely|Great|Let me)[^.!]*[.!]\s*/i;
  // May need multiple passes (e.g. "I understand. I'm ready to help.")
  for (let i = 0; i < 3; i++) {
    const before = cleaned;
    cleaned = cleaned.replace(preamblePattern, '');
    if (cleaned === before) break;
  }
  cleaned = cleaned.trim() || text.trim();

  // Reject entire output if it looks like a generic Claude greeting
  const lower = cleaned.toLowerCase();
  if (JUNK_MARKERS.some(marker => lower.includes(marker))) return null;

  return cleaned;
}

/**
 * Generate fallback narration when changelog generation fails.
 *
 * @param {ExecutionResults} results - Execution results
 * @returns {string} Fallback narration text
 */
function fallbackNarration(results) {
  return (
    `NightyTidy ran ${results.completedCount + results.failedCount} improvement steps on your codebase. ` +
    `${results.completedCount} steps completed successfully. ` +
    `See the step results below for details on what changed. A detailed changelog could not ` +
    `be generated \u2014 this typically happens when Claude Code is under heavy load. ` +
    `Try re-running the changelog step individually if needed.`
  );
}

/**
 * Format a cost in USD for display (rounded to nearest cent).
 *
 * @param {number|null|undefined} costUSD - Cost in USD
 * @returns {string|null} Formatted cost (e.g., "$14.02"), or null if no cost
 */
function formatCost(costUSD) {
  if (costUSD == null) return null;
  return `$${costUSD.toFixed(2)}`;
}

/**
 * Format a token count for human-readable display.
 * >=1M → "1.2M", >=1000 → "45k", else raw number with commas.
 *
 * @param {number|null|undefined} tokens - Token count
 * @returns {string|null} Formatted token count, or null if no data
 */
function formatTokens(tokens) {
  if (tokens == null || !Number.isFinite(tokens) || tokens === 0) return null;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m >= 10 ? `${Math.round(m).toLocaleString('en-US')}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000).toLocaleString('en-US')}k`;
  return tokens.toLocaleString('en-US');
}

/**
 * Build the run summary section of the report.
 *
 * @param {ExecutionResults} results - Execution results
 * @param {ReportMetadata} metadata - Report metadata
 * @returns {string} Markdown section
 */
function buildSummarySection(results, metadata) {
  const date = formatDate(metadata.startTime);
  const duration = formatDuration(metadata.endTime - metadata.startTime);
  const total = results.completedCount + results.failedCount;

  let section =
    `## Run Summary\n\n` +
    `- **Date**: ${date}\n` +
    `- **Duration**: ${duration}\n` +
    `- **Steps completed**: ${results.completedCount}/${total}\n` +
    `- **Steps failed**: ${results.failedCount}\n` +
    `- **Branch**: ${metadata.branchName}\n` +
    `- **Safety tag**: ${metadata.tagName}\n`;

  if (metadata.totalCostUSD != null) {
    section += `- **Total cost**: ${formatCost(metadata.totalCostUSD)}\n`;
  }

  const fmtIn = formatTokens(metadata.totalInputTokens);
  const fmtOut = formatTokens(metadata.totalOutputTokens);
  if (fmtIn || fmtOut) {
    section += `- **Total tokens**: ${fmtIn || '0'} input / ${fmtOut || '0'} output\n`;
  }

  return section + '\n';
}

/**
 * Build the step results table for the report.
 *
 * @param {ExecutionResults} results - Execution results
 * @returns {string} Markdown table section
 */
function buildStepTable(results) {
  const hasCost = results.results.some(r => r.cost?.costUSD != null);

  // Define columns dynamically based on data
  const baseColumns = ['#', 'Step', 'Status', 'Duration', 'Attempts'];
  const columns = hasCost ? [...baseColumns, 'Cost'] : baseColumns;

  // Build header row and separator
  const headerRow = `| ${columns.join(' | ')} |`;
  const separator = `|${columns.map(() => '---').join('|')}|`;

  // Build data rows
  const rows = results.results.map(r => {
    const status = r.status === 'completed' ? '\u2705 Completed' : '\u274C Failed';
    const duration = formatDuration(r.duration);
    const baseCells = [r.step.number, r.step.name, status, duration, r.attempts];
    const cells = hasCost ? [...baseCells, formatCost(r.cost?.costUSD) || '\u2014'] : baseCells;
    return `| ${cells.join(' | ')} |`;
  });

  return `## Step Results\n\n${headerRow}\n${separator}\n${rows.join('\n')}\n\n`;
}

/**
 * Build the failed steps section of the report.
 *
 * @param {ExecutionResults} results - Execution results
 * @returns {string} Markdown section with failure details
 */
function buildFailedSection(results) {
  let section = `## Failed Steps\n\n`;

  for (const r of results.results) {
    if (r.status !== 'failed') continue;
    section += `### Step ${r.step.number}: ${r.step.name}\n`;
    section += `- **Error**: ${r.error || 'No error details available'}\n`;
    section += `- **Attempts**: ${r.attempts} (1 initial + ${r.attempts - 1} retries)\n`;
    section += `- **Suggestion**: Try running this step individually later with \`nightytidy\` and selecting only this step.\n\n`;
  }

  return section;
}

/**
 * Build the undo instructions section.
 *
 * @param {ReportMetadata} metadata - Report metadata
 * @returns {string} Markdown section with undo instructions
 */
function buildUndoSection(metadata) {
  return (
    `## How to Undo This Run\n\n` +
    `If you need to reverse all changes from this run, ask Claude Code:\n\n` +
    `> "Reset my project to the git tag \`${metadata.tagName}\`"\n\n` +
    `Or run this git command:\n\n` +
    `\`\`\`\n` +
    `git reset --hard ${metadata.tagName}\n` +
    `\`\`\`\n\n` +
    `The NightyTidy branch \`${metadata.branchName}\` is preserved and can be deleted manually when no longer needed.\n\n` +
    `---\n*Generated by NightyTidy v${getVersion()}*\n`
  );
}

/**
 * Generate the complete NIGHTYTIDY-REPORT.md file.
 *
 * Writes the report file and updates CLAUDE.md with run information.
 * Error contract: Warns but NEVER throws.
 *
 * @param {ExecutionResults} results - Execution results
 * @param {string|null} narration - AI-generated changelog, or null for fallback
 * @param {ReportMetadata} metadata - Report metadata
 * @param {ReportOptions} [options] - Report options
 * @returns {string} The report filename (basename only, e.g. 'NIGHTYTIDY-REPORT_01_2026-03-10-1448.md')
 */
export function generateReport(results, narration, metadata, { actionPlanText, reportFile } = {}) {
  const date = formatDate(metadata.startTime);

  let report = `# NightyTidy Report \u2014 ${date}\n\n`;

  const cleanedNarration = cleanNarration(narration);
  if (cleanedNarration) {
    report += `${cleanedNarration}\n\n---\n\n`;
  } else {
    report += `${fallbackNarration(results)}\n\n---\n\n`;
  }

  report += buildSummarySection(results, metadata);
  report += buildStepTable(results);

  if (results.failedCount > 0) {
    report += buildFailedSection(results);
  }

  if (actionPlanText) {
    report += `${actionPlanText}\n\n`;
  }

  report += buildUndoSection(metadata);

  const filename = reportFile || 'NIGHTYTIDY-REPORT.md';
  const reportPath = path.join(metadata.projectDir, filename);
  writeFileSync(reportPath, report, 'utf8');
  info(`Report written to ${reportPath}`);

  // Update CLAUDE.md
  updateClaudeMd(metadata);

  return filename;
}

/**
 * Update or append a markdown section in content.
 * Replaces existing section (from marker to next ## or EOF) or appends if not found.
 *
 * @param {string} content - Existing file content
 * @param {string} marker - Section marker to find (e.g., "## NightyTidy")
 * @param {string} newSection - New section content
 * @returns {string} Updated content
 */
function updateOrAppendSection(content, marker, newSection) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return content + newSection;
  }

  const nextSectionIndex = content.indexOf('\n## ', markerIndex + marker.length);
  const beforeSection = content.slice(0, markerIndex);
  const afterSection = nextSectionIndex !== -1 ? content.slice(nextSectionIndex) : '';

  return beforeSection + newSection.trim() + '\n' + afterSection;
}

/**
 * Update the target project's CLAUDE.md with run information.
 * Creates the file if it doesn't exist.
 *
 * @param {ReportMetadata} metadata - Report metadata
 * @returns {void}
 */
function updateClaudeMd(metadata) {
  const claudePath = path.join(metadata.projectDir, 'CLAUDE.md');
  const date = formatDate(metadata.startTime);
  const section =
    `\n## NightyTidy \u2014 Last Run\n\n` +
    `Last run: ${date}. To undo, reset to git tag \`${metadata.tagName}\`.\n`;

  try {
    if (existsSync(claudePath)) {
      const content = readFileSync(claudePath, 'utf8');
      const updated = updateOrAppendSection(content, '## NightyTidy', section);
      writeFileSync(claudePath, updated, 'utf8');
    } else {
      writeFileSync(claudePath, section.trim() + '\n', 'utf8');
    }
    info('CLAUDE.md updated with NightyTidy run info');
  } catch (err) {
    warn(`Failed to update CLAUDE.md: ${err.message}`);
  }
}
