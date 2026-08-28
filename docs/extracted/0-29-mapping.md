# 0.29.0 → grokbot2: trích logic thật, không bịa

Bản đồ BE · FE · API · system prompt giữa client **Grok Bot 0.29.0** và backend này.

## Xuất xứ và cách kiểm chứng

- **Nguồn**: `app.asar` của bản **đang cài** (`C:\Users\admin\Desktop\Grok Bot\resources\app.asar`, 29.7 MB),
  giải nén tươi trong phiên này. Xác minh version: `"version": "0.29.0"` trong `package.json` của gói.
  Không dùng bản giải nén cũ (bản đó là 0.18/0.20, đã loại).
- **Cách đọc**: các file `main.cjs` minified một dòng (6.4 MB / 3.3 MB / 468 KB) — trích bằng grep chuỗi,
  không đọc cả file.
- **Quy tắc**: mỗi khẳng định dưới đây kèm chuỗi grep thật. Chỗ nào không trích được thì ghi thẳng
  "không có trong bundle" — **không suy diễn cho đủ**.
- Bốn mảnh (API · prompt+tool · FE · BE) do bốn tác nhân đọc song song; những khẳng định **đổi việc
  phải làm** đã được kiểm lại độc lập lần hai trước khi ghi vào đây.

---

## 0 · Ba điều đáng giá nhất

### 0.1 — Client 0.29 GỬI CHO TA một cờ mà ta chưa từng đọc

```
services/grokbot-backend/.data/coverage.json:524    "directAddressedAcceptance": true,
grep directAddressedAcceptance trong services/src + packages/*/src  →  0
```

`coverage.json` là payload **client thật** bắt được (xem [[capture-real-client-payloads]] — đây là
nguồn sự thật duy nhất về hợp đồng). Client đính `directAddressedAcceptance` vào `sendPrompt`, và
backend này **bỏ qua hoàn toàn**. Trong bundle 0.29 nó xuất hiện 5 lần, đúng chỗ dựng đối số
`sendPrompt`:

```
node-agent-coordinator/main.cjs   ...t.directAddressedAcceptance===!0?{directAddressedAcceptance:!0}:{}
```

Đây chính là nửa quan sát được của luật **"chỉ nói khi được nhắc tên"** — thứ §7.4.2 còn thiếu.
Ta đang cho **mọi** thành viên nói một lượt; hãng có một cờ nói "tin này gọi đích danh tôi".

### 0.2 — System prompt 0.29 KHÔNG nằm trong client. Nó do server bơm.

```
"You are Grok Bot"                → 0 hit toàn dist (không phân biệt hoa thường)
"Skills are SOPs"                 → 0
"Parallel tool calls are critical" → 0
"codebase_search"                 → 0
electron-main/main.cjs:  name:"system_prompt_override",kind:"message",T:Jl,opt:!0
                         name:"system_prompt_spec",kind:"message",T:Jl,opt:!0
```

Toàn bộ văn xuôi dạy model của 0.20 đã biến mất; thay vào đó là **ô chứa protobuf** (`system_prompt`,
`custom_system_prompt`, `knowledge_base_prompt`, `task_prompt`…). Danh mục tool cũng chỉ còn tên trần:

```
...{no:65,name:"CLIENT_SIDE_TOOL_V2_SEND_TO_USER"},{no:66,name:"CLIENT_SIDE_TOOL_V2_CONNECT_SCM"}]
```

**Hệ quả cho ta — và đây là tin tốt:** grokbot2 đang giữ đúng vai server (prompt + protocol nằm ở
`prompt-base.ts` + các `*_PROTOCOL` trong `runtime/tools.ts`). Không có prompt nào của 0.29 để "chép
cho giống" — **nửa dạy-model là của ta, và phải là của ta**. Mọi công sức 7.4.x viết protocol vừa qua
là đi đúng hướng, không phải chế lại bánh xe.

### 0.3 — Luật lượt nói của hãng KHÔNG trích được, vì nó không nằm trong client

```
roundRobin 0 · turnQueue 0 · shouldSpeak 0 · moderator 0
Temporal 4 · TEMPORAL_UNAVAILABLE 18
requestGrokBotRoomMemberTurn:{name:"RequestGrokBotRoomMemberTurn",I:jo,O:Ko,kind:C.Unary}
```

