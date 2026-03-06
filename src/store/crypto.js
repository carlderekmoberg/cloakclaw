import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALGO = 'aes-256-gcm';
const CONFIG_DIR = join(homedir(), '.cloakclaw');
const KEY_FILE = join(CONFIG_DIR, 'encryption.key');
const SALT_FILE = join(CONFIG_DIR, 'encryption.salt');
const PW_HASH_FILE = join(CONFIG_DIR, 'encryption.pw');
const IV_LEN = 16;
const TAG_LEN = 16;

let _key = null;

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtected() {
  return existsSync(PW_HASH_FILE);
}

/**
 * Set a password. Derives a new key from password + salt.
 * Replaces any existing key file. Existing encrypted data will NOT be re-encrypted
 * (call this on a fresh DB or after wiping).
 */
export function setPassword(password) {
  if (!password || password.length < 4) throw new Error('Password must be at least 4 characters');

  const dir = CONFIG_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const salt = randomBytes(32);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });

  // Store salt and password verification hash (SHA-256 of derived key)
  writeFileSync(SALT_FILE, salt.toString('hex'), { mode: 0o600 });
  const pwHash = createHash('sha256').update(key).digest('hex');
  writeFileSync(PW_HASH_FILE, pwHash, { mode: 0o600 });

  // Remove old auto-generated key file if present
  if (existsSync(KEY_FILE)) {
    try { writeFileSync(KEY_FILE, ''); chmodSync(KEY_FILE, 0o600); } catch {}
  }

  _key = key;
  return true;
}

/**
 * Unlock with password. Derives key and verifies against stored hash.
 */
export function unlockWithPassword(password) {
  if (!existsSync(SALT_FILE) || !existsSync(PW_HASH_FILE)) {
    throw new Error('No password set. Use setPassword() first.');
  }

  const salt = Buffer.from(readFileSync(SALT_FILE, 'utf8').trim(), 'hex');
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });

  const expectedHash = readFileSync(PW_HASH_FILE, 'utf8').trim();
  const actualHash = createHash('sha256').update(key).digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error('Wrong password');
  }

  _key = key;
  return true;
}

/**
 * Remove password protection. Reverts to auto-generated key file.
 * WARNING: Existing encrypted data becomes unreadable unless DB is wiped.
 */
export function removePassword() {
  try { if (existsSync(SALT_FILE)) writeFileSync(SALT_FILE, ''); } catch {}
  try { if (existsSync(PW_HASH_FILE)) writeFileSync(PW_HASH_FILE, ''); } catch {}
  _key = null;
  // Next getKey() call will auto-generate a new key
}

/**
 * Get or create the encryption key.
 * If password-protected: must call unlockWithPassword() first.
 * Otherwise: auto-generated on first use, stored at ~/.cloakclaw/encryption.key
 */
export function getKey() {
  if (_key) return _key;

  // If password-protected, key must be unlocked first
  if (isPasswordProtected()) {
    throw new Error('Database is password-protected. Unlock required.');
  }

  const dir = CONFIG_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, 'utf8').trim();
    if (raw.length >= 64) {
      _key = Buffer.from(raw, 'hex');
      return _key;
    }
  }

  // Auto-generate new key
  _key = randomBytes(32);
  writeFileSync(KEY_FILE, _key.toString('hex'), { mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch {}

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
