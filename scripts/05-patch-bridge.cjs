// 05-patch-bridge.cjs
// Patch the header chunk that loads at runtime (module 614067,
// forwardOpencodeClientHeaders) so __ocCtx falls back to the globalThis bridge.
// Also patches the mint helper in the executor chunk to set the bridge.
//
// Usage: node 05-patch-bridge.cjs <chunksDir>
const fs = require('fs');
const { execSync } = require('child_process');
const dir = process.argv[2];
if (!dir) { console.log('usage: node 05-patch-bridge.cjs <chunksDir>'); process.exit(1); }

const OLD_CTXFN = 'var __ocRs,__ocCtx=function(){try{var __m=e.i(963181);return __m.currentRequestContext()?.session?.trim()}catch(__e){return undefined}};';
const NEW_CTXFN = 'var __ocRs,__ocCtx=function(){try{var __m=e.i(963181);var __c=__m.currentRequestContext();var __s=__c?.session?.trim();if(!__s&&globalThis.__ocSessionBridge)__s=globalThis.__ocSessionBridge;return __s}catch(__e){return undefined}};';

let patched = 0;
for (const n of fs.readdirSync(dir)) {
  if (!n.endsWith('.js')) continue;
  let s;
  try { s = fs.readFileSync(dir + '/' + n, 'utf8'); } catch (_) { continue; }

  let orig = s;
  if (s.split(OLD_CTXFN).length - 1 === 1) {
    s = s.replace(OLD_CTXFN, NEW_CTXFN);
  }
  if (s !== orig) {
    fs.writeFileSync(dir + '/' + n, s);
    try {
      execSync('node --check "' + dir + '/' + n + '"', { stdio: 'pipe' });
      console.log(n + ': bridge patched OK');
      patched++;
    } catch (e) {
      console.log(n + ': SYNTAX FAIL ' + (e.stderr || e.message).toString().slice(0, 150));
    }
  }
}
console.log('files patched: ' + patched);
