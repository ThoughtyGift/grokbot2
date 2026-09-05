# App gốc 0.43.0 so với app local 0.29.20260903 — đọc trực tiếp từ bundle, 05/09/2026

> Nguồn: `sand-update-0.43.0.exe` (chữ ký Valid, `Anysphere, Inc.`) bung bằng 7-Zip → `app-64.7z` → `app.asar`
> (34.298.294 B, **cùng byte** với `C:\Program Files\Grok Bot\resources\app.asar` sau khi người dùng bấm cập nhật) →
> `@electron/asar extract`. Local = bản chở-app `%LOCALAPPDATA%\Programs\Bot Noi Bo` (client 0.29 + 6 bản vá).
> Không có dòng nào là đoán: mọi số dưới đây là `grep`/`comm` trên hai bundle.

## 1 · Hình dạng bundle

| | local 0.29 | hãng 0.43 |
|---|---|---|
| renderer | 5 chunk, chunk chính **4,32 MB** | 6 chunk, chunk chính **3,39 MB** (tách nhiều hơn) |
| electron-main | `main.cjs` (proto nhúng) | `main.cjs` 12 KB chỉ là vỏ → `main-app.cjs` 2,0 MB · `main-core.cjs` 1,7 MB · `proto.cjs` 4,0 MB |
| RPC Cursor (`aiserver.v1.*Request`) | 1.266 | 1.350 — **+84, −0** |
| mặt lệnh renderer→host (DSL `v().args`) | 345 (0.30) | **366** — +32 mới, −11 |
| bảng nhóm lệnh của renderer | 122 (0.30) | 125 — +14, −11 |
| cờ tính năng trong main | (0.30: bảng khác dạng) | **712** cờ `name:{client,default}` |
| signer allowlist của updater | — | vẫn `["Anysphere, Inc.","Anysphere"]` |

**Đọc số "366 vs 147" thế nào.** 147 là tập con của DSL được chuyển tiếp tới box-gateway (backend). DSL 0.30 đã là 345,
giao với 147 đúng 147. Nên 0.43 **không** mọc 219 lệnh backend — nó mọc **32 lệnh host** (bảng dưới), trong đó một phần
đi tới backend; hợp đồng 147 cần **trích lại từ 0.43** để biết chính xác (việc §5 mục 15 bảng theo dõi).

## 2 · Lệnh mới / mất

**32 lệnh host mới (DSL):** `awaitCookieOriginApproval checkMessagesPermissions completeGithubConnect
deleteUserFormVaultEntry exposeUsageWarningExperiment getBotColorInChatEnabled getBoxHostPhase
getCurrentMachineMessagesEnabled getCursorOriginPrStatus getUserFormPrefill hasMigratedClientPersistence
isServerAgentSettingsEnabled isServerAutomationsEnabled isServerRoomsEnabled listGrokBotAgentSessions
listUserFormVaultEntries peekUsageWarningAssignment previewVoice readManyClientPersistence
reportLocalExecSupervisorFailed reportPolicyStopped reportTranscriptRowLoss reportUsageWarning
requestCookieOriginApproval setAgentVoice setBotColorInChatEnabled setVoiceCallPresence stageAttachmentPath
stopCloudAgent updateCurrentMachineMessagesEnabled updateUserFormVaultEntry uploadAttachmentChunk`

**14 lệnh mới trong bảng nhóm renderer:** `completeGithubConnect deleteUserFormVaultEntry getServerAgentRoster
getUserFormPrefill listUserFormVaultEntries listVirtualCardPaymentMethods noteMountedAgent previewVoice
resolveAgentCreation restoreTemporalAgentRouting setAgentVoice setVoiceCallPresence stopCloudAgent
updateUserFormVaultEntry` — backend mình chưa có handler nào trong 14 cái này.

**11 lệnh bỏ hẳn:** toàn bộ phòng chung `addOwnAgentToSharedRoom createRoomFromAgent createRoomInvite createSharedRoom
getSharingState joinSharedRoom leaveSharedRoom removeOwnAgentFromSharedRoom respondToRoomJoinRequest setSharedRoomTyping`
+ `isMultiMachineLocalExecEnabled`. ⇒ 9 trong 16 lệnh "thiếu" của bảng theo dõi nay **không còn tồn tại ở client** — thay
bằng đường server (`isServerRoomsEnabled`, RPC `CreateGrokBotRoom`/`SetGrokBotRoomMembers`).

