// 09-fix-combo-legs.cjs
// After 08-fix-connection-provider-field.cjs the bare slug stops routing:
//   openai-compatible-chat/mimo-v2.6-flash-free  → 401 No active credentials
//   ocfree/mimo-v2.6-flash-free                  → 200
//   openai-compatible-chat-<uuid>/<model>        → 200
// So any combo leg written against the old bare slug is now dead. Rewrite them
// to the node-scoped form (both model and providerId).
//
// Usage: node 09-fix-combo-legs.cjs            (rewrite)
//        node 09-fix-combo-legs.cjs --dry
const path = require('path');
const os = require('os');

const DB = process.env.OMNI_DB || path.join(os.homedir(), '.omniroute', 'storage.sqlite');
const SHIM_BASE = process.env.SHIM_BASE_URL || 'http://127.0.0.1:8791/v1';
const OLD_SLUG = 'openai-compatible-chat';
const dry = process.argv.includes('--dry');

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
  .prepare('SELECT id FROM provider_nodes WHERE base_url = ?')
  .get(SHIM_BASE);
if (!node) throw new Error(`no provider_nodes row with base_url=${SHIM_BASE}`);

const combos = db.prepare('SELECT id, name, data FROM combos').all();
let total = 0;

for (const combo of combos) {
  const data = JSON.parse(combo.data);
  let changed = 0;
  for (const leg of data.models || []) {
    if (leg.kind !== 'model' || typeof leg.model !== 'string') continue;
    if (!leg.model.startsWith(OLD_SLUG + '/')) continue;
    const bare = leg.model.slice(OLD_SLUG.length + 1);
    if (bare.startsWith('chat-') || bare.startsWith('responses-')) continue; // already node-scoped
    leg.model = `${node.id}/${bare}`;
    leg.providerId = node.id;
    leg.id = `${combo.name}-${node.id}-${bare}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    changed++;
    console.log(`[${combo.name}] ${leg.model}`);
  }
  if (!changed) continue;
  total += changed;
  if (dry) {
    console.log(`  (dry) would update ${changed} leg(s) in ${combo.id}`);
    continue;
  }
  data.updatedAt = new Date().toISOString();
  db.prepare('UPDATE combos SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(data), data.updatedAt, combo.id);
  console.log(`  saved ${combo.id} (${changed} leg(s))`);
}

console.log(total === 0 ? 'no bare-slug legs found' : `legs rewritten: ${total}${dry ? ' (dry run)' : ''}`);
db.close();
