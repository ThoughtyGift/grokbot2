# Protocol reference

Extracted from the Grok Bot `0.20.0` client bundle (`host-main.cjs`, `electron-main/main.cjs`,
renderer). ConnectRPC over HTTP/1.1, binary protobuf; transport `connect-es/1.6.1`.

**0.29 addendum:** the three-plane split below and the gateway coverage numbers were measured
against `0.29.0` (fresh extract of the installed `app.asar`). Everything else on this page is still
the 0.20 reading unless it says otherwise. Full 0.29 map:
[docs/extracted/0-29-mapping.md](extracted/0-29-mapping.md).

---

## The client speaks on THREE planes — do not mix them

This is the first thing to get right, because a method on the wrong plane is a method you either
implement for nothing or wait for forever. Grep the client bundle and there are exactly two JSON
method tables plus the proto services:

```
Xa("gateway",{methods:{ …   ← 146 methods   BOX GATEWAY   → this is what grokbot2 /gw must answer
Xa("main",{methods:{    …   ← 152 methods   APP IPC       → Grok Bot.exe answers itself, in-process
typeName:"aiserver.v1.GrokBotService" (+ AiService · DashboardService · SandBoxService · Keyring …)
                            ← ConnectRPC    VENDOR RPC    → goes to the vendor's servers
```

| plane | who answers | our job |
|---|---|---|
| **Box gateway** `POST /gw/api/<method>` | the box | **all of it** — see coverage below |
| **App IPC** | `Grok Bot.exe` itself, never leaves the process | **none**. Implementing these is wasted work |
| **Vendor RPC** (ConnectRPC proto) | vendor backend | only the bootstrap subset we fake — see *Bootstrap gates* |

### The example that makes the split concrete: Chrome cookies

The "log in once, let the bots reuse the session" feature is **split across two planes**, which is
why treating it as one backend feature goes nowhere:

| method | plane | meaning |
|---|---|---|
| `listChromeProfiles` · `importChromeCookies` · `putCookieOriginGrants` | **app IPC** | read cookies out of the Chrome on the USER'S machine, and hold the allow-list of sites. Never reaches any backend. |
| `injectChromeCookies` | **box gateway** | push those cookies into the box's Chrome. **This half is ours**, and it is still missing. |

So: no amount of backend work implements `importChromeCookies` — the app already does it — while
`injectChromeCookies` will never appear on its own. Get the plane wrong and you build the half that
was never yours.

### Gateway coverage, measured

Đo lại bất cứ lúc nào — đừng tin con số dán trong doc:

```
node services/grokbot-backend/scripts/gateway-coverage.mjs --bundle <asar>/dist/electron-main/main.cjs
```

Nó đọc bảng `Xa("gateway")` thẳng từ bundle và **import** bảng lệnh của ta để đếm khoá thật. Cố ý
không regex phía ta: bản đếm tay đầu tiên bỏ sót 9 lệnh shared-room đăng ký bằng
`Object.fromEntries(...)` và báo thiếu 27 thay vì 18. Số dưới đây là kết quả của lần chạy 28/08:

| | |
|---|---|
| methods in the 0.29 gateway table | **146** |
| answered by grokbot2 | **129 (88%)** — 120 implemented + 9 shared-room commands answered with an explicit refusal |
| unanswered → soft 404 | **17** |

The 17, grouped — a soft 404 means the button in the app does nothing at all, with no error:

- **bot templates (7)** — `listBotTemplates`, `publishBotTemplate`, `createAgentFromTemplate`,
  `getBotTemplateVersion`, `getBotTemplateForSourceAgent`, `deleteBotTemplate`,
  `setBotTemplateVisibility`
- **voice calls (5)** — `getVoiceCall`, `nudgeVoiceCall`, `recordVoiceCall`,
  `readVoiceCallAgentContext`, `readVoiceCallSentMessages`
- **`injectChromeCookies` (1)** — the box half of the cookie feature above
- **assets / misc (4)** — `generateAgentAvatarImage`, `getAgentNotificationAvatar`,
  `getMcpPluginLogo`, `getAutomationWebhookCredential`

