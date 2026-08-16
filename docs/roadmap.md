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

## Done — the workspace pane (VNC)
The pane shows a real Linux desktop from the VPS box and takes keyboard/mouse input.
`infra/vps/grok-box-up.sh` brings the box up; `GROKBOT2_VNC_URL` in `.env` points the backend
at it; `getForeverBoxStatus`/`ensureForeverBox` hand the client the status that opens the
viewer (see [`box-architecture.md`](./box-architecture.md#what-actually-opens-the-viewer)).
Verify with `node scripts/e2e-vnc.mjs`.

## Later — the rest of the real box (exec / host)
Running *commands* in the box still needs the exec daemon; the screen does not.

1. **Package the box host** — run the app's `host-main.cjs` (it *is* the box host) on Linux.
2. **systemd unit** `grok-box@<id>` mirroring `flow-chrome@`: `Xvfb :<disp>` + `xfwm4` + `host-main`
   + `x11vnc` + `websockify`. See [`infra/systemd/grok-box@.service`](../infra/systemd/grok-box@.service).
3. **Exec daemon** on the exec port, plus the approval layer in front of it.
4. **Route inference** (`AiService/StreamChat`) from the box → the Claude/Grok pool.

At that point chat + transcript + tools + VNC all run *for real* (host-main handles them) and
this backend shrinks to auth + `EnsureSandBox` + inference routing.

## Management
- [ ] Expose backend health/config to the OpenClaw `admin-dashboard` (a "Grok Bot" tab).
- [ ] Per-box lifecycle (create/stop/status) reusing the dashboard's account model.
