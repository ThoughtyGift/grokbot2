# So sánh hai backend: Cursor gốc ↔ grokbot2

> Viết 2026-08-30 (ICT). So **backend với backend**, không so UI.
> App gốc và grokbot2 dùng chung một `Grok Bot.exe` (đã vá); lệch nằm ở não phía server.
>
> Nguồn đo: `docs/extracted/0-29-mapping.md`, `docs/plan/con-thieu-so-voi-0-30.md`,
> `docs/state/bang-theo-doi.md`, `docs/architecture.md`, `packages/cursor-acl/src/commands.ts`.
> Không dùng số cũ (28/54 tool, 111/120 cổng, ROADMAP F2).
>
> Ba loại lệch, đừng trộn:
> 1. **Map được, chưa làm** — cùng hợp đồng, grokbot2 chưa trả / trả dở.
> 2. **Map được, cố ý khác** — cùng chỗ gọi, grokbot2 từ chối hoặc stub có lý do.
> 3. **Không map được** — chạy trên server hãng / Temporal / pod / prompt bơm từ 0.29; không có trong client để chép.

Hai backend grokbot2 đang sống (`127.0.0.1:8788` và `https://cinai.app/agent/`) là **cùng một mã**, khác cờ (`AUTH`/`BILLING`/`BIND`). File này so **Cursor BE** với **grokbot2 BE**, không so hai bản grokbot2 với nhau.

---

## 0 · Hình dạng

| | BE gốc (Cursor / Anysphere) | BE grokbot2 |
|---|---|---|
| Endpoint app nói chuyện | `api2.cursor.sh` + box-gateway trên pod | BFF `:8788` (`CURSOR_API_BASE_URL` / `SAND_BACKEND_URL`) |
| Process | dịch vụ đám mây + Temporal + pod Linux từng tenant | 4 process: BFF `:8788` · runtime `:8789` · computer `:8790` · ops `:8791` |
| Não chat | model Cursor, prompt **server bơm** (từ 0.29) | Claude pool `admin.halcion.vn/v1/claude` qua `@grokbot2/pool-client`; prompt nằm `prompt-base.ts` (port 0.20) |
| Máy Linux | pod disposable `*.cursorvm.com`, host **trong** pod | một VPS dùng chung; `EnsureSandBox` trỏ về chính backend này; user OS `gb2uNNN` + VNC từng slot |
| Dữ liệu | `store.db` trên box; client chỉ cache | SQLite trên BFF (`.data/grokbot.sqlite`); BFF là nơi duy nhất ghi `seq` |
| Auth | Cursor account / team / spend | JWT tự mint (client decode, không verify chữ ký); vé `/gw` theo người (`gwu.<authId>.HMAC`) |
| Cập nhật client | feed ký Authenticode `Anysphere, Inc.` | `SAND_DISABLE_UPDATES=1`; chặng 8 chưa dựng |

```
App gốc ──protobuf + /gw──► BE Cursor ──► pod + Temporal + marketplace + billing
Grok Bot.exe (vá) ──cùng hợp đồng──► BE grokbot2 ──► pool Claude + VPS box
```

---

## 1 · Hợp đồng cổng `/gw`

Đo 0.30: **135/147** lệnh grokbot2 trả lời (gồm 9 lệnh shared-room trả `{ok:false}`). Còn **12** chưa trả. Lệnh lạ → **200 `{}`** (404 mềm) trừ khi `GROKBOT2_STRICT_404=1`.

### 1.1 Map được, chưa làm

