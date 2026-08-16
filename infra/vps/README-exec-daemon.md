# Box exec daemon — deployed

Serves `run_terminal_command_v2`, `read_file_v2`, `list_dir_v2`, `glob_file_search` and
`ripgrep_raw_search`. Everything runs **inside the box**, never on the machine running the
backend.

| | |
|---|---|
| Host | the box host (same machine as `/opt/flow-vnc.sh` and display `:77`) |
| SSH | port **24700**, not 22 — plain `ssh host` fails and looks like the host is down |
| Unit | `grok-exec.service`, enabled, `Restart=always` |
| Binary | `/opt/grok-exec-daemon.mjs` |
| Listens | `127.0.0.1:1337` only |
| Root | `/root/grok-workspace` — every path is confined to it |
| Public | `https://admin.halcion.vn/grok-exec/` via a location in `sites-enabled/admin-halcion` |
| Token | `/etc/grok-exec.env`, mode 600. Not in the unit file: units are world-readable |
| Display | `DISPLAY=:77`, so a shell command can touch the box's own desktop |

## Redeploy after editing exec-daemon.mjs

```bash
scp -P 24700 infra/vps/exec-daemon.mjs root@<box>:/opt/grok-exec-daemon.mjs
ssh -p 24700 root@<box> 'systemctl restart grok-exec && systemctl is-active grok-exec'
```

## Verify

```bash
# from anywhere, with the token
curl -s -X POST https://admin.halcion.vn/grok-exec/health \
  -H "authorization: Bearer $(cat services/grokbot-backend/box-token.txt)" \
  -H 'content-type: application/json' -d '{}'

# the whole tool surface against the real box
GROKBOT2_BOX_EXEC_URL=https://admin.halcion.vn/grok-exec \
GROKBOT2_EXEC_TOKEN=$(cat services/grokbot-backend/box-token.txt) \
  npx tsx services/grokbot-backend/scripts/test-real-box.mjs
```

## Rollback

The nginx file was backed up before editing: `/root/admin-halcion.bak.<epoch>`.

```bash
ssh -p 24700 root@<box> 'systemctl disable --now grok-exec'
# then remove the `location /grok-exec/` block and: nginx -t && systemctl reload nginx
```
