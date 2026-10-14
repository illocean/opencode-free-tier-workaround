// opencode-free-shim.cjs
// OpenAI-compatible shim backed by the local opencode server's native API.
// Exposes POST /v1/chat/completions (and /v1/models) on 127.0.0.1:8791.
//
// Why: OpenCode's gateway now rejects direct free-tier requests from non-CLI
// clients (403 FreeTierError). The local opencode server is the trusted proxy.
//
// Usage:
//   node opencode-free-shim.cjs [port]
// Then add to OmniRoute as a custom OpenAI-compatible provider:
//   base URL  http://127.0.0.1:8791/v1
//   api key   anything (shim ignores it)

const http = require('http');
const fs = require('fs');

const PORT = Number(process.argv[2] || process.env.SHIM_PORT || 8791);
const SERVICE_JSON_CANDIDATES = [
  process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR + '/state/opencode/service.json',
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '/opencode-data/state/opencode/service.json',
  process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME + '/opencode/service.json',
  process.env.HOME && process.env.HOME + '/.local/state/opencode/service.json',
  process.env.HOME && process.env.HOME + '/.config/opencode/service.json',
].filter(Boolean);

function readService() {
  for (const p of SERVICE_JSON_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.url && j.password) return j;
      }
    } catch (_) {}
  }
  throw new Error('opencode service.json not found in: ' + SERVICE_JSON_CANDIDATES.join(', '));
}

let svc = null;
function svcNow() {
  if (!svc) svc = readService();
  return svc;
}
const BASIC = () => 'Basic ' + Buffer.from('opencode:' + svcNow().password).toString('base64');
const BASE = () => svcNow().url.replace(/\/+$/, '');
const H = () => ({
  Authorization: BASIC(),
  'User-Agent': 'opencode/latest/2.0.28/cli',
  'Content-Type': 'application/json',
});

function j(res, code, obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); }
    });
  });
}

async function mint() {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 4000);
  const r = await fetch(BASE() + '/api/session', { method: 'POST', headers: H(), body: '{}', signal: ac.signal });
  if (!r.ok) throw new Error('mint failed: ' + r.status);
  const b = await r.json();
  return (b && (b.id || (b.data && b.data.id)));
}

function splitModel(model) {
  // Accept "<anyprefix>/mimo-v2.6-flash-free" or "mimo-v2.6-flash-free".
  // The local API ALWAYS wants providerID="opencode"; any prefix the caller
  // adds (OmniRoute applies its connection prefix, e.g. "ocfree/") is stripped.
  let id = String(model || 'mimo-v2.6-flash-free');
  if (id.includes('/')) id = id.slice(id.indexOf('/') + 1);
  if (!id) id = 'mimo-v2.6-flash-free';
  return { providerID: 'opencode', id };
}

function flattenMessages(messages) {
  if (!Array.isArray(messages)) return 'Say OK';
  const lines = [];
  for (const m of messages) {
    const role = (m && m.role) || 'user';
    let content = m && m.content;
    if (Array.isArray(content)) content = content.map(c => (c && c.text) || '').join('');
    if (typeof content !== 'string') content = String(content ?? '');
    lines.push(role.toUpperCase() + ': ' + content);
  }
  return lines.join('\n\n');
}

async function chatCompletions(body) {
  const { providerID, id } = splitModel(body.model);
  const prompt = flattenMessages(body.messages);
  const sid = await mint();
  const mr = await fetch(BASE() + '/api/session/' + sid + '/model', {
    method: 'POST', headers: H(),
    body: JSON.stringify({ model: { id, providerID } }),
  });
  if (!mr.ok && mr.status !== 204) throw new Error('set model failed: ' + mr.status);
  await fetch(BASE() + '/api/session/' + sid + '/prompt', {
    method: 'POST', headers: H(), body: JSON.stringify({ text: prompt }),
  });
  // poll for assistant message
  let text = '';
  let usage = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const mb = await (await fetch(BASE() + '/api/session/' + sid + '/message', { headers: H() })).json();
    const asst = (mb.data || mb).filter(m => m.type === 'assistant');
    if (asst.length) {
      const last = asst[asst.length - 1];
      const c = last.content;
      const t = (Array.isArray(c) ? c : []).filter(x => x.type === 'text').map(x => x.text).join('');
      // wait until the message is finished AND has text (reasoning-only msgs come first)
      if (last.finish && t) {
        text = t;
        usage = last.tokens || null;
        break;
      }
      if (!text && t) text = t; // keep partial as fallback
    }
  }
  return {
    id: 'chatcmpl-' + sid,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: usage ? { prompt_tokens: usage.input || 0, completion_tokens: usage.output || 0, total_tokens: (usage.input || 0) + (usage.output || 0) } : undefined,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      // pull live free model list from local server
      const mb = await (await fetch(BASE() + '/api/model', { headers: H() })).json();
      // Strip the "opencode/" provider prefix from the id so OmniRoute applies
      // the connection's own prefix (e.g. "ocfree/") cleanly, without collision
      // against the builtin opencode provider's "oc/" namespace.
      const list = (mb.data || mb).map(m => {
        const bare = String(m.id || m.modelID || '').replace(/^opencode\//, '');
        return { id: bare, object: 'model', owned_by: 'opencode' };
      });
      return j(res, 200, { object: 'list', data: list });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readBody(req);
      const out = await chatCompletions(body);
      return j(res, 200, out);
    }
    if (req.method === 'GET' && url.pathname === '/health') return j(res, 200, { ok: true, service: BASE() });
    return j(res, 404, { error: 'not found: ' + url.pathname });
  } catch (e) {
    console.error('[shim]', e && e.message);
    return j(res, 502, { error: { message: String(e && e.message || e) } });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  try { console.log('[shim] listening on http://127.0.0.1:' + PORT + '/v1  (opencode service: ' + BASE() + ')'); }
  catch (e) { console.log('[shim] listening on ' + PORT + ' but service.json NOT readable yet: ' + e.message); }
});