**84 RPC Cursor mới**, theo chủ đề: Marketplace (`ListPublicGrokBotMarketplaceListings`, `GetPublicGrokBotMarketplaceListing`,
`*MarketplaceCategory/Creator/ListingInternal`, `PreviewGrokBotMarketplaceSourceInternal`) · Form vault
(`ListGrokBotUserFormVaultEntries/Keys`, `UpsertGrokBotUserFormVaultEntry`) · Thẻ ảo (`RaiseGrokBotVirtualCard`,
`ResolveGrokBotVirtualCardApproval`, `ListGrokBotStripeLinkPaymentMethods`) · Memory shard (`ListGrokBotMemoryShards`,
`PutGrokBotMemoryShard`) · Voice (`MintDesktopRealtimeVoiceSecret`) · Phòng server (`CreateGrokBotRoom`,
`SetGrokBotRoomMembers`, `RequestGrokBotRoomMemberTurn`) · Team (`GetTeamGrokBotTrial`, `SendTeamSandOnboardingInvites`,
`UpdateTeamSandShareBotExportSettings`) · Admin box (`AdminListGrokBotSessionBoxes`, `AdminHibernate…`, `AdminReap…`) ·
Draft (`SendGrokBotDraft`, `DiscardGrokBotDraft`) · `GetGrokBotRuntimeCapabilities`.

## 3 · Teach a task — 0.43 đổi gì

Không đổi hợp đồng: `startTeachRecording{agentId,entryPoint}` · `stopTeachRecording{agentId,save}` ·
`getTeachRecordingStatus` noArgs — **khớp từng chữ** với 0.30 và với ta. Hằng số `"The recording is finished. Learn the
task from it."`, `learn-from-demonstration`, `teach-recording:`, `sand-workflow:`, `workflowReference` — đủ cả, cùng số lần.

Một đổi có hệ quả: **cờ `sand_teach_by_demonstration` biến mất** (0.30: 3 lần trong renderer, 0.43: 0; không có trong 712 cờ).
Nút Teach nay hiện **vô điều kiện**. Bên mình `featureGates` vẫn trả cờ đó — với client 0.29 là cần, với 0.43 vô hại.
Thêm i18n (Đức/Hà Lan/Thuỵ Điển…) cho "Learn from demonstration".

## 4 · Marketplace (thay panel Plugins) — dữ liệu ở ĐÂU

Chuỗi `"Plugins"` **mất** khỏi catalog en; `Marketplace` 80 lần (local: 1). Hai tab:

| tab | lệnh host (main-app 0.43) | RPC Cursor phía sau |
|---|---|---|
| **Plugins** (Gmail, Drive, Notion, Slack, Granola, team `ecc`…) | `getEffectivePlugins` noArgs · `getEffectiveMcpPlugins` noArgs · `getPluginSyncStatus` · `getMcpPluginLogo{url}` · `uninstallPlugin{pluginId}` · `updatePluginInstall{pluginId}` · `installEntry{entryId}` | `GetEffectiveUserPlugins`, `AddMarketplace`, `AddMcpServersFromPlugin`, `BatchGetPluginMcpConfig`, `ApplyTeamMarketplaceRequiredPlugins` |
| **Bots** (dr eggbot, Overheard, Tradbot…) | `listPublicBotMarketplace` noArgs · `getPublicBotTemplate{shareId}` (regex `BOT_TEMPLATE_SHARE_ID_PATTERN`) · `createAgentFromTemplate` · `listBotTemplates` · `getBotTemplateVersion` · `getBotTemplateForSourceAgent` · `publishBotTemplate` · `getBotTemplateExportPolicy` | `ListPublicGrokBotMarketplaceListings`, `GetPublicGrokBotMarketplaceListing`, `GetPublicGrokBotTemplate`, `CreateGrokBotAgentFromTemplate`, `ActivateGrokBotTemplateVersion`, `SetGrokBotTemplateVisibility` |