Client chỉ mang **hợp đồng** (cặp RPC + shape message), còn **thuật toán** chạy trong một workflow
Temporal phía server hãng — enum `NOT_TEMPORAL` / `TEMPORAL_UNAVAILABLE` là bằng chứng. Nói cách khác:
không ai chép được luật lượt nói của hãng từ máy này, kể cả hãng cũng không đưa nó xuống client.
Cái ta chép được là **các mảnh dữ liệu** hãng đưa vào quyết định — và đó là chỗ ta còn thiếu (§4.1).

---

## 1 · System prompt và tool

| | 0.29 | grokbot2 |
|---|---|---|
| Văn xuôi dạy model | **không có** (server bơm qua field proto) | có, và đúng vai — `prompt-base.ts`, `*_PROTOCOL` |
| Danh mục tool | enum `CLIENT_SIDE_TOOL_V2_*` (56 mục), chỉ `{no,name}` | **63 tool** đăng ký lúc chạy (đếm bằng `Object.keys(TOOLS)`, không phải grep) |
| Bề mặt tool thứ hai | `SubagentType` oneof (12 mục) | `SUBAGENT_TYPES` (**5 mục** sau 28/08) |

**`SubagentType` của 0.29 — trích đủ 12 mục, bằng chứng thật:**

```
{no:1,name:"unspecified"} {no:2,name:"computer_use"} {no:3,name:"custom"} {no:4,name:"explore"}
{no:5,name:"media_review"} {no:6,name:"bash"} {no:7,name:"browser_use"} {no:8,name:"shell"}
{no:9,name:"vm_setup_helper"} {no:10,name:"debug"} {no:11,name:"cursor_guide"} {no:12,name:"watch_video"}
```

| SubagentType 0.29 | grokbot2 | ghi chú |
|---|---|---|
| `browser_use` · `explore` · `shell` | ✅ `browserUse` · `explore` · `shell` | khớp |
| `bash` | 🟡 gộp vào `shell` | |
| `watch_video` | ✅ **là TOOL bên ta** | + cờ `enable_watch_video_in_ide` — ta làm 28/08, trùng hướng hãng một cách độc lập |
| `computer_use` | 🟡 là TOOL bên ta, không phải subagent | |
| `media_review` | ✅ **28/08** `mediaReview` | subagent soi ảnh/PDF/clip; chỉ được các tool NHÌN và ĐỌC |
| **`vm_setup_helper`** | ⬜ **thiếu** | ← đây là chỗ hãng đặt **tính năng 3** (dựng/cài phần mềm trên máy ảo) |
| `debug` · `cursor_guide` · `custom` | ⬜ | `cursor_guide` là của IDE, không hợp sản phẩm ta |
| — | `pastConversationExplorer` | của riêng ta |

**Tool 0.29 có, ta chưa có** — *đã đếm lại bằng cách chạy thật:*

```
CLIENT_SIDE_TOOL_V2_DEEP_SEARCH · CREATE_DIAGRAM        ← thiếu thật
```

> ⚠️ **Đính chính (28/08, bản đầu của trang này SAI).** Bản đầu ghi thêm `WEB_SEARCH` · `WEB_FETCH`
> vào danh sách thiếu, kèm câu "ta không có tool web nào". Sai. Cả hai **đã có đủ** trong
> `src/tools.ts` (`alwaysAvailable: true`, gọi `webSearch()`/`webFetch()` thật), cùng với
> `list_mcp_resources` và `read_mcp_resource`.
>
> Vì sao sai: cả tôi lẫn tác nhân đọc bundle đều đếm bằng `grep "^TOOLS\."` — nhưng phần lớn tool
> **không** gán trực tiếp, chúng nạp qua vòng `for (const [name, spec] of Object.entries(availableTools()))`.
> Grep thấy 26, chạy thật thấy **63**.
>
> **Bài học, và nó lặp lại lần thứ ba trong ngày:** đếm bằng cách CHẠY, đừng đếm bằng cách đọc.
> Một dòng đăng ký động là đủ để giấu 37 tool khỏi mắt grep — và suýt nữa tôi xây lại hai tool đã có.