| Lệnh / cụm | BE gốc | BE grokbot2 | Hiệu ứng |
|---|---|---|---|
| ~~`injectChromeCookies`~~ | bơm cookie Chrome user vào Chrome box | **XONG 31/08** | — |
| ~~`getAgentNotificationAvatar`~~ | avatar thông báo | **XONG 06/09** (`avatar-mac-dinh.ts` chép đúng hai hàm băm của renderer) | — |
| `getVoiceCall` · `nudgeVoiceCall` · `recordVoiceCall` · `readVoiceCallAgentContext` · `readVoiceCallSentMessages` · `previewVoice` · `setAgentVoice` · `setVoiceCallPresence` | voice call | không có | **không hệ quả**: cờ `sand_voice_call` trong bundle 0.43 là `{client:!0,default:!1}` — đo 07/09 |
| `generateAgentAvatarImage` · `getMcpPluginLogo` | có | không có | avatar sinh ảnh / logo plugin trống |
| `resolveVirtualCardApproval` · `listVirtualCardPaymentMethods` | Stripe Link / thẻ ảo | không có | **ngủ đông, không hỏng**: thẻ chỉ hiện nếu backend ta phát ra `virtual_card_approval`, và ta chưa bao giờ phát (đo 07/09) |
| `getBotTemplateExportPolicy` | chính sách xuất mẫu, **mới 0.30** | không có | xuất template không có policy |
| 4 lệnh `user_form_vault` | tự điền form | **0/4 — nhóm duy nhất trống hoàn toàn** | nếu bị gọi: reply đòi mảng mà ta trả `{}` ⇒ **banner "mất kết nối"** (07/09) |
| `completeGithubConnect` | nối GitHub | không có | ngủ đông: `getListenerConnectUrl` của ta là stub trả `{url:""}` nên luồng không khởi động |

*Cập nhật 07/09: bảng này đo lại bằng hai nguồn (bảng lệnh `main-app.cjs` **và** bảng lệnh của
renderer). Hợp đồng thật là **155** lệnh, không phải 150 — 5 lệnh chỉ renderer biết
(`noteMountedAgent` · `resolveAgentCreation` · `getServerAgentRoster` ·
`restoreTemporalAgentRouting` · `listVirtualCardPaymentMethods`). Ta thiếu **24**, và
`coverage.unknownPaths` **rỗng**: client chưa gọi một cái nào.*

### 1.2 Map được, cố ý khác

| Lệnh / cụm | BE gốc | BE grokbot2 |
|---|---|---|
| 9 lệnh shared-room (`createSharedRoom`, `joinSharedRoom`, …) | relay phòng nhiều máy | `{ok:false, reason: NO_RELAY}` — không giả phòng |
| `sendDraft` | gửi nháp mail/Slack (0.29 có nút; 0.20 handler cũng trống) | `{ok:false, NO_TRANSPORT}` — bảo copy gửi tay |
| `discardDraft` | bỏ thẻ | **đã làm** 28/08 |
| `renameMcpAccount` / `removeMcpAccount` | nhiều tài khoản / server | từ chối: mỗi server một bộ đăng nhập |
| `publishSkill` · `resyncPublishedSkill` · `unpublishSkill` · `getSkillPublishTargets` | registry team | `{ok:false}` — skill trên đĩa vẫn inject prompt |
| `importAgentWorkflowText` / `Url` | import workflow | `"workflows not supported by this backend"` |
| Box lifecycle (`autoUpdateBoxNow`, `snapshotBoxStoreNow`, `prepareBoxForRecreate`, …) | recreate pod | `{ok:false}` |
| `completeMcpOAuth` | OAuth MCP | từ chối stdio; HTTP MCP status vẫn trả |
| `requestWebAuthnCeremony` | khoá phần cứng | từ chối |
| `getCloudAgentInfo` | cloud agent | `null` |
| `isGlobalSearchEnabled` / `isEgressTunnelAvailable` / `isAgentNetworkEnabled` | tuỳ gate | luôn `false` |

### 1.3 Stub rỗng (hình như có, thực ra không)

| Lệnh | BE gốc | BE grokbot2 |
|---|---|---|
| Workflow CRUD (`get/create/update/setEnabled/deleteAgentWorkflow`, `runAgentWorkflowNow`) | workflow thật | `LOCAL_WORKFLOWS = []` — tạo xong “biến mất” |
| `skillsCatalog` | catalog skill | `() => []` — skill đĩa vẫn vào prompt |
| `searchMedia` | tìm media | `() => []` |
| `getListenerIntegrations` | Slack/GitHub listener UI | `() => ({})` |
| `getListenerConnectUrl` | URL connect | `{ url: "" }` |
| `getHostStatus.version` | version client | hardcode `"0.20.0"` trong khi client 0.29/0.30 |