> Closed 28/08: **`transcribeAudio`**. The proto answer had existed for ages, but 0.29 asks over the
> **gateway** and that road was missing — so the composer's mic recorded, sent, and got silence. The
> reply is a record and the renderer destructures exactly one field
> (`function hGt(t){const{text:e}=t;return{text:e}}`), so the handler always returns `{text, ms}` and
> never throws: no transcriber installed and broken audio are both "heard nothing", while an error
> escaping to the gateway is a mic button that dies without a word.

> Answering **NO** counts as answered. `SHARED_ROOM_COMMANDS` return
> `{ok:false, reason:"Sharing needs a relay both installs can reach…"}` rather than a 404 or a
> cheerful `{}`; the comment in `commands.ts` says why — *faking success is worse than refusing*.
> The user finds out immediately instead of wondering why nothing happened.

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

## Plugins / Marketplace

`aiserver.v1.Plugin` (field numbers verbatim from `electron-main/main.cjs` descriptors). The client
converts a wire Plugin into its view model in `o8s` → `r8s`, and **drops any plugin with no
`mcp_servers` and no `skills`** — an entry with neither never appears.

| # | Field | What the client does with it |
|---|-------|------------------------------|
| 1 | `id` | install/uninstall key |
| 2 | `name` | overridden by `mcp_servers[0].name` in the view model |
| 3 | `display_name` | row title |
| 4 | `description` | row subtitle |
| 10 | `logo_url` | row icon — see the constraint below |
| 11 | `primary_color` | unused by the marketplace rows |
| 24 / 27 | `git_url` / `full_ref` | shown as provenance; `git_url`'s host also feeds an icon-domain map |
| 28 / 32 | `skills` / `mcp_servers` | `{name, description}` each; also decide whether the row survives |
| 38 | `variables` | `google.protobuf.Struct` holding **JSON Schema** — becomes the setup form |
| 41 | `lifecycle_state` | 1 = public listed |

**`logo_url` is https-only.** The MAIN process fetches it (`resolvePluginLogo`), caps the response at
512 KB, and returns null for any other scheme — `data:` URIs and `http://127.0.0.1` do not render.
A URL is only fetched if it arrived on a plugin, and the result is cached per URL.

Without `logo_url` the client falls back to a **built-in brand set** resolved from the plugin name
(noise words `plugin|mcp|server|connector|official` are stripped first): `slack buildkite gitlab
github linear notion sentry stripe huggingface upstash playwright atlassian jira confluence todoist
dock google gmail`. Anything else gets a coloured letter tile, so `logo_url` is only worth sending
for names outside that set.

### The credential form

A non-empty `variables` is what makes **Add** open a setup form instead of installing immediately
(`Wl(entry, install)` = `fields.length > 0 && !hasTeamConfiguredVariables`). The Struct is read as
JSON Schema:

```jsonc
{ "properties": { "LARK_APP_ID": { "type": "string", "title": "App ID", "description": "hint under the box" } },
  "required": ["LARK_APP_ID"] }
```

- `title` → label (falls back to a humanised key), `description` → hint, `default` → prefilled value.
- A field is masked when `format:"password"`, `writeOnly:true`, **or the key matches
  `/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/`** — the regex wins, so a key like `GMAIL_CREDENTIALS_PATH`
  is masked even though it is a path.
- `required` is enforced client-side before the install RPC is sent.

What the person typed comes back as a Struct:

| RPC | Request fields |
|-----|----------------|
| `InstallUserPlugin` | 1 `plugin_id` · 4 `pinned_git_ref` · **5 `variables`** |
| `UpdateUserPluginInstall` | 1 `plugin_id` · 3 `is_enabled` · 5 `pinned_git_ref` · **6 `variables`** |
| `UninstallUserPlugin` | 1 `plugin_id` → response `{1 success}` |