⚠️ **`vm_setup_helper` không lộ cách cài**: `apt-get` 0 hit, `sudo` 0 hit, `install_package` 0 hit
trong `electron-main`. Tức hãng cũng **không** ship logic cài đặt xuống client — nó nằm trong ảnh box
hoặc server. Kết luận này **xác nhận** lựa chọn đang ghi trong plan 7.4.x: làm **toolbelt cài sẵn
trong ảnh box** trước, đừng vội mở cửa `sudo`.

**Đính chính một điều tôi từng nói:** `create_agent` / `create_group` **không phải** model-tool trong
0.29 — chúng là RPC người dùng bấm (`createAgent:{name:"CreateAgent",kind:g.Unary}`,
`createGroup:v().args({name:C(),description:z(C()),memberAgentIds:Ie(C())})`). Việc phơi chúng cho
model gọi là **lớp của riêng grokbot2**. Shape đối số thì khớp — nên đây là mở rộng hợp lệ, không
phải lệch hợp đồng.

---

## 2 · API — 0.29 nói trên BA mặt phẳng, đừng trộn

```
Xa("gateway",{methods:{   ← box gateway   → ĐÂY là thứ grokbot2 /gw phải emulate
Xa("main",{methods:{      ← IPC nội bộ app (window/theme/update/importChromeCookies/switchCursorAccount)
typeName:"aiserver.v1.GrokBotService"  + AiService/DashboardService/SandBoxService/Keyring… ← RPC lên server hãng
```

Phân tầng này **chưa có trong `docs/protocol-reference.md`** — nên bổ sung, vì nhầm mặt phẳng là
nhầm cả việc: `importChromeCookies` chẳng hạn là IPC app-local, **không** phải việc của backend.

### Method box-gateway ta còn thiếu (đã kiểm: 0 hit trong `commands.ts`)

| Method 0.29 | Shape thật | Hậu quả khi thiếu |
|---|---|---|
| ~~`submitUserForm`~~ ✅ **28/08** | `.args({entryId:C(),values:f2e,agentId:C(),platform:z(wpn)})` | nhận đúng shape; ta chưa PHÁT `user-form` (xem §3.2) |
| ~~`dismissUserForm`~~ ✅ **28/08** | `.args({entryId:C(),mode:mn("dismissal mode",["dismissed","escalated"])…})` | nt |
| ~~cụm MCP ghi (10 lệnh)~~ ✅ **28/08** | mỗi cái xác nhận 1 hit `:v()` | 8 lệnh thật + 2 từ chối có lý do — xem hàng 4 ở §5 |
| ~~cụm mẫu bot (7)~~ ✅ **28/08** | `zEr = {shareId,agentId,name,avatarShape,avatarColor,expectedActiveVersion}` | mẫu của NHÓM chở mô tả từng thành viên → dựng lại cả đội; bước TẠO của hãng không có trong client, xem ghi chú trong `bot-templates.ts` |
| `injectChromeCookies` | `.args({cookies:Ie(xkr)})` | ← nửa **box** của tính năng cookie (§4.1 trong plan cũ); `importChromeCookies` mới là nửa app-IPC |
| ~~`sendDraft` / `discardDraft`~~ ✅ **làm 28/08** | `.args({entryId,draft:LEr,agentId})` | **nút chết THẬT, đã sửa** — xem đính chính §3.1 |
| ~~`transcribeAudio`~~ ✅ **28/08** | `.args({audioBase64,mimeType,language?})`, trả record — renderer rút đúng `{text}` | đã nối; proto có sẵn từ lâu, thiếu đúng đoạn đường cổng |
| `generateAgentAvatarImage`, `getAgentNotificationAvatar`, `getMcpPluginLogo`, `getAutomationWebhookCredential` | — | phụ trợ |

Router của ta trả **404 mềm** cho tên lạ (`http.ts` `const fn=methods[name]`), nên các nút trên
"chết lặng" chứ không báo lỗi — đúng kiểu lỗi khó tìm nhất.

### Đã khớp, không phải lo

