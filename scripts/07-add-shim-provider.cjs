// 07-add-shim-provider.cjs — register the shim as a NEW custom OpenAI-compatible
// provider in OmniRoute via its API. Read-only otherwise; does not touch
// existing opencode/opencode-zen legs. Safe: creating a provider, not editing core.
//
// Prereq: shim must be running (start-shim.cmd). Set OMNI_PW to login.
const PASSWORD = process.env.OMNI_PW || '0PpXxfsh9okcVvwmr48UjJLY';
const BASE = 'http://localhost:20128';
const SHIM_BASE = 'http://127.0.0.1:8791/v1';

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed');
  const cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).filter(Boolean);
  const auth = cookies.find(c => c.startsWith('auth_token='));
  return auth.split(';')[0];
}

(async () => {
  let cookie;
  try { cookie = await login(); console.log('login OK'); }
  catch (e) { console.log('LOGIN ERR', e.message); process.exit(1); }
  const H = { cookie, 'Content-Type': 'application/json' };

  // inspect what a custom provider create expects: list existing connections
  const pr = await fetch(BASE + '/api/providers', { headers: { cookie } });
  const pj = await pr.json();
  const list = Array.isArray(pj) ? pj : (pj.providers || pj.data || []);
  console.log('existing providers:', list.map(p => p.id || p.name).join(', '));

  // Look for a custom/openai-compatible provider shape already present to mimic
  const sample = list.find(p => /custom|openai|zen/i.test(p.id || p.name || '')) || list[0];
  console.log('sample provider shape keys:', sample ? Object.keys(sample).join(',') : 'none');
})();
