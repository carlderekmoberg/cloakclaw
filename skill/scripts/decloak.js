#!/usr/bin/env node
/**
 * CloakClaw skill wrapper — decloak an LLM response.
 * Usage: node decloak.js --session <sessionId> --input <file_or_text>
 * Output: JSON with decloaked text and restore count
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', 'app');

const { Decloaker } = await import(resolve(APP_ROOT, 'src', 'decloaker.js'));

// Parse args
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const sessionId = getArg('session');
const input = getArg('input');

if (!sessionId || !input) {
  console.error('Usage: node decloak.js --session <sessionId> --input <file_or_text>');
  process.exit(1);
}

try {
  let text;
  try {
    text = readFileSync(input, 'utf-8');
  } catch {
    text = input;
  }

  const decloaker = new Decloaker();
  const result = decloaker.decloak(text, sessionId);
  decloaker.close();

  console.log(JSON.stringify({
    decloaked: result.decloaked,
    restoredCount: result.restoredCount,
  }));
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
