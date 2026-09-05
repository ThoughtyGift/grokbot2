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

**KẾT QUẢ 05/09 — A XONG phần chạy được, còn hai việc đóng gói.**

- **10/10 mốc neo lại**, không tách thư mục vá theo bản: mỗi bản vá có `variants[]` theo `version`, `patch-client.mjs` chọn
  biến thể mà `find` xuất hiện đúng `expected` lần. 7 áp lên 0.43 (`main-app.cjs` + renderer), **3 chứng minh thừa** bằng
  `obsoleteIf` (chuỗi bằng chứng hãng đã tự sửa: `yct` kiểm ổ đĩa Windows trước `new URL`; cờ `sand_multi_machine_local_exec`
  bỏ; host gộp vào main-app). `--verify` xanh trên **cả** `C:\cai043` và `C:\cai029`. Trạng thái vá nay ghi **cạnh bản cài**
  (`resources/grokbot2-patch-state.json`), không còn một file chung cho hai bản.
- **Client 0.43 chạy song song** với 0.29: `C:\cai043` (asar bung + vá), hồ sơ `%APPDATA%\Grok Bot (local 043)`, CDP `:9225`,
  bốn biến trỏ `localhost:8788`. Boot, đăng nhập (chép hồ sơ), roster, transcript, routine, "New Bot's screen" đều vẽ đúng;
  update-feed hỏi ta (204); một lượt chat gõ qua CDP đi hết vòng (tin lên tail có `clientNonce`, trả lời mọc sống sau 3 s).
- **Bức tường thật không phải bản vá mà là SCHEMA REPLY.** Mở lần đầu, 0.43 hiện *"Can't reach your computer"* +
  *"Showing saved messages…"* dù `transport:"connected"`. Coordinator 0.43 kiểm **mọi** reply gateway theo schema nhúng
  (mode "structural") và ném `gateway <lệnh> reply is malformed`; 12 lệnh của ta trượt. Toàn bộ chuyện này ở
  [0-43-so-voi-local.md §7](../extracted/0-43-so-voi-local.md) và bài đo `scripts/kiem-reply-0-43.mjs` (29 lệnh đọc: 0 sai, 2 lệch cố ý).
- **Đóng gói XONG 05/09 tối** (mục 3 · 4 · 5):
  - Mục 3: `GROKBOT2_CLIENT_DIR=C:\cai043 GROKBOT2_SETUP_VARIANT=043 node scripts/build-setup.mjs --with-app` →
    `dist/043/Bot-Noi-Bo-Setup-20260905-0.43.exe` (111.213.560 B). Biến thể = AppId · AppName · `Programs\Bot Noi Bo 043` ·
    shortcut · kho hồ sơ `%APPDATA%\Bot Noi Bo 043` đều riêng, ghi vào thư mục CON `dist/043/` để `newestSetup`/`phat-hanh` không
    bao giờ nhặt nó làm gói phát hành. Cài im lặng thử: exit 0, 578 file (573 của cây nguồn + launcher, `backend.txt`, icon, 2 file
    gỡ cài), `package.json` 0.43.20260905, `--verify` xanh trên bản cài, bản 0.29 ở `Programs\Bot Noi Bo` không đổi một byte.
  - Mục 4: `infra\scripts\start-app-043.cmd` — đặt `GROKBOT2_APP_EXE` (ưu tiên bản cài 043, rồi `C:\cai043`), `GROKBOT2_CDP_PORT=9225`
    (`run.ps1` nay đọc cổng từ biến), `SAND_USER_DATA_DIR=Grok Bot (local 043)`. Đo: mở bản cài → 9 tiến trình đúng đường dẫn, CDP
    :9225, roster hiện từ backend; 18 tiến trình của hãng + 0.29 không bị đụng.
  - Mục 5: "clientVersion bootstrap" hoá ra không phải trường proto nào — là NỀN phiên bản `phat-hanh.mjs` đọc từ
    `docs/state/client-patch-state.json` (đứng ở 0.29.0 từ khi trạng thái vá chuyển sang nằm cạnh bản cài). Nay đọc từ
    `GROKBOT2_CLIENT_DIR/resources/app/package.json` trước, file repo là dự phòng. **Chưa phát hành 0.43 lên feed** — quyết định
    đổi bản cho mọi máy là của chủ dự án (xem rủi ro: gói 0.43 trên feed sẽ được launcher 0.29 tải và cài).
  - Bắt được kèm: launcher của MỌI gói đã phát ghi `%APPDATA%Bot Noi Bo` (mất backslash trong template literal) — hồ sơ người dùng
    nằm ở `AppData\RoamingBot Noi Bo`; sửa + di dời một lần. Xem bảng theo dõi §7.

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

