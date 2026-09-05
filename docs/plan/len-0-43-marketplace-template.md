# Lên client 0.43 · Cộng đồng bot (Marketplace) · Share as template — kế hoạch, 05/09/2026

> Căn cứ: [0-43-so-voi-local.md](../extracted/0-43-so-voi-local.md) (đọc trực tiếp bundle 0.43) và mã hiện có
> (`bot-templates.ts`, `conversation/cards.ts`, `runtime/tools.ts`, `infra/patches/*`). Mọi hình dạng dưới đây là
> trích từ `main-app.cjs`/`proto.cjs` 0.43, không đoán. Ranh giới: [legal.md](../legal.md) — client đã vá chỉ cho máy
> của mình; nội dung marketplace của hãng **không** kéo về.

## 0 · Thứ tự và vì sao

```
A. neo lại bộ vá cho 0.43 → dựng bản chở-app 0.43 → mở được app 0.43 trỏ vào backend mình
B. bịt lệnh mới client 0.43 gọi (404 → 200/204)             ← đo bằng GROKBOT2_STRICT_404 + gateway-coverage
C. Share as template khớp hình dạng 0.43                     ← đã có 70%, thiếu 5 trường + 1 regex
D. Marketplace (tab Bots + tab Plugins) phục vụ từ backend   ← 2 lệnh mới + kho listing + skill cho bot
E. E2E qua CDP :9222 trên app 0.43 local
```

A đứng đầu vì **không có A thì C, D không đo được**: client 0.29 local không có Marketplace, còn app gốc 0.43 không điều
khiển được. Giữ bản 0.29 (`Programs\Bot Noi Bo`) song song để parity cũ còn so được.

## A · Client 0.43 chạy với backend mình

Đo 05/09: **10/10 chuỗi `find` của 6 bản vá KHÔNG khớp** trên 0.43. Nguyên nhân cụ thể:

| bản vá | mốc cũ | ở 0.43 |
|---|---|---|
| `win-drive-path` (2) | `function cOt(t){…}` / `vht` trong `main.cjs` | `main.cjs` chỉ còn 12 KB vỏ; logic nằm ở `main-app.cjs` 2,0 MB / `main-core.cjs` 1,7 MB — tìm lại bằng `fe-find.mjs --identifier` theo **thân hàm** (`new URL(t).protocol!=="file:"`), không theo tên |
| `attach-upload-observable` | `dist/host/host-main.cjs` | **thư mục `host/` không còn** — code host gộp vào `main-app` |
| `get-ultra-redirect` (2) | `"https://cursor.com/bot/onboarding"` renderer + main | chuỗi có thể còn, tên biến đổi; grep chuỗi URL rồi đọc ±200 ký tự |
| `computer-tab-flag` | `featureGates?.sand_multi_machine_local_exec??!1` | cờ **không còn trong 712 cờ** của 0.43 (`isMultiMachineLocalExecEnabled` cũng bị bỏ) — kiểm xem tab Computer còn cần cờ không; có thể **bỏ bản vá** |
| `computer-tab-ipc/label/permission` (3) | `getSandMachines:s(…)` trong `main.cjs` | 0.43 có `getSandMachines` **chính thức** trong DSL (`noArgs`) + `updateSandMachineLabel{machineId,…}` — có thể bản vá thành **không cần** |
| `update-feed` (2) | `var JBn="https://api2.cursor.sh/updates"` | grep lại URL; thêm cờ mới đáng chú ý `sand_auto_update_when_idle`, `sand_busy_one_click_update`, `updater_recovery_windows` |

Việc:
1. `node infra/scripts/fe-find.mjs` trỏ vào asar 0.43 đã bung (`APP` hiện ghi cứng `Programs\Grok Bot` — thêm biến
   `GROKBOT2_CLIENT_DIR`, cùng lỗi họ với `patch-client.mjs` đã sửa 05/09).
