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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.CLOAKCLAW_PORT || 3900;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

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
  const path = url.pathname;

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

    // POST /api/cloak/stream — SSE streaming with progress
    if (path === '/api/cloak/stream' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.text) return json(res, { error: 'text is required' }, 400);
      const profile = body.profile || 'email';
      const useLlm = body.useLlm !== false;

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
