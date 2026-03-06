import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALGO = 'aes-256-gcm';
const KEY_FILE = join(homedir(), '.cloakclaw', 'encryption.key');
const IV_LEN = 16;
const TAG_LEN = 16;

let _key = null;

/**
 * Get or create the encryption key.
 * Auto-generated on first use, stored at ~/.cloakclaw/encryption.key
 * File is chmod 600 (owner read/write only).
 */
export function getKey() {
  if (_key) return _key;

  const dir = join(homedir(), '.cloakclaw');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, 'utf8').trim();
    _key = Buffer.from(raw, 'hex');
  } else {
    _key = randomBytes(32);
    writeFileSync(KEY_FILE, _key.toString('hex'), { mode: 0o600 });
    try { chmodSync(KEY_FILE, 0o600); } catch {}
  }

  return _key;
}

/**
 * Encrypt a string. Returns base64-encoded payload (iv + tag + ciphertext).
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv (16) + tag (16) + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return 'enc:' + packed.toString('base64');
}

/**
 * Decrypt an enc:-prefixed string. Returns original plaintext.
 * If input is not encrypted (no enc: prefix), returns as-is (migration support).
 */
export function decrypt(encoded) {
  if (!encoded) return encoded;
  if (!encoded.startsWith('enc:')) return encoded; // unencrypted legacy data
  const key = getKey();
  const packed = Buffer.from(encoded.slice(4), 'base64');
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
