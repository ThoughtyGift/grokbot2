# Grok Bot 2 — Claude Code project instructions

Self-hosted backend for the **Grok Bot** desktop agent: point the stock frontend at a local
backend + your Claude pool (`admin.halcion.vn`). User-facing quickstart in [README.md](README.md).

> Personal / research use only. Grok Bot is a rebranded Cursor (Anysphere) desktop agent; this
> backend emulates the contract its client speaks. See [docs/legal.md](docs/legal.md).

## Structure — BE / FE / API map

| Concern | Folder | What |
|---------|--------|------|
| **FE** (frontend) | `apps/grokbot-desktop/` + patched `Grok Bot.exe` | production UI. Fallback: `apps/grokbot-web/` |
| **BE** (backend) | `services/grokbot-backend/` | glue server: auth + bootstrap RPC + box gateway + chat bridge |
| **API** (contract) | `packages/grokbot-proto/`, `packages/pool-client/` | protobuf encoder/responses + Claude-pool HTTP client |
| infra | `infra/` | Windows launcher + systemd unit for a future VPS box |
| docs | `docs/` | architecture · protocol-reference · spike-findings · roadmap · legal |

Monorepo: **pnpm workspaces + Turborepo**. Node ≥20, TypeScript (ESM, strict).

## Commands

| | |
|---|---|
| `pnpm install` | install workspace |
| `pnpm backend` | four processes: computer `:8790` + runtime `:8789` + ops `:8791` + BFF `:8788` |
| `pnpm dev:app` | F2 launcher: that stack + patched `Grok Bot.exe` on CDP `:9222` |
| `pnpm web` | fallback Vite UI on `localhost:5173` (proxies `/v1`) |
| `pnpm phase:gate` | current phase from `docs/parity-runs/phase-current.json`. From **F3**, CDP `:9222` is required (RED if missing). `--phase F3` measures without moving the pointer. |
| `node services/grokbot-backend/scripts/build-setup.mjs --with-app` | dựng bộ cài **chở cả ứng dụng** (~118 MB, mất vài phút). Máy nhận **không cần** client cài trước, **không cần** Node — đúng hình dạng bộ cài của hãng. Gói này chứa client của nhà phát hành: dùng cho máy của chính bạn. |
| `node services/grokbot-backend/scripts/build-setup.mjs` | dựng **hai** gói cài mà trang tải phát ra → `.data/dist/bot-noi-bo-setup-{win,mac}-<ngày>.zip`. Gói KHÔNG chứa app: nó vá client người dùng đã tự cài, tạo lối mở mang 4 biến, và ghi địa chỉ backend. Bản Mac **chưa chạy thử trên máy Mac thật**. |
| `node services/grokbot-backend/scripts/serve-site.mjs` | máy chủ **chỉ phát trang tải + file cài** (0.0.0.0:8080), để máy khác cùng LAN tải app về — không phơi backend. Đưa lên VPS: [docs/plan/publish-download-site.md](docs/plan/publish-download-site.md) |
| `http://localhost:8788/` | trang tải (`apps/grokbot-site/index.html` qua `src/site.ts`) — công khai, không qua `checkAuth`, vì cửa này dành cho người chưa có token lẫn app |
| `pnpm typecheck` / `pnpm build` | turbo across workspace |
| `http://localhost:8788/admin?token=<.data/gateway-token.txt>` | box capacity board — how many more bots fit, and whether RAM or disk binds. Read-only on purpose: six of the Chromes on that box are **not ours** (see [docs/plan/one-display-per-bot.md](docs/plan/one-display-per-bot.md)). |
| `infra\scripts\start-app.cmd` | double-click launcher (Desktop shortcut "Grok Bot (local)"). **Never double-click the installed `Grok Bot.exe`** — it starts with none of the four env vars, so it talks to the vendor's servers *and* can auto-update over the patch set. |
| `infra\scripts\check-app.cmd` | which backend is the app talking to? Counts real RPC traffic for 6s. |
| `infra\scripts\run-web.ps1` | Vite FE only — does not spawn `Grok Bot.exe` |
| `python -m venv services/grokbot-backend/.venv-stt` then `.venv-stt\Scripts\pip install faster-whisper` | the composer's microphone. Runs offline; the model downloads on first use. Without it `TranscribeAudio` answers empty text and the mic silently does nothing. |

## Where to change things

- Add/adjust a **bootstrap RPC** response → `packages/grokbot-proto/src/bootstrap.ts`
- Add a **gateway method** → `services/grokbot-backend/src/gateway.ts` (the `methods` map)
- Add/adjust a **native `/v1` route** → `services/grokbot-backend/src/native.ts`
- **Independent UI** → `apps/grokbot-web/`
- **Chat** behavior / transcript shape → `services/grokbot-backend/src/chat.ts`
- Point the **brain** elsewhere → `services/grokbot-backend/src/config.ts` (+ `pool-key.txt`)

## Conventions

- TypeScript ESM, strict; small focused modules; match surrounding style.
- **Never commit secrets** — `pool-key.txt`, `.env`, `*-key.txt` are gitignored. Keys via file/env only.
- The backend must stay a faithful emulation of the client contract — verify against
  [docs/protocol-reference.md](docs/protocol-reference.md) before changing response shapes.
- Conventional commits (`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`). Attribution disabled.

## Reverse-engineering context

The Grok Bot client is Cursor's `sand` build (v0.20.0). Findings + protocol are captured in
[docs/reverse/spike-findings.md](docs/reverse/spike-findings.md) and [docs/protocol-reference.md](docs/protocol-reference.md).
The decompiled bundle (reference only, not in this repo) lives under the session scratchpad.