2. Mỗi bản vá: neo lại `file` + `find`, giữ `expected: 1`; bản vá nào 0.43 đã làm sẵn thì **xoá** khỏi `PATCHES`
   thay vì ép khớp. `--verify` phải đỏ trên 0.29 cũ và xanh trên 0.43 — hai bộ vá cho hai client: tách
   `infra/patches/0.29/` và `infra/patches/0.43/`, `index.mjs` chọn theo `package.json.version` của client.
3. `build-setup.mjs --with-app` từ client 0.43 đã vá → `Bot-Noi-Bo-Setup-<ngày>-0.43.exe`; cài **song song** vào
   `Programs\Bot Noi Bo 043` (DefaultDirName mới hoặc `/DIR=` không dấu cách).
4. `run.ps1` nhận `GROKBOT2_APP_EXE` (đã có) — mở, kiểm CDP :9222, login, một lượt chat.
5. Cập nhật `clientVersion` mà bootstrap trả (nay 0.29) — client 0.43 so số này với chính nó ở vài chỗ (`quitAndInstallUpdate{expectedVersion}`).

Kiểm: `patch-client.mjs --verify` xanh trên 0.43; `check-app.cmd` thấy RPC tới `:8788`; không tiến trình nào của
`C:\Program Files\Grok Bot` bị đụng.

## B · Lệnh client 0.43 gọi mà backend chưa có

Bật `GROKBOT2_STRICT_404=1`, mở app 0.43 local, đi qua: sidebar → Marketplace (2 tab) → một bot → Share as template
→ Settings. Đọc `coverage.json` + log 404. Danh sách chắc chắn phải có (từ bundle):

| lệnh | args (0.43) | trả gì trước mắt |
|---|---|---|
| `listPublicBotMarketplace` | noArgs | `{featuredListings:[], listings:[], nextPageToken:""}` — rồi D làm thật |
| `getPublicBotTemplate` | `{shareId}` (regex `BOT_TEMPLATE_SHARE_ID_PATTERN`) | `{template, ownerDisplayName}` |
| `getBotTemplateExportPolicy` | noArgs | chính sách xuất (ai được share, có kèm memories không) |
| `getEffectivePlugins` · `getEffectiveMcpPlugins` | noArgs | map từ `mcp.ts` sang `EffectivePlugin` |
| `getPluginSyncStatus` · `getMcpPluginLogo{url}` · `updatePluginInstall{pluginId}` · `installEntry{entryId}` · `uninstallMcpPlugin{pluginId}` | | |
| `isServerRoomsEnabled` · `isServerAutomationsEnabled` · `isServerAgentSettingsEnabled` · `isServerAgentActionRoutingEnabled` · `isServerRosterActivityEnabled` | noArgs | `false` — giữ đường local |
| `listGrokBotAgentSessions{agentId}` · `listGrokBotTeamAgents` · `setGrokBotAgentVisibility{agentId,visibility:"owner"\|"team"}` · `setGrokBotAgentSidebarHidden` | | rỗng / ghi nhận |
| `listUserFormVaultEntries` · `getUserFormPrefill{fields}` · `upsert/update/deleteUserFormVaultEntry` | | rỗng — form vault là tính năng riêng, làm sau |
| `previewVoice{voiceId}` · `setAgentVoice{id,…}` · `setVoiceCallPresence` | | 204 — cờ `sand_voice_call` mặc định tắt |
| `listVirtualCardPaymentMethods` | | `[]` — xem [grokbot-vendor-monetization] |
| `stopCloudAgent{bcId}` · `completeGithubConnect{state}` · `getCursorOriginPrStatus{prUrl}` | | không áp dụng → lỗi có chữ |

Luật cũ vẫn áp: **hợp đồng 147 là của 0.30 — trích hợp đồng 0.43 ra file riêng** (`extract-contract.mjs --asar
<0.43 asar>`; sửa script để `OUT` không ghi đè `gateway-commands.json`), rồi `gateway-coverage.mjs` đo theo file đó.

