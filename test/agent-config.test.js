import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readConfig, writeConfig, getConfigDir, CONFIG_VERSION } from '../src/agent/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('agent config', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-config-'));
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('returns default config when file does not exist', () => {
    const config = readConfig(tmpDir);
    expect(config.version).toBe(CONFIG_VERSION);
    expect(config.port).toBe(48372);
    expect(config.token).toBeDefined();
    expect(typeof config.token).toBe('string');
    expect(config.token.length).toBeGreaterThan(0);
  });

  it('writes and reads config', () => {
    const config = { version: CONFIG_VERSION, port: 48372, token: 'abc123', machine: 'test' };
    writeConfig(tmpDir, config);
    const read = readConfig(tmpDir);
    expect(read).toEqual(config);
  });

  it('includes version field', () => {
    expect(CONFIG_VERSION).toBe(1);
  });

  it('getConfigDir returns ~/.nightytidy path', () => {
    const dir = getConfigDir();
    expect(dir).toContain('.nightytidy');
  });
});
