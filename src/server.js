import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Cloaker } from './cloaker.js';
import { Decloaker } from './decloaker.js';
import { MappingStore } from './store/sqlite.js';
import { getConfig, setConfig, getConfigValue } from './config.js';
import { listProfiles } from './profiles/index.js';
import { isOllamaAvailable } from './ner/llm-pass.js';
import { extractText, SUPPORTED_EXTENSIONS } from './extract.js';
import { isPasswordProtected, unlockWithPassword, setPassword, removePassword } from './store/crypto.js';
import { getConfigValue } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.CLOAKCLAW_PORT || 3900;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max upload

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_FILE_SIZE) { req.destroy(); reject(new Error('Request too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_FILE_SIZE) { req.destroy(); reject(new Error('File too large (max 50MB)')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Multipart parser using Node's built-in Request/FormData (Node 22+)
async function parseMultipart(req) {
  const raw = await parseRawBody(req);
  const contentType = req.headers['content-type'] || '';

  // Use the Web API Request to parse multipart
  const request = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: raw,
  });

  const formData = await request.formData();
  const fields = {};
  const files = [];

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const arrayBuf = await value.arrayBuffer();
      files.push({ fieldName: key, filename: value.name, data: Buffer.from(arrayBuf) });
    } else {
      fields[key] = value;
    }
  }

  return { fields, files };
}

