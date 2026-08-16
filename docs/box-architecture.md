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

## Mapping to a self-hosted box

1. **Desktop** — `Xvfb :N` + a window manager, exactly like the OpenClaw VPS recipe for
   `flow-chrome@` (that deployment already runs this stack per account).
2. **Viewer** — `x11vnc` on the display, `websockify` in front of it serving noVNC, reachable
   as `…/vnc.html?…&path=websockify…`.
3. **Gateway** — point `gateway_url` at this backend (already implemented).
4. **Exec** — a small daemon on the exec port for shell commands (the approval layer is here).
5. **EnsureSandBox** — return the four URLs above instead of localhost placeholders.

The viewer (1–2) is the piece worth reusing from the existing VPS setup; the gateway is done;
the exec daemon is the remaining new surface.
