# Roadmap

## Done
- [x] Redirect seam + auth stub
- [x] Bootstrap ConnectRPC gates (UI renders)
- [x] Box gateway + SSE (main window shows)
- [x] Chat bridge → Claude pool (`admin.halcion.vn/v1/claude`)

## P0 — core chat + roster (done)
- [x] Roster mutations: updateAgent (rename), deleteAgents, duplicateAgent, setAgentUnread, setAgentHiddenFromSidebar
- [x] interruptAgentRun — abortable in-flight pool call
- [x] reactToMessage / voteFeedback / promptAcceptanceStatus
- [x] getConversationOutline
- [x] Progressive (typing-style) reveal of the pool reply
- [x] Multi-turn context, agent naming

## P1 — in progress
- [x] Approval pipeline plumbing: `resolveLocalToolPermission`, `resolveAutoReviewApproval`,
  `respondToWidget`, `submitSecret`, `dismissWidget` (state machine HTTP-verified).
- [x] Tool-call + `send-message` (permission card) transcript entry kinds, with a SAFE demo tool
  registry (`echo`/`time`/`reverse`/`upper`, no system access) triggered by `/tool <name> <arg>`.
- [ ] **Live-verify** the card render in the app UI; iterate the entry shape if the coordinator
  doesn't map `kind:"tool-call"` / `kind:"send-message"` as expected.
- [ ] Attachments/images (pool supports `image`; schema has `images[]`); agent avatars; per-agent notifications; trays content.
- [ ] Real token streaming (needs a streaming pool endpoint; current reveal is client-side).
- [ ] Settings write-back (`setHostSettings` currently discards).
- [ ] A real tool-emitting agent loop (so tool-calls fire without the `/tool` trigger).

## Later — the real box (workspace / VNC / exec)
The workspace pane is a VNC view of a Linux desktop. Reuse the OpenClaw VPS recipe:

1. **Package the box host** — run the app's `host-main.cjs` (it *is* the box host) on Linux.
2. **systemd unit** `grok-box@<id>` mirroring `flow-chrome@`: `Xvfb :<disp>` + `xfwm4` + `host-main`
   + `x11vnc` + `websockify`. See [`infra/systemd/grok-box@.service`](../infra/systemd/grok-box@.service).
3. **Point `EnsureSandBox`** at the VPS: `gateway_url`/`vnc_url`/`exec_daemon_url` → the box.
4. **Route inference** (`AiService/StreamChat`) from the box → the Claude/Grok pool.

At that point chat + transcript + tools + VNC all run *for real* (host-main handles them) and
this backend shrinks to auth + `EnsureSandBox` + inference routing.

## Management
- [ ] Expose backend health/config to the OpenClaw `admin-dashboard` (a "Grok Bot" tab).
- [ ] Per-box lifecycle (create/stop/status) reusing the dashboard's account model.
