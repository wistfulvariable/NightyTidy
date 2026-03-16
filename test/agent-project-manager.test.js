import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from '../src/agent/project-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  initLogger: vi.fn(),
}));

describe('ProjectManager', () => {
  let tmpDir, pm;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pm-'));
    pm = new ProjectManager(tmpDir);
  });

  afterEach(async () => {
    await robustCleanup(tmpDir);
  });

  it('starts with empty project list', () => {
    expect(pm.listProjects()).toEqual([]);
  });

  it('adds a project', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    expect(project.id).toBeDefined();
    expect(project.name).toBe('TestProject');
    expect(project.path).toBe(tmpDir);
    expect(pm.listProjects()).toHaveLength(1);
  });

  it('removes a project', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    pm.removeProject(project.id);
    expect(pm.listProjects()).toEqual([]);
  });

  it('persists projects across instances', () => {
    pm.addProject(tmpDir, 'TestProject');
    const pm2 = new ProjectManager(tmpDir);
    expect(pm2.listProjects()).toHaveLength(1);
  });

  it('generates unique IDs', () => {
    const p1 = pm.addProject(tmpDir, 'A');
    const p2 = pm.addProject(path.join(tmpDir, '..'), 'B');
    expect(p1.id).not.toBe(p2.id);
  });

  it('gets project by ID', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    const found = pm.getProject(project.id);
    expect(found.name).toBe('TestProject');
  });

  it('returns null for unknown project ID', () => {
    expect(pm.getProject('nonexistent')).toBeNull();
  });

  it('updates project fields', () => {
    const project = pm.addProject(tmpDir, 'TestProject');
    pm.updateProject(project.id, { lastRunAt: Date.now() });
    const found = pm.getProject(project.id);
    expect(found.lastRunAt).toBeDefined();
  });

  it('prunes projects with non-existent paths', () => {
    pm.addProject('/nonexistent/path/12345', 'Ghost');
    pm.pruneStaleProjects();
    expect(pm.listProjects()).toEqual([]);
  });
});
