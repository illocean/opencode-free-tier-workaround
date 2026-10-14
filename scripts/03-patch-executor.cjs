// 03-patch-executor.cjs
// Replace the inline mint block inside executeOnce with a call to a
// module-scope helper __ocMintIfNeeded, and insert that helper immediately
// before `class D extends n.BaseExecutor{`. Module scope is required so the
// imported `m` (isGatedFreeTierRequest) is not shadowed by a local `let m`.
//
// Usage: node 03-patch-executor.cjs <chunkPath>
const fs = require('fs');
const { execSync } = require('child_process');
const f = process.argv[2];
if (!f) { console.log('usage: node 03-patch-executor.cjs <open-sse_1689v-3._.js path>'); process.exit(1); }

let s = fs.readFileSync(f, 'utf8');
const anchor = 'class D extends n.BaseExecutor{';
if (s.split(anchor).length - 1 !== 1) {
  console.log('class D anchor not found/not unique: ' + (s.split(anchor).length - 1));
  process.exit(1);
}

const HELPER = [
  'async function __ocMintSession(){',
  '  const cands=[',
  '    process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR+"/state/opencode/service.json",',
  '    process.env.LOCALAPPDATA && process.env.LOCALAPPDATA+"/opencode-data/state/opencode/service.json",',
  '    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME+"/opencode/service.json",',
  '    process.env.HOME && process.env.HOME+"/.local/state/opencode/service.json",',
  '    process.env.HOME && process.env.HOME+"/.config/opencode/service.json",',
  '  ].filter(Boolean);',
  '  for(const p of cands){',
  '    try{',
  '      if(!require("fs").existsSync(p))continue;',
  '      const j=JSON.parse(require("fs").readFileSync(p,"utf8"));',
  '      if(!j.url||!j.password)continue;',
  '      const ac=new AbortController();setTimeout(()=>ac.abort(),3000);',
  '      const r=await fetch(j.url.replace(/\\/+$/,"")+"/api/session",{',
  '        method:"POST",',
  '        headers:{',
  '          "Content-Type":"application/json",',
  '          "Authorization":"Basic "+Buffer.from("opencode:"+j.password).toString("base64"),',
  '          "User-Agent":"opencode/latest/2.0.28/cli",',
  '        },',
  '        body:"{}",signal:ac.signal,',
  '      });',
  '      if(r.status!==200)continue;',
  '      const b=await r.json();',
  '      const id=b&&(b.id||(b.data&&b.data.id));',
  '      if(id&&/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(id))return id;',
  '    }catch(e){}',
  '  }',
  '  return undefined;',
  '}',
  'async function __ocMintIfNeeded(surface,provider,model){',
  '  try{',
  '    const envv=(process.env.OPENCODE_SYNTHESIZE_CLI_HEADERS||"").trim();',
  '    if(/^(0|false|no|off)$/i.test(envv))return;',
  '    let gated;',
  '    try{ gated=(0,m.isGatedFreeTierRequest)(surface,provider,String(model??"")); }catch(e2){ throw e2; }',
  '    if(!gated)return;',
  '    const ctx=(0,g.currentRequestContext)();',
  '    if(!ctx)return;',
  '    const sid=await __ocMintSession();',
  '    if(sid){',
  '      try{',
  '        ctx.session=sid;',
  '        globalThis.__ocSessionBridge=sid;',
  '      }catch(e3){}',
  '    }',
  '  }catch(err){}',
  '}',
  ''
].join('\n');

s = s.replace(anchor, HELPER + anchor);

// Replace inline mint block at start of executeOnce's try.
// Older inline form (adjust if your chunk differs):
const inline = '{let __c=(0,g.currentRequestContext)();if(__c&&(0,m.isGatedFreeTierRequest)(this._surface(),this.provider,String(e.model??""))){try{__c.session=await __ocMintSession()}catch(e2){}}}';
if (s.split(inline).length - 1 === 1) {
  s = s.replace(inline, '{await __ocMintIfNeeded(this._surface(),this.provider,e.model)}');
  console.log('inline mint block replaced');
} else {
  console.log('inline mint block not found (count=' + (s.split(inline).length - 1) + ') — add the call manually');
}

fs.writeFileSync(f, s);
try { execSync('node --check "' + f + '"', { stdio: 'pipe' }); console.log('syntax OK'); }
catch (e) { console.log('SYNTAX FAIL: ' + (e.stderr || e.message).toString().slice(0, 200)); }
