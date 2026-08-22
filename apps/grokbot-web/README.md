# grokbot2 web (S13)

Independent UI for this backend. It speaks only the native API (`/v1/*`,
[`docs/api/grokbot2-v0.yaml`](../../docs/api/grokbot2-v0.yaml)). It does **not** call
`/gw/api`, ConnectRPC, or load any Anysphere renderer.

## Run

```bash
pnpm backend          # BFF :8788 (keep the stock ACL up for dual-run)
pnpm web              # Vite :5173, proxies /v1 → :8788
```

Or `infra/scripts/run-web.ps1` — opens this UI, never `Grok Bot.exe`.

Stock Grok Bot on CDP 9222 can stay running against the same BFF for comparison
(see [`docs/dual-run.md`](../../docs/dual-run.md)).