## C · Share as template — khớp 0.43

Đã có: `createTemplateForAgent` · `publishBotTemplate{shareId,version}` · `getBotTemplateForSourceAgent{sourceAgentId}` ·
`getBotTemplateVersion{shareId,version}` · `setBotTemplateVisibility{shareId,visibility:"public"|"team"}` ·
`deleteBotTemplate{shareId}` · `createAgentFromTemplate` · thẻ `bot-template-share` · tool `share_bot_template`.
Args 0.43 của các lệnh này **không đổi** (`nlt/olt/ilt/slt/alt` trong `main-app`), trừ:

1. **`createAgentFromTemplate`** thêm `expectedActiveVersion:number` và `creatorContext?:string` → nhận, và trả lỗi có
   chữ khi `expectedActiveVersion` ≠ bản đang active (client dùng nó để tránh import bản cũ).
2. **Bản ghi template** (`aiserver.v1.GrokBotTemplate`): `share_id name avatar_shape avatar_color source_agent_id
   created_at_ms updated_at_ms blob_object_key published active_version description visibility owner_type image_url`.
   Ta thiếu `published`, `activeVersion`, `ownerType`, `imageUrl`; `blob_object_key` là **thân template nằm trong blob** —
   bên mình để `snapshot` inline là được, client không đọc key đó.
3. **Thân template phải chở đủ 5 mục** mà trang chi tiết vẽ: Instructions · Memories · Skills · Routines · Integrations.
   `TemplateSnapshot` hiện chỉ có `name/description/members` → thêm `instructions`, `memories[]`, `skills[]`
   (từ `workflows.ts forAgent`), `routines[]` (từ automations), `integrations[]` (MCP/plugin của bot). Và
   `createAgentFromTemplate` phải **dựng lại** 4 thứ đó cho bot mới, không chỉ tên + mô tả.
4. **`shareId` phải qua regex của client** (`getPublicBotTemplate` kiểm `BOT_TEMPLATE_SHARE_ID_PATTERN` TRƯỚC khi gọi).
   Id của ta là `tpl-<agent>-<base36>` — **chưa chắc qua**. Việc đầu tiên của C: trích regex ấy từ bundle
   (`fe-find.mjs "BOT_TEMPLATE_SHARE_ID_PATTERN"`), rồi đặt shareId theo đúng mẫu. Hãng dùng dạng
   `eMo3rxNN04q0ln6BQgT1e` (21 ký tự base62 — thấy trong transcript thật).
5. `getBotTemplateExportPolicy` noArgs — trả `{canShare:true, includeMemories:false,…}` theo đúng tên trường renderer
   đọc (trích khi làm).
6. Đường "Share as template" trong UI 0.43 (nút ⬆ đầu khung) gọi `getBotTemplateForSourceAgent` → nếu chưa có thì
   client **nhờ bot** (*"Create a template of yourself…"* → bot chạy skill export → `bot-template-share`) — đường
   này ta đã có qua tool `share_bot_template`; kiểm lại câu mở đầu client gửi ở 0.43 có còn nguyên văn không.

Kiểm: trên 0.43 local, bấm Share as template → thẻ hiện → tài khoản thứ hai `getPublicBotTemplate` → Import Bot →
bot mới có đủ skill + routine của bản gốc (đếm `getAgentWorkflows`/`getAgentAutomations`).

## D · Cộng đồng bot (Marketplace) — phục vụ từ backend

Hình dạng (proto 0.43):

```
listPublicBotMarketplace → ListPublicGrokBotMarketplaceListingsResponse
  { featured_listings: PublicGrokBotMarketplaceListing[], listings: […], next_page_token }
PublicGrokBotMarketplaceListing
  { slug, name, description, image_url | default_avatar{shape,color}, category, categories[],
    created_at_ms, updated_at_ms, share_id, creator{ id, name, profile_photo_url, handles } }
getPublicBotTemplate{shareId} → { template: GrokBotTemplate, owner_display_name }
Import Bot → createAgentFromTemplate{ shareId, agentId, name, avatarShape, avatarColor, expectedActiveVersion, creatorContext? }
```