`getAutomationWebhookCredential` + `POST /hooks/automation/<id>`: **xong 29/08**, nhóm automations 8/8.

---

## 2 · Bootstrap / protobuf / cờ

| Mặt | BE gốc | BE grokbot2 | Map? |
|---|---|---|---|
| `GetMe` | user Cursor thật | JWT / stub `user@localhost` khi chưa login | một phần |
| `GetSandAccessStatus` | GRANTED / PAYMENT_REQUIRED + `ErrorButton` | luôn GRANTED (bypass paywall hãng); `ErrorButton` = 0 hit — paywall tự quản mới có markdown link | **không map nút upgrade** |
| `EnsureSandBox` | descriptor pod Cursor (cluster/pod/network_token, host *trong* box) | descriptor trỏ gateway/VNC/exec về **chính** BFF này | map hình, **không map hạ tầng** |
| `BootstrapStatsig` | ~42–95 cờ `sand_*` | phát đúng shape; mặc định chỉ bật `sand_teach_by_demonstration` | map cơ chế; **cố ý không bật** `*_via_server` (bật là đẩy roster/transcript sang server hãng, emulation chết) |
| System prompt | server bơm field proto từ 0.29; **không có trong client** | `prompt-base.ts` port 0.20 | **không map được** — mọi sửa prompt hãng sau 0.20 ta không thấy |
| Luật lượt nói phòng | Temporal `RequestGrokBotRoomMemberTurn` trên server hãng | vòng tuần tự trong `sendPrompt` local | **không map thuật toán**; cờ `directAddressedAcceptance` đã đọc 28/08 |

---

## 3 · Chat / tool / SSE / thẻ

| Mặt | BE gốc | BE grokbot2 | Map? |
|---|---|---|---|
| Tool runtime | enum `CLIENT_SIDE_TOOL_V2_*` (56 tên) + prompt server | ~**63** tool đăng ký lúc chạy | gần map; thiếu `deep_search` (cần nhà cung cấp) |
| Subagent | 12 loại (`browser_use`, `explore`, `shell`, `bash`, `computer_use`, `media_review`, `watch_video`, `vm_setup_helper`, `debug`, `cursor_guide`, `custom`, …) | 5: `browserUse` · `explore` · `shell` · `mediaReview` · `pastConversationExplorer`; `watch_video`/`computer_use` là **tool**; `bash` gộp `shell`; `cursor_guide` bỏ (IDE) | thiếu `vm_setup_helper` · `debug` · `custom`; subagent **chạy xong mới trả**, không resume |
| `deep_search` | có | không | chưa làm |
| SSE | 18 kênh (0.30) | đẩy 12 / nhận 18. Cố ý trống: `tray`, `workflows`, `sharing`, `box-disk-pressure`, `agent-activity`, `mcp-auth` | map thiếu producer |
| Thẻ `send-message` | 17 loại (0.30) | phát 8 | thiếu: `cursor-agent`, `secret-request`, `user-form` (handler nhận đã có), `permission-request`, `connector(s)`, `bot-template-share`, `virtual-card-approval`, `cookie-origin-approval` |
| Entry kind | `message` · `user-attachment` · `notice` · `feedback` · `voice-call` | thiếu `feedback` · `voice-call` | `notice`/`user-attachment` đã làm 28/08 |
| Event | `name-changed` · `channel-connected` · `channel-disconnected` · `automation-changed` | chưa phát `channel-connected/disconnected` | |

---

## 4 · Box / exec — chỗ không cùng kiến trúc