`createGroup` · `setGroupMembers` · `broadcastToAgents` · `setBoxSecrets` · `getBoxSecretsStatus` ·
`sendPrompt` · transcript/widget/agent CRUD/memory/automation/workflow/tray/teach/foreverBox/attachment
(~110 method).

### Từ chối có chủ đích (không phải thiếu sót)

`SHARED_ROOM_COMMANDS` (`createSharedRoom`, `joinSharedRoom`, `leaveSharedRoom`…) → `{ok:false, NO_RELAY}`.
Ghi chú trong `commands.ts` nói đúng lý do: *"Faking success is worse than refusing"*.

---

## 3 · FE — renderer 0.29 vẽ theo entry nào

```
Kye=["message","tool-call","send-message","user-attachment","notice","event"]
```

| kind | grokbot2 phát? | hậu quả |
|---|---|---|
| `message` · `send-message` · `tool-call` · `event` | ✅ | khớp |
| **`user-attachment`** `{file_path,file_name}` | ⬜ 0 | file người dùng gửi dạng entry gốc không hiện |
| **`notice`** → `{role:"note"}` | ⬜ 0 | thông báo hệ thống trong transcript không vẽ |
| `feedback` · `voice-call` | ⬜ 0 | |

### 3.1 · Đính chính bản đầu — và chính chỗ sai này suýt giấu một lỗi đang sống

Bản đầu của trang này viết *"0.29 stock **không vẽ** `email-draft`/`slack-draft`"*. **Sai.** Nó dựa
trên `grep 'type==="email-draft"'` → 0 hit; nhưng renderer 0.29 không viết kiểu đó, nó dùng `switch`:

```
case"email-draft"      → 2 hit
case"slack-draft"      → 2 hit
case"listener-connect" → 1 hit
```

Danh sách message type **đầy đủ và chính thức** (mảng renderer dùng để lọc, chép nguyên văn):

```
QJt=["text","attachment","widget","cursor-agent","secret-request","user-form","email-draft",
     "slack-draft","permission-request","connector","connectors","listener-connect",
     "bot-template-share","auto-review-approval","local-tool-permission"]
JJt=["message","user-attachment","notice","feedback","voice-call"]          ← entry kind
ZJt=["name-changed","channel-connected","channel-disconnected","automation-changed"]  ← loại event
```

**Hệ quả thật:** ta CÓ phát thẻ nháp, client CÓ vẽ nó — nên hai nút Gửi/Bỏ trên thẻ gọi vào
`sendDraft`/`discardDraft`, hai lệnh ta không có, và router trả **404 mềm**: bấm không ra gì, không
báo lỗi, không ai biết. Nếu tin bản đầu thì ta đã xếp việc này xuống đáy danh sách. Đã sửa 28/08
(`sendDraft` từ chối trung thực vì không có đường gửi; `discardDraft` bỏ thẻ thật).

Hai loại event ta cũng chưa phát: `channel-connected` / `channel-disconnected`.

### 3.2 · `user-form`: nhận thì được, phát thì chưa

```
electron-main:  sand_user_form:{client:!0,default:!1}          ← cờ mặc định TẮT
renderer:       case"user-form":return t.formRequest.title
                `${t}:user-form:${e.formRequest.fields.length}:${e.formRequest.title.length}`
```

Biết chắc: `{formRequest:{title, fields[]}}`. **Không** biết: shape từng phần tử `fields[]` — renderer
chỉ đọc `.length`, và không có `fieldType`/`isSecret`/`placeholder` nào tra được (các hit
`placeholder`/`inputType` đều là ruột ProseMirror). Nên ta **nhận** `submitUserForm`/`dismissUserForm`
đúng hình dạng đối số đã trích, nhưng **không phát** `user-form` — đoán schema rồi phát ra là cách
chắc chắn để thẻ hiện thành khoảng trắng.

**Widget** — shape ta đã khớp gần hết (`prompt`/`helpText`/`options`/`allowCustom`/`dismissOnMoveOn`,
option `{label,value?,description?,style:"default"|"primary"|"danger"}`), **thiếu đúng một trường**:

```
0.29:  multiSelect:AM()...   và render thật:  if(e.multiSelect===!0)return Oon(n).map(…)
ta:    grep multiSelect trong types.ts → 0
```

