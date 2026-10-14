// 01-mint-test.cjs
// Prove the local opencode service will mint a real session id.
// Reads the service.json written by the opencode CLI at login time.
const fs = require('fs');
const path = process.env.LOCALAPPDATA
  ? process.env.LOCALAPPDATA + '/opencode-data/state/opencode/service.json'
  : null;

if (!path || !fs.existsSync(path)) {
  console.log('service.json NOT FOUND at', path);
  process.exit(0);
}

const j = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log('service url:', j.url, '| has password:', !!j.password);

(async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(j.url.replace(/\/+$/, '') + '/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from('opencode:' + (j.password || '')).toString('base64'),
        'User-Agent': 'opencode/latest/2.0.28/cli',
      },
      body: '{}',
      signal: ac.signal,
    });
    console.log('POST /api/session ->', r.status);
    const body = await r.text();
    console.log('body:', body.slice(0, 300));
    let id = null;
    try { const p = JSON.parse(body); id = p && (p.id || (p.data && p.data.id)); } catch (_) {}
    const ok = !!(id && /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(id));
    console.log('session id:', id, '| format valid:', ok);
  } catch (e) {
    console.log('mint FAILED:', e.message);
  }
})();