// Auto-expire old sessions on startup
try {
  const _store = new MappingStore();
  const expiry = _store.expireOldSessions(7);
  if (expiry.expiredSessions > 0) {
    console.log(`♻️  Expired ${expiry.expiredSessions} sessions older than 7 days (${expiry.expiredMappings} mappings)`);
  }
  _store.close();
} catch {}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Token auth check (if configured)
  const uiToken = getConfigValue('ui.token');
  if (uiToken) {
    const authToken = url.searchParams.get('token') || req.headers['x-cloakclaw-token'] || '';
    // Allow password status/unlock endpoints without token (chicken-and-egg)
    const authFree = ['/api/password/status', '/api/password/unlock', '/api/auth/check'];
    const rawCheck = url.pathname.replace(/^\/cloakclaw/, '');
    if (!authFree.includes(rawCheck) && authToken !== uiToken) {
      // Serve auth page for HTML requests, 401 for API
      if (req.headers.accept?.includes('text/html') && !rawCheck.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>CloakClaw</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2rem;width:320px;text-align:center}
h2{margin:0 0 8px}p{color:#8b949e;font-size:13px;margin:0 0 16px}
input{width:100%;padding:10px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:14px;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:10px;background:#00d4ff;color:#0d1117;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px}
.err{color:#f85149;font-size:12px;display:none}</style></head>
<body><div class="box"><h2>🦀 CloakClaw</h2><p>Enter your access token</p>
<input id="t" type="password" placeholder="Access token" onkeydown="if(event.key==='Enter')go()">
<div class="err" id="e">Invalid token</div>
<button onclick="go()">Unlock</button></div>
<script>function go(){const t=document.getElementById('t').value;if(t){localStorage.setItem('cloakclaw_token',t);location.href=location.pathname+'?token='+encodeURIComponent(t)}else{document.getElementById('e').style.display='block'}}</script></body></html>`);
        return;
      }
      return json(res, { error: 'Unauthorized' }, 401);
    }
  }

  // Strip /cloakclaw prefix if proxied through command center
  const rawPath = url.pathname;
  const path = rawPath.startsWith('/cloakclaw') ? rawPath.slice('/cloakclaw'.length) || '/' : rawPath;

  try {
    // === Static UI ===
    if (path === '/' || path === '/index.html') {
      const html = readFileSync(join(__dirname, '..', 'ui', 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    // === API Routes ===

    // GET /api/status — health + config
    if (path === '/api/status' && req.method === 'GET') {
      const config = getConfig();
      const ollamaUp = await isOllamaAvailable();
      const store = new MappingStore();
      const sessions = store.listSessions(5);
      store.close();
      return json(res, {
        version: '0.1.0',
        ollama: { ...config.ollama, available: ollamaUp },
        profiles: listProfiles().map(p => ({ name: p.name, description: p.description })),
        recentSessions: sessions.length,
      });
    }

    // GET /api/config
    if (path === '/api/config' && req.method === 'GET') {
      return json(res, getConfig());
    }

    // PUT /api/config
    if (path === '/api/config' && req.method === 'PUT') {
      const body = await parseBody(req);
      for (const [key, value] of Object.entries(body)) {
        setConfig(key, value);
      }
      return json(res, { ok: true, config: getConfig() });
    }

    // POST /api/extract — extract text from uploaded file
    if (path === '/api/extract' && req.method === 'POST') {
      try {
        const { fields, files } = await parseMultipart(req);
        if (!files.length) return json(res, { error: 'No file uploaded' }, 400);
        const file = files[0];
        const text = await extractText(file.data, file.filename);
        return json(res, { text, filename: file.filename, chars: text.length });
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    // POST /api/cloak/stream — SSE streaming with progress
    if (path === '/api/cloak/stream' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.text) return json(res, { error: 'text is required' }, 400);
      const profile = body.profile || 'email';
      const useLlm = body.useLlm !== false;
      const entityTypes = body.entityTypes || null; // null = all

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const cloaker = new Cloaker({
        interactive: false,
        useLlm,
        entityTypes,
        onProgress: (step, data) => send('progress', { step, ...data }),
      });

      try {
        const result = await cloaker.cloak(body.text, profile);
        const store = new MappingStore();
        const mappings = store.getMappings(result.sessionId);
        store.close();
        send('result', {
          sessionId: result.sessionId,
          cloaked: result.cloaked,
          entityCount: mappings.length,
          mappings: mappings.map(m => ({
            original: m.original,
            replacement: m.replacement,
            type: m.entity_type,
          })),
        });
      } catch (e) {
        send('error', { message: e.message });
      } finally {
        cloaker.close();
        res.end();
      }
      return;
    }

    // POST /api/cloak
    if (path === '/api/cloak' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.text) return json(res, { error: 'text is required' }, 400);
      const profile = body.profile || 'email';
      const useLlm = body.useLlm !== false;

      const cloaker = new Cloaker({ interactive: false, useLlm });
      try {
        const result = await cloaker.cloak(body.text, profile);
        const store = new MappingStore();
        const mappings = store.getMappings(result.sessionId);
        store.close();
        return json(res, {
          sessionId: result.sessionId,
          cloaked: result.cloaked,
          entityCount: mappings.length,
          mappings: mappings.map(m => ({
            original: m.original,
            replacement: m.replacement,
            type: m.entity_type,
          })),
        });
      } finally {
        cloaker.close();
      }
    }

    // POST /api/decloak
    if (path === '/api/decloak' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.text || !body.sessionId) return json(res, { error: 'text and sessionId required' }, 400);
      const decloaker = new Decloaker();
      try {
        const result = decloaker.decloak(body.text, body.sessionId);
        return json(res, { decloaked: result.decloaked, restoredCount: result.restoredCount });
      } finally {
        decloaker.close();
      }
    }

    // GET /api/sessions
    if (path === '/api/sessions' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const store = new MappingStore();
      const sessions = store.listSessions(limit);
      store.close();
      return json(res, { sessions });
    }

    // GET /api/session/:id
    if (path.startsWith('/api/session/') && req.method === 'GET') {
      const id = path.split('/api/session/')[1];
      const store = new MappingStore();
      let session = store.getSession(id);
      if (!session) session = store.findSession(id);
      if (!session) { store.close(); return json(res, { error: 'Session not found' }, 404); }
      const mappings = store.getMappings(session.id);
      store.close();
      return json(res, { session, mappings });
    }

    // GET /api/profiles
    if (path === '/api/profiles' && req.method === 'GET') {
      return json(res, { profiles: listProfiles() });
    }

    // GET /api/features
    if (path === '/api/features' && req.method === 'GET') {
      const store = new MappingStore();
      const requests = store.listFeatureRequests();
      store.close();
      return json(res, { requests });
    }

    // POST /api/features
    if (path === '/api/features' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.title) return json(res, { error: 'title is required' }, 400);
      const store = new MappingStore();
      store.addFeatureRequest(body.title, body.description, body.email);
      store.close();
      return json(res, { ok: true });
    }

    // POST /api/features/:id/vote
    if (path.match(/^\/api\/features\/\d+\/vote$/) && req.method === 'POST') {
      const id = parseInt(path.split('/')[3]);
      const store = new MappingStore();
      store.voteFeatureRequest(id);
      store.close();
      return json(res, { ok: true });
    }

    // GET /api/password/status
    if (path === '/api/password/status' && req.method === 'GET') {
      return json(res, { protected: isPasswordProtected() });
    }

    // POST /api/password/unlock
    if (path === '/api/password/unlock' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.password) return json(res, { error: 'password required' }, 400);
      try {
        unlockWithPassword(body.password);
        return json(res, { ok: true });
      } catch (e) {
        return json(res, { error: e.message }, 401);
      }
    }

    // POST /api/password/set
    if (path === '/api/password/set' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.password) return json(res, { error: 'password required' }, 400);
      try {
        if (isPasswordProtected() && body.current) {
          unlockWithPassword(body.current);
        }
        setPassword(body.password);
        return json(res, { ok: true, message: 'Password set. Wipe old DB if changing password.' });
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
    }

    // POST /api/password/remove
    if (path === '/api/password/remove' && req.method === 'POST') {
      const body = await parseBody(req);
      if (isPasswordProtected()) {
        if (!body.password) return json(res, { error: 'current password required' }, 400);
        try { unlockWithPassword(body.password); } catch (e) { return json(res, { error: e.message }, 401); }
      }
      removePassword();
      return json(res, { ok: true });
    }

    // GET /api/auth/check
    if (path === '/api/auth/check' && req.method === 'GET') {
      const needsAuth = !!getConfigValue('ui.token');
      return json(res, { needsAuth, authenticated: true }); // if we got here, we're authed
    }

    // 404
    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CloakClaw UI → http://localhost:${PORT}`);
});
