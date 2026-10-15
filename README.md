> ### ⚠️ UPDATE (2026-10-14) — the session-mint fix below no longer works
>
> OpenCode hardened the free-tier gate. Direct requests to `opencode.ai` now
> return 403 regardless of session id, org header, or bearer token. The gateway
> only accepts free-tier requests **proxied through the local opencode server**.
>
> **The current working solution is the local shim — see
> [`shim/README.md`](shim/README.md).** The content below is kept as a record of
> the original fix and its root-cause analysis.
>
> Quick verification of the regression:
>
> ```
> real session + real oc_sk key + x-opencode-org-id → opencode.ai  = 403
> same model through local /api/session/{id}/prompt                = 200
> ```
>
> ---

# Making the shim visible in the providers dashboard

This is the **current** work. Everything further down this file documents the
superseded chunk-patch approach.

## Symptom

After registering the shim as an OpenAI-compatible connection, requests route
fine (`POST /v1/chat/completions` → 200) but the provider card never appears
under `/dashboard/providers?mode=configured`.

## Why

The dashboard builds its "configured providers" list by pairing a **card** with
the **connections** whose `provider` field equals the card's id:

```
buildCompatibleProviderGroups(providerNodes)            # cards, one per provider_nodes row
  → eL(node.id)  # stats = connections where connectionBelongsToProviderCard(conn, node.id)
    → getProviderConnectionFamilyIds(node.id).includes(conn.provider)
  → filterConfiguredProviderEntries: keep only stats.total > 0
```

`getProviderConnectionFamilyIds(id)` is just `[id, ...aliases[id] ?? []]` — **exact
id match, no prefix collapsing.** So a card is only shown if some connection's
`provider` column literally equals the node id.

Creating the connection through the UI sets `provider = "openai-compatible-chat"`
(the generic slug), while `POST /api/provider-nodes` mints an id like
`openai-compatible-chat-<uuid>`. Nothing matches, so the card is filtered out.

This is exactly why `orcarouter` works: its connection `provider` is
`openai-compatible-chat-4443a5b1-0908-482c-988a-ee162aafcfe5`, which *is* its node id.

## Fix

Point the connection at its node id. `provider` is **not** in
`updateProviderConnectionSchema`, so `PUT /api/providers/{id}` cannot change it —
the DB write function (`_02v77bl._.js` → `P()`) accepts it but the route never
passes it. A direct SQLite write is the only path:

```js
// scripts/08-fix-connection-provider-field.cjs
db.prepare('UPDATE provider_connections SET provider = ? WHERE id = ?')
  .run(nodeId, connectionId);
```

`storage.sqlite` runs in WAL mode, so writing from a second process while the
server is running is safe. Restart not required.

## Fallout

Re-pointing the connection changes the routing key. The bare slug stops working:

| Model id | Result |
|---|---|
| `ocfree/mimo-v2.6-flash-free` | 200 |
| `openai-compatible-chat-b3760c9f-…/mimo-v2.6-flash-free` | 200 |
| `openai-compatible-chat/mimo-v2.6-flash-free` | 401 `No active credentials for provider: openai-compatible-chat` |

Any combo leg still referencing `{providerId: "openai-compatible-chat"}` breaks.
`scripts/09-fix-combo-legs.cjs` rewrites them to the node id.

---

# Making OmniRoute's OpenCode free-tier provider work (original fix, now superseded)

