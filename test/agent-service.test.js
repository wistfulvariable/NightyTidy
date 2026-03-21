// test/agent-service.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Mock child_process
const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args) => mockExecSync(...args),
}));

// Mock fs
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockExistsSync = vi.fn();
const mockCopyFileSync = vi.fn();
vi.mock('node:fs', () => ({
  default: {
    writeFileSync: (...args) => mockWriteFileSync(...args),
    mkdirSync: (...args) => mockMkdirSync(...args),
    unlinkSync: (...args) => mockUnlinkSync(...args),
    existsSync: (...args) => mockExistsSync(...args),
    copyFileSync: (...args) => mockCopyFileSync(...args),
  },
}));

describe('agent service', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockUnlinkSync.mockReset();
    mockExistsSync.mockReset();
    mockCopyFileSync.mockReset();
  });

  describe('getAgentStartCommand()', () => {
    it('returns a string containing "nightytidy"', async () => {
      const { getAgentStartCommand } = await import('../src/agent/service.js');
      const cmd = getAgentStartCommand();
      expect(typeof cmd).toBe('string');
      expect(cmd).toContain('nightytidy');
    });

    it('returns a string containing "agent"', async () => {
      const { getAgentStartCommand } = await import('../src/agent/service.js');
      const cmd = getAgentStartCommand();
      expect(cmd).toContain('agent');
    });

    it('includes process.execPath', async () => {
      const { getAgentStartCommand } = await import('../src/agent/service.js');
      const cmd = getAgentStartCommand();
      expect(cmd).toContain(process.execPath);
    });
  });

  describe('registerService()', () => {
    it('returns { success: true } when execSync succeeds (win32)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      mockExecSync.mockReturnValue('');

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: true } when file write + execSync succeeds (darwin)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      mockMkdirSync.mockReturnValue(undefined);
      mockWriteFileSync.mockReturnValue(undefined);
      mockExecSync.mockReturnValue('');

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: true } when file write + execSync succeeds (linux)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      mockMkdirSync.mockReturnValue(undefined);
      mockWriteFileSync.mockReturnValue(undefined);
      mockExecSync.mockReturnValue('');

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('succeeds via Startup .cmd copy when PowerShell schtasks fails (win32)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      // .cmd launcher write succeeds, PowerShell fails, .cmd copy to Startup succeeds
      mockMkdirSync.mockReturnValue(undefined);
      mockWriteFileSync.mockReturnValue(undefined);
      mockExecSync.mockImplementation(() => { throw new Error('Access denied'); });
      mockCopyFileSync.mockReturnValue(undefined);
      mockExistsSync.mockReturnValue(false); // no stale VBS to clean up

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result).toEqual({ success: true });
      // Should have written the .cmd launcher to ~/.nightytidy/
      expect(mockWriteFileSync).toHaveBeenCalled();
      const launcherPath = mockWriteFileSync.mock.calls[0][0];
      expect(launcherPath).toContain('start-agent.cmd');
      // Should have copied .cmd to Startup folder
      expect(mockCopyFileSync).toHaveBeenCalled();
      const copyDest = mockCopyFileSync.mock.calls[0][1];
      expect(copyDest).toContain('Startup');
      expect(copyDest).toContain('.cmd');
      platformSpy.mockRestore();
    });

    it('returns { success: false } when both Startup folder and schtasks fail (win32)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      mockWriteFileSync.mockImplementation(() => { throw new Error('Startup folder failed'); });
      mockExecSync.mockImplementation(() => { throw new Error('Access denied'); });

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result.success).toBe(false);
      expect(typeof result.fallbackInstructions).toBe('string');
      platformSpy.mockRestore();
    });

    it('returns { success: false, error, fallbackInstructions } when writeFileSync throws (darwin)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      mockMkdirSync.mockReturnValue(undefined);
      mockWriteFileSync.mockImplementation(() => { throw new Error('Permission denied'); });

      const { registerService } = await import('../src/agent/service.js');
      const result = registerService();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(typeof result.fallbackInstructions).toBe('string');
      platformSpy.mockRestore();
    });
  });

  describe('unregisterService()', () => {
    it('returns { success: true } on successful removal (win32)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      mockExecSync.mockReturnValue('');

      const { unregisterService } = await import('../src/agent/service.js');
      const result = unregisterService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: true } on successful removal (darwin) when plist exists', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue('');
      mockUnlinkSync.mockReturnValue(undefined);

      const { unregisterService } = await import('../src/agent/service.js');
      const result = unregisterService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: true } on successful removal (linux) when service file exists', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      mockExecSync.mockReturnValue('');
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockReturnValue(undefined);

      const { unregisterService } = await import('../src/agent/service.js');
      const result = unregisterService();

      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: true } even when schtasks fails (win32) — silently ignores', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      mockExistsSync.mockReturnValue(false); // no .vbs file
      mockExecSync.mockImplementation(() => { throw new Error('Task not found'); });

      const { unregisterService } = await import('../src/agent/service.js');
      const result = unregisterService();

      // Windows unregister silently ignores errors (may not have been registered)
      expect(result).toEqual({ success: true });
      platformSpy.mockRestore();
    });

    it('returns { success: false, error } when execSync throws (linux)', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      mockExecSync.mockImplementation(() => { throw new Error('Unit not found'); });

      const { unregisterService } = await import('../src/agent/service.js');
      const result = unregisterService();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unit not found');
      platformSpy.mockRestore();
    });
  });
});