> **XONG phần lõi 05/09 (18:40)** — commit cùng ngày. Làm được ngay trên 0.29, đo bằng
> `scripts/e2e-mau-bot.mjs` qua `/gw/api` thật: **20/20 xanh**, dọn sạch. Cụ thể: (1) ✅ `expectedActiveVersion`
> (lệch → `{ok:false, reason}`) + `creatorContext` nhận vào; (2) ✅ bản ghi thêm `ownerAuthId · ownerType · imageUrl`,
> bản cũ trong kho được lấp lúc đọc; (3) ✅ `snapshot.recipe` đúng zod `CB`/`Dct` của 0.43 (`profile · memory[] ·
> skills[] · routines[] · plugins[]`), nguồn tiêm qua `bindTemplateSources` (gateway nối workflows · automations ·
> memory-trên-box · plugins đã cài), `createAgentFromTemplate` dựng lại skill + routine (+ memory best-effort) cho
> bot MỚI; (4) ✅ regex trích được: `BOT_TEMPLATE_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/`, `newShareId()` =
> 16 byte → base64url → 21; (6) ✅ `getPublicBotTemplate{shareId}` xuyên chủ, trả đúng `BotTemplateImport
> {expectedActiveVersion, instructions, view}` mà `isBotTemplateImport` của renderer kiểm — kể cả các điều kiện
> ngầm: `view` KHÔNG có `sourceAgentId`, mọi chuỗi `min(1)` (skill thiếu mô tả thì lấp), avatar phải nằm trong bảng
> `EB`/`SB` (11 màu · 18 hình, ghi trong `bot-templates.ts`). **Chưa**: (5) `getBotTemplateExportPolicy`; recipe của
> NHÓM chưa chở skill từng thành viên; hồ sơ người tạo (tên suy từ tài khoản `nguoi-a@…` → `nguoi-a`); tầng proto
> (`GetGrokBotTemplateImportDetails` + blob URL) — cần khi client 0.43 gọi qua Cursor RPC thay vì box-gateway.

> **Nút "Share as template" — XONG 05/09 tối, đo bấm thật trên client 0.43 local** (tay trọn 7 bước; `scripts/e2e-chia-se-mau.mjs` 6/7, mốc 7 đã sửa cách kiểm — chạy lại khi app rảnh).
> Luồng trích từ renderer 0.43 + cache client app gốc (bot "dr eggbot", 08:41 05/09): menu header (nút ⬆, `Template actions`)
> → client TỰ gửi tin người dùng `"Create a template of yourself that I can share with somebody else."` (i18n `RN7y7S`)
> → bot đăng vài câu tiến độ (memories → skills → routines → plugins → "giữ N…") → bản ghi mọc entry `send-message`
> `{type:"bot-template-share", shareId, name, avatarShape, avatarColor, body, shareUrl, version:1, published:false,
> visibility:"public"}` → thẻ vẽ **Unpublished · Publish · View Details** → người dùng bấm Publish → client gọi
> `publishBotTemplate{shareId,version}` và ghép reply vào store → thẻ **Published · Copy link**, menu header đổi sang
> *View template details / Update template / Delete Template* (đọc `published` từ `getBotTemplateForSourceAgent`).
> **Update template** gửi câu KHÁC: `"Update the shared template of yourself."` (`sfB+W/`) → thẻ thứ hai bản active+1.
> Trạng thái thẻ client tự suy (`LQ`): `version===activeVersion` (có cả hai) · `published===false → false` · `active`.
> Bên ta: `stageTemplateForAgent` (bản CHỜ `staged`, đầu bảng giữ bản đã phát — người import không nhận bản chưa duyệt),
> `publishBotTemplate` nâng đúng bản chờ thay vì chụp lại, `toWireView` (5 mục ở đầu bảng cho hộp View Details,
> `activeVersion` vắng thay vì null), thẻ `postBotTemplateShareCard`, tool `share_bot_template` đăng tiến độ + thẻ,
> lượt nhận ra bằng hằng câu (`laLuotChiaSeMau`) → khoá `ask_question` + hướng dẫn 3 nhịp trong SYSTEM.
> Mục (5) `getBotTemplateExportPolicy` ✅ `{exportPolicy:"all"}`; `getHostStatus.capabilities` mang
> `botTemplateJsonShareV1` + `botTemplateVisibilityV1` (điều kiện `sEe` để nút hiện). Chưa: hồ sơ người tạo thật
> (`creatorName` suy từ tài khoản), nhóm chở skill thành viên, mã lỗi `bot-template/not-found` cho thẻ của mẫu đã xoá
> (client tự đánh dấu "user-deleted" nên chưa cần).

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