`aiserver.v1.Marketplace`: 1 id · 2 name · 3 display_name · 4 description · 5 git_url · 6 git_ref ·
9 logo_url · 10 created_at.

### MCP OAuth — signing in instead of pasting a token

The client owns the OAuth itself: `electron-main/main.cjs` carries PKCE (`code_challenge`), dynamic
client registration, the token endpoint, and a **loopback listener it binds on its own**
(`[sand:mcp] loopback OAuth listener bound`). The backend is only asked to remember things. An RPC
this backend does not handle answers 200 with an empty body, so leaving these unanswered makes a
sign-in report success and store nothing.

| RPC | Request | Response |
|-----|---------|----------|
| `ProbeMcpUrl` | 1 url · 2 headers (map) · 3 oauth_redirect_uri · 4 auth_client_id · 5 auth_client_secret | 1 is_available · 2 requires_auth · 3 auth_url · 4 error |
| `StoreMcpOAuthPendingState` | 1 server_url · 2 code_verifier · 3 client_id · 4 client_secret · 5 redirect_uri · 6 service_account_id · 7 account_key | 1 state_id |
| `GetMcpOAuthPendingState` | 1 state_id | 1 server_url · 2 code_verifier · 3 client_id · 4 client_secret · 5 redirect_uri · 6 service_account_id · 7 post_auth_return_url · 8 account_key |
| `CompleteMcpOAuth` | 1 state_id · 2 authorization_code | 1 post_auth_return_url · 2 account_key |
| `StoreMcpOAuthToken` | 1 server_url · 2 refresh_token · 3 client_id · 4 client_secret · 5 redirect_uri · 6 access_token · 7 service_account_id · 8 client_token_created_at_ms · 9 source · 10 account_key | 1 updated_at_ms · 2 applied · 3 skipped_because_backend_newer |
| `GetMcpOAuthTokens` | 1 server_urls (rep) · 2 service_account_id · 3 account_key | 1 entries — Entry{1 server_url · 2 token_data · 3 updated_at_ms · 4 account_key} |
| `ValidateMcpOAuthTokens` | 1 server_urls (rep) · 2 service_account_id · 3 targets (rep Target{1 server_url · 2 account_key}) | 1 results — Result{1 server_url · 2 has_valid_token · 3 account_key} |
| `DeleteMcpOAuthToken` | 1 server_url · 2 service_account_id · 3 source · 4 account_key | (no fields) |
| `McpOAuthRefreshLockBegin` | 1 server_url · 2 executor_kind · 3 executor_id · 4 observed_updated_at_ms · 5 service_account_id · 6 account_key | 1 outcome · 2 lease_handle · 3 should_enforce |
| `McpOAuthRefreshLockRelease` | 1 lease_handle · 2 reason | (no fields) |
| `CheckHttpMcpStatus` | 1 server_ids (rep int32) · 2 oauth_redirect_uri · 3 team_id · 4 service_account_id · 5 force_reauth · 6 service_account_type · 7 post_auth_return_url · 8 account_key | 1 statuses — ServerStatus{1 id · 2 is_available · 3 requires_auth · 4 auth_url · 5 error · 6 has_valid_token} |

`McpOAuthStoredData` (the `token_data` above): 1 refresh_token · 2 client_id · 3 client_secret ·
4 redirect_uris (rep) · 5 access_token.

`McpOAuthRefreshLockBeginOutcome`: 0 UNSPECIFIED · 1 SKIPPED · **2 WOULD_ACQUIRE** · 3 WOULD_WAIT ·
4 REDIS_ERROR. `McpOAuthRefreshLockReleaseReason`: 0 UNSPECIFIED · 1 COMPLETE · 2 ERROR · 3 ABANDONED.

Two notes worth keeping: `ValidateMcpOAuthTokens` carries the same servers under **two** spellings
(bare `server_urls` and `targets`), and reading only one reports "not signed in" for callers that use
the other. And the lease exists so two clients cannot refresh one token at once — upstream backs it
with Redis; a single local install can always answer WOULD_ACQUIRE with `should_enforce` false.
