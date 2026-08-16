# Handoff — Grok Bot 2 self-host

Everything needed to pick this up cold: what runs today, how to start it, what was learned the
hard way, and exactly where the VNC work stopped.

---

## 1. What this is

The stock **Grok Bot** desktop app (a rebranded Cursor agent, internal name `sand`, v0.20.0,
signed by Anysphere) pointed at a **self-hosted backend** instead of `api2.cursor.sh`, with the
model served by the owner's **Claude/Gemini pool** at `admin.halcion.vn`.

The app resolves its backend from `CURSOR_API_BASE_URL`. There is no TLS pinning and no
response signing, so a local server can answer for it.

```
Grok Bot desktop (unchanged, signed)
   │  CURSOR_API_BASE_URL → http://localhost:8788
   ▼
grokbot2 backend            ← this repo
   ├─ /oauth/token              mint a JWT (the client never verifies the signature)
   ├─ /aiserver.v1.*/<method>   protobuf gate responses (GetMe, GetSandAccessStatus…)
   ├─ /gw/* (JSON + SSE)        the box gateway: roster, transcript, settings, chat
   └─ chat → admin.halcion.vn   the model pool (subscription CLI, no per-token cost)
```

---

## 2. State today

**Working, verified in the real UI**

| Area | Notes |
|------|-------|
| Boot, auth, render | app opens straight into the workspace |
| Roster | list · create · rename · delete · duplicate · hide · unread · avatar · notification flags |
| Chat | real replies from the pool, typewriter animation, markdown |
| Reactions | chips render; same emoji toggles off |
| Tool calls | model emits `TOOL_CALL:` → approval card → approve → result → follow-up answer |
| Transcript | paging (`beforeSeq`), outline, search, interrupt |
| Persistence | agents, transcripts, settings, acceptance ledger survive restarts |
| Coverage | **78 / 87** coordinator methods handled |

**Not working**

- **VNC workspace pane** — the box is built and serving (below), but the app still shows
  "Can't reach … screen" and never opens the viewer. This is where to resume.
- **Shared rooms** (9 methods) — needs a real relay; faking it would create rooms nobody can join.
- Stubs that answer their declared shape but have no feature: workflows, automations, channels,
  skills publishing, subagents, async tasks, cloud agent, forever-box, teach recording,
  media search, groups, trays, MCP/plugins.

---

## 3. Running it

```bash
pnpm install
echo "hal_…" > services/grokbot-backend/pool-key.txt   # key from admin.halcion.vn → API Keys
pnpm backend                                            # http://localhost:8788
```

Launch the app (Windows):

```powershell
infra\scripts\run.ps1
```

Or by hand — **these three details matter**:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE          # else the exe runs as Node with no window
$env:CURSOR_API_BASE_URL = 'http://localhost:8788'
$env:CURSOR_WEBSITE_URL  = 'https://cursor.com'   # else login goes to https://localhost:4443
& "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe" --remote-debugging-port=9222
```

**Two instances side by side** (local build vs the original): the single-instance lock is scoped
to the profile, so give the second one its own `--user-data-dir` and debugging port.

```powershell
$env:SAND_USER_DATA_DIR = 'C:\Users\admin\Desktop\grokbot2\.data\profile-real'
& "$exe" --remote-debugging-port=9333 --user-data-dir=$env:SAND_USER_DATA_DIR
node services/grokbot-backend/scripts/label-window.mjs --cdp http://127.0.0.1:9333 --title "GOC"
```

**Model** — `GROKBOT2_MODEL`, default `gemini-3.7-flash`. Measured round-trip through the pool:
gemini-2.5-flash ~0.8s · gemini-3.7-flash ~2s · sonnet ~5.7s · haiku ~6s · grok-4.5 ~12s.

---

## 4. Tooling built along the way

All under `services/grokbot-backend/scripts/`, all driving the real app over CDP:

| Script | What it does |
|--------|--------------|
| `e2e-coverage.mjs` | replays every method the client bundle declares → HANDLED vs NOT MAPPED |
| `e2e-ui.mjs` | probes the live UI, types in the composer, screenshots |
| `e2e-tool.mjs` | full tool loop: ask → approval card → approve → answer |
| `e2e-console.mjs` | watches renderer console during a round-trip |
| `box-probe.mjs` | logging pass-through to the real backend; decodes the box descriptor |
| `label-window.mjs` | distinct window titles when two instances run |
| `capture-box.mjs` | hooks MessagePort (returned nothing useful — box traffic is host-side) |

`GROKBOT2_LOG=1` makes the gateway log every method **with its arguments** — that is how the
argument-shape bugs below were found.

---

## 5. Findings worth keeping

**Two audits, two different failure modes.** Method coverage says whether a method is handled;
it says nothing about whether the handler reads the right keys. Five bugs were of the second
kind, and each one silently killed a feature:

| The FE sends | We read (wrong) | Symptom |
|--------------|-----------------|---------|
| `{id, limit, beforeSeq}` | `agentId` | **every transcript came back empty — no replies rendered** |
| `{id, profile:{name}}` | `name` | rename did nothing |
| `{id, isUnread}` / `{id, isHidden}` | `unread` / `hidden` | sidebar toggles were no-ops |
| `{…, resolution:"always"\|"allow-once"\|"never"\|"deny"}` | `approved` | approving a tool did nothing |
| reactions as `[{emoji, by}]`, `by==="me"` | `string[]` | no reaction chips |

**Contracts that are easy to get wrong**

- `createAgent` must return `{agent, transcript}` — the client reads `result.agent.id`.
- Transcript entry kinds are `message | tool-call | send-message | user-attachment | notice |
  event`. `user-message`/`agent-message` are the *shared-room* serializer's shapes and are
  dropped silently.
- A transcript page needs `reachable: true` plus numeric `seq` / `beforeSeq` / `nextBeforeSeq`.
- `promptAcceptanceStatus({clientNonce})` must answer `{outcome:"found", record:{status,
  echoEntryId,…}}`, and the ledger must **persist** — otherwise every message shows
  "Failed to send" after a backend restart.

**Environment traps**

- `ELECTRON_RUN_AS_NODE=1` makes the signed exe run as plain Node: it exits instantly with no
  window. This cost hours before it was spotted.
- With a localhost `CURSOR_API_BASE_URL` the app switches to dev mode and sends login to
  `https://localhost:4443`. Set `CURSOR_WEBSITE_URL=https://cursor.com`.
