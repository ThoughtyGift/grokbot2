---
description: Launch the grokbot2 backend + the patched Grok Bot app on localhost
---

Bring up the full self-host stack on localhost:

1. **One command:** `pnpm dev:app` (`infra/scripts/run.ps1`).
   - Unsets `ELECTRON_RUN_AS_NODE`.
   - Fails closed if the client is not patched (`node infra/scripts/patch-client.mjs --apply` first).
   - Starts `pnpm backend` if `:8788` is down (computer `:8790`, runtime `:8789`, ops `:8791`, BFF `:8788`).
   - Clears leftover node listeners on **8792–8817**.
   - Launches patched `Grok Bot.exe` with `CURSOR_API_BASE_URL` / `SAND_BACKEND_URL=http://localhost:8788`, `CURSOR_WEBSITE_URL=https://cursor.com`, and `--remote-debugging-port=9222`.
2. Confirm: the app window renders and the backend log shows `auth → bootstrap → /gw/*`.
3. For chat, ensure `services/grokbot-backend/pool-key.txt` holds a `hal_xxx` key.

Fallback UI (debug): `pnpm web` — never from this command.
