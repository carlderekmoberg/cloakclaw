#!/usr/bin/env node
/**
 * CloakClaw test suite — basic smoke tests.
 * Run: node test/test.js
 */
import { Cloaker } from '../src/cloaker.js';
import { Decloaker } from '../src/decloaker.js';
import { MappingStore } from '../src/store/sqlite.js';
import { encrypt, decrypt } from '../src/store/crypto.js';
import { extractText } from '../src/extract.js';
import chalk from 'chalk';

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(chalk.green(`  ✓ ${name}`)); passed++; }
  catch (e) { console.log(chalk.red(`  ✗ ${name}`)); console.log(chalk.dim(`    ${e.message}`)); failed++; }
}

async function asyncTest(name, fn) {
  try { await fn(); console.log(chalk.green(`  ✓ ${name}`)); passed++; }
  catch (e) { console.log(chalk.red(`  ✗ ${name}`)); console.log(chalk.dim(`    ${e.message}`)); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

function getMappingTypes(sessionId) {
  const store = new MappingStore();
  const mappings = store.getMappings(sessionId);
  store.close();
  return mappings;
}

// Suppress cloaker console output
const origWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = () => true;

console.log(chalk.cyan.bold('\n  🦀 CloakClaw Tests\n'));

// ── Encryption ──
console.log(chalk.bold('  Encryption'));

test('encrypt/decrypt round-trip', () => {
  const original = 'Carl Moberg SSN 487-23-9156';
  const enc = encrypt(original);
  assert(enc.startsWith('enc:'), 'Should start with enc:');
  assert(enc !== original, 'Should not be plaintext');
  assert(decrypt(enc) === original, 'Should decrypt to original');
});

test('decrypt unencrypted passthrough', () => {
  assert(decrypt('plain text') === 'plain text');
});

test('encrypt empty/null', () => {
  assert(encrypt('') === '');
  assert(encrypt(null) === null);
});

// ── Regex Entity Detection ──
console.log(chalk.bold('\n  Regex Detection'));

await asyncTest('detects SSN', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('SSN: 487-23-9156', 'general');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'ssn'), 'Should detect SSN');
  c.close();
});

await asyncTest('detects email', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Email: carl@streakwave.com', 'general');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'email'), 'Should detect email');
  c.close();
});

await asyncTest('detects phone', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Call (408) 463-8774 today', 'general');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'phone'), 'Should detect phone');
  c.close();
});

await asyncTest('detects dollar amounts', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Revenue was $2,500,000 last quarter', 'financial');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'dollar'), 'Should detect dollars');
  c.close();
});

await asyncTest('detects IP addresses', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Server at 192.168.1.100:8080', 'code');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'ip_address'), 'Should detect IP');
  c.close();
});

await asyncTest('detects passwords/secrets', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('DATABASE_URL=postgres://admin:secret@db.com:5432/main', 'code');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'password'), 'Should detect password');
  c.close();
});

await asyncTest('detects MAC addresses', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Gateway MAC: 74:AC:B9:D8:5A:4F', 'code');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'mac_address'), 'Should detect MAC');
  c.close();
});

await asyncTest('detects API keys', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('api_key=sk-proj-abc123def456ghi789jkl012mno345pqr678stu', 'code');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'api_key' || e.entity_type === 'password'), 'Should detect API key');
  c.close();
});

// ── Round-trip ──
console.log(chalk.bold('\n  Round-trip'));

await asyncTest('cloak → decloak restores originals', async () => {
  const c = new Cloaker({ useLlm: false });
  const original = 'John Smith (john@acme.com, SSN 123-45-6789) closed the $500,000 deal.';
  const result = await c.cloak(original, 'general');
  assert(result.entities.length > 0, 'Should find entities');

  const d = new Decloaker();
  const res = d.decloak(result.cloaked, result.sessionId);
  const restored = typeof res === 'string' ? res : res.decloaked;
  assert(restored === original, `Decloak mismatch:\n  Got: ${restored}\n  Exp: ${original}`);
  c.close();
  d.close();
});

await asyncTest('cloaked text contains no originals', async () => {
  const c = new Cloaker({ useLlm: false });
  const result = await c.cloak('Call John at john@test.com or (555) 123-4567', 'email');
  assert(!result.cloaked.includes('john@test.com'), 'Email should be replaced');
  assert(!result.cloaked.includes('(555) 123-4567'), 'Phone should be replaced');
  c.close();
});

// ── Text Extraction ──
console.log(chalk.bold('\n  Extraction'));

await asyncTest('extracts plain text', async () => {
  const text = await extractText(Buffer.from('Hello world'), 'test.txt');
  assert(text === 'Hello world');
});

await asyncTest('extracts JSON', async () => {
  const text = await extractText(Buffer.from('{"key": "value"}'), 'config.json');
  assert(text.includes('"key"'));
});

// ── Profiles ──
console.log(chalk.bold('\n  Profiles'));

await asyncTest('legal profile detects case numbers', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Case No. 2025-CV-44821 filed in Orange County', 'legal');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'case_number'), 'Should detect case number');
  c.close();
});

await asyncTest('code profile skips case numbers', async () => {
  const c = new Cloaker({ useLlm: false });
  const r = await c.cloak('Server 10.0.1.5 has Case No. 2025-CV-44821', 'code');
  const m = getMappingTypes(r.sessionId);
  assert(m.some(e => e.entity_type === 'ip_address'), 'Should detect IP');
  assert(!m.some(e => e.entity_type === 'case_number'), 'Should NOT detect case number');
  c.close();
});

await asyncTest('entity count in DB is encrypted', async () => {
  const store = new MappingStore();
  const sessions = store.listSessions(1);
  const raw = store.db.prepare('SELECT original FROM mappings WHERE session_id = ? LIMIT 1').get(sessions[0].id);
  assert(raw.original.startsWith('enc:'), 'Raw DB value should be encrypted');
  store.close();
});

// Restore stderr
process.stderr.write = origWrite;

// ── Summary ──
console.log(chalk.bold(`\n  Results: ${chalk.green(passed + ' passed')}${failed ? ', ' + chalk.red(failed + ' failed') : ''}\n`));
process.exit(failed > 0 ? 1 : 0);
