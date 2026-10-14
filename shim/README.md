# Local shim — restore OmniRoute's OpenCode free models (current solution)

OpenCode now blocks **all** direct free-tier requests to `opencode.ai`, no
matter what headers or session ids you send. The only accepted path is
**through the local opencode server**.

This shim exposes an OpenAI-compatible `/v1/chat/completions` backed by that
local server, so OmniRoute can use it as an ordinary custom provider.

**No OmniRoute edits. No chunk patching. No restarts.**

---

## TL;DR

```powershell
node opencode-free-shim.cjs        # listens on 127.0.0.1:8791
node test-shim.cjs                 # verify it works
```

Then in the OmniRoute dashboard:

| Setting | Value |
|---|---|
| Provider | **OpenAI Compatible** (custom) |
| Base URL | `http://127.0.0.1:8791/v1` |
| API Key | anything, e.g. `local` |
| Model | `opencode/mimo-v2.6-flash-free` |

**Verified OmniRoute connection settings (what we actually used):**

| Setting | Value |
|---|---|
| Provider slug | `openai-compatible-chat` |
| Base URL | `http://127.0.0.1:8791/v1` |
| API Key | any non-empty string |
| Prefix | `ocfree` (cosmetic only — **not** used for routing) |
| Call model as | `openai-compatible-chat/mimo-v2.6-flash-free` |

**The routing key is the provider slug, not the prefix.** `ocfree/mimo-v2.6-flash-free`
returns 401 because OmniRoute routes by `{provider-slug}/{model}`. Use
`openai-compatible-chat/mimo-v2.6-flash-free` in your OmniRoute combo.

Done. Free models work again.

---

## Requirements

- `opencode` CLI v2 installed and **logged in** (`opencode auth login`)
- The opencode service running (`opencode service status` should show a URL)
- Node ≥ 18

The shim reads the service URL and password automatically from:

```
%LOCALAPPDATA%\opencode-data\state\opencode\service.json
```

---

## What it does

```
OmniRoute  (OpenAI-compatible POST /v1/chat/completions)
   ↓
shim
   ↓  POST /api/session                              → real session id
   ↓  POST /api/session/{id}/model    {id, providerID}
   ↓  POST /api/session/{id}/prompt   {text}
   ↓  GET  /api/session/{id}/message  → poll until finished assistant msg
   ↓
OpenAI-shaped response back to OmniRoute
```

Compared to my earlier approach (session mint + header injection into
OmniRoute's compiled chunks), this has:

- **no** dependency on which Turbopack chunk maps happen to load at runtime
- **no** compiled-bundle edits that break on OmniRoute updates
- **no** risk of breaking OmniRoute's boot
- **no** restarts of the live server

---

## Files

```
shim/
├── opencode-free-shim.cjs   the shim
├── test-shim.cjs            smoke test (health, models, chat)
├── start-shim.cmd           launch (hidden window)
├── launch-shim.cmd          launch + health check
├── start-shim.vbs           autostart (no console window)
├── autostart.sh             launch (Linux/macOS)
└── README.md                this file
```

## Autostart

The shim must be running before OmniRoute needs it. On Windows, the simplest
approach (no admin needed) is a Startup folder shortcut:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OmniRoute OpenCode Shim.lnk
  → runs start-shim.vbs
  → node opencode-free-shim.cjs  (hidden window)
```

On Linux/macOS, run `shim/autostart.sh` from your session startup script.

---

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | returns `{ok:true, service:"http://127.0.0.1:49374"}` |
| `GET` | `/v1/models` | live free+paid model list from the local server |
| `POST` | `/v1/chat/completions` | full chat, returns `choices[0].message.content` |

The shim ignores the `Authorization` header entirely — OmniRoute just needs a
non-empty value.

---

## Supported request fields

| Field | Handled |
|---|---|
| `model` | `"opencode/mimo-v2.6-flash-free"` or bare `"mimo-v2.6-flash-free"` |
| `messages[]` | flattened into one prompt, prefixed by role (`USER: …`, `ASSISTANT: …`) |
| `messages[].content` | string or array-of-parts (text parts joined) |

`max_tokens`, `temperature`, `stream`, etc. are **not** forwarded — the local
API doesn't accept them. Streaming is emulated as a single non-streamed reply.

---

## Gotchas

- **Assistant messages arrive twice.** The local server emits a reasoning-only
  message first, then a text message with `finish` set. The shim waits for
  `last.finish && text` before returning, otherwise you get an empty reply.
- **Model must be set with `{id, providerID}`** — not `{providerID, modelID}`
  and not just a string. The OpenAPI schema requires both `id` and `providerID`.
- **Prompt field is `{text}`**, not `{parts:[{type:'text',text}]}`. The latter
  returns `Missing key at ["text"]`.
- **There is no OpenAI surface on the local server.** `/openai/v1/...` returns
  the SPA HTML catch-all on GET and 405 on POST — don't point OmniRoute at it.
- **The shim must keep running.** If OmniRoute can't reach it, opencode legs
  will fail. It autostarts via a Startup folder shortcut
  (`OmniRoute OpenCode Shim.lnk` → `start-shim.vbs`). If you removed the
  shortcut, run `start-shim.cmd` manually.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `502 {error:"opencode service.json not found…"}` | service.json missing/not logged in | run `opencode auth login`, confirm `opencode service status` |
| Empty `content` in the response | took the reasoning-only message | the shim now waits for `finish && text` — restart it |
| `405` from the gateway | you pointed OmniRoute at `opencode.ai` directly | use `http://127.0.0.1:8791/v1` |
| Slow first reply | cold model load | normal, ~2–4 s |