This documents the full path from the original 403 to a working OpenCode
free-tier provider inside [OmniRoute](https://github.com/diegosouzapw/OmniRoute), including every
mistake and dead end, with the exact scripts used.

Two independent problems had to be solved:

1. **The 403** — OmniRoute fabricates a *fake* OpenCode session id, which the
   OpenCode gateway rejects.
2. **The gateway also only accepts a *real registered* session** created by the
   local `opencode` service, so we had to mint a real session and inject it
   into the request headers.

---

## TL;DR of the fix

| Problem | Cause | Fix |
|---|---|---|
| `403 FreeTierError` | OmniRoute generates a local fake session id (`ses_<12hex><14base62>`) that the OpenCode gateway does not recognise. | Mint a real session from the local `opencode` service and substitute it into the `x-opencode-session` header. |
| `502 Cannot access 'm' before initialization` | The first version of the mint block ran inside `executeOnce`, where a minified local `let m` shadows the module-scope import used by `isGatedFreeTierRequest` — a temporal dead zone. | Move the mint logic into a module-scope helper `__ocMintIfNeeded()` placed *before* `class D extends n.BaseExecutor`. |
| `403 still returns after mint succeeds` | `forwardOpencodeClientHeaders` runs in a different async context than the executor, so `currentRequestContext()?.session` returns `undefined` there. | Bridge the session id through `globalThis.__ocSessionBridge` — the mint writes it, the header fallback reads it. |

---

## Background — what the OpenCode gate actually checks

From GitHub issue [#50084](https://github.com/anomalyco/opencode/issues/50084):

> Nope, that is abuse… Free models are meant to be used in opencode ONLY.
> Paid models can be used anywhere.

The gateway (as of v2, ~October 2026) validates:

- `User-Agent` — must parse as `opencode/<version>`
- `x-opencode-session` — **must be a real session id registered on the
  OpenCode server** (a well-formed but unregistered id is rejected with 403)
- `stream: true` with a non-empty `tools` array
- a valid bearer token

The anonymous "well-known" path that used to work (forge any bearer + canonical
session id) was closed in v2. Anyone still getting 403 with a fabricated
session is hitting exactly this.

**Important:** OmniRoute cannot just invent the session — the OpenCode gateway
now checks it against the local `opencode` server's session store.

---

## Step 0 — Environment

- OmniRoute installed globally, compiled, **no source / no build step**
  (production pruned install; you patch compiled Turbopack chunks).
- OpenCode CLI v2 installed and logged in (`opencode auth login`).
- The `opencode` service running locally on `http://127.0.0.1:<port>`.
- Node.js ≥ 18 (uses `fetch`).
- **Windows 10 / PowerShell 5.1** — see gotchas at the end.

Locate the OpenCode service credentials:

```
%LOCALAPPDATA%\opencode-data\state\opencode\service.json
```

Contents look like:

```json
{
  "url": "http://127.0.0.1:49374",
  "password": "…"
}
```

---

## Step 1 — Prove the mint endpoint works

`scripts/01-mint-test.cjs` POSTs `{}` to `<serviceUrl>/api/session` with
HTTP Basic auth (`opencode:<password>`) and the official CLI user-agent, then
validates the returned id matches the session-id format.

```powershell
node 01-mint-test.cjs
```

Expected output:

```
POST /api/session -> 200
session id: ses_ec5d2496affedZv7yuELIxhom7 | format valid: true
```

If this fails you cannot proceed — fix the local service first.

---

## Step 2 — Locate the compiled OmniRoute chunks

OmniRoute ships a Turbopack build. The pieces you need:

```
%APPDATA%\npm\node_modules\omniroute\dist\.build\next\server\chunks\
```

Relevant chunk files (names are stable for 3.8.51 but always re-check):

| File | What it contains |
|---|---|
| `open-sse_1689v-3._.js` | `OpencodeExecutor` (module id 633058) — `executeOnce`, the place to inject the mint. |
| `_1n6tsx0._.js` | `forwardOpencodeClientHeaders` (module id 614067) — **the copy that actually loads at runtime.** |
| `_02g7gyp._.js` | `resolveOpencodeSessionIdentity` (module id 780197) — not used on this path. |

The 10+ other chunks that also carry the same `__ocCtx` markers are dead
duplicates and never load — verified with a module-load logger.

Two ways to confirm which modules actually load:

```powershell
node 02-find-module.cjs 614067     # where forwardOpencodeClientHeaders lives
node 02-find-module.cjs 780197     # where resolveOpencodeSessionIdentity lives
```

Then inject an IIFE that logs at module scope; after a request, only the files
that logged are live. Only `_02g7gyp` and `_1n6tsx0` load in a stock install.

---

## Step 3 — Fix the executor's TDZ (the 502)

The first patch tried to call `(0,m.isGatedFreeTierRequest)(...)` at the top of
`executeOnce`. Inside `executeOnce`, Turbopack had declared
`let ..., m = r.some(...)` further down — so `m` was still in TDZ when our line
ran → `Cannot access 'm' before initialization` → HTTP 502 on every request.

**Fix:** replace the inline block with a call to a module-scope helper placed
*before* `class D extends n.BaseExecutor{`. Module-scope, `m` resolves to the
import `m=e.i(399938)` which exports `isGatedFreeTierRequest`.

`scripts/03-patch-executor.cjs` does the rewrite in-place.

---

## Step 4 — Patch the header fallback

`forwardOpencodeClientHeaders` builds `x-opencode-session` like this:

```js
o["x-opencode-session"] =
  A ? f.test(A) ? A : u("ses_", A)
    : (__ocRs = __ocCtx(),
       __ocRs && f.test(__ocRs) ? __ocRs
         : u("ses_", (0, a.generateSessionId)(d ?? null) ?? undefined))
```

The `__ocCtx()` fallback was *my* earlier patch and is what makes the real
session reach the wire. It reads `currentRequestContext()?.session?.trim()`.

**But** — see Step 5.

---

## Step 5 — Bridge the ALS context with globalThis

`currentRequestContext()` is backed by `AsyncLocalStorage`. The executor sets
`ctx.session = sid` inside its own async context, but `forwardOpencodeClientHeaders`
is invoked from `buildHeaders` inside `execute()` — **a different async context**
where `currentRequestContext()` returns `undefined`.

Confirmed with a debug log: `HDR ctxSid=undefined` while the mint log shows
`SET ctx.session ok`.

**Fix:** both chunks import the same module `963181`, so the ALS boundary is
the boundary, not the module. Use a plain `globalThis` bridge instead:

- mint helper, after getting the sid:

  ```js
  ctx.session = sid;
  globalThis.__ocSessionBridge = sid;
  ```

- header fallback (`_1n6tsx0._.js`):

  ```js
  var __ocCtx = function () {
    try {
      var __m = e.i(963181);
      var __c = __m.currentRequestContext();
      var __s = __c?.session?.trim();
      if (!__s && globalThis.__ocSessionBridge) __s = globalThis.__ocSessionBridge;
      return __s;
    } catch (_) { return undefined; }
  };
  ```

`scripts/05-patch-bridge.cjs` applies both edits.

---

## Step 6 — Restart and verify

Chunk edits need the server restarted. On Windows:

```powershell
$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
     Where-Object { $_.CommandLine -match 'server-ws.mjs' }
taskkill /PID $p.ProcessId /F
Start-Sleep -Seconds 16
```

Then hit the provider directly:

```powershell
node 06-verify.cjs
```

Expected:

```
HTTP 200
{"id":"gen-…","choices":[{"message":{"content":"OK"}}],…}
```

And the dashboard test route:

```powershell
node 06-dashboard-test.cjs
# {"status":"ok","latencyMs":3504,"responseText":"…"}
```

---

## Directory layout

```
opencode-free-tier-workaround/
├── README.md              ← you are here
├── shim/                  ← the current, supported solution
│   ├── opencode-free-shim.cjs
│   ├── start-shim.vbs / start-shim.cmd / launch-shim.cmd
│   ├── autostart.sh
│   ├── test-shim.cjs
│   └── README.md
├── scripts/
│   ├── 01-mint-test.cjs          # prove the session mint endpoint
│   ├── 02-find-module.cjs        # locate module ids in chunks
│   ├── 03-patch-executor.cjs     # fix TDZ in open-sse_1689v-3._.js
│   ├── 05-patch-bridge.cjs       # globalThis bridge, both sides
│   ├── 06-verify.cjs             # direct /v1/chat/completions smoke test
│   ├── 06-dashboard-test.cjs     # dashboard /api/models/test smoke test
│   ├── 07-add-shim-provider.cjs  # read-only dump of existing connections
│   ├── 08-fix-connection-provider-field.cjs  # connection.provider = node id
│   └── 09-fix-combo-legs.cjs               # rewrite combo legs to node ids
├── chunks/
│   ├── open-sse_1689v-3._.js     # reference copy of the patched executor
│   ├── _1n6tsx0._.js             # reference copy of the patched header
│   └── _02g7gyp._.js             # reference copy of the patched header
└── diagnostics/
    ├── _hdr_debug.log            # what module loaded, what ctxSid was
    └── _mint_debug.log           # mint calls, sid values, bridge writes
```

Steps 01–06 and `chunks/` are historical: they only apply to the superseded
chunk-patch approach. For the shim path you need `shim/`, `scripts/08-*` and
`scripts/09-*`.

---

## Gotchas — Windows PowerShell

These cost real time; read them before you start.

- **PowerShell 5.1 does not support `&&`.** Use `;` and `if ($LASTEXITCODE) …`.
- **`Get-Content -Raw` does not exist** in 5.1. Read files via Node, or use
  `-join` tricks.
- **Inline `node -e` with quotes mangles** in PowerShell. Always write a
  `.cjs` file and `node script.cjs`.
- **`npm` on this machine only works as**
  `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"`.
  Bare `npm` fails with `Unknown command: "pm"`.

---

## Gotchas — editing Turbopack chunks

- Always back up the chunk before editing. A single bad byte and OmniRoute
  won't boot.
- **Never put `e.i(moduleId)` at the top level of a chunk.** A top-level
  `var __ocCtx = e.i(972495)` forces eager instantiation during module
  evaluation and crashes boot with
  `Module … was instantiated … but the module factory is not available`.
  Keep every `e.i(…)` inside a lazily-called function body.
- After every edit run `node --check <file>`. If it fails, restore from backup.
- Many chunk files are dead duplicates — patch all of them for consistency, but
  only the two that load (`_02g7gyp._.js`, `_1n6tsx0._.js`) matter at runtime.

---

## What NOT to do

- **Do not forge a bearer token.** Post-v2 this is closed and gets you flagged
  as abuse (see #50084).
- **Do not mint a fake session id locally.** The gateway now validates against
  the server's session store.
- **Do not edit OmniRoute's config, `bin/`, or `setup/`.** Only the compiled
  chunk under `dist/` is in scope for this fix.
- **Do not MITM the OpenCode CLI.** The CLI spawns its own local service and
  refuses to share a port; a captured manifest would only prove what you
  already know from the well-known endpoint.

---

## Final architecture

```
User request
   ↓
OpencodeExecutor.executeOnce
   ↓  __ocMintIfNeeded()
   │    POST http://127.0.0.1:<port>/api/session
   │    (Basic opencode:<pw>, UA opencode/latest/2.0.28/cli)
   │    → real session id ses_…
   │    → ctx.session = sid
   │    → globalThis.__ocSessionBridge = sid
   ↓
BaseExecutor.execute → buildHeaders
   ↓  forwardOpencodeClientHeaders
   │    reads ALS ctx.session, falls back to bridge
   │    sets headers["x-opencode-session"] = sid
   ↓
https://opencode.ai/inference/v1/chat/completions
   → 200
```

That's it. The trickiest part is not the session mint — it's getting the session
id across the async-context boundary between the executor and the header
builder, which `globalThis` handles cleanly.

---

## UPDATE (2026-10-15) — making the shim show up in `/dashboard/providers?mode=configured`

The shim connection existed, but the dashboard's **configured** view filters
every compatible entry by `connectionMatchesProviderCard`, which requires:

1. a `provider_nodes` row for the entry (entries are built from
   `buildCompatibleProviderGroups(providerNodes)` — no node, no card), and
2. a `provider_connections` row whose `provider` field **exactly equals** that
   node id (stats.total = count of matching connections; 0 → filtered out).

The shim connection had `provider = "openai-compatible-chat"` (generic slug)
while its node id was `openai-compatible-chat-b3760c9f-76ef-45cc-b29a-2e0f92af6b6b`
— mismatch → 0 matches → card hidden. (Orcarouter works because its connection
`provider` already equals its node id.)

### Why this can't be done via the API

`PUT /api/providers/{id}` uses `updateProviderConnectionSchema`, which has **no
`provider` field** — it is immutable through the API. The DB layer
(`updateProviderConnection` → `P()`) *does* write `provider = @provider`, so the
only path is a direct SQLite update (`storage.sqlite`, WAL mode — safe while the
server runs).

### Fix — `scripts/07-add-shim-provider.cjs`

1. Find/create the `provider_nodes` row (id `openai-compatible-chat-chat-<uuid>`,
   prefix `ocfree`, baseUrl `http://127.0.0.1:8791/v1`).
2. `UPDATE provider_connections SET provider = <node id> WHERE id = <shim conn>`.
3. Sweep combo legs still using old bare-slug ids
   (`openai-compatible-chat/<model>`) and rewrite them to
   `<node id>/<model>` — after the rename, bare-slug ids 401 with
   `No active credentials for provider: openai-compatible-chat.`

Run: `node scripts/07-add-shim-provider.cjs` (shim must be running).

### Verified

| Model id | Result |
|---|---|
| `openai-compatible-chat-b3760c9f-…/mimo-v2.6-flash-free` | 200 |
| `openai-compatible-chat-b3760c9f-…/step-5-preview-free` | 200 |
| `ocfree/mimo-v2.6-flash-free` (prefix still resolves) | 200 |
| `openai-compatible-chat/mimo-v2.6-flash-free` (old bare slug) | 401 — dead |

Combo `fries-in-the-bag` leg updated to the node-scoped id; all 7 legs verified.