Trang chi tiết bot (Instructions · Memories · Skills · Routines · Integrations · **Import Bot**) chính là hình dạng
`bot-template-share` đã thấy trong transcript (`{shareId,name,avatarShape,avatarColor,body}`), mở rộng thêm skill/routine.
URL ngoài duy nhất: `https://cursor.com/marketplace`.

**Cache client KHÔNG giữ catalog** — quét 32 blob / 9 nhóm slice: "dr eggbot"/"Marketplace" chỉ xuất hiện trong transcript
(bot nhắc tới) và roster. Catalog kéo từ server mỗi lần mở.

**Trích được tới đâu:**
- **Hợp đồng** (tên lệnh, args, tên RPC/proto message) — **trích trọn**, ở trên. Đủ để backend mình phục vụ một Marketplace
  của riêng mình (template + plugin của ta) cho client 0.43.
- **Nội dung** (catalog plugin, thân template dr eggbot… của bên thứ ba) — **không có trong bundle, không có trong cache**.
  Lấy được chỉ bằng cách gọi server Cursor với phiên của người dùng; đó là nội dung của hãng và của người đăng — nằm ngoài ranh
  [legal.md](../legal.md) ("không phân phối lại"), nên **không làm nếu chưa có quyết định**.

Bên mình đã có handler: `createAgentFromTemplate publishBotTemplate listBotTemplates getBotTemplateVersion
getBotTemplateForSourceAgent uninstallPlugin installPlugin getSandMachines`, và từ **05/09 (bước C)** thêm
`getPublicBotTemplate{shareId}` — trả đúng `BotTemplateImport {expectedActiveVersion, instructions, view}` mà host
0.43 đưa cho renderer (`xfe` = botTemplateImportFromPackedVersion), `createAgentFromTemplate` nhận đủ
`expectedActiveVersion` + `creatorContext`; chưa có: `listPublicBotMarketplace getEffectivePlugins
getEffectiveMcpPlugins getPluginSyncStatus getMcpPluginLogo uninstallMcpPlugin getBotTemplateExportPolicy
updatePluginInstall installEntry`.

**Validator import của renderer (trích `main-app.cjs`, để khỏi đoán lần nữa):** `isBotTemplateImport` →
`expectedActiveVersion` nguyên ≥ 1 · `instructions` string · `view.shareId` khớp `/^[A-Za-z0-9_-]{21}$/` · `name`,
`description`, `shareUrl` không rỗng · `avatarShape ∈ SB` (blob pebble bean egg squircle tablet capsule cylinder hex gem
crystal wedge shield dome arch cloud teardrop leaf) · `avatarColor ∈ EB` (black brown red orange yellow green cyan blue
violet magenta gray) · `creatorName` nếu có thì không rỗng; `isPackedImportView` → `version === activeVersion ===
expectedActiveVersion` · `active === published === true` · **`sourceAgentId == null`** · `memory/skills/routines/plugins`
qua zod `CB`: skill `{name, description, content}` **cả ba `min(1)`**, routine `{name, slug, description, content}` cả bốn,
plugin `{pluginId, name, description?}`, memory `{kind?, createdAt?, content}`. Share URL: `https://x.ai/bot/${shareId}`.

## 5 · Chuỗi UI tiếng Anh mới (khối en so theo id: 372 → 481, +131 / −29)

- **Thẻ ảo / Stripe Link**: *"Virtual card approval"*, *"This card was approved. Finish authorizing on the Stripe Link page…"*,
  *"No payment methods in your Link wallet"*, *"Charged via Link. Card details never enter this chat."*
- **Team**: *"Share this bot with your team"*, *"Team access enabled"*, *"Work with this bot in your team's Slack channels"*
- **Messages trên máy người dùng** (macOS): *"Allow Grok Bot to use Messages on your local computer?"*, *"Read your Messages…"*
- **Canvas**: *"Building canvas…"*, *"Expand canvas"* · **Marketplace**: *"Add from Plugins"*, *"Open in Plugins"*
- **Mất**: *"Plugins"*, toàn bộ *Shared chat / Threads / Start a thread / View thread* (chat chia sẻ kiểu cũ bỏ), *"The Bot wants to copy cookies"* (đổi sang cửa `cookie-origin-approval`).

