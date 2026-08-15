---
description: Launch the grokbot2 backend + the stock Grok Bot app on localhost
---

Bring up the full self-host stack on localhost:

1. Free port 8788 and **unset `ELECTRON_RUN_AS_NODE`** (else the Electron exe runs headless as Node and exits).
2. Start the backend: `pnpm backend` (serves `http://localhost:8788`).
3. Launch the app pointed at it (Windows): `infra\scripts\run.ps1`, or set
   `CURSOR_API_BASE_URL=http://localhost:8788` before launching `Grok Bot.exe`.
4. Confirm: the app window renders and the backend log shows the flow `auth → bootstrap → /gw/*`.
5. For chat, ensure `services/grokbot-backend/pool-key.txt` holds a `hal_xxx` key.
