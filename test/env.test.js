import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLoggerMock } from './helpers/mocks.js';

vi.mock('../src/logger.js', () => createLoggerMock());

const originalEnv = { ...process.env };

describe('cleanEnv', () => {
  let cleanEnv;
  let debug;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/env.js');
    cleanEnv = mod.cleanEnv;
    const logger = await import('../src/logger.js');
    debug = logger.debug;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes through PATH', () => {
    process.env.PATH = '/usr/bin';
    const env = cleanEnv();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('passes through HOME and USERPROFILE', () => {
    process.env.HOME = '/home/user';
    process.env.USERPROFILE = 'C:\\Users\\user';
    const env = cleanEnv();
    expect(env.HOME).toBe('/home/user');
    expect(env.USERPROFILE).toBe('C:\\Users\\user');
  });

  it('passes through TEMP/TMP/TMPDIR', () => {
    process.env.TEMP = '/tmp';
    process.env.TMP = '/tmp';
    process.env.TMPDIR = '/tmp';
    const env = cleanEnv();
    expect(env.TEMP).toBe('/tmp');
    expect(env.TMP).toBe('/tmp');
    expect(env.TMPDIR).toBe('/tmp');
  });

  it('passes through ANTHROPIC_ prefixed vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
    const env = cleanEnv();
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('passes through CLAUDE_ prefixed vars', () => {
    process.env.CLAUDE_CONFIG = '/path/to/config';
    const env = cleanEnv();
    expect(env.CLAUDE_CONFIG).toBe('/path/to/config');
  });

  it('blocks CLAUDECODE even though CLAUDE_ prefix matches', () => {
    process.env.CLAUDECODE = '1';
    const env = cleanEnv();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it('passes through GIT_ prefixed vars', () => {
    process.env.GIT_AUTHOR_NAME = 'Test';
    process.env.GIT_SSH_COMMAND = 'ssh -i /key';
    const env = cleanEnv();
    expect(env.GIT_AUTHOR_NAME).toBe('Test');
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i /key');
  });

  it('passes through LC_ prefixed vars', () => {
    process.env.LC_ALL = 'en_US.UTF-8';
    const env = cleanEnv();
    expect(env.LC_ALL).toBe('en_US.UTF-8');
  });

  it('passes through XDG_ prefixed vars', () => {
    process.env.XDG_CONFIG_HOME = '/home/user/.config';
    const env = cleanEnv();
    expect(env.XDG_CONFIG_HOME).toBe('/home/user/.config');
  });

  it('passes through Windows system vars', () => {
    process.env.SYSTEMROOT = 'C:\\Windows';
    process.env.COMSPEC = 'C:\\Windows\\system32\\cmd.exe';
    process.env.APPDATA = 'C:\\Users\\user\\AppData\\Roaming';
    const env = cleanEnv();
    expect(env.SYSTEMROOT).toBe('C:\\Windows');
    expect(env.COMSPEC).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(env.APPDATA).toBe('C:\\Users\\user\\AppData\\Roaming');
  });

  it('passes through NIGHTYTIDY_LOG_LEVEL', () => {
    process.env.NIGHTYTIDY_LOG_LEVEL = 'debug';
    const env = cleanEnv();
    expect(env.NIGHTYTIDY_LOG_LEVEL).toBe('debug');
  });

  it('filters unknown env vars', () => {
    process.env.MY_SECRET_TOKEN = 'secret123';
    process.env.DATABASE_URL = 'postgres://..';
    const env = cleanEnv();
    expect(env.MY_SECRET_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('logs filtered var names via debug', () => {
    // Clear everything except one unknown var
    const saved = process.env;
    process.env = { UNKNOWN_VAR: 'value' };
    const env = cleanEnv();
    expect(env.UNKNOWN_VAR).toBeUndefined();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_VAR'));
    process.env = saved;
  });

  it('handles case-insensitive matching for allowed vars', () => {
    // Some platforms may have lowercase PATH (rare but possible)
    process.env.path = '/usr/bin';
    const env = cleanEnv();
    expect(env.path).toBe('/usr/bin');
  });

  it('returns clean object without prototype pollution', () => {
    const env = cleanEnv();
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(env.constructor).toBe(Object);
  });
});