| Mặt | BE gốc | BE grokbot2 | Map? |
|---|---|---|---|
| Đời box | pod disposable, recreate/snapshot/migrate | VPS bền, lifecycle từ chối | **không map recreate** |
| Exec daemon | ConnectRPC streaming, ~39 op (`BackgroundShellSpawn`, `WriteShellStdin`, `ComputerUse`, `RecordScreen`, Subagent+Await, Mcp*, hook, allowlist, …) | HTTP POST, **12** op (`exec`, `read`, `readBytes`, `write`, `replace`, `remove`, `list`, `glob`, `grep`, `memoryLoad`, `memorySave`, `health`) | thiếu stdin / lệnh nền / RecordScreen |
| Duyệt lệnh | vòng `needsApproval → retire-approval` **ở daemon** | duyệt ở app | khác chỗ, cố ý |
| MCP | có thể sống **trong pod** | in-process trên BFF | **không map chỗ chạy** |
| Cài phần mềm | bot `apt` trên pod (vứt được); `vm_setup_helper` chỉ là tên — logic không nằm client | user OS không root; chưa toolbelt OBS; chưa `install_app` | **không map được cách hãng cài** (0 hit `apt-get`/`sudo` trong client) |
| Cookie Chrome | IPC app `importChromeCookies` + BE `injectChromeCookies` + (0.30) `/cookie-origin-approval/*` | nửa IPC không phải việc BE; nửa BE chưa làm; gate tắt | map được nửa BE, chưa làm |
| Máy Windows user | `GrokBotUserComputer*` · `spawnLocalExecDaemon` · `ListSandMachines` · cờ `sand_multi_machine_local_exec` | kênh `/gw/local-exec/{requests,responses}` phác 3 op (`shell`/`read`/`ls`); gate multi-machine **tắt** (quyết định an toàn) | **không map full**; khác kiến trúc |

---

## 5 · Plugin / MCP / chợ / automation

| Mặt | BE gốc | BE grokbot2 | Map? |
|---|---|---|---|
| Catalog plugin | Cursor.com (Remotion, Canva, Notion, Gmail, … ~hàng trăm) | `plugin-registry.json` local (~25). `ListMarketplacePlugins` là stub local | **thiếu dữ liệu**, không thiếu code list/install |
| MCP write | đầy đủ + nhiều account | 8 lệnh thật + 2 từ chối account | gần map |
| `sand_marketplace_bots` | chợ bot | gate tắt — cần máy chủ chia sẻ | chưa nên làm |
| Template bot | publish/list/createFromTemplate + (0.30) storefront | gateway template 7/7 (28/08); không có tab Marketplace hãng | map RPC, không map FE chợ |
| Routine | cron + event Cursor (Slack/GitHub/Origin/Linear/…) + trả lời ngược kênh | cron + webhook + Slack/GitHub **inbound** (đánh thức); **không outbound**; `InstallGrokBotSlackApp` chưa có | map một chiều |
| Cloud agent / Origin | VM Cursor, PR, `cursor-agent` card | `getCloudAgentInfo = null`; không emit thẻ | **không thuộc về ta** |

---

## 6 · Auth / billing / update

| Mặt | BE gốc | BE grokbot2 | Map? |
|---|---|---|---|
| Paywall | `PAYMENT_REQUIRED` + `ErrorButton` (`upgrade` / `url` / …) | GRANTED giả với hãng; billing tự quản `warn`; token = `len/2.8`; `enforce` cố ý chưa; nút upgrade chưa envelope RPC | map enum, **không map nút** |
| Keyring | `Keyring` / grant / `CopyTeamSecretsToKeyring` | secret MCP per-user JSON + `setBoxSecrets` (khúc gỗ) | chưa map ACL chia sẻ |
| Update client | feed `/api/update/{platform}/sand/{version}/…` → 204 hoặc 200+sha256; ký Anysphere; NSIS `--updated /S` | chưa dựng; Inno `/VERYSILENT` unsigned — feed giả sẽ tải xong rồi **ném**, tệ hơn không làm | map được shape, **chưa nên bật** |
| WebAuthn | ceremony | từ chối | cố ý |

---

## 7 · Không map được (kể cả khi code hết)

