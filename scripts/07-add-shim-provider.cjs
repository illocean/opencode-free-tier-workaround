// 07-add-shim-provider.cjs — wire the local shim into OmniRoute as a proper
// OpenAI-compatible provider so it appears in /dashboard/providers?mode=configured.
//
// Two DB mutations are needed because OmniRoute's PUT /api/providers/{id} cannot
// change the `provider` field (immutable via API). This script uses better-sqlite3
// directly against storage.sqlite (WAL mode — safe while server is running).
//
// What it does:
//   1. Finds (or creates) the provider_nodes row for the shim
//   2. Finds the shim connection (provider='openai-compatible-chat', baseUrl=shim)
//   3. Sets connection.provider = node.id  → makes dashboard match it
//   4. Fixes combo legs that still use the old bare-slug model ids
//
// Prereq: shim running (start-shim.cmd). Set OMNI_PW to override login password.
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const SHIM_BASE = 'http://127.0.0.1:8791/v1';
const NODE_PREFIX = 'ocfree';
const NODE_NAME = 'oc-free-shim';
const DB_PATH = path.join(os.homedir(), '.omniroute', 'storage.sqlite');

const db = new Database(DB_PATH, { readonly: false });

// ── 1. find or create provider_nodes row ──────────────────────────────────
let node = db.prepare(
  `SELECT id, type, name, prefix, base_url, api_type FROM provider_nodes
   WHERE name = ? OR prefix = ?`
).get(NODE_NAME, NODE_PREFIX);

if (!node) {
  // generate id the same way the server does: openai-compatible-chat-{apiType}-{uuid}
  const { randomUUID } = require('crypto');
  const nodeId = 'openai-compatible-chat-chat-' + randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at)
     VALUES (?, 'openai-compatible', ?, ?, 'chat', ?, ?, ?)`
  ).run(nodeId, NODE_NAME, NODE_PREFIX, SHIM_BASE, now, now);
  node = db.prepare(`SELECT id, type, name, prefix, base_url, api_type FROM provider_nodes WHERE id = ?`).get(nodeId);
  console.log('created provider_nodes row:', nodeId);
} else {
  console.log('found existing provider_nodes row:', node.id);
}

// ── 2. find the shim connection ───────────────────────────────────────────
const conn = db.prepare(
  `SELECT id, provider, provider_specific_data FROM provider_connections
   WHERE provider_specific_data LIKE ? AND provider != ?`
).get('%' + SHIM_BASE + '%', node.id);

if (!conn) {
  // fallback: any connection whose provider_specific_data has the shim base url
  const conns = db.prepare(
    `SELECT id, provider, provider_specific_data FROM provider_connections
     WHERE provider_specific_data LIKE ?`
  ).all('%' + SHIM_BASE + '%');
  if (conns.length === 0) throw new Error('shim connection not found — create it via the dashboard first');
  conn._fallbackList = conns;
  conn.id = conns[0].id;
  conn.provider = conns[0].provider;
  conn.provider_specific_data = conns[0].provider_specific_data;
}

console.log('shim connection id:', conn.id, 'provider:', conn.provider);

// ── 3. fix connection.provider to match node id ───────────────────────────
if (conn.provider !== node.id) {
  const r = db.prepare(
    `UPDATE provider_connections SET provider = ?, updated_at = ? WHERE id = ?`
  ).run(node.id, new Date().toISOString(), conn.id);
  console.log('updated provider field:', r.changes, 'row(s)');
} else {
  console.log('provider field already correct');
}

// ── 4. fix combo legs using old bare-slug model ids ──────────────────────
const combos = db.prepare(`SELECT id, name, data FROM combos`).all();
let legsFixed = 0;
for (const combo of combos) {
  let data;
  try { data = JSON.parse(combo.data); } catch { continue; }
  let changed = false;
  for (const model of data.models || []) {
    if (model.kind !== 'model') continue;
    if (model.model && model.model.startsWith('openai-compatible-chat/')) {
      const bare = model.model.slice('openai-compatible-chat/'.length);
      model.model = node.id + '/' + bare;
      model.providerId = node.id;
      model.id = 'combo-' + combo.id + '-' + node.id + '-' + bare.replace(/[^a-zA-Z0-9]/g, '-');
      changed = true;
      legsFixed++;
    }
  }
  if (changed) {
    data.updatedAt = new Date().toISOString();
    db.prepare(`UPDATE combos SET data = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(data), data.updatedAt, combo.id);
    console.log('fixed combo legs in:', combo.name);
  }
}
console.log('total legs fixed:', legsFixed);
db.close();
console.log('\nDone. Refresh /dashboard/providers?mode=configured to see the shim card.');