> **KẾT QUẢ 05/09 — XONG, đo trên client 0.43 thật.** Kho listing + hồ sơ người tạo (`services/grokbot-backend/src/marketplace.ts`,
> file `GROKBOT2_MARKETPLACE_FILE ?? .data/marketplace.json`), 3 RPC main-side (`ListPublicGrokBotMarketplaceListings` ·
> `GetGrokBotTemplateImportDetails` · `GetPublicGrokBotMarketplaceListing`, `packages/grokbot-proto/src/marketplace-rpc.ts`), blob
> recipe `GET /gw/bot-template-blob/<shareId>/<version>.json` (không cần ticket — main của client `fetch` trần), lỗi Connect có
> MÃ (404 `not_found` / 403 `permission_denied`; đường `connect+proto` ra khung end-stream), 6 lệnh gateway
> (`listPublicBotMarketplace` · `listMyBotListings` · `publishBotListing` · `unpublishBotListing` · `getCreatorProfile` ·
> `setCreatorProfile`), tool bot `publish_bot_listing`, ba cờ client bật (`sand_marketplace_bots_v2` · `sand_share_bot` ·
> `sand_header_template_share_menu`). **Trên UI 0.43:** Marketplace → Bots hiện thẻ Featured + nhóm Ops Finance/Productivity với tên
> người tạo từ hồ sơ; mở thẻ → trang chi tiết (qua RPC + blob, qua zod `Dct` của main); **Import Bot** → bot mới mang ĐÚNG
> `agentId` client tự đúc (UUID) + avatar chọn trên thẻ, skill đã dựng, không lời nhắc setup, bot tự chào (kickstart).
> Đo: `scripts/e2e-marketplace.mjs` 26/26 · `scripts/e2e-mau-bot.mjs` 20/20 · `kiem-reply-0-43.mjs` 29 đọc + 13 ghi = 0 sai · 18 unit.
> **Chưa:** mục 4 (tab Plugins nối MCP — hiện tab Plugins vẫn danh mục cũ), tài khoản thứ hai qua web login, phân trang thật
> (`nextPageToken` luôn rỗng), ảnh người tạo là URL ngoài (chưa host). Ba điều bất ngờ ghi ở
> [0-43-so-voi-local.md §7b](../extracted/0-43-so-voi-local.md).

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

## D′ · Plugin hai tầng — hãng làm thế nào, và đường của ta (bổ sung 05/09, 13:40)

**Plugin của hãng = định dạng plugin của Claude Code, lấy từ git.** Không đoán — đọc `proto.cjs` 0.43:

```
Plugin        { id, name, display_name, description, status, repository_url, tags, logo_url, primary_color,
                is_published, publisher{…}, marketplace_id, marketplace{…},
                git_url, git_ref, git_path, full_ref,
                skills[], subagents[], hooks[], rules[], mcp_servers[], commands[], variables[],
                release_repo, release_asset, release_tag, curated_category_keys[],
                team_marketplace_install_mode, lifecycle_state, min_client_versions, published_by_user }
Marketplace   { id, name, display_name, description, git_url, git_ref, user_id, team_id, logo_url,
                last_indexed_at, last_indexed_commit_sha, team_config, required_plugin_installs[],
                auto_reindex, distribution_git_url, is_default, allow_user_publish }
AddMarketplaceRequest { name, git_url, git_ref, display_name, description, team_id, auto_reindex }   ← nút "Add repositories"
EffectivePlugin { plugin, is_team_required, is_enabled, pinned_git_ref, configured_variables, inline_content_json,
                  install_mode: USER | TEAM_DEFAULT | TEAM_REQUIRED, configured_variable_keys[] }
FirstPartyPluginConfiguration → FirstPartyPluginMode: ENABLE_ALL | ALLOWLIST
```

Chuỗi UI khớp: *"Add repositories"* · *"Plugin content needs GitHub authentication"* · *"Set up git credentials on Grok
Bot's computer so installed plugins can be fetched"* · *"Complete GitHub auth to sync installed plugins"* · *"Copy link to
this plugin"* · *"Team plugins"* · *"Your plugins"* · *"Plugin Setup"* (điền `variables`). Và bằng chứng sống: repo `ecc`
của chính người dùng hiện trong tab Plugins là **"Team plugins · ecc — Battle-tested Claude Code plugin"** — hãng đã
index một marketplace Claude Code (`.claude-plugin/marketplace.json` + `plugin.json` + `skills/ commands/ agents/ hooks/
.mcp.json`) rồi cài lên box bằng `git clone` (do đó cần git credentials trên box).

