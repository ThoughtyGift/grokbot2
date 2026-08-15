# Architecture

## The seam

The Grok Bot desktop app (Electron) resolves its backend base URL from:

```js
new URL(process.env.SAND_BACKEND_URL ?? process.env.CURSOR_API_BASE_URL ?? "https://api2.cursor.sh")
```

Setting `CURSOR_API_BASE_URL=http://localhost:8788` routes **all** backend traffic to this
backend. There is no TLS pinning or response signing that blocks a localhost server;
`x-cursor-checksum` is an outbound-only header the server can ignore.

## Request flow

```
Grok Bot desktop (Electron, unchanged)
   │  CURSOR_API_BASE_URL → http://localhost:8788
   ▼
grokbot-backend
   ├─ /oauth/token, /auth/*          → mint JWT (auth.ts)
   ├─ /aiserver.v1.*/<method>        → protobuf gate responses (@grokbot2/proto)
   ├─ /gw/health, /gw/events (SSE)   → box "healthy" so the window shows (gateway.ts)
   ├─ /gw/api/<method>               → JSON host/agent methods (gateway.ts)
   │     └─ sendPrompt               → chat.ts → @grokbot2/pool-client
   ▼
admin.halcion.vn/v1/claude  (your Claude pool: subscription CLI, LB + failover)
```

## Why the app is a thin client

The desktop app is architected as a viewer onto a cloud **box** (a Linux sandbox pod):
`EnsureSandBox` returns `cluster / pod_id / vnc_url / gateway_url / exec_daemon_url`. The
workspace pane is a VNC stream of that Linux desktop (`Xvfb + x11vnc + websockify + xfwm4`).

For **chat**, we stub the box: `EnsureSandBox` points the gateway at this backend, and the
gateway serves healthy JSON so the window renders. Chat is implemented directly in the
gateway (the box's agent host role), backed by the Claude pool.

For a **working workspace/VNC**, run a real box — see [roadmap.md](roadmap.md).

## Layers in this repo

- **auth.ts** — JWT minting + `/oauth/token`. The client decodes but never verifies the sig.
- **@grokbot2/proto** — a tiny protobuf wire encoder + the bootstrap gate responses (field
  numbers/enums extracted from the client bundle; see [protocol-reference.md](protocol-reference.md)).
- **gateway.ts** — the `/gw/*` box-host API as JSON + an SSE event channel.
- **chat.ts** — an in-memory transcript store; `sendPrompt` calls the pool and appends the reply.
- **@grokbot2/pool-client** — the HTTP client for the OpenClaw Claude pool.
