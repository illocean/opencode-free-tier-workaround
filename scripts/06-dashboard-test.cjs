// 06-dashboard-test.cjs
// Drive the same endpoint the dashboard "test" button hits, so you can
// reproduce whatever the UI is showing.
const http = require('http');
const BASE = process.env.OMNIROUTE_BASE || 'localhost';
const PORT = Number(process.env.OMNIROUTE_PORT || 20128);
const PASSWORD = process.env.OMNIROUTE_PASSWORD; // dashboard login password
const PROVIDER = process.argv[2] || 'opencode';
const MODEL = process.argv[3] || 'mimo-v2.6-flash-free';

function req(path, method, body, cookie) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Cookie: cookie || '' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request({ host: BASE, port: PORT, path, method, headers }, (resp) => {
      let b = '';
      resp.on('data', (c) => (b += c));
      resp.on('end', () => res({ status: resp.statusCode, body: b, headers: resp.headers }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  if (!PASSWORD) { console.log('set OMNIROUTE_PASSWORD=<dashboard password>'); process.exit(1); }
  const lr = await req('/api/auth/login', 'POST', { password: PASSWORD });
  const ck = lr.headers['set-cookie'] ? lr.headers['set-cookie'][0].split(';')[0] : '';
  console.log('login:', lr.status, ck ? '(cookie ok)' : '(NO cookie)');
  const r = await req('/api/models/test', 'POST', { providerId: PROVIDER, modelId: MODEL }, ck);
  console.log('/api/models/test ->', r.status);
  console.log(r.body.slice(0, 500));
})();
