# Grok Bot 2 — Claude Code project instructions

Self-hosted backend for the **Grok Bot** desktop agent: point the stock frontend at a local
backend + your Claude pool (`admin.halcion.vn`). User-facing quickstart in [README.md](README.md).

> Personal / research use only. Grok Bot is a rebranded Cursor (Anysphere) desktop agent; this
> backend emulates the contract its client speaks. See [docs/legal.md](docs/legal.md).

## Structure — BE / FE / API map

| Concern | Folder | What |
|---------|--------|------|
| **FE** (frontend) | `apps/grokbot-desktop/` | the **stock Grok Bot Electron app** + launch config (no source to build) |
| **BE** (backend) | `services/grokbot-backend/` | glue server: auth + bootstrap RPC + box gateway + chat bridge |
| **API** (contract) | `packages/grokbot-proto/`, `packages/pool-client/` | protobuf encoder/responses + Claude-pool HTTP client |
| infra | `infra/` | Windows launcher + systemd unit for a future VPS box |
| docs | `docs/` | architecture · protocol-reference · spike-findings · roadmap · legal |

Monorepo: **pnpm workspaces + Turborepo**. Node ≥20, TypeScript (ESM, strict).

## Commands

| | |
|---|---|
| `pnpm install` | install workspace |
| `pnpm backend` | run backend on `localhost:8788` |
| `pnpm typecheck` / `pnpm build` | turbo across workspace |
| `infra\scripts\run.ps1` | launch backend + the app (Windows) |

## Where to change things

- Add/adjust a **bootstrap RPC** response → `packages/grokbot-proto/src/bootstrap.ts`
- Add a **gateway method** → `services/grokbot-backend/src/gateway.ts` (the `methods` map)
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
[docs/spike-findings.md](docs/spike-findings.md) and [docs/protocol-reference.md](docs/protocol-reference.md).
The decompiled bundle (reference only, not in this repo) lives under the session scratchpad.
