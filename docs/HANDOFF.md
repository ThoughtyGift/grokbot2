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
| **VNC workspace** | live desktop in the pane and the full-size viewer; keyboard and mouse reach the box (§6) |
| **Routines** | editor, cron scheduler, run history — fires on schedule and the model really answers |
| **Box tools** | `run_terminal_command_v2` `read_file_v2` `list_dir_v2` `glob_file_search` `ripgrep_raw_search`, running on the deployed box (§3a) |
| **Web tools** | `web_search` `web_fetch` — need neither a box nor a key, so they work on a fresh clone |
| **Question card** | `ask_question` — the turn parks, the answer resumes it |
| **Memory** | `knowledge_base`; a cold session recalls what an earlier one learned |
| **Context compaction** | long conversations are summarised instead of resent whole |
| **System prompt** | the original's own 59k-char prompt, ported and tiered (§5) |
| Coverage | **90** gateway methods handled, 0 unmapped |

**Not working**

- **Shared rooms** (9 methods) — needs a real relay; faking it would create rooms nobody can join.
- **Past-conversation search** — the original has a `PAST_CONVERSATION_EXPLORER` subagent;
  `searchAgents` here searches transcripts but only for the sidebar, the agent cannot call it.
- **Skills** — `skillsCatalog` still answers `[]`.
- Stubs that answer their declared shape but have no feature: workflows, channels,
  skills publishing, async tasks, cloud agent, teach recording, media search, groups,
  trays, MCP/plugins.

**Tests** — `services/grokbot-backend/scripts/`, all runnable with `npx tsx`:

| Suite | Covers |
|---|---|
| `test-cron` (31) | cron grammar, timezones, dom-OR-dow day semantics |
| `test-exec-daemon` (24) | daemon protocol, the directory tree, sandbox escapes |
| `test-web` (28) | html→markdown, tree rendering, live search/fetch probes |
| `test-prompt-tiers` (20) | tier order and, mainly, the shared cache prefix |
| `test-compaction` (18) | estimate, threshold, slice, malformed checkpoints |
| `test-box-tools` (11) · `test-tool-args` (11) | tool calls and quoted-argument handling |
| **`test-real-box` (14)** | the tools against the DEPLOYED box, over TLS and nginx |
| `e2e-memory` · `e2e-ask-question` · `e2e-box-tools` | model-in-the-loop, real replies |

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
| `e2e-vnc.mjs` | proves the computer pane: status shape, viewer webviews, live RFB, framebuffer dump |

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

## 6. The VNC workspace — how it was actually gated

**The box is real and serving.** `infra/vps/grok-box-up.sh` brings up Xvfb + fluxbox + xterm on
display `:77` and reuses the host's own `/opt/flow-vnc.sh` for x11vnc + websockify + the nginx
route — nothing already running is touched.

**The screen does not come from `EnsureSandBox`.** That was the wrong tree. The descriptor's
`vnc_url` is never what the viewer opens. The renderer keeps a per-agent box store fed by two
gateway methods, and *its* status is the only input to the pane:

```
getForeverBoxStatus({id})   ─┐
ensureForeverBox({id})       ├─→ status ─→ state === "running" && vncUrl ?  open <webview>
resetForeverBox / update…   ─┘                                            :  placeholder
```

Both were stubbed as `{status:"disabled"}` — a shape the store accepts and then discards, so
the pane sat on the placeholder forever. This is the same failure mode as the five argument-name
bugs in §5: the method was "handled", it just answered something nobody reads.

The status the client actually reads (`services/grokbot-backend/src/forever-box.ts`):

```jsonc
{ "agentId": "<echoes the id you were asked about>",   // the store files status by THIS field
  "state":   "running",                                // anything else ⇒ no screen
  "vncUrl":  "https://…/vnc.html?path=…websockify…",   // opened as given
  "windows": [], "handoff": null }                     // `pull` present ⇒ "Setting up the computer"
```

Placeholder text tells you which branch you are on: *Can't reach X's screen* = the read or
ensure call **rejected**; *Booting up the computer* = resolved but `state`/`vncUrl` not usable;
*Setting up the computer* = you sent a `pull`.

**What the app adds to the URL**: `autoconnect=true&resize=scale&reconnect=true`, plus
`sandInteractive=1` on the full-size viewer — so there are normally **two** webviews (preview
+ modal), both on partition `persist:sand-forever-box`. `preload-vnc.cjs` only installs the
clipboard bridge, liveness tripwire, presence reporter and control-bar hider when the path
ends in `/vnc.html`, which is why the URL must be the whole noVNC page.

**Not needed after all**: the exec daemon (port 1337). The viewer never waits on it.

**Verified end to end**, not by inspection — `node scripts/e2e-vnc.mjs`:

```
viewer webviews: 2   [preview] + [interactive]
forever-box: state=running  vncUrl=set
html class: noVNC_connected   canvas: 1920x1080
PASS: RFB session is live inside the app.
```

and by typing through the app's own viewer: `echo GROKBOT2_VNC_INPUT_OK` reached the box's
shell and the output came back on the framebuffer. Input and display both work.

**Two shape bugs found next door**, both of which crashed the whole right rail (error boundary),
taking the computer pane down with them — worth knowing because the symptom looks nothing like
the cause:

| Method | Missing | What throws |
|--------|---------|-------------|
| `getAgentAutomations` etc. | `runs: []` | the row icon reads `automation.runs[0]?.status` **unguarded** |
| `getSharingState` | `rooms: []` | the sharing store does `v.rooms.map(…)` **unguarded** |

**Configure it**: put the URL `infra/vps/grok-box-up.sh` prints into `.env` as
`GROKBOT2_VNC_URL` (the repo root `.env` is loaded by `config.ts`; real env vars still win).
Leave it unset and the pane honestly reports the box as off.

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
