# grokbot-desktop (FE)

The **frontend is the stock Grok Bot Electron app** — a signed binary we do **not** own the
source of. It is installed at `%LOCALAPPDATA%\Programs\Grok Bot\Grok Bot.exe`.

This package holds only the **launch configuration** that points that app at our local backend.
Use `pnpm dev:app` (repo root) or `pnpm start` here — both run [`../../infra/scripts/run.ps1`](../../infra/scripts/run.ps1):

- `CURSOR_API_BASE_URL` and `SAND_BACKEND_URL` = `http://localhost:8788`
- `CURSOR_WEBSITE_URL=https://cursor.com` (otherwise localhost API base is treated as dev and login goes to `https://localhost:4443`)
- **Unset `ELECTRON_RUN_AS_NODE`** before launching, or the exe runs headless as Node and exits
- `--remote-debugging-port=9222` for CDP / Gate B

There is **no build step** and no source to compile here — the UI ships inside the signed app.

The independent grokbot2 UI is [`apps/grokbot-web`](../grokbot-web) (fallback/debug). This package is the
stock-exe launch config. ACL + `/gw` stay for as long as this exe is the production UI (ADR-F0-1).