→ widget nhiều lựa chọn **luôn bị vẽ thành chọn-một**. Sửa rẻ, lợi ngay (chính tính năng 2 cần:
"một lựa chọn cho mỗi plugin còn thiếu").

Trường khác 0.29 đọc mà ta chưa trả: `branched` (dấu phân nhánh), `channelSender`,
`attachment.images[]` (nhiều ảnh một message), `approval.surface`/`approval.command`
(affordance `bot_share`), roster `isSharedRoom`/`remoteRoom`/`sharedRoomId`/`harness`.
Không cái nào làm **vỡ** render — đều falsy → mất tính năng, không lỗi.

**Đã khớp:** `local-tool-permission` (`ask.status/target/requestId`), nhóm
(`subtitle:s.isGroup?…memberIds.length`, `icon:{type:"group"}`), tác giả từng bot trong phòng
(`send-message.author` → `member:${t.author.id}`), `fromAgent`/`toAgent`, `description`+`purpose`,
`notifyOnUpdatesEnabled`.

---

## 4 · BE

### 4.1 — Lượt nói trong phòng: hợp đồng của hãng vs cách ta làm

Shape thật (`node-agent-coordinator/main.cjs`):

```
RequestGrokBotRoomMemberTurnRequest:  1 nonce · 2 room · 3 member_agent_id · 4 peers[] ·
                                      5 new_messages[] · 6 is_winding_down · 7 deadline_ms
GrokBotRoomMemberTurnMessage:         1 speaker_kind(HUMAN|AGENT) · 2 speaker_name · 3 is_self ·
                                      4 text · 5 reply_to
Dispatch enum: UNSPECIFIED/ACCEPTED/DUPLICATE/NOT_TEMPORAL/TARGET_NOT_FOUND/TEMPORAL_UNAVAILABLE
```

| | hãng 0.29 | grokbot2 (`runtime/turn.ts`) |
|---|---|---|
| Vận chuyển | cặp RPC → workflow Temporal trên server | vòng lặp trong `sendPrompt`, cục bộ |
| Ai quyết ai nói | server, mỗi thành viên một request kèm đủ ngữ cảnh | vòng tuần tự cố định, **mọi** thành viên nói một lượt |
| "Chỉ nói khi được gọi tên" | `directAddressedAcceptance` + `is_self`/`speaker_kind` | ⬜ **chưa mô hình hoá** — cờ client gửi bị bỏ qua |
| Chặn bot-nói-bot | `is_self` + `speaker_kind=AGENT`, server quyết | ✅ cứng: chỉ `!args.fromAgent` mới mở vòng; DM có `MAX_HOPS=3` |
| Đang tàn cuộc / hạn chót | `is_winding_down`, `deadline_ms` | ⬜ (có `AbortController` chung, ngắt khi người nói tiếp) |
| Phòng chia sẻ nhiều máy | `is_shared_room`, `shared_room_id` | ⬜ từ chối có chủ đích |

**Kết luận thẳng:** cặp RPC kia ta **không cần** — kiến trúc một-backend-cục-bộ đã phủ ca "một người +
nhiều bot trong một phòng". Nhưng **cờ `directAddressedAcceptance` thì cần**, vì client đang gửi nó
cho ta thật (§0.1) và nó là mảnh duy nhất của luật "gọi tên mới nói" mà ta trích được.

### 4.2 — Box exec daemon

| | hãng (`local-exec-daemon`) | ta (`infra/vps/exec-daemon.mjs`) |
|---|---|---|
| Giao thức | ConnectRPC **streaming**, khung `kind` = `exec`/`upload`/`download`/`retire-approval`/`cancel`/`welcome` | HTTP + `Bearer`, mỗi POST một op |
| Op | ~39 op `agent.v1.*Args`: `Shell, BackgroundShellSpawn, WriteShellStdin, ComputerUse, RecordScreen, Subagent(+Await), Mcp*, ExecuteHook, Fetch, *AllowlistPrecheck, Pi*…` | 12: `exec, read, readBytes, write, replace, remove, list, glob, grep, memoryLoad, memorySave, health` |
| Duyệt lệnh | vòng `needsApproval → approvalId → retire-approval` **ở daemon** | không có ở daemon (duyệt nằm ở app) |
| Tách người dùng | pod/tenant (`tenant_id`, `pod_id` trong box descriptor) — **không** thấy `spawn({uid})` | header `x-grokbot2-owner` → chạy dưới tài khoản OS từng người (chặng 5) |
| Truyền file | khung `upload`/`download` hạng nhất | gộp trong `readBytes`/`write` |

