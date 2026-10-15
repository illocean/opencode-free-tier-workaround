// 07-add-shim-provider.cjs — wire the local shim (shim/opencode-free-shim.cjs) into
// OmniRoute so it shows up under /dashboard/providers?mode=configured and routes.
//
// Three idempotent steps:
//   1. find (or create) the provider_nodes row for the shim base url
//   2. set provider_connections.provider = that node id — the dashboard's
//      connectionMatchesProviderCard does an EXACT id match, so a connection
//      left on the generic "openai-compatible-chat" slug never matches its card
//   3. rewrite combo legs still pointing at the now-dead bare slug
//      "openai-compatible-chat/<model>"
//
// `provider` is not part of updateProviderConnectionSchema, so PUT /api/providers/{id}
// cannot change it. A direct SQLite write is the only route. storage.sqlite is WAL,
// so writing from a second process while the server runs is safe — no restart.
//
// Usage: node 07-add-shim-provider.cjs            (apply)
//        node 07-add-shim-provider.cjs --dry      (report only, opens readonly)
//        OMNI_DB=... SHIM_BASE_URL=... node 07-add-shim-provider.cjs
const path = require('path');
const os = require('os');

const DB_PATH = process.env.OMNI_DB || path.join(os.homedir(), '.omniroute', 'storage.sqlite');
const SHIM_BASE = process.env.SHIM_BASE_URL || 'http://127.0.0.1:8791/v1';
const NODE_NAME = 'oc-free-shim';
const NODE_PREFIX = 'ocfree';
const API_TYPE = 'chat';
const LEGACY_SLUG = 'openai-compatible-chat';
const DRY = process.argv.includes('--dry');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = require(path.join(
    process.env.APPDATA || '',
    'npm/node_modules/omniroute/node_modules/better-sqlite3'));
}

const db = new Database(DB_PATH, { readonly: DRY });

// ── 1. provider_nodes row ────────────────────────────────────────────────────
let node = db
  .prepare('SELECT id, name, prefix, base_url FROM provider_nodes WHERE base_url = ?')
  .get(SHIM_BASE);
if (!node) {
  // same id shape the server mints: openai-compatible-chat-{apiType}-{uuid}
  const id = `${LEGACY_SLUG}-${API_TYPE}-${require('crypto').randomUUID()}`;
  const now = new Date().toISOString();
  if (!DRY) {
    db.prepare(
      `INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at)
       VALUES (?, 'openai-compatible', ?, ?, ?, ?, ?, ?)`
    ).run(id, NODE_NAME, NODE_PREFIX, API_TYPE, SHIM_BASE, now, now);
  }
  node = { id, name: NODE_NAME, prefix: NODE_PREFIX, base_url: SHIM_BASE };
  console.log(`${DRY ? 'would create' : 'created'} provider_nodes row:`, id);
} else {
  console.log('provider_nodes row:', node.id, `(prefix=${node.prefix})`);
}

// ── 2. connection.provider = node id ─────────────────────────────────────────
const conns = db
  .prepare('SELECT id, name, provider FROM provider_connections WHERE provider_specific_data LIKE ?')
  .all('%' + SHIM_BASE + '%');
if (conns.length === 0) {
  throw new Error(
    `no connection points at ${SHIM_BASE} — add it in the dashboard first ` +
    '(OpenAI Compatible, base url ' + SHIM_BASE + ', any api key)');
}
const conn = conns.find(c => c.provider === node.id) || conns[0];
console.log('connection       :', conn.id, `(${conn.name})`);
console.log('provider field   :', conn.provider);
if (conn.provider === node.id) {
  console.log('already aligned — nothing to do');
} else if (DRY) {
  console.log('would set provider field to:', node.id);
} else {
  const r = db
    .prepare('UPDATE provider_connections SET provider = ?, updated_at = ? WHERE id = ?')
    .run(node.id, new Date().toISOString(), conn.id);
  console.log('provider field updated:', r.changes, 'row(s) →', node.id);
}

// ── 3. combo legs on the dead bare slug ──────────────────────────────────────
let legs = 0;
for (const combo of db.prepare('SELECT id, name, data FROM combos').all()) {
  let data;
  try { data = JSON.parse(combo.data); } catch { continue; }
  let changed = false;
  for (const m of data.models || []) {
    if (m.kind !== 'model' || typeof m.model !== 'string') continue;
    if (!m.model.startsWith(LEGACY_SLUG + '/')) continue;
    m.model = node.id + '/' + m.model.slice(LEGACY_SLUG.length + 1);
    m.providerId = node.id;
    changed = legs++;
  }
  if (!changed) continue;
  const now = new Date().toISOString();
  data.updatedAt = now;
  if (!DRY) {
    db.prepare('UPDATE combos SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), now, combo.id);
  }
  console.log(`${DRY ? 'would fix' : 'fixed'} combo legs in:`, combo.name);
}
console.log('legs fixed:', legs);

db.close();
if (!DRY) console.log('\nDone. Refresh /dashboard/providers?mode=configured — the shim card should appear.');
