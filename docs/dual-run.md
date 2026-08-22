# Dual-run — stock Grok Bot (production) + grokbot-web (fallback)

**Hướng 2026-08-20 (ADR-F0-1):** patched `Grok Bot.exe` is the production UI. `apps/grokbot-web` is fallback/debug (risk R2) and is **not** chasing feature parity. There is **no Phase 8** that turns ACL off. Do **not** set `GROKBOT2_CURSOR_ACL=0`.

| UI | How | Wire |
|----|-----|------|
| **Stock Grok Bot** (production) | `pnpm dev:app` (`infra/scripts/run.ps1`) — verifies patch, starts 4 processes if needed, sets `CURSOR_API_BASE_URL` / `SAND_BACKEND_URL=http://localhost:8788` and `CURSOR_WEBSITE_URL=https://cursor.com`, CDP `:9222`. Not the Desktop shortcut. | `/gw/*` + ConnectRPC, **permanent** |
| **grokbot2 web** (fallback) | `pnpm web` or `infra/scripts/run-web.ps1` → `http://localhost:5173` | `/v1/*` only (OpenAPI). Vite proxies to `:8788`. |

Do **not** spawn `Grok Bot.exe` from `run-web.ps1`. Production launch is `pnpm dev:app`.

Session (web): `GET /v1/session` (loopback) then bearer on every `/v1` call. Same ticket the stock app gets from `EnsureSandBox`.

Computer pane (web): iframe of `GROKBOT2_VNC_URL` from `GET /v1/agents/{id}/computer`. Off when the URL is unset.

Write tools on the web UI show one Allow/Deny card (`askWriteTools`). `ask_question` is `kind: widget`. Roster rename/hide and mid-turn interrupt work on `/v1`. Native **handoff** card is not a product goal anymore.

**Phase gate:** from **F3**, Gate B is mandatory — `pnpm phase:gate` is **RED** if the patched app is not on CDP `:9222`. Launch with `pnpm dev:app`. Do not `--advance` unless the gate is green and you mean to move the pointer.
