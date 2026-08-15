# grokbot-desktop (FE)

The **frontend is the stock Grok Bot Electron app** — a signed binary we do **not** own the
source of. It is installed at `%LOCALAPPDATA%\Programs\Grok Bot\Grok Bot.exe`.

This package holds only the **launch configuration** that points that app at our local backend:

- `CURSOR_API_BASE_URL=http://localhost:8788` (and `SAND_BACKEND_URL`) → routes the app's backend
  traffic to `services/grokbot-backend`.
- **Unset `ELECTRON_RUN_AS_NODE`** before launching, or the exe runs headless as Node and exits.

There is **no build step** and no source to compile here — the UI ships inside the signed app.
The Windows launcher lives at [`../../infra/scripts/run.ps1`](../../infra/scripts/run.ps1).

If we ever build our own frontend (independent of the stock app), it goes here as a real app.