(Khối en bắt được 372/481 id vì catalog tách nhiều khối — đủ để đọc hướng, không đủ để đếm tuyệt đối.)

## 6 · Hệ quả cho bên mình

1. **Bản tham chiếu nay là 0.43**, hợp đồng đã trích là 0.30, client local là 0.29 — ba số, đừng hợp nhất. Việc đáng làm:
   `extract-contract.mjs --asar <0.43 asar>` ra **file riêng** (không ghi đè `gateway-commands.json` 0.30) rồi diff.
2. Client 0.43 nói với backend mình sẽ gọi thêm ít nhất 14 lệnh chưa có handler — mở app 0.43 trỏ vào ta là thấy 404
   (`GROKBOT2_STRICT_404`). Chưa cần vì local vẫn 0.29; cần khi nâng client.
3. Cờ `sand_teach_by_demonstration` không còn ở 0.43 → không phải điều kiện của nút `+` nữa.
4. 9/16 lệnh "thiếu" (phòng chung) nay là chuyện đã đóng ở phía client.

## 7 · Coordinator 0.43 kiểm MỌI reply gateway theo schema nhúng (đo 05/09)

Đây là điều 0.29 không có, và là lý do client 0.43 mở lên với backend mình lại hiện hai banner mất kết nối trong khi
`transport:"connected"`, SSE sống, health `ok`.

**Cơ chế.** `dist/node-agent-coordinator/main.cjs` có hằng `RA` = base64 của một JSON nén **deflate-raw**
(`inflateGatewayProtocolSchema`): `{ methods: { <lệnh>: { args, reply } }, events, capabilities, hostOnlyMethods, $defs }`
— 150 lệnh, sinh từ `sand/src/shared/rpc/gateway.ts` của hãng. Mỗi reply đi qua `parsedReply → ft(schema, reply, "structural")`;
lỗi ⇒ `SandGatewayMalformedReplyError("gateway <lệnh> reply is malformed: <chi tiết>")`, và **chỗ gọi coi như lệnh thất bại**.
Rút ra: `JSON.parse(zlib.inflateRawSync(Buffer.from(RA, "base64")))` → [gateway-schema-0.43.json](gateway-schema-0.43.json).

**Mode "structural" bắt gì.** Kiểu (`string|number|boolean|null|array|object`), `required`, `null` ở nơi không nullable
(`{"type":"number"}` không nhận `null` — khoá phải VẮNG), `anyOf`/`oneOf`. **Không** bắt `enum`/`const`, **không** bắt
khoá thừa (`additionalProperties:false` chỉ có tác dụng ở mode "exact") — nên gửi **thêm** khoá cho client cũ là an toàn,
gửi **thiếu**/`null` là hỏng cả lệnh.

**Hai banner, hai lệnh.** *"Can't reach your computer"* = `getHostSettings` thiếu `notifications.allowedApps` →
`readHostSettingsFromBox` ném → kho "sidebar sections" đọc hỏng (`client/sidebar-sections-read-failed`) → roster vẽ banner.
*"Showing saved messages"* = một tin người dùng trong `openAgentTail` thiếu `isStreaming` → trang tail bị coi là hỏng →
replica không "install", renderer giữ bản lưu (`isShowingRestoredTranscript`). Không dòng log nào ở phía ta, vì reply là 200.

**12 chỗ đã sửa cho khớp** (`scripts/kiem-reply-0-43.mjs` quét 29 lệnh đọc: 0 sai):

