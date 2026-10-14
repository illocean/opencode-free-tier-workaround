// 06-verify.cjs
// Direct end-to-end test through OmniRoute's public API.
// Set AUTH to the API key from your OmniRoute dashboard.
const AUTH = 'Bearer <your-omniroute-api-key>';
const BASE = process.env.OMNIROUTE_BASE || 'http://localhost:20128';
const MODEL = process.argv[2] || 'opencode/mimo-v2.6-flash-free';

(async () => {
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say OK' }],
      max_tokens: 16,
    }),
  });
  console.log('HTTP', r.status);
  console.log((await r.text()).slice(0, 400));
})();
