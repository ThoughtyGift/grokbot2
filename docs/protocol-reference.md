# Protocol reference

Extracted from the Grok Bot `0.20.0` client bundle (`host-main.cjs`, `electron-main/main.cjs`,
renderer). ConnectRPC over HTTP/1.1, binary protobuf; transport `connect-es/1.6.1`.

## Key numbers

| | |
|---|---|
| RPC methods defined | 1108 |
| RPC methods actually called | ~90 |
| `agent.v1.*` message types | 1009 |
| `aiserver.v1.*` message types | 4145 |
| System prompt (shipped in client) | ~60 KB |
| Default model | grok-4.5 |
| Backend host | api2.cursor.sh |

## Auth

- `POST /oauth/token` — `{ client_id, grant_type: "refresh_token", refresh_token }` → `{ access_token, refresh_token }`.
  The client does **not** verify the JWT signature; a self-minted token is accepted.
- Login (fresh): browser → `${website}/loginDeepControl?...` then poll `${backend}/auth/poll?uuid&verifier`.

## Bootstrap gates (ConnectRPC, `application/proto`)

The ~15 RPCs the app calls before rendering. Gate values that unlock the UI:

| Method | Response (field#: value) |
|--------|--------------------------|
| `DashboardService/GetMe` | 1:auth_id, 2:user_id, 3:email, 4:first_name, 5:last_name |
| `DashboardService/GetSandAccessStatus` | 1(state)=**1 GRANTED**, 3(block_reason)=1 NONE |
| `DashboardService/GetSandUsageStatus` | 7:has_available_usage=true, 8:has_non_zero_included_limit=true |
| `DashboardService/GetSandTrialClaimStatus` | 1(status)=1 NONE |
| `DashboardService/GetUserPrivacyMode` | 1(privacy_mode)=1, 6:acknowledged=true |
| `GrokBotService/EnsureSandBox` | cluster/tenant/pod + `gateway_url`/`vnc_url`/`exec_daemon_url` |
| `GrokBotService/WatchSandBoxMigration` | server-streaming; empty end-frame = no migration |

`EnsureSandBoxResponse` fields: 1 cluster · 2 tenant_id · 3 pod_id · 4 network_token ·
5 exec_daemon_auth_token · 6 exec_daemon_url · 7 vnc_url · 8 terminals_folder ·
10 gateway_url · 11 gateway_token · 12 fork_vnc_base_url.

Enums: `SandAccessState` {0 UNSPECIFIED, **1 GRANTED**, 2 UNAVAILABLE, 3 PAYMENT_REQUIRED};
`SandTrialClaimStatus` {0, 1 NONE, 2 PENDING_CARD, 3 GRANTED, …}.

## Box gateway (`/gw/*`, JSON)

Once the app has a sandbox descriptor it connects to `gateway_url`:

- `GET /gw/health` → `{ status:"healthy", ok:true }` (polled).
- `GET /gw/events` → **SSE**, must stay open (box→app events; "ready" here unblocks the window).
- `POST /gw/api/<method>` → JSON. Reply kinds: array / count / record / void.

Methods observed at boot: `getHostSettings`, `setHostSettings`, `getHostStatus`, `listAgents`,
`countAgents`, `getTrays`, `skillsCatalog`, `listBoxMcpServers`, `getBoxSecretsStatus`,
`getSharingState`, `isGlobalSearchEnabled`, `isEgressTunnelAvailable`, `isAgentNetworkEnabled`,
`getTeachRecordingStatus`, `getForeverBoxStatus`, `getBackgroundComposerUserSettings`, `setWindowFocused`.

Two of those are read without a guard and must not be minimised:
`getSharingState` → `{ rooms: [] }` (the store maps `rooms`), and `getForeverBoxStatus` →
the box status in [`box-architecture.md`](architecture/box-architecture.md#what-actually-opens-the-viewer)
(this, not `EnsureSandBox`, is what opens the VNC viewer).

## Chat / transcript

- `POST /gw/api/sendPrompt` — `{ agentId, content|prompt|richText, clientNonce }` → `{ accepted, entryId }`.
- `POST /gw/api/createAgent` → agent record `{ id, name, agentOwnerAuthId, createdAtMs }`.
- `POST /gw/api/getAgentTranscriptTail` / `openAgentTail` — `{ entries: [...], hasMore }`.

Transcript entry shapes:

```jsonc
{ "kind": "user-message",  "entryId": "e1", "text": "...", "images": [], "timestampMs": 0, "clientNonce": "..." }
{ "kind": "agent-message", "entryId": "e2", "agentId": "agent-1", "agentOwnerAuthId": "...",
  "authorName": "Claude", "text": "...", "images": [], "timestampMs": 0 }
```
