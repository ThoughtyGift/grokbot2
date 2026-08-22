# The box: what a self-hosted workspace has to provide

Captured from a real, entitled account by proxying `EnsureSandBox` (see
`scripts/box-probe.mjs`). Tokens redacted; host names are per-tenant and short-lived.

## The real descriptor

```
cluster              us8
tenant_id            <20 hex>
pod_id               pod-<26 chars>
exec_daemon_url      https://<tenant>-<pod>-1337.<cluster>.cursorvm.com
vnc_url              https://<tenant>-<pod>-6080.<cluster>.cursorvm.com/vnc.html
                       ?network_token=nto-…&resume_lower_s=900&resume_upper_s=18000
                       &path=websockify%3Fnetwork_token%3D…%26resume_lower_s%3D900%26resume_upper_s%3D18000
gateway_url          https://<tenant>-<pod>-1340.<cluster>.cursorvm.com
fork_vnc_base_url    https://<tenant>-<pod>-6081.<cluster>.cursorvm.com
terminals_folder     /workspace/terminals
network_token        nto-… (also embedded in vnc_url and its websockify path)
gateway_token        <43 chars>
exec_daemon_auth_token  <short>
```

One pod, four ports:

| Port | Role |
|------|------|
| 6080 | **noVNC** — serves `vnc.html`, upgrades to `websockify` for the RFB stream |
| 6081 | fork VNC (secondary view) |
| 1337 | exec daemon — runs commands inside the box |
| 1340 | box gateway — the `/gw/api/*` surface this backend already implements |

## Why this is reproducible

`vnc_url` is **stock noVNC**: `vnc.html` plus `path=websockify` and a token in the query
string. That is exactly the `Xvfb + x11vnc + websockify + noVNC` stack, so a self-hosted box
is standard infrastructure — nothing proprietary in the viewer path.

Auth is by token in the URL, not a signed session: the app opens the URL as given, so any
host that serves noVNC on the advertised path will render.

## What actually opens the viewer

The descriptor above is **not** where the pane gets its screen. `EnsureSandBox` hands the main
process the pod's addresses, but the renderer opens the viewer off a *gateway* status object,
fetched per agent and refreshed on window focus:

| Method | Args | Reply |
|--------|------|-------|
| `getForeverBoxStatus` | `{id}` | status (below) |
| `ensureForeverBox` | `{id}` | status — a **rejection** here is what prints "Can't reach … screen" |
| `resetForeverBox` / `updateForeverBox` | `{id}` | status |
| `handBackForeverBox` | `{id, trigger}` | ignored |

```jsonc
{ "agentId": "<the id that was asked for>",   // the store keys the status by THIS field;
                                              // omit it and the agent never leaves "off"
  "state":   "running",                       // "hibernated" ⇒ sleeping, anything else ⇒ off
  "vncUrl":  "https://…/vnc.html?path=…",     // must be non-empty or there is no screen
  "windows": [],                              // extra monitors: {subagentId, title, vncUrl, handoff}
  "handoff": null,
  "pull":    null }                           // non-null ⇒ "Setting up the computer" + progress bar
```

The box host builds this by decorating its `forever-box` extension's status with `handoff`,
`hostVersion`, `hostUpdateAvailable` and `diskPressure`, and also pushes it on a `forever-box`
event channel. Only `agentId`, `state`, `vncUrl`, `windows`, `handoff` and `pull` are read by
the pane; `nextRunAt`-style extras are ignored.

The app opens `vncUrl` as given plus `autoconnect=true&resize=scale&reconnect=true`, and again
with `sandInteractive=1` for the full-size modal — two webviews on partition
`persist:sand-forever-box`. `preload-vnc.cjs` gates the clipboard bridge, liveness tripwire,
presence reporter and control-bar hider on a path ending in `/vnc.html`.

## Mapping to a self-hosted box

1. **Desktop** — `Xvfb :N` + a window manager, exactly like the OpenClaw VPS recipe for
   `flow-chrome@` (that deployment already runs this stack per account).
2. **Viewer** — `x11vnc` on the display, `websockify` in front of it serving noVNC, reachable
   as `…/vnc.html?…&path=websockify…`.
3. **Gateway** — point `gateway_url` at this backend (already implemented).
4. **Status** — answer `getForeverBoxStatus`/`ensureForeverBox` with the object above
   (`services/grokbot-backend/src/forever-box.ts`). **This is the step that lights the pane.**
5. **EnsureSandBox** — return the four URLs instead of localhost placeholders.
6. **Exec** — a daemon on the exec port for shell commands. Not required for the viewer: the
   screen works with no exec daemon at all.

Steps 1–2 are reused from the existing VPS setup; 3–5 are done. The exec daemon is the
remaining new surface, and it only gates running commands, not seeing the desktop.