Renderer đọc: `categories` (52 lần), `creatorName` (41), `creator.name`, `creator.profilePhotoUrl`, `featured`,
`listing.slug`. Nhóm lọc trên UI: *From Grok Bot Team · Engineering · Sales · Marketing · Design · Personal · More*.

Việc:
1. `marketplace.ts`: kho listing (`.data/marketplace.json`, đường dẫn qua env như `GROKBOT2_WORKFLOWS_FILE` — tránh
   bẫy "test ghi vào kho thật"). Listing = template có `visibility:"public"` + `category`, `creator`. Phân trang bằng
   `nextPageToken` dù ban đầu một trang.
2. Handler `listPublicBotMarketplace` (featured = listing có cờ `featured`), `getPublicBotTemplate` (đọc **xuyên owner**
   — template public của người khác; đây là chỗ duy nhất `bot-templates.ts` phải bỏ lọc `owner`).
3. Đường ĐĂNG: `setBotTemplateVisibility{shareId,"public"}` đã có → tạo listing; thêm tool cho bot
   **`publish_bot_listing{agent, category, description}`** và một **skill** trong menu `/` — *"Đăng bot lên cộng đồng"*:
   hỏi category, viết mô tả một dòng theo mẫu của hãng (*"Designs high-quality Grok Bots. Asks a few preference
   questions, then…"*), gọi `share_bot_template` → `publish_bot_listing`, rồi trả link `sand-marketplace`/shareId. Skill
   là văn bản trong `workflows.ts` (dựng sẵn như `dungSkillHocTuDemo`), tool là mã.
4. Tab Plugins: `getEffectivePlugins` map từ `mcp.ts` (id, name, description, logo, installMode); `installEntry`/
   `uninstallPlugin` nối vào add/remove MCP hiện có. Không cần catalog của hãng — catalog của ta là MCP mình đã có.
5. Trang chi tiết listing dùng chung template của C — nên **C trước D**.

Kiểm: app 0.43 local → Marketplace → Bots thấy listing của mình đúng nhóm → mở → 5 mục có dữ liệu → Import Bot → bot mới
chạy được một lượt. Tài khoản thứ hai (web login) thấy cùng listing.

## E · Đo

- `scripts/e2e-marketplace.mjs` (CDP :9222): mở Marketplace → chọn tab → chọn listing → Import → đếm bot mới; và
  Share as template → thẻ → `getPublicBotTemplate` qua GW. Xanh/đỏ từng mốc như `e2e-teach.mjs`.
- `gateway-coverage.mjs` theo hợp đồng 0.43: 0 đường 404 sau một vòng đi hết UI.
- Bẫy đã biết áp cho bài này: selector phải IN RA rồi đọc; đếm ở kho MỚI; `coverage.json` đếm cả lượt của bài đo.

## Ước lượng và rủi ro

| bước | cỡ | rủi ro chính |
|---|---|---|
| A | 1 ngày | neo sai bản vá → app 0.43 boot bundle gốc "trông như chạy" (fail-closed của `--verify` phải giữ) |
| B | ½ ngày | thiếu một lệnh `isServer*Enabled` → client đi đường server, mọi thứ im |
| C | 1 ngày | regex `shareId`; snapshot thiếu skill/routine → Import ra bot rỗng |
| D | 1–1½ ngày | đọc xuyên owner ở đúng MỘT chỗ; kho listing lẫn với kho test |
| E | ½ ngày | — |

Không làm: kéo catalog/plugin/template của hãng về (ngoài ranh legal); đụng `C:\Program Files\Grok Bot`.