Những thứ này **không có trong client** hoặc nằm trên hạ tầng hãng. Đối chiếu file-to-file sẽ mãi lệch:

1. **System prompt + mô tả tool từ 0.29 trở đi** — server bơm; `dist/host` đã bị xoá. `prompt-base.ts` sẽ lệch dần theo từng bản.
2. **Thuật toán lượt nói phòng** — Temporal phía hãng; client chỉ mang RPC + `directAddressedAcceptance`.
3. **Cách cài phần mềm trên VM** — `vm_setup_helper` chỉ là tên; `apt-get`/`sudo`/`install_package` = 0 hit trong bundle.
4. **Pod disposable / migrate / `WatchSandBoxMigration`** — grokbot2 là VPS bền.
5. **Relay phòng shared nhiều máy** — cần máy chủ chia sẻ; đang `NO_RELAY`.
6. **Cloud agent, Origin, marketplace Cursor.com, Stripe Link** — sản phẩm hãng, không phải lỗ hổng nối dây `/gw`.
7. **IPC `main` của Electron** (`importChromeCookies`, `switchCursorAccount`, `selectCursorTeam`, `setCursorSpendLimit`) — không đi `/gw`.

---

## 8 · Việc còn lại, xếp theo đau (BE)

Chỉ việc **sửa được bằng BE grokbot2**:

| # | Việc | Loại | Vì sao đau |
|---|---|---|---|
| 1 | `injectChromeCookies` (+ origin grants) | năng lực | gỡ 5 bot chờ đăng nhập Shopee |
| 2 | Toolbelt / `vm_setup_helper` trên ảnh box | năng lực + hạ tầng | OBS/CapCut kịch bản B2 |
| 3 | Phát thẻ `secret-request` + `user-form` | năng lực (ruột đã có) | rẻ nhất, đóng mẫu “khai báo không điền” |
| 4 | `deep_search` | năng lực + nhà cung cấp | thiếu tool thật |
| 5 | `BackgroundShellSpawn` + `WriteShellStdin` | năng lực daemon | lệnh dài / live |
| 6 | Cụm voice (5 lệnh) | năng lực | khối lớn, giá trị với user này chưa rõ |
| 7 | `ErrorButton` nhánh `url` | năng lực | paywall tự quản |
| 8 | Catalog plugin thật | **dữ liệu** | widget B2 1/5 vì không có Remotion/Canva |
| 9 | Soft-404 → lỗi rõ | DX | nút chết lặng (G1–G4, voice) |
| 10 | `getHostStatus.version` | lệch nhỏ | About hiện 0.20.0 |

**Chưa nên làm từ BE:** virtual card, marketplace hãng, `GrokBotUserComputer` đầy đủ, bật `*_via_server`, feed update khi chưa ký.

---

## 9 · Hai bản grokbot2 (cùng BE, khác cờ)

Không phải hai sản phẩm. Cùng tree, khác môi trường:

| | Local `127.0.0.1:8788` | VPS `https://cinai.app/agent/` |
|---|---|---|
| AUTH | thường off | `enforce` |
| BILLING | tuỳ máy | `warn` |
| BIND | localhost | nginx + Cloudflare Tunnel, process `127.0.0.1:8788` |
| SQLite | máy Windows | kho **rỗng riêng** lúc dựng |
| Plugin install | mở được | từng `ALLOW_PLUGIN_INSTALL=0` rồi mở lại sau khi tách user |

Lệch local ↔ VPS là cờ vận hành, không phải lệch hợp đồng với BE gốc.

---

## Xem thêm

- [con-thieu-so-voi-0-30.md](./con-thieu-so-voi-0-30.md) — số đo 0.30 (cổng, thẻ, gate)
- [../extracted/0-29-mapping.md](../extracted/0-29-mapping.md) — map từng lệnh 0.29
- [../state/bang-theo-doi.md](../state/bang-theo-doi.md) — trạng thái chặng (một số dòng ⬜ đã xong 28/08: VNC slot, vá 0.29, nhóm bot)
