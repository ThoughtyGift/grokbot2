# Spike findings

How the self-host was validated, milestone by milestone.

## 1. The redirect seam works
Setting `CURSOR_API_BASE_URL=http://localhost:PORT` routes every backend call to localhost.
No TLS pinning, no cert check, no response signing. `x-cursor-checksum` is outbound-only.

**Gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set in the environment, the Electron exe runs as
plain Node (no GUI) and exits immediately. Unset it before launching.

## 2. Auth is stubbable
First call is `POST /oauth/token` with a stored refresh token. Returning a self-minted JWT is
accepted — the client decodes the payload (exp/email/sub) but does **not** verify the signature.

## 3. Bootstrap gates → UI enters
~15 ConnectRPC calls gate rendering. Returning valid protobuf (esp. `GetSandAccessStatus=GRANTED`,
`GetMe`, `EnsureSandBox`) moves the app past auth/paywall. The React renderer loads (a 1440×759
BrowserWindow is created) but stays **hidden** pending a healthy box.

## 4. Box gateway → window shows
The app connects to `gateway_url` and polls `/gw/api/*` + `/gw/health` + `/gw/events` (SSE).
Returning healthy JSON shapes (`getHostStatus.isBusy=false`, `listAgents:[]`, SSE kept open)
makes the app show its **main workspace UI** — verified with a screenshot: sidebar, composer
("Ask anything…"), account chip, all rendered against localhost.

## 5. Chat → Claude pool
Typing calls `sendPrompt` (not `StreamChat` directly — the agent loop lives in the box). The
gateway plays the box's agent-host role: append the user turn, call the Claude pool, append the
assistant turn; the frontend reads it back via `getAgentTranscriptTail`. Validated end-to-end at
the HTTP layer (`createAgent → sendPrompt → transcript`).

## What's NOT done
- The **VNC/exec box** — a real Linux desktop for the workspace pane. Chat doesn't need it.
- Rich transcript features (tool calls, streaming deltas, widgets) — only plain text so far.

## Reuse from OpenClaw (admin.halcion.vn)
- **Brain:** the Claude pool endpoint — subscription CLI, LB+failover, no API-token cost.
- **Box (future):** the VPS already runs `Xvfb + x11vnc + websockify + noVNC` per-account
  (`flow-chrome@`, `flow-vnc.sh`) — the same stack the Grok Bot box needs. See [roadmap.md](../roadmap.md).