| lệnh | thiếu / sai | sửa |
|---|---|---|
| `getHostSettings` | `notifications` thiếu 4 khoá; `mcpCustomInstructions` chuỗi; `computerUseModel: null` | lấp mặc định hãng `{allowedApps:[], minIntervalMs:5000, maxPerWindow:10, windowMs:300000}`; record; model null ⇒ vắng; bỏ `uiByOwner`/`byOwner` khỏi dây |
| `getHostStatus` | `{isBusy, capabilities:{}, version…}` | `{hostVersion:null, latestHostVersion:null, hostUpdateAvailable:false, isBusy, capabilities:["botTemplateJsonShareV1","botTemplateVisibilityV1"]}` — hai capability là cửa Share as template |
| `listAgents` (+ SSE `agents`) | thiếu `avatarDataUrl`, `isActive`; `snapshotEpoch` số; `currentActivity:null` | thêm hai khoá; **epoch là CHUỖI** (`OrderedStamp.epoch`, `epochHint` đều string); activity null ⇒ vắng |
| `openAgentTail` / `getAgentTranscriptTail` | tin người dùng thiếu `isStreaming`; `nextBeforeSeq:null` | `isStreaming:false` ở cửa ra; hết trang ⇒ vắng khoá |
| `getAgentAutomations` / `listAllAutomations` | thiếu `filePath`, `nextRunAt`; run thiếu `finishedAt`; list là `{agentId, automation}` | thêm khoá; run status `ok|error|running`; hàng list mang cả phẳng lẫn `automation` |
| `getForeverBoxStatus` | thiếu `vncUrl` khi off | `vncUrl:null` (cả `grokbot-computer/session.ts`) |
| `skillsCatalog` | thiếu `install`, `publisher`, `source` | `install:{kind:"content",name,content}`, `source:"managed"` |
| `getMcpState` | thiếu `customInstructions`; `statusDetail` chuỗi (schema: object `{kind}`) | thêm `""`; bỏ `statusDetail` (0.29 không đọc) |
| `getEffectiveMcpPlugins` | 0.43 phẳng (`pluginId, name, displayName, installMode, isEnabled`) | gửi cả `{plugin,isEnabled}` cũ lẫn khoá phẳng |
| `getAgentAvatar` / `getAgentNotificationAvatar` | `{dataUrl,version}` / 6 khoá (`avatarByteCount, avatarContentType, avatarVersion, color, name, shape`) | thêm; giữ cặp khoá cũ |
| `getAgentMemories` | MẢNG `{id, kind:"log"|"profile", content, createdAt}` | mảng (renderer 0.29 cũng không đọc `.memories`) |
| `getListenerIntegrations` · `getSkillPublishTargets` · `getBotTemplateExportPolicy` | `{}` · `{targets}` · không có handler | `{integrations:[]}` · `{teams:[], unavailableReason, unavailableReasonKind:"team_required"}` · `{exportPolicy:"all"}` |

**Lệch cố ý còn lại:** `getAgentTranscript`/`getTranscript` — schema nói mảng entry, ta trả trang `{entries}` vì 12 bài đo
đọc `.entries` và không client nào gọi (coverage chỉ có lượt script). Ngoài ra sự kiện SSE **không** bị coordinator kiểm
schema (chỉ đòi `channel` là chuỗi); renderer có validator riêng cho từng loại.

**Bài học.** Cùng họ với "trường có trong hợp đồng ≠ trường có người đọc", nhưng chiều ngược: từ 0.43, **mọi trường
`required` đều có người đọc** — máy đọc, trước cả UI. Một reply 200 "trông đúng" mà thiếu một khoá là cả tính năng
biến thành banner mất kết nối, và không lỗi nào nổi lên ở phía backend. Bài đo phải chạy lại mỗi khi đổi shape:
`node services/grokbot-backend/scripts/kiem-reply-0-43.mjs`.

## 7b · Đợt hai (05/09 chiều): đường GHI, và ba điều schema không nói

Bài đo đợt một chỉ quét 29 lệnh ĐỌC. Đợt hai gọi các lệnh ghi bằng id thật (`kiem-reply-0-43.mjs createAgent:{…} updateAgent:{…}`,
13 lệnh) và bấm thật trên UI 0.43. Sửa thêm:

