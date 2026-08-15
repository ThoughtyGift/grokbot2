---
name: project-grokbot2-overview
description: What grokbot2 is and how the self-host works end to end
metadata:
  type: project
---

**grokbot2** self-hosts the stock **Grok Bot** desktop app (Cursor's `sand` build, v0.20.0,
signed by Anysphere). Set `CURSOR_API_BASE_URL=http://localhost:8788` (and unset
`ELECTRON_RUN_AS_NODE`, else the exe runs headless as Node) → the app talks to the local backend.

**Backend** (`services/grokbot-backend`) answers three layers so the real UI renders:
1. Auth `/oauth/token` → self-minted JWT (client does NOT verify the signature).
2. Bootstrap ConnectRPC (`aiserver.v1.*`) → protobuf gate responses (`GetSandAccessStatus`=GRANTED,
   `GetMe`, `EnsureSandBox`…). Encoder + responses in `packages/grokbot-proto`.
3. Box gateway `/gw/api/*` (JSON) + `/gw/events` (SSE, kept open) + `/gw/health` → the app shows
   its main window. Chat lives here: `sendPrompt` → Claude pool → transcript entry.

**Brain** = the OpenClaw Claude pool: `POST admin.halcion.vn/v1/claude` Bearer `hal_xxx`
(subscription CLI, LB+failover, no API-token cost). Key in `services/grokbot-backend/pool-key.txt`
(gitignored). No raw key exists in the OpenClaw repo — create one at admin.halcion.vn → API Keys.

**Not built:** the real VNC/exec box (a Linux desktop for the workspace pane). Chat doesn't need it.
Reuse OpenClaw's VPS `Xvfb+x11vnc+websockify` recipe (`flow-chrome@`, `flow-vnc.sh`) — see `docs/roadmap.md`.

Repo: `github.com/ThoughtyGift/grokbot2` (private). Reference bundle decompiled under the session scratchpad.
