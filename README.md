# Grok Bot 2 — self-host backend

Point the **stock Grok Bot desktop app** at your own backend so it renders and chats
against **your Claude pool** (`admin.halcion.vn/v1/claude`) instead of Cursor's servers —
no per-token API cost, full control.

> ⚠️ **Personal / research use.** Grok Bot is a rebranded Cursor (Anysphere) desktop agent.
> This project emulates the backend contract its client speaks so you can self-host the
> brain. The **patched stock app is the production UI** ([ROADMAP.md](ROADMAP.md) F0–F7;
> `apps/grokbot-web` is fallback). Do not redistribute or impersonate Cursor infrastructure. See [docs/legal.md](docs/legal.md).

## What it does

The desktop app resolves its backend from `CURSOR_API_BASE_URL`. This backend answers the
three layers the client needs, so the real UI renders and works:

| Layer | This backend |
|-------|--------------|
| Auth (`/oauth/token`) | mints a self-signed JWT (client doesn't verify the signature) |
| Bootstrap ConnectRPC (`aiserver.v1.*`) | protobuf gate responses (`GetMe`, `GetSandAccessStatus=GRANTED`, `EnsureSandBox`, …) |
| Box gateway (`/gw/api/*` + SSE) | healthy JSON shapes so the workspace window shows |
| Chat (`sendPrompt`) | routed to your Claude pool via `@grokbot2/pool-client` |

Not included yet: the VNC/exec **box** (a real Linux desktop). Chat does not need it. See
[docs/roadmap.md](docs/roadmap.md) for running a real box on a VPS.

## Structure (pnpm + Turborepo)

```
services/grokbot-backend   the glue server (auth + bootstrap + gateway + chat)
packages/pool-client       HTTP client for admin.halcion.vn/v1/claude
packages/grokbot-proto     protobuf encoder + bootstrap response builders
infra/                     launch script + systemd unit for a future VPS box
docs/                      architecture, protocol reference, spike findings
```

## Quickstart

```bash
pnpm install
# put your hal_xxx pool key here (gitignored):
echo "hal_xxxxxxxx" > services/grokbot-backend/pool-key.txt
pnpm backend                      # computer :8790 + runtime :8789 + ops :8791 + BFF :8788
```

Then launch the **patched stock app** (production UI):

```powershell
pnpm dev:app                  # 4-process stack + Grok Bot.exe on CDP :9222
```

If the client is not patched, that command exits 2 and prints `node infra/scripts/patch-client.mjs --apply`.

Fallback UI (debug only, not feature-parity):

```powershell
pnpm web                      # http://localhost:5173  (/v1 only)
```

## License

Personal use. Not affiliated with Anysphere/Cursor or xAI.