Ta **không nên** đổi sang ConnectRPC streaming: `.data/coverage.json` cho thấy client nói với backend
qua box-gateway, còn daemon là nội bộ của ta. Nhưng hai thứ đáng mượn: **khung duyệt ở daemon** và
**`BackgroundShellSpawn` + `WriteShellStdin`** (chạy lệnh dài, gõ tiếp vào stdin — đúng thứ kịch bản
OBS/live cần).

### 4.3 — Cờ tính năng

95 cờ `sand_*` trong `electron-main`. Ta chỉ dùng 2 (`sand_teach_by_demonstration` bật mặc định,
`sand_global_search`), phần còn lại tắt qua `GROKBOT2_FEATURE_GATES`. **Cơ chế thì đã đúng**
(bootstrap Statsig V1, `hash_used:"none"`, tên trần) — chỉ là chưa bật gì thêm.

Cờ đáng chú ý theo nhóm việc: `sand_multiplayer`, `sand_shared_room_box_tools_kill_switch`,
`sand_roster_via_server`, `sand_send_via_server`, `sand_attachments_via_server` ·
`sand_import_chrome_cookies` · `sand_multi_machine_local_exec` · `sand_trial_expires_at`,
`sand_usage_page`, `sand_usage_limit_tray_recovery` · `sand_computer_use_playwright(_config)`.

### 4.4 — Cổng tiền

```
state:        UNSPECIFIED=0 GRANTED=1 UNAVAILABLE=2 PAYMENT_REQUIRED=3
block_reason: NONE=1 TEAM_PRIVACY_MODE=2 … FREE_TRIAL_AVAILABLE=6 PAYWALL_INDIVIDUAL=7 …
ErrorButton oneof action: upgrade · switch_model · configure_spend_limit · url ·
                          upgrade_choice · dashboard_action · reload_window · client_action
```

`bootstrap.ts` của ta **đúng enum**: chặn → `state=3` + `block_reason=7`, thông → `1`/`1`.
Nhưng `grep ErrorButton` bên ta = **0** → nút hành động trên màn chặn chưa nối. Đường tái sử dụng cho
billing tự quản chính là nhánh **`url` (no:5)** — đúng như [[grokbot-vendor-monetization]] đã ghi.

---

## 5 · Việc đề nghị, xếp theo giá trị đo được

