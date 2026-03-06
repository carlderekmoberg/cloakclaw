#!/usr/bin/env node
/**
 * CloakClaw skill wrapper — cloak a document or text.
 * Usage: node cloak.js --profile <profile> --input <file_or_text> [--no-llm]
 * Output: JSON with sessionId, cloaked text, entityCount, mappings
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', 'app');

// Dynamic import from the app
const { Cloaker } = await import(resolve(APP_ROOT, 'src', 'cloaker.js'));
const { extractText } = await import(resolve(APP_ROOT, 'src', 'extract.js'));
const { MappingStore } = await import(resolve(APP_ROOT, 'src', 'store', 'sqlite.js'));

// Parse args
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const profile = getArg('profile') || 'email';
const input = getArg('input');
const noLlm = hasFlag('no-llm');

if (!input) {
  console.error('Usage: node cloak.js --profile <legal|financial|email> --input <file_or_text>');
  process.exit(1);
}

// Auto-detect profile from content
function detectProfile(text) {
  const sample = text.slice(0, 500).toLowerCase();
  const legalWords = ['agreement', 'contract', 'whereas', 'hereby', 'party', 'witness', 'jurisdiction', 'resolved'];
  const finWords = ['revenue', 'profit', 'balance', 'quarterly', 'fiscal', 'earnings', 'p&l', 'ebitda', 'payroll'];
  const emailWords = ['from:', 'to:', 'subject:', 'cc:', 'regards', 'sincerely', 'best regards'];

  const legalScore = legalWords.filter(w => sample.includes(w)).length;
  const finScore = finWords.filter(w => sample.includes(w)).length;
  const emailScore = emailWords.filter(w => sample.includes(w)).length;

  if (legalScore >= 2) return 'legal';
  if (finScore >= 2) return 'financial';
  if (emailScore >= 2) return 'email';
  return profile; // fallback to provided profile
}

try {
  let text;

  // Check if input is a file path or raw text
  try {
    const buf = readFileSync(input);
    text = await extractText(buf, input);
  } catch {
    // Not a file — treat as raw text
    text = input;
  }

  const detectedProfile = detectProfile(text);

  const cloaker = new Cloaker({
    interactive: false,
    useLlm: !noLlm,
  });

  const result = await cloaker.cloak(text, detectedProfile);

  // Get mappings
  const store = new MappingStore();
  const mappings = store.getMappings(result.sessionId);
  store.close();
  cloaker.close();

  // Output JSON
  const output = {
    sessionId: result.sessionId,
    profile: detectedProfile,
    cloaked: result.cloaked,
    entityCount: mappings.length,
    originalLength: text.length,
    cloakedLength: result.cloaked.length,
    mappings: mappings.map(m => ({
      original: m.original,
      replacement: m.replacement,
      type: m.entity_type,
    })),
  };

  console.log(JSON.stringify(output));
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
