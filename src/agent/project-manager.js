import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { debug, warn } from '../logger.js';

const PROJECTS_FILE = 'projects.json';
const PROJECTS_VERSION = 1;

export class ProjectManager {
  constructor(configDir) {
    this.configDir = configDir;
    this.filePath = path.join(configDir, PROJECTS_FILE);
    this.projects = this._load();
  }

  listProjects() {
    return [...this.projects];
  }

  getProject(id) {
    const project = this.projects.find(p => p.id === id);
    return project ? { ...project } : null;
  }

  addProject(projectPath, name) {
    const project = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      path: projectPath,
      addedAt: Date.now(),
      lastRunAt: null,
      schedule: null,
      webhooks: [],
    };
    this.projects.push(project);
    this._save();
    debug(`Added project: ${name} at ${projectPath}`);
    return project;
  }

  removeProject(id) {
    this.projects = this.projects.filter(p => p.id !== id);
    this._save();
    debug(`Removed project: ${id}`);
  }

  updateProject(id, updates) {
    // Find directly in array (not via getProject which returns a copy)
    const project = this.projects.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates);
      this._save();
    }
  }

  pruneStaleProjects() {
    const before = this.projects.length;
    this.projects = this.projects.filter(p => {
      if (!fs.existsSync(p.path)) {
        warn(`Pruning stale project: ${p.name} (${p.path})`);
        return false;
      }
      return true;
    });
    if (this.projects.length < before) this._save();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (data.version === PROJECTS_VERSION) return data.projects || [];
      return this._migrate(data);
    } catch {
      return [];
    }
  }

  _save() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify({
      version: PROJECTS_VERSION,
      projects: this.projects,
    }, null, 2));
  }

  _migrate(data) {
    return data.projects || [];
  }
}
