# infra

- **scripts/run.ps1** — Windows launcher: starts `grokbot-backend` + the stock Grok Bot app
  with `CURSOR_API_BASE_URL` pointed at it. Unsets `ELECTRON_RUN_AS_NODE` (else the exe runs
  headless as Node).
- **systemd/grok-box@.service** — *future* VPS unit to run the real Linux box (Xvfb + x11vnc +
  host-main). Mirrors OpenClaw's `flow-chrome@`. Not needed for chat. See [../docs/roadmap.md](../docs/roadmap.md).

Chat needs only the backend + a `hal_xxx` pool key. The box is for the workspace/VNC pane.
