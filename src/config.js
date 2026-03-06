import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';

const CONFIG_DIR = join(homedir(), '.cloakclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

const DEFAULTS = {
  ollama: {
    url: 'http://localhost:11434',
    model: 'qwen2.5:7b',
  },
  profiles: {},
};

export function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getConfig() {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = YAML.parse(raw) || {};
    return { ...DEFAULTS, ...parsed, ollama: { ...DEFAULTS.ollama, ...parsed.ollama } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setConfig(key, value) {
  const config = getConfig();
  const parts = key.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, YAML.stringify(config), 'utf-8');
  return config;
}

export function getConfigValue(key) {
  const config = getConfig();
  const parts = key.split('.');
  let obj = config;
  for (const part of parts) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[part];
  }
  return obj;
}

export { CONFIG_DIR, CONFIG_FILE };
