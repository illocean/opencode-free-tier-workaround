// test-shim.cjs — drive the shim like OmniRoute would
const BASE = process.env.SHIM || 'http://127.0.0.1:8791';
(async () => {
  // health
  try {
    const h = await fetch(BASE + '/health');
    console.log('health ->', h.status, await h.text());
  } catch (e) { console.log('health ERR (is shim running?)', e.message); process.exit(1); }

  // models (first few)
  const m = await fetch(BASE + '/v1/models');
  const mb = await m.json();
  const free = (mb.data || []).filter(x => /free/i.test(x.id));
  console.log('models ->', m.status, 'total=' + (mb.data || []).length, 'free=' + free.length);
  console.log('sample free ids:', free.slice(0, 5).map(x => x.id).join(', '));

  // chat
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer anything' },
    body: JSON.stringify({
      model: 'opencode/mimo-v2.6-flash-free',
      messages: [{ role: 'user', content: 'reply with just: OK' }],
      max_tokens: 16,
    }),
  });
  console.log('chat ->', r.status);
  console.log((await r.text()).slice(0, 500));
})();
