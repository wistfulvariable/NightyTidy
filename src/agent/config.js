import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { debug } from '../logger.js';

export const CONFIG_VERSION = 1;
const CONFIG_FILE = 'config.json';

export function getConfigDir() {
  return path.join(os.homedir(), '.nightytidy');
}

export function ensureConfigDir(configDir) {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    debug(`Created config directory: ${configDir}`);
  }
}

export function readConfig(configDir) {
  const filePath = path.join(configDir, CONFIG_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data.version === CONFIG_VERSION) return data;
    debug(`Config version mismatch: ${data.version} → ${CONFIG_VERSION}, migrating`);
    return migrateConfig(data);
  } catch {
    return createDefaultConfig();
  }
}

export function writeConfig(configDir, config) {
  ensureConfigDir(configDir);
  const filePath = path.join(configDir, CONFIG_FILE);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

function createDefaultConfig() {
  return {
    version: CONFIG_VERSION,
    port: 48372,
    token: crypto.randomBytes(24).toString('hex'),
    machine: os.hostname(),
  };
}

function migrateConfig(data) {
  // Future migrations go here
  return { ...createDefaultConfig(), ...data, version: CONFIG_VERSION };
}
