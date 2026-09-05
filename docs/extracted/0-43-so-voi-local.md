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
getBotTemplateForSourceAgent uninstallPlugin installPlugin getSandMachines`; chưa có: `listPublicBotMarketplace
getPublicBotTemplate getEffectivePlugins getEffectiveMcpPlugins getPluginSyncStatus getMcpPluginLogo uninstallMcpPlugin
getBotTemplateExportPolicy updatePluginInstall installEntry`.

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