| lệnh | thiếu / sai | sửa |
|---|---|---|
| `createAgent` · `createGroup` · `duplicateAgent` | `agent` là bản ghi THÔ (`createdAtMs`, `unread`, `currentActivity:null`) — schema đòi `SandAgentSummary`; `transcript` là trang `{entries,hasMore}` — schema đòi MẢNG | `directory.createAgent/createGroup/duplicateAgent` trả hàng đã `summarise`; `transcript: []` |
| `updateAgent` · `setGroupMembers` | bản ghi thô; `setGroupMembers` còn bọc `{agent}` "cho giống" — renderer 0.43 đọc thẳng `Ne?.harness` | trả `SandAgentSummary \| null`, không bọc |
| `deleteAgents` | `{deleted}` — schema đòi `{transcript: []}` | thêm `transcript: []`, giữ `deleted` |
| **26 lệnh reply `{"type":"null"}`** (`setAgentUnread`, `setAgentHiddenFromSidebar`, `dismissTray`, `runAgentWorkflowNow`, `submitUserForm`, `deleteBotTemplate`…) | ta trả `{}` — "object" ≠ null ⇒ cả cú bấm bị coi là thất bại dù việc đã làm | `REPLY_NULL` trong `cursor-acl/commands.ts`, ép về `null` ở cửa dây (`http.ts`) — một chỗ thay vì 26 handler |
| `listBotTemplates` · `getBotTemplateForSourceAgent` · `getBotTemplateVersion` · `setBotTemplateVisibility` | thiếu `shareUrl` | `shareUrl = shareUrlOf(shareId)`, lấp lúc đọc cho bản cũ |
| `getAgentWorkflows` · `createAgentWorkflow` · `updateAgentWorkflow` | `SandSkill` đòi `body` + 10 khoá (`filePath, helperScripts, runs, lastRunAt, nextRunAt, pluginId, sourceRef, scheduleDescription, trigger, publishedByCurrentUser`) | `wireSkill()` ở cửa dây; kho vẫn giữ `instructions` |
| `createAgentFromTemplate` | trả `{agent}`; schema đòi `{agent, setup, transcript}` | `setup: {kind:"recipe", skills, automations, memories, plugins, isSetupSendSuppressed:true}`, nhóm ⇒ `{kind:"unavailable"}` |

**Ba điều schema KHÔNG nói, chỉ UI nói:**

1. **Client tự đúc `agentId` khi import.** `createAgentFromTemplate{agentId: <UUID>}` — renderer `mintAgentId()` rồi vẽ NGAY một
   hàng roster mang id đó. Ta tạo bot `agent-1002` ⇒ sidebar có HAI hàng cùng tên, hàng UUID là ma và không bao giờ mất cho tới khi
   mở lại app. Nay `directory.createAgent` nhận `id` từ client (regex `^(?!agent-\d+$)[A-Za-z0-9_-]{1,64}$`, không trùng), và bot
   import mang đúng UUID ấy — đo lần hai: một hàng, đúng avatar `blob/blue` chọn trên thẻ.
2. **Client tự gửi lời nhắc setup.** Với `setup.kind:"recipe"`, renderer đăng một tin người dùng *"Hi X. Please create your skills.
   <bot_template_setup_context>{…recipe…}</bot_template_setup_context> <bot_template_setup_instructions> 3. For every skill, persist …
   with update_state target "skill" action "create" …"* — ở hãng, bot tự áp recipe bằng tool `update_state`. Bên ta
   `dungLaiTuRecipe` đã dựng skill/routine/memory lúc import, và ta không có `update_state`; nên `isSetupSendSuppressed: true`.
3. **Chặn lời nhắc thì "Creating…" treo.** Hàng roster của bot mới là placeholder `beginCreation{expectsContent:true}`, chỉ gỡ khi
   bot có NỘI DUNG đầu tiên. Ở hãng nội dung ấy là câu trả lời cho lời nhắc setup. Đo: `kickstartAgent{id}` tay ⇒ bot chào bằng
   tiếng Việt theo mô tả của mẫu, hàng chuyển sang tin đầu. Nay `createAgentFromTemplate` tự gọi `introduceRef` — đúng vai
   `isKickstartRequested` mà `createAgent` 0.43 gửi.

Cùng lượt: **`.data/bot-templates`, `.data/box-secrets`, `.data/mcp-prefs` THẬT bị xoá** bởi chính bộ test khi chạy
`npx tsx --test` trần — ba bài có `sach()` đọc `GROKBOT2_DATA_DIR ?? <src>/../.data`, và biến ấy chỉ do
`scripts/run-tests.mjs` đặt. Nay ba bài tự `mkdtemp` khi biến vắng. Chi tiết ở bảng theo dõi §7.
