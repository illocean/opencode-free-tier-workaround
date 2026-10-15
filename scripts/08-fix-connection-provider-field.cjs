// 08-fix-connection-provider-field.cjs
// Point the shim's provider_connections row at its provider_nodes row id.
//
// Why this is needed at all: the providers dashboard only shows a compatible
// provider card when some connection's `provider` column EXACTLY equals the
// card id (getProviderConnectionFamilyIds = [id, ...aliases[id]] — no prefix
// collapsing). Connections created through the UI get provider="openai-compatible-chat"
// while POST /api/provider-nodes mints "openai-compatible-chat-<uuid>", so the
// card is filtered out by `stats.total > 0`.
//
// `provider` is not part of updateProviderConnectionSchema, so PUT /api/providers/{id}
// cannot change it. Direct SQLite write is the only route. storage.sqlite is WAL,
// so writing from a second process while the server runs is safe. No restart needed.
//
// Usage: node 08-fix-connection-provider-field.cjs            (fix)
//        node 08-fix-connection-provider-field.cjs --dry      (show only)
const path = require('path');
const os = require('os');

const DB = process.env.OMNI_DB || path.join(os.homedir(), '.omniroute', 'storage.sqlite');
const SHIM_BASE = process.env.SHIM_BASE_URL || 'http://127.0.0.1:8791/v1';

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = require(path.join(
    process.env.APPDATA || '',
    'npm/node_modules/omniroute/node_modules/better-sqlite3'));
}

const db = new Database(DB, { readonly: false });
const node = db
  .prepare('SELECT id, name, prefix, base_url FROM provider_nodes WHERE base_url = ?')
  .get(SHIM_BASE);
if (!node) throw new Error(`no provider_nodes row with base_url=${SHIM_BASE}`);

const conn = db
  .prepare("SELECT id, name, provider FROM provider_connections WHERE provider_specific_data LIKE ?")
  .get('%' + SHIM_BASE + '%');
if (!conn) throw new Error(`no provider_connections row pointing at ${SHIM_BASE}`);

console.log('node      :', node.id, `(${node.name}, prefix=${node.prefix})`);
console.log('connection:', conn.id, `(${conn.name})`);
console.log('before    :', conn.provider);

if (conn.provider === node.id) {
  console.log('already aligned — nothing to do');
} else if (process.argv.includes('--dry')) {
  console.log('would set :', node.id, '(dry run, no write)');
} else {
  const r = db
    .prepare('UPDATE provider_connections SET provider = ?, updated_at = ? WHERE id = ?')
    .run(node.id, new Date().toISOString(), conn.id);
  console.log('rows affected:', r.changes, '→ after:', node.id);
}

db.close();