| # | Việc | Vì sao | Công |
|---|---|---|---|
| 1 | **Đọc `directAddressedAcceptance`** trong `sendPrompt` → chỉ thành viên được gọi tên nói, không thì cả phòng | client **đang gửi** cho ta (coverage.json:524) mà ta bỏ qua; hoàn thiện đúng phần 7.4.2 còn thiếu | ✅ **xong 28/08** |
| 2 | **`widget.multiSelect`** | 0.29 render thật; tính năng 2 cần chọn nhiều plugin | ✅ **xong 28/08** |
| 3 | **`submitUserForm` + `dismissUserForm`** | nút Submit của form đang chết lặng (404 mềm) | ✅ **xong 28/08** (+ `sendDraft`/`discardDraft` — nút chết thật) |
| 4 | **Cụm MCP ghi** | MCP bên ta mới chỉ đọc — khoảng trống hành vi lớn nhất của một mặt phẳng đã làm dở | ✅ **xong 28/08 — 10/10**: 8 lệnh thật (`installMcpEntry` · `updateMcpPluginInstall` · `uninstallMcpPlugin` · `listMcpServerTools` · `toggleMcpToolDisabled` · `setMcpCustomInstructions` · `removeMcpServer` · `authenticateMcpServer`) + 2 từ chối có lý do (`renameMcpAccount`/`removeMcpAccount` — ở đây mỗi server chỉ có MỘT bộ đăng nhập, không có khái niệm nhiều tài khoản) |
| 5 | ~~`web_search`/`web_fetch`~~ | — | ❌ **HÀNG NÀY SAI**: cả hai đã có sẵn từ trước, xem đính chính §1 |
| 6 | Entry `notice` + `user-attachment` | renderer 0.29 đã biết vẽ, ta chưa phát | ✅ **xong 28/08** |
| 7 | `BackgroundShellSpawn` + `WriteShellStdin` ở daemon | kịch bản OBS/live cần lệnh chạy dài + gõ tiếp stdin | vừa |
| 8 | `ErrorButton` nhánh `url` | nối nút trên màn chặn về trang thanh toán của mình | 🟡 **28/08 — nối bằng link markdown, không phải ErrorButton**: nút của hãng đi trong `CustomErrorDetails.buttons[]` (envelope LỖI RPC) và ta chưa dựng được đường chứng minh client đọc envelope đó từ backend này; link markdown thì có bằng chứng chạy trong bản ghi app gốc |
| 9 | `injectChromeCookies` (nửa box) | gỡ nút thắt "5 bot đứng chờ đăng nhập Shopee" — **chỉ sau khi tách trình duyệt** | lớn |
| 10 | `media_review` · `create_diagram` · `deep_search` | ba thứ THẬT SỰ còn thiếu sau khi đếm lại | ✅ **28/08**: `create_diagram` (mermaid trong markdown — đúng đường 0.29 vẽ) + `media_review` (subagent, chỉ tool NHÌN/ĐỌC, không tool ghi). **Còn `deep_search`** — cần một nhà cung cấp tìm kiếm sâu, không phải chuyện nối dây |

---

## 5.1 · Một khoảng cách KHÔNG phải lỗi hành vi: danh mục plugin

Replay B2 đo được **widget 0/5** — app gốc mở widget mời chọn ở 5 case, ta không mở cái nào. Ba lần
chạy đều vậy, kể cả sau khi siết lời nhắc. Nguyên nhân không nằm ở model:

```
danh mục plugin của backend này: 2 mục  (Grokbot2 Memory, Grokbot2 Skill)
danh mục app gốc trong B2:        chợ thật — Remotion, Canva, HeyGen, Notion, Gmail, …
```

Hỏi "có MCP nào giống CapCut không" thì bot ta rà bốn lượt tool rồi trả lời "chưa thấy gì kiểu
CapCut" — **đúng**, và đúng theo chính luật ta viết ("không thấy gì thì nói thẳng, đừng dựng
widget"). Mở widget để mời chọn giữa hư không mới là sai.

Nên: khoảng cách widget ở những case này là khoảng trống **DỮ LIỆU**, không lời nhắc nào lấp được.
Muốn đuổi kịp thì phải có danh mục thật, chứ không phải sửa câu chữ. Bài E2E đã đổi cho đúng: đo
luật hai chiều (có ứng viên → mời chọn; không có → nói thẳng và im), thay vì đòi widget vô điều kiện.

**Bài học cho mọi phép đo parity sau này:** một con số parity thấp có thể là hành vi sai, mà cũng có
thể là ta không có cùng dữ liệu để hành xử giống. Phân biệt trước khi đi sửa lời nhắc.

## 6 · Những gì KHÔNG trích được (ghi để không ai đi tìm lại)

- **Thuật toán lượt nói của hãng** — nằm trong workflow Temporal phía server, không có trong client.
  Ta chỉ có hợp đồng + các mảnh dữ liệu đầu vào.
- **Cách hãng cài phần mềm trên máy ảo** — `vm_setup_helper` chỉ là *tên* một subagent type;
  `apt-get`/`sudo`/`install_package` đều 0 hit. Logic nằm trong ảnh box hoặc server.
- **Văn xuôi system prompt / mô tả tool** — server bơm (§0.2). Không có gì để chép.
- **Có drop quyền theo từng lệnh trên box hãng không** — không tìm thấy `spawn({uid})`; các chuỗi
  `uid/gid` là của thư viện `tar` đi kèm. Cách ly đọc như mức pod/tenant. **Chưa xác nhận.**