- The pool's streaming route intermittently completes with **no deltas** (HTTP 200,
  finish_reason stop). Empty streams fall back to the non-streaming route.
- Killing the backend by "the node process" is not enough — kill the **port owner**; tsx leaves
  a child holding 8788 and you end up testing stale code.

**Login / entitlement** — the session lives in `sand-secrets.json` inside the profile
(`cursor-access-token`, `cursor-refresh-token`). Delete it to sign out. Grok Bot itself requires
an **Ultra plan**; a Free account sees "Grok Bot needs an Ultra plan" and gets no box.

---

## 6. Where the VNC work stopped

**The box is real and serving.** `infra/vps/grok-box-up.sh` brings up Xvfb + fluxbox + xterm on
display `:77` and reuses the host's own `/opt/flow-vnc.sh` for x11vnc + websockify + the nginx
route — nothing already running is touched.

Verified on the host and from the Windows machine:

```
X77 socket           present
x11vnc               RFB 003.008        ← real handshake, not just LISTEN
noVNC 127.0.0.1:7077 HTTP 200
https://admin.halcion.vn/flowvnc-grokbox/vnc.html   HTTP 200 (also from Windows)
```

**The real descriptor** (captured from an entitled account, see `docs/box-architecture.md`):
one pod, four ports — 6080 noVNC (`vnc.html` + `path=websockify` + token in the query),
6081 fork VNC, 1337 exec daemon, 1340 gateway. The viewer path is **stock noVNC**, which is why
the VPS recipe is a valid substitute.

**What is wired**: `EnsureSandBox` returns the box URLs from
`GROKBOT2_VNC_URL / _EXEC_URL / _GATEWAY_URL / _FORK_VNC_URL / _POD_ID / _CLUSTER`, with
`fork_vnc_base_url` defaulted (the viewer config needs primaryUrl + forkBaseUrl + networkToken
together, or the whole block is rejected).

**What still fails**: the app shows "Can't reach … screen" and **never opens a webview** — no
VNC target ever appears in CDP. Ruled out already: URL unreachable (it is reachable), missing
fork URL (added), instant replies on the `/gw/local-exec/requests` and `/gw/webauthn/requests`
long-poll channels (now parked for 25s).

**Leads for the next session**

1. The gate is in the **main process**, not the gateway — the app never asks the gateway about
   the screen (confirmed from the argument log). Trace `n9n(gatewayUrl, gatewayToken,
   networkToken, {primaryUrl, forkBaseUrl})` in `electron-main/main.cjs` and find what must
   succeed before the viewer is created.
2. `preload-vnc.cjs` (18 KB, readable) references `noVNC` and `vnc.html` — read it end to end;
   it is the viewer's own contract.
3. The exec daemon (port 1337 on a real box) does not exist here yet. The box may be considered
   unreachable until the exec channel handshakes.
4. Compare against the original app while it runs: `box-probe.mjs` already decodes the real
   descriptor, and both instances can run side by side.

---

## 7. Repo map

```
services/grokbot-backend/   auth · bootstrap RPC · gateway · chat bridge · scripts
packages/grokbot-proto/     protobuf encoder + bootstrap responses (EnsureSandBox lives here)
packages/pool-client/       HTTP client for the model pool (streaming + fallback)
infra/scripts/run.ps1       Windows launcher
infra/vps/grok-box-up.sh    brings up the VNC box on the VPS
docs/                       architecture · protocol-reference · box-architecture · audit · roadmap · legal
.data/                      local state, captured descriptors, screenshots (gitignored)
```

Repo: `github.com/ThoughtyGift/grokbot2` (private).

> Scope note: this is personal/research use against the owner's own account and infrastructure.
> See `docs/legal.md`.