Hai tầng của hãng, và ta có gì:

| tầng | hãng | ta hôm nay | thiếu |
|---|---|---|---|
| **Plugin hãng** (Gmail, Drive, Notion, Slack, Granola…) | MCP do Cursor host; `FirstPartyPluginConfiguration` ENABLE_ALL/ALLOWLIST; tab Plugins → *Featured* | `plugin-catalog.ts` (registry JSON: `GROKBOT2_PLUGIN_REGISTRY` path/URL) + `plugins.ts` (Add = ghi MCP server vào config theo owner) + `bootstrap-plugins.ts` (dựng hình cho client) — **đã chạy trên 0.29** | map sang `EffectivePlugin` cho 0.43 (`getEffectivePlugins`/`getEffectiveMcpPlugins`), `variables` → *Plugin Setup* |
| **Plugin cộng đồng** (user tự build, `ecc`, `pstack` 45 skill) | marketplace = **git repo**; plugin = thư mục theo định dạng Claude Code; index → `skills/subagents/hooks/rules/commands/mcp_servers`; cài = clone lên box; `allow_user_publish`; `install_mode` user/team | **chưa có** | toàn bộ tầng này |

**Đường của ta cho tầng cộng đồng — không clone plugin của ai, dựng ĐƯỜNG để ai cũng đăng được:**

1. `marketplaces.ts` — kho marketplace theo owner: `{name, gitUrl, gitRef, displayName, description, autoReindex}`; lệnh
   `addMarketplace` (0.43 gọi qua RPC `AddMarketplace` — trích tên lệnh host tương ứng khi làm B). Marketplace mặc định
   của ta = một repo git của dự án (`is_default`), `allow_user_publish: true`.
2. **Indexer** (chạy trên box, nơi đã có git): clone/fetch repo → đọc `.claude-plugin/marketplace.json` → mỗi plugin đọc
   `plugin.json` + đếm `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md`, `hooks/hooks.json`, `.mcp.json` → ghi
   `Plugin` vào kho (`.data/plugins-index.json`, đường dẫn qua env). `last_indexed_commit_sha` để biết cũ/mới.
3. **Cài** = `installEntry{entryId}` (0.43) → clone `git_url@git_ref/git_path` vào `~/workspace/plugins/<name>` trên box →
   (a) mỗi `skills/*/SKILL.md` thành một skill trong `workflows.ts` cho bot (menu `/`), (b) `.mcp.json` → `mcp.ts`
   (đi qua `plugins.ts` sẵn có, `variables` → secrets.ts placeholder như registry hiện tại), (c) `rules/` ghép vào lời
   nhắc, (d) `hooks/` **bỏ qua ở bản đầu** (hooks chạy lệnh tuỳ ý — trên box dùng chung là rủi ro; ghi rõ "chưa hỗ trợ").
   `pinned_git_ref` để `updatePluginInstall{pluginId}` biết có bản mới.
4. **Đăng** (user tự build): skill trong menu `/` *"Tạo plugin"* — bot scaffold `plugin.json` + `skills/` từ chính skill/routine
   của bot (đường ngược của C: template → plugin), commit vào repo của người dùng (hoặc PR vào marketplace mặc định), rồi
   `addMarketplace`/reindex. Tool: `scaffold_plugin{name, skills[], mcp?}` + `publish_plugin{gitUrl}`.
5. Quyền: `GROKBOT2_ALLOW_PLUGIN_INSTALL` đã có — giữ; thêm `install_mode` team-required cho chủ VPS ép plugin nền.

Kiểm: `ecc` của chính người dùng (đã là marketplace Claude Code hợp lệ) → `addMarketplace` → index ra đúng số skill →
cài lên `New Bot` → menu `/` mọc skill của `ecc` → gọi một skill chạy được. Đó là bài E2E rẻ nhất vì repo có sẵn.

*Về câu "giống plugin của Hermes/DeepSeek không": không kiểm được từ đây; thứ kiểm được là hãng dùng **đúng định dạng plugin
+ marketplace của Claude Code** (cùng nhà Anthropic-format mà `ecc` của bạn viết theo), nên chuẩn mở để bám là chuẩn đó.*
