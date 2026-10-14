// 02-find-module.cjs
// Locate the Turbopack chunk files that define a given module id.
// Usage: node 02-find-module.cjs 614067
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'C:/Users/andador kim phillip/AppData/Roaming/npm/node_modules/omniroute/dist/.build/next/server/chunks';
const moduleId = process.argv[3];
if (!moduleId) { console.log('usage: node 02-find-module.cjs <chunksDir> <moduleId>'); process.exit(1); }
for (const n of fs.readdirSync(dir)) {
  if (!n.endsWith('.js')) continue;
  let s;
  try { s = fs.readFileSync(dir + '/' + n, 'utf8'); } catch (_) { continue; }
  const has = new RegExp(moduleId + '[,:]').test(s);
  if (has) console.log(n + '  defines module ' + moduleId + '  (len=' + s.length + ')');
}
