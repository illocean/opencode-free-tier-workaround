// 06-verify.cjs — live smoke test. Set OMNI_AUTH=Bearer <your-omniroute-api-key>.
// Usage: $env:OMNI_AUTH="Bearer <key>"; node 06-verify.cjs [model]
const AUTH = process.env.OMNI_AUTH;
const BASE = process.env.OMNIROUTE_BASE || 'http://localhost:20128';
const MODEL = process.argv[2] || 'opencode/mimo-v2.6-flash-free';
if(!AUTH){ console.log('set OMNI_AUTH=Bearer <your-omniroute-api-key>'); process.exit(1); }
(async () => {
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 16 }),
  });
  console.log('HTTP', r.status);
  console.log((await r.text()).slice(0, 400));
})();
