import Database from 'better-sqlite3';
import { join } from 'path';
import { CONFIG_DIR, ensureConfigDir } from '../config.js';
import { encrypt, decrypt } from './crypto.js';

const DB_PATH = join(CONFIG_DIR, 'mappings.db');

export class MappingStore {
  constructor(dbPath) {
    ensureConfigDir();
    this.db = new Database(dbPath || DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        original_length INTEGER,
        cloaked_length INTEGER,
        entity_count INTEGER DEFAULT 0,
        number_scale_factor REAL,
        date_shift_days INTEGER,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        original TEXT NOT NULL,
        replacement TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_mappings_session ON mappings(session_id);
      CREATE INDEX IF NOT EXISTS idx_mappings_replacement ON mappings(session_id, replacement);

      CREATE TABLE IF NOT EXISTS feature_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        votes INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS allowlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL UNIQUE,
        entity_type TEXT,
        action TEXT NOT NULL DEFAULT 'always_cloak',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createSession(id, profile, opts = {}) {
    this.db.prepare(`
      INSERT INTO sessions (id, profile, original_length, cloaked_length, number_scale_factor, date_shift_days)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, profile, opts.originalLength || 0, opts.cloakedLength || 0, opts.numberScaleFactor || 1.0, opts.dateShiftDays || 0);
  }

  updateSession(id, opts) {
    const sets = [];
    const vals = [];
    if (opts.cloakedLength != null) { sets.push('cloaked_length = ?'); vals.push(opts.cloakedLength); }
    if (opts.entityCount != null) { sets.push('entity_count = ?'); vals.push(opts.entityCount); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  addMapping(sessionId, original, replacement, entityType) {
    this.db.prepare(`
      INSERT INTO mappings (session_id, original, replacement, entity_type)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, encrypt(original), encrypt(replacement), entityType);
  }

  getMappings(sessionId) {
    const rows = this.db.prepare('SELECT * FROM mappings WHERE session_id = ? ORDER BY id').all(sessionId);
    return rows.map(r => ({
      ...r,
      original: decrypt(r.original),
      replacement: decrypt(r.replacement),
    })).sort((a, b) => b.original.length - a.original.length);
  }

  getSession(sessionId) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  }

  findSession(partialId) {
    return this.db.prepare('SELECT * FROM sessions WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1').get(`${partialId}%`);
  }

  listSessions(limit = 20) {
    return this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // Allowlist
  getAllowlistAction(entity) {
    const row = this.db.prepare('SELECT action FROM allowlist WHERE entity = ?').get(entity);
    return row ? row.action : null;
  }

  setAllowlistAction(entity, entityType, action) {
    this.db.prepare(`
      INSERT INTO allowlist (entity, entity_type, action)
      VALUES (?, ?, ?)
      ON CONFLICT(entity) DO UPDATE SET action = ?, entity_type = ?
    `).run(entity, entityType, action, action, entityType);
  }

  // Feature requests
  addFeatureRequest(title, description, email) {
    return this.db.prepare(`
      INSERT INTO feature_requests (title, description, email) VALUES (?, ?, ?)
    `).run(title, description || '', email ? encrypt(email) : '');
  }

  listFeatureRequests(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM feature_requests ORDER BY votes DESC, created_at DESC LIMIT ?').all(limit);
    return rows.map(r => ({ ...r, email: r.email ? decrypt(r.email) : '' }));
  }

  voteFeatureRequest(id) {
    this.db.prepare('UPDATE feature_requests SET votes = votes + 1 WHERE id = ?').run(id);
  }

  updateFeatureRequestStatus(id, status) {
    this.db.prepare('UPDATE feature_requests SET status = ? WHERE id = ?').run(status, id);
  }

  // Auto-expire old sessions (default 7 days)
  expireOldSessions(days = 7) {
    const result = this.db.prepare(`
      DELETE FROM mappings WHERE session_id IN (
        SELECT id FROM sessions WHERE created_at < datetime('now', ?)
      )
    `).run(`-${days} days`);
    const sessions = this.db.prepare(`
      DELETE FROM sessions WHERE created_at < datetime('now', ?)
    `).run(`-${days} days`);
    return { expiredSessions: sessions.changes, expiredMappings: result.changes };
  }

  close() {
    this.db.close();
  }
}
