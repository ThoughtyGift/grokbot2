# BẢNG THEO DÕI — một chỗ duy nhất

> Số đo **31/08/2026**. Chạy lại: `node services/grokbot-backend/scripts/trang-thai.mjs`
>
> Đây là chỗ trả lời **"đang ở đâu, còn gì"**. Tài liệu sâu nằm chỗ khác — xem §9.

Tài liệu này từng dài 1.249 dòng, trong đó một mục tên *"Cửa cấp token"* chiếm 567 dòng và bên
trong nó là nhật ký của cả chặng 4 → 8; thứ tự mục là 3 → 3d → 3g → 3f → 3e → 3c → 3b. Bản này giữ
**kết luận và bài học**, bỏ nhật ký: chuyện đã xong thì một dòng là đủ, còn cái bẫy nó để lại mới
đáng chép nguyên văn. Bản cũ vẫn nằm trong lịch sử git nếu cần tra.

---

## 1 · Hôm nay đang ở đâu

Backend nói được **148/147** lệnh của hợp đồng 0.30, client không còn đường nào nhận 404, bot điều
khiển được **cả box Linux lẫn máy Windows thật** của người dùng, và bám app gốc với **2 ca lệch ổn
định** trên 23 ca. Phần chưa làm gần như trọn vẹn nằm sau các cờ tính năng mà **chính client đang
tắt**.

```
lệnh gateway   hợp đồng 147 · có handler 149 · thiếu 16 — CẢ 16 đều client tự tắt
client gọi     148 lệnh · 0 đường còn 404
kênh           3: local-exec · webauthn · cookie-origin-approval
mã             backend 685 bài · 685 xanh · typecheck sạch (đo 05/09 đêm, runner từ GỐC repo — xem §7 "runner 0 bài"); 1 đỏ CŨ ở `apps/grokbot-web/avatar.test` — UI fallback, không dính backend
parity         0 ca lệch HÀNH VI — còn 21 (khác môi trường: WebGL) + 23 (khác cách vẽ: widget vs câu)
bản vá client  10 mốc · 0.29: 6 áp · 0.43: 7 áp + 3 chứng minh thừa (`obsoleteIf`) · `--verify` xanh cả hai
bộ cài        0.29: `Bot-Noi-Bo-Setup-20260903.exe` (đang phát) · 0.43 song song: `dist/043/Bot-Noi-Bo-Setup-20260905-0.43.exe` (chưa phát)
```

## 2 · Máy tính người dùng — làm được gì

| việc | trạng thái | đo bằng |
|---|---|---|
| chạy lệnh trên máy Windows | ✅ | `hostname` → `DESKTOP-7D2FJG8`, exit 0 |
| nhiều máy cùng lúc | ✅ | 3 máy, mỗi lệnh tới đúng máy, tên sai báo rõ |
| bảng Settings → Computer | ✅ | hiện đúng máy; "Current computer" lấy id từ client |
| đổi tên máy / mức quyền | ✅ | tên người đặt không bị `hello` ghi đè |
| đọc project trên máy | ✅ | bot tóm tắt đúng 5 phần `clawe-main`, tự tránh `.env` |
| lái Chrome trên máy | ✅ | mở · đọc · bấm · gõ · chụp, cửa sổ riêng cổng 9333 |
| cài phần mềm **portable** | ✅ | bot tự tải + bung + chạy OBS 32.2.2, `obs64` PID 27156 |
| cài phần mềm **cần admin** | ❌ | daemon `KHONG-ELEVATED`; app gốc **cũng chặn cứng** trên Windows |
| bot tự soát hành động | ✅ | routine + điều hướng: chặn đúng ca app gốc bắt, cho qua ca hợp lệ |

Vì sao **không** thêm đường nâng quyền — đo từ chính daemon của hãng:
[nang-quyen-tren-may-nguoi-dung.md](../extracted/nang-quyen-tren-may-nguoi-dung.md).

**Trên BOX Linux** (khác máy Windows ở trên):

| việc | trạng thái | đo bằng |
|---|---|---|
| cài phần mềm không cần root | ✅ | OBS 32.2.2 AppImage, glibc 2.31 nhận |
| bot tự quay màn hình box | ✅ | một lượt thật: bot tự bật OBS, quay, đo file, gửi clip |
| skill: dạy xong gõ `/` gọi lại | ✅ | menu `/` có mục thật; chọn → gửi `@tên` → bot làm |
| teach a task qua GIAO DIỆN | ✅ | `e2e-teach.mjs` xanh 11/11 (01/09): nút `+` → lớp phủ → recorder đúng tab → skill mới có instructions thật |
| dựng đội: tên `<Miền> <Vai>` | ✅ | lượt thật: `Shopee CS · Kho · Ads · Kế toán`, phòng `Shopee Ops` |
| dựng đội: mỗi con một lịch | ✅ | 4 routine, 4 bot con khác nhau, nhịp riêng theo vai |

Chi tiết + năm chỗ hỏng im lặng: [infra/box/README.md](../../infra/box/README.md).

## 3 · Lệnh gateway còn thiếu

Thiếu 16, và **cả 16 đều là thứ client không gọi được**:

| nhóm | số | vì sao client không gọi |
|---|---|---|
| phòng chung (`createSharedRoom`, `joinSharedRoom`…) | 9 | sau cờ `grok_bot_multiplayer` — **TẮT** |
| gọi thoại (`getVoiceCall`, `recordVoiceCall`…) | 5 | sau cờ `sand_voice_call` — **TẮT** |
| `getBotTemplateExportPolicy`, `resolveVirtualCardApproval` | 2 | **0 lần** trong bundle 0.29 — chỉ có ở hợp đồng 0.30 |
| ~~`injectChromeCookies`~~ | ~~1~~ | **XONG 31/08** — chở phiên đăng nhập từ máy người dùng sang box |

*05/09: client **0.43** đã **bỏ hẳn** 9 lệnh phòng chung (và cả `isMultiMachineLocalExecEnabled`) khỏi bundle — chuyển sang đường server (`isServerRoomsEnabled`, RPC `CreateGrokBotRoom`). Với client 0.43 thì 9 dòng đầu bảng này là chuyện đã đóng, không phải việc còn lại. Xem [0-43-so-voi-local.md](../extracted/0-43-so-voi-local.md).*

Cờ đọc từ `main.cjs` bản đang cài: `grok_bot_multiplayer` TẮT · `sand_voice_call` TẮT ·
`sand_share_bot` TẮT · `sand_channels` TẮT · `agent_prompted_cookie_sync` TẮT ·
`sand_multi_machine_local_exec` TẮT *(mặc định của hãng — bản vá `computer-tab` bật nó tại chỗ
renderer đọc)*.

**Đọc bảng này thế nào.** "Thiếu" không đồng nghĩa "hỏng". Viết ra 14 lệnh sau cờ tắt thì client vẫn
không gọi một dòng nào.

**Xác nhận bằng đường trích thứ hai (01/09).** Con số 16 ở trên trước đây chỉ đến từ một nguồn:
bảng `dl("gateway",{methods:{…}})` trong `electron-main`. Nay trích thêm **bảng nhóm lệnh trong
renderer** — 21 nhóm, 122 lệnh (`transcript`, `send`, `roster`, `sharing`…). Hai nguồn khớp: bảng
nhóm là **tập con thật sự** của hợp đồng 147 (0 lệnh nằm ngoài), và đúng 16 lệnh ấy là chỗ ta chưa
có handler — 149 handler cho 147 lệnh. **Không có API BE nào còn thiếu ngoài 16 cái đã biết.**
Phần còn thiếu không nằm ở *danh sách lệnh* mà ở *hình dạng luồng* — xem
[0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md) §3 và §4.

## 4 · Bám app gốc

**Số hiện hành — 02/09, `parity-lap --lan 3`, 3 lượt đủ 23/23: 0 ca lệch HÀNH VI.**

```
16 ca ổn định đúng · 7 ca dao động · 2 ca "lệch ổn định" nhưng KHÔNG phải hành vi:
  case 21 — khác MÔI TRƯỜNG: box Chrome ta lái không có WebGL (xem §5 mục 10)
  case 23 — khác CÁCH VẼ: app gốc cũng hỏi, bằng văn xuôi; ta hỏi bằng widget
```

Cả năm ca từng lệch dai dẳng đều đã chữa, mỗi ca đúng một lần đo xác nhận:

| ca | lệch cũ | chữa bằng | xác nhận |
|---|---|---|---|
| 1 *"tính năng nào mới"* | tuyên bố không biết + widget | vế "không biết thì đi TRA" (ví dụ nguyên văn) | 0/3 |
| 3 *"recording is finished"* | hỏi thay vì học | **cấu trúc**: cờ `luotHocTuBanGhi` khoá `ask_question` — làm được vì tin là hằng số `CAU_GHI_XONG` | 0/3 qua `sendPrompt`; qua UI dao động vì ca 2 tràn cửa sổ |
| 6 · 10 | thiếu/thừa widget | vòng 5–6 của lịch sử dưới | 3/3 · 0/3 |
| 12 *"ok"* | hỏi lại thứ vừa được thuận | ví dụ "ok là ĐỒNG Ý — tiếp tục" | 3/3 → 1/3 |

**Cách đọc số parity, ba luật đã trả giá:** (1) sửa bài đo trước rồi mới đọc số — phép đo hỏng nhịp
chờ từng che đúng hai ca lệch và sinh số "0 ca" giả; (2) hai bài đo khác nhau không trộn số —
`do-mot-ca` đi cửa `sendPrompt`, bảng này đo qua giao diện với ngữ cảnh các ca trước; (3) một ô lệch
phải mở transcript đọc trước khi sửa — cả 21 lẫn 23 đều "làm rồi mới hỏi", không phải "hỏi thay vì
làm", nên thêm ví dụ thứ tư sẽ không nhúc nhích (đã thử, đúng thế).

Lịch sử sáu vòng vặn lời nhắc giữ lại vì nó là bài học phương pháp:

| vòng | đổi gì | lệch ổn định |
|---|---|---|
| 1 | "mời chọn SAU khi đã tra" | 2 |
| 2 | thêm "việc cụ thể thì phải đi TRA" | 3 |
| 3 | thu hẹp còn "hỏi mình CÓ CÔNG CỤ gì" | 3 |
| 4 | dữ kiện "mảng này đã mở chưa" (`nguCanhMoiChon`) | 4 → **đã tắt** |
| 5 | ba VÍ DỤ thật đưa vào lời nhắc (trước nằm trong chú thích) | hết THIẾU, sinh THỪA |
| 6 | thêm vế NGƯỢC + vế TRA + "ok là đồng ý" | **0 lệch hành vi** |

Vòng 5 là chỗ đổi cục diện: bốn ví dụ mô tả chính xác luật ĐÃ nằm trong `tools.ts` từ lâu — trong
một khối chú thích, chưa bao giờ được gửi đi. Người đọc code thấy; model thì không. (Và bài học ấy
lặp lại lần hai: ví dụ case 21 cũng mắc trong chú thích thêm một ngày nữa.)

**Lượt đo sau khi đổi trình duyệt (02/09, Chrome 9224 + SwiftShader) — KHÔNG so số được với các lượt
trước, vì môi trường đổi.** Ba điều đo được:

1. **Case 21: bức tường DỜI.** Widget giờ là *"Làm gì tiếp trên CapCut?"* — bot **vào được editor**
   (trước: *"chặn vì thiếu WebGL2"*). WebGL fix ăn ở tầng năng lực; lệch còn lại thuộc họ
   widget-vs-văn-xuôi của case 23.
2. **SwiftShader có giá:** render bằng CPU nên lượt dài ra — 2/3 lượt CHẠM HẠN CỨNG 900s ở case
   22–23 (lần đầu), một ca treo 180s (lưới an toàn bắn thật lần đầu, đúng thiết kế). 11 ca dao động
   so với 7 của lượt trước.
3. **Case 15 tụt kiểu mới:** bot viết lựa chọn thành văn xuôi A/B thay vì widget, và nói sai một dữ
   kiện ("không cài nổi OBS" — OBS AppImage ĐÃ cài). Chưa rõ do trình duyệt chậm đổi ngữ cảnh hay
   nhiễu model; **đừng vặn lời nhắc trước khi tách được hai cái đó**.

Nhật ký chi tiết các vòng đo 01–02/09 nằm trong lịch sử git của chính file này.

## 5 · Việc còn lại, theo thứ tự đáng làm

| # | việc | chặn bởi | kiểm bằng |
|---|---|---|---|
| 1 | Dùng máy Windows vào việc thật | cần nêu một việc cụ thể | cửa đã thông hai chiều |
| 2 | Máy thứ hai trỏ vào VPS (`T2` · `4.8`) | cần máy thật thứ hai | mở app máy 2 → chat một lượt |
| 3 | Box qua hầm từ máy khác (`T3`) | như trên | — |
| 4 | Hai máy một box (`T5`) | **bắt buộc** hai máy thật | — |
| ~~5~~ | ~~Billing `enforce`~~ **BẬT 02/09** | 11 ngày warn là đủ số; trình tự: test nhánh từ chối (5/5, lần đầu có) → chủ lên `pro` qua webhook → bật → đo sống: chủ được trả lời 8s, không bong bóng chặn | lùi: `GROKBOT2_BILLING=warn` trong `.env` + reload |
| 6 | Voice-call (5) + phòng chung (9) | cờ client đang tắt | chỉ làm khi bật cờ |
| 7 | ~~Cơ chế `generation` / `CursorTooOld`~~ **hạ ưu tiên 02/09** | client tra tail 198.691 lượt với `limit:500`, ta trả đủ → nhịp tra kế tiếp tự lấp | chỉ còn hở khi mất kết nối mà bản ghi mọc **>500 entry** — xem [0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md) §7 |
| 8 | Tự cập nhật client | **chặn: XONG và đã áp** (`sandLab: true`, `--verify` xanh 02/09) · **kênh của mình: chặn bởi CHỮ KÝ SỐ**, không phải bởi mã | giao thức đã moi đủ: [spike-findings.md](../reverse/spike-findings.md) |
| **10** | **Trình duyệt bot lái** | **ĐÃ ĐỔI 02/09** sang Chrome của mình (9224, WebGL, tự lành) — đo: tab mọc đúng bên, CapCut vào được editor | giá còn lại: SwiftShader chậm (2/3 lượt parity chạm trần 900s ở ca cuối) — nếu thành vấn đề thật, cân nhắc quay lại 9223 cho ca không cần WebGL |
| ~~9~~ | ~~Sáu trường bỏ qua~~ **ĐÓNG 02/09** | cả sáu đều không có hệ quả đo được: `branched` không ai đọc, khoá gốc luồng là chuyện nội bộ client | [§8 + §8b](../extracted/0-30-transcript-watch.md) |
| **11** | **4 tool máy-người-dùng còn thiếu so app gốc** — `write-file`, `send-input` (stdin), chạy nền vượt lượt, (`send-imessage`/`read-messages` là macOS, bỏ qua) | không bị chặn — daemon hãng khai đủ 7, ta làm 3 | [tool-doi-chieu.md](../extracted/tool-doi-chieu.md) §2b |
| ~~13~~ | ~~Gộp `/tai/` vào `/agent/`~~ **XONG 03/09** — bốn bước, đo qua Internet: `/tai/?k=…` → **301** `/agent/?k=…` · `/agent/download/windows?k=…` → `Bot-Noi-Bo-Setup-20260903.exe` (110.552.768 B, sha `66702e2c…` khớp cục bộ, Defender sạch) · không token → gói 50 KB · token sai → 50 KB, **200 không 403** · unit `botnoibo-site` disabled, `:8099` không còn nghe | lùi: khôi phục `cinai-app.bak-*` + `systemctl enable --now botnoibo-site` | — |
| **14** | **Teach: nút `+` vẫn đi đường CŨ (CDP steps → routine+skill)**, trong khi hãng 0.30 đi đường video → tin `teach-recording` → bot tự học → skill. Đường video bên mình ĐÃ có (`teach-demo.ts`, `demo_start`/`demo_stop`) nhưng chỉ là tool bot gọi, **chưa nối vào `stopTeachRecording`**; và bot không phát link `sand-workflow:<slug>` nên câu "tách xong" không mọc chip skill | không bị chặn — cần quyết định: giữ CDP (chính xác selector) hay đổi sang video (hiểu ý định) cho nút `+` | đọc chuỗi hãng: [teach-hang-0-30.md](../extracted/teach-hang-0-30.md) |
| **15** | **App gốc đã lên 0.43.0 (05/09)** — hợp đồng đã trích vẫn là 0.30, local vẫn 0.29. Đọc trực tiếp bundle 0.43: +84 RPC, +32 lệnh host (14 vào bảng nhóm renderer, **0 có handler**), −11 (phòng chung bỏ hẳn), cờ `sand_teach_by_demonstration` biến mất, Plugins → **Marketplace** (Plugins + Bots) kéo từ server, cache không giữ catalog | không chặn — việc kế: `extract-contract.mjs --asar <0.43>` ra FILE RIÊNG rồi diff; chỉ cần handler mới khi nâng client local | [len-0-43-marketplace-template.md](../plan/len-0-43-marketplace-template.md) | KẾ HOẠCH lên client 0.43 · Marketplace (cộng đồng bot) · Share as template — 5 bước A→E, hình dạng proto, rủi ro |
| [0-43-so-voi-local.md](../extracted/0-43-so-voi-local.md) |
| **17** | **Lên client 0.43 — bước A XONG 05/09**: 10/10 mốc vá neo lại, `C:\cai043` chạy song song với 0.29 (hồ sơ riêng, CDP :9225), một lượt chat sống; **12 reply sửa cho qua schema nhúng của coordinator 0.43** | **đóng gói XONG 05/09 tối** (bộ cài song song `dist/043/…-0.43.exe`, `start-app-043.cmd`, nền phiên bản đọc từ cây app); còn §B của kế hoạch; **§D XONG 05/09** (§6 mục 21). Chưa phát hành 0.43 lên feed — chờ chủ dự án | `node services/grokbot-backend/scripts/kiem-reply-0-43.mjs` → 0 sai; `GROKBOT2_CLIENT_DIR=C:\cai043 node infra/scripts/patch-client.mjs --verify` xanh |
| **16** | **`deleteAgent` để lại skill mồ côi trong `workflows.json`** (đo 05/09) | không chặn — thêm `remove` theo `agentId` vào `directory.deleteAgents` | xoá bot → `getAgentWorkflows{id}` phải `[]` |
| **18** | **SỰ CỐ 06/09: tên miền `halcion.vn` mất NS ở đăng ký** — DNS công khai (8.8.8.8, 1.1.1.1) trả `admin.halcion.vn` → `117.122.125.107` = trang giữ chỗ của VNNIC, chứng chỉ `*.vnnic.vn`; mọi HTTPS tới pool (`/v1/claude`) và box (`/grok-exec`) đứt ⇒ **không bot nào chạy được lượt** trên VPS lẫn máy dev. Gốc thật vẫn sống sau Cloudflare (edge `104.21.5.75`, exec health `ok:true`) | **Vá tạm trên VPS 06/09**: một dòng `/etc/hosts` `104.21.5.75 admin.halcion.vn` (bản gốc `/etc/hosts.bak-20260906`), restart → `[box] OK`, bot chạy lại (đo 9 s). **Máy dev CHƯA vá** (hosts Windows cần quyền admin). **Việc thật là của chủ tên miền**: khôi phục/gia hạn `halcion.vn` ở nhà đăng ký rồi bỏ dòng hosts | `dig +short NS halcion.vn @8.8.8.8` phải có NS; `curl -sI https://admin.halcion.vn/` không còn exit 60 khi KHÔNG có dòng hosts |
| **12** | **Dải tài khoản box chỉ 5, đã cấp hết 5** | người thứ 6 mất TOÀN BỘ tool box cùng lúc, lỗi viết cho quản trị viên | `GROKBOT2_USER_POOL` trong `infra/vps/exec-router.mjs` |

*Bỏ khỏi bảng vì đã xong (02/09): "mở lớp tự soát sang `subagent`" — đã gắn đủ ba mặt trong
`tools.ts` (`computer`, `automation_write`, `subagent`) và đo 7/7; và "hai ca parity còn lệch" —
nay 0 ca lệch ổn định.*

## 6 · Đã xong — kết luận, không phải nhật ký

| chặng | kết quả |
|---|---|
| 0 · Dọn mã | cổng 9/9; `mcp.ts` 936 → <800; `bootstrap.ts` 862 → <800 |
| 1 · Đo được tiền | **`enforce` BẬT 02/09** sau 11 ngày warn (chủ ~18,7M token / trần free 100k → chủ lên `pro` TRƯỚC khi bật, không có cửa sổ bị khoá). Nhánh từ chối có test lần đầu (`billing-gate.test.ts`). Webhook đổi plan hoạt động (secret trong `.env`). Chưa đặt `GROKBOT2_CHECKOUT_URL` nên lời chặn không kèm link nâng cấp — đặt khi có trang thanh toán |
| 2 · Ba lỗ đăng nhập | thu hồi token 200→204→**401** · đoán mật khẩu 6 lần → **429** · `/register` **403** · JWT 365 → **30 ngày** |
| 3 · Máy thứ hai | T1 ✅ · T4 ✅ (cài trên máy sạch thật, 118 MB) · T2/T3/T5 chờ máy thật |
| 4 · BE ra khỏi máy cá nhân | VPS + HTTPS qua Cloudflare Tunnel; `/oauth/token` bịt xong — đo 403/403/**200**/403 |
| 5 · Tách người dùng trên box | 8/8, một daemon mỗi người, cờ màn-riêng bật |
| 6 · FE riêng | **bỏ hướng này** — client gốc LÀ production UI; `apps/grokbot-web` chỉ còn là fallback |
| 7 · Lên client 0.29 | chạy tốt hơn dự đoán; bộ vá chuyển sang xong |
| 9 · Skill trong menu `/` | 14 lệnh workflow hết stub; dạy xong gõ `/` là bot làm — đo end-to-end |
| 10 · OBS trên box | AppImage 32.2.2 chạy không cần root, quay ra h264 720p + aac |
| 11 · Trả lời tin (reply) | E2E trọn vòng 01/09: bấm Reply trong app → pill hiện đúng nội dung → gửi → tin mới mang khối trích dẫn, `(deleted)` hết. Dây 4/4, kể cả câu trả lời của bot cũng mang tham chiếu. Bài đo: `scripts/e2e-reply.mjs` + `scripts/do-reply-day.mjs`. Ba điều kiện của client: [0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md) §6 |
| 12 · Video phát được | `sand-media` thiếu `mime` + dùng nhầm trần 128 KB của bản xem trước văn bản → **mọi** video hỏng; nay `readyState=4`, khung 1920×1080 giải được thật trong app |
| 13 · Teach a task qua giao diện | `e2e-teach.mjs` **11/11** (chạy lại 05/09, GREEN): nút `+` → lớp phủ → recorder đúng tab → skill mới có instructions thật. **Mapping với hãng: khớp từng chữ ở tầng dây** — hợp đồng 0.30 `startTeachRecording{agentId,entryPoint}` · `stopTeachRecording{agentId,save}` · `getTeachRecordingStatus` **noArgs**, và `lastArgs` từ client THẬT trùng khít (`{"agentId":"agent-984","entryPoint":"composer_menu"}` · `{"agentId":"agent-984","save":true}` · `{}`); cờ `sand_teach_by_demonstration` cùng tên hai bên. Hai chỗ lệch, cả hai vô hại: ta **nhận nhưng không dùng** `entryPoint`, và `startDesktopTeachRecording`/`stopDesktopTeachRecording` là **của riêng ta** (0 lần trong bundle hãng, không có trong 147 lệnh) — nên `n=25` của cặp đó là lượt của chính bài đo, không phải client . **Đọc trọn chuỗi BE của hãng (05/09)** từ cache client, hai lượt thật: client tự đăng tin `role:user` = hằng `"The recording is finished. Learn the task from it."` + `richText` chip `workflowReference{id:"learn-from-demonstration", teachQueueScope:<sha256>}` + `clientNonce` `teach-recording:<scope>:teach-<ISO>-<uuid>.json`; bot trả lời sau **7,9 s** (không cần bấm gì — chip chỉ là link mở skill, `onClick → l7e()(id)`); 4–5 câu tiến độ (*cắt khung kiểm tra → xem hết video → đối chiếu LỊCH SỬ CHROME → tách skill*); **`requestId` đổi giữa chừng** sau khoảng trống 31 s / 183 s = lượt cha uỷ thác subagent xem video chạy nền rồi một lượt MỚI tiếp; kết bằng `[Tên](sand-workflow:<slug>)` + 5 bước có `{input}` + câu/widget mời chạy thử. Cache **không** có entry tool-call nào và **không** có slice workflows — thân skill nằm trên box hãng, chỉ đọc được qua UI. Chi tiết: [teach-hang-0-30.md](../extracted/teach-hang-0-30.md). **E2E chạy lại 05/09 12:00 trên bản cài MỚI** (vừa cài lại từ bộ cài chở-app): GREEN 11/11, `hocNen` đổi tên skill thành *"Mở trang giải thích về tên miền ví dụ của IANA"* trong ~10 s (pool sống); hai skill thử đã xoá qua `deleteAgentWorkflow{workflowId}`, kho `New Bot` rỗng |
| 19 · Mẫu bot khớp 0.43 (bước C của [len-0-43-marketplace-template.md](../plan/len-0-43-marketplace-template.md)) | **XONG 05/09** — làm ngay trên 0.29, đo bằng `scripts/e2e-mau-bot.mjs` qua `/gw/api` thật: **20/20 xanh**, tự chứa, dọn sạch. `shareId` nay qua regex client `/^[A-Za-z0-9_-]{21}$/` (dạng cũ `tpl-…` trượt → cửa Import không bao giờ tới backend, im lặng); `snapshot.recipe` đúng zod của 0.43 (profile · memory · skills · routines · plugins), nguồn **tiêm** (`bindTemplateSources`) để `bot-templates.ts` không kéo `automations.ts`→`chat.js`; `createAgentFromTemplate` nhận `expectedActiveVersion` (lệch → từ chối có chữ) + `creatorContext`, dựng lại skill/routine/memory cho bot MỚI; `getPublicBotTemplate{shareId}` xuyên chủ trả đúng `BotTemplateImport` renderer kiểm (`isBotTemplateImport`: KHÔNG `sourceAgentId`, mọi chuỗi min 1, avatar trong bảng 11 màu/18 hình). 18 unit + 20 E2E. Chưa: `getBotTemplateExportPolicy`, recipe nhóm chưa chở skill thành viên, hồ sơ người tạo, tầng proto |
| 20 · Client 0.43 chạy với backend (bước A của [len-0-43-marketplace-template.md](../plan/len-0-43-marketplace-template.md)) | **XONG 05/09** — bộ vá thành **biến thể theo bản** (`variants[]`, chọn theo số lần khớp) + `obsoleteIf` (bằng chứng hãng tự sửa) + trạng thái vá ghi cạnh bản cài; 0.43 = `main.cjs` vỏ 12 KB → `main-app.cjs`/`main-core.cjs`, host gộp vào main-app, renderer `index-Df98_wE4.js`. Client lên, đăng nhập, roster/transcript/routine/màn bot đều vẽ, update-feed hỏi ta. Hai banner mất kết nối hoá ra là **schema reply**: coordinator 0.43 kiểm mọi reply gateway (mode structural) — 12 lệnh của ta trượt vì thiếu khoá bắt buộc hoặc `null` ở nơi không nullable; sửa xong, banner hết, lượt chat gõ qua CDP đi trọn vòng. Schema rút ra: [gateway-schema-0.43.json](../extracted/gateway-schema-0.43.json); bài đo `kiem-reply-0-43.mjs` 29 lệnh đọc 0 sai. Chi tiết: [0-43-so-voi-local.md §7](../extracted/0-43-so-voi-local.md) |
| 24 · Bảng Routine → bot lên tiếng · trang đích của Copy link | **XONG 05/09 đêm** — (a) app gốc: mỗi thao tác trên bảng Routine để lại hàng sự kiện (`automation-changed` đủ 5 `action` của `SandAutomationChangeAction`: created·updated·deleted·**enabled·disabled**) và bot trả MỘT câu ngay, bật+sửa liền nhau → một câu, không tin người dùng nào. Bên ta: `automations.ts` phát sự kiện cho xoá/bật/tắt (trước chỉ tạo/sửa), `routine-nhac.ts` gom nhịp 1,5 s theo bot → lời nhắc `silent` qua `sendPrompt`, chờ bot rảnh (tối đa 60 s rồi bỏ), chỉ gắn ở CỔNG GATEWAY (bot tự sửa routine bằng tool không tự nhắc mình); `api-contract` mở enum. Đo sống `e2e-routine-nhac.mjs`: 4 nhịp → 4 câu (*"`kiem-ke-sang` đang tạm dừng rồi nhé, muốn mình bật lại lúc nào không?"*), 6–11 s, 0 tin người dùng. (b) Copy link của hãng trỏ `x.ai/bot/<id>` — trang tĩnh avatar · "<tên> by <người tạo>" · mô tả · miễn trừ · **Add to Grok Bot** = `grokbot://app/v1/bot-template?id=<id>` tự mở. Bên ta: `shareUrlOf` tính LÚC ĐỌC từ `GROKBOT2_PUBLIC_SITE` (vd `https://cinai.app/agent`) → `/bot/<shareId>`; `site-bot.ts` phục vụ trang ấy công khai (chỉ mẫu đã publish + public; nháp/xoá/riêng → cùng một trang 404; thoát HTML, CSP nonce, chỉ số đếm không lộ thân skill; og:title/og:url). 7 unit + 5 unit. **Đã bật trên VPS 06/09**: `GROKBOT2_PUBLIC_SITE=https://cinai.app/agent` trong `.env`, deploy `2e398bb`, đo qua Internet bằng `e2e-trang-chia-se.mjs` chạy trên VPS: bot thử stage mẫu 9 s → trước publish 404 → publish → `https://cinai.app/agent/bot/<id>` 200 với title/og/deep link/CSP → xoá → 404 lại (link thật đã mở, mẫu đã dọn). Lộ một lỗi: `/bot/<id>/` có gạch chéo cuối làm link tương đối `../download/windows` rơi vào `/agent/bot/download/windows` → nay 301 tương đối về dạng chuẩn. Cùng lượt đo lộ **sự cố tên miền `halcion.vn`** (§5 mục 18) — trước khi vá hosts, lượt share trên VPS không chạy được. Rủi ro: scheme `grokbot://` thuộc app MỞ SAU CÙNG (đo: `HKCU\Software\Classes\grokbot` → `C:\cai043\Grok Bot.exe`), app hãng mở lại là chiếm lại — trang web không chọn được app nào mở |
| 23 · Nút "Share as template" đúng luồng 0.43 | **XONG 05/09 tối** — trích từ renderer + cache client app gốc: client TỰ gửi `Create a template of yourself…` (Update template gửi câu KHÁC `Update the shared template of yourself.`), bot đăng tiến độ rồi entry `send-message` `bot-template-share` `{published:false, version}` → thẻ Unpublished · Publish → bấm Publish → `publishBotTemplate` → Published · Copy link, menu header đổi. Bên ta: bản CHỜ `staged` (đầu bảng giữ bản đã phát), publish nâng đúng bản chờ (không chụp lại đè mô tả bot viết), `toWireView` (5 mục cho hộp View Details, `activeVersion` vắng thay vì null), tool đăng tiến độ + thẻ, lượt nhận ra bằng hằng câu → khoá `ask_question`. Đo bấm thật tay trọn vòng 7 bước; `e2e-chia-se-mau.mjs` chép lại 7 mốc — chạy được **6/7** (mốc 7 sửa cách kiểm sau đó, chưa chạy lại trọn vì người dùng đang dùng app trên :9225); 7 unit mới; schema 0.43 0 sai. Chi tiết [0-43-so-voi-local.md §7c](../extracted/0-43-so-voi-local.md) |
| 22 · Đóng gói client 0.43 (mục 3·4·5 của bước A) | **XONG 05/09** — `GROKBOT2_SETUP_VARIANT=043` cho `build-setup.mjs --with-app`: bộ cài SONG SONG (AppId/AppName/`Programs\Bot Noi Bo 043`/shortcut/kho hồ sơ riêng), ghi vào `dist/043/` để không lọt vào đường phát hành; `Bot-Noi-Bo-Setup-20260905-0.43.exe` 111.213.560 B; cài im lặng exit 0, 578 file, `--verify` xanh, bản 0.29 nguyên. `start-app-043.cmd` + `run.ps1` đọc `GROKBOT2_CDP_PORT`: mở bản cài trên :9225, roster hiện từ backend, 18 tiến trình khác không đụng. `phat-hanh.mjs` đọc nền phiên bản từ `GROKBOT2_CLIENT_DIR/resources/app/package.json` (file repo `client-patch-state.json` đứng ở 0.29.0 là dự phòng). Kèm: sửa launcher mất backslash ở `SAND_USER_DATA_DIR` (§7) |
| 21 · Marketplace bot + hồ sơ người tạo (bước D của [len-0-43-marketplace-template.md](../plan/len-0-43-marketplace-template.md)) | **XONG 05/09** — kho listing (`marketplace.ts`, 9 nhóm của renderer, slug bỏ dấu, `featured` chỉ người vận hành đặt), hồ sơ người tạo (tên · ảnh · handles), 3 RPC proto main-side + blob recipe qua zod `Dct` của main, lỗi Connect có mã (404/403, khung end-stream cho `connect+proto`), 6 lệnh gateway, tool `publish_bot_listing`, ba cờ client bật. **Đo trên UI 0.43 thật**: tab Bots hiện thẻ Featured + nhóm, mở thẻ ra trang chi tiết, **Import Bot** ra bot mang đúng UUID client đúc + avatar chọn, skill đã dựng, bot tự chào. Cùng lượt sửa **đường GHI** cho schema 0.43: 5 lệnh tạo/sửa bot trả `SandAgentSummary`, 26 lệnh reply `null` (`REPLY_NULL`), `SandSkill` 11 khoá, `shareUrl`, `deleteAgents.transcript`. `e2e-marketplace.mjs` 26/26 · `e2e-mau-bot.mjs` 20/20 · `kiem-reply-0-43.mjs` 29 đọc + 13 ghi = 0 sai. Ba điều schema không nói: [0-43-so-voi-local.md §7b](../extracted/0-43-so-voi-local.md). Chưa: tab Plugins nối MCP, tài khoản thứ hai, phân trang thật |
| 14 · Lớp tự soát 3 mặt | `computer` · `automation_write` · `subagent`, đo **7/7**; một ca không đo được là bỏ cả lượt (`khongDoDuoc`) |
| 8 · Tự cập nhật | **Đường của mình xong 03/09**: launcher hỏi `/updates/ban-moi`, kiểm sha256, chạy bộ cài, fail-open; updater gốc tắt hẳn vì nó dò chữ ký người ký của HÃNG (`["Anysphere, Inc.","Anysphere"]`) — banner hiện được nhưng Install không bao giờ chạy, nên không mời nó thử. Mỗi nền một bộ ba `url+sha+tên` trong manifest |
| 18 · Một nút tải, và E2E trọn luồng | **XONG 04/09** — `GROKBOT2_PUBLIC_FULL=1` trên VPS: nút công khai ở `cinai.app/agent/` phát **bản chở-app** (quyết định chủ dự án, ghi `legal.md`); cửa `/download/windows-cfg` giữ nghĩa cố định cho bộ 50 KB, manifest tách `url` (cfg) / `full.url` (chở-app). E2E đo bằng trình duyệt thật + curl + cài thử: bấm nút → `Bot-Noi-Bo-Setup-20260903.exe` 110.554.294 B, sha `1902d7bf…` = manifest = file trên VPS; cfg `e3b23901…`, mac `296ef303…` đều khớp; Defender sạch cả bundle lẫn cmd; cài thử **khớp từng byte** bản đang chạy (375/375 file, 288 chunk); `token.txt` + `backend.txt` đúng; **cập nhật thật**: hạ version xuống 0.29.0 → launcher đã cài hỏi backend thật → tải 105 MB (45 s) → hash khớp → pha 2 ghi ra → chạy pha 2 → bộ cài ghi đè tại chỗ → version về `0.29.20260903`, token còn, launcher vẫn hai pha. `/tai/` 301, updater gốc 204 |
| 17 · Bản chở-app tự cập nhật | **XONG 03/09** — bộ cài nướng `token.txt` cạnh app (từ `GROKBOT2_FULL_DOWNLOAD_TOKEN` lúc dựng); launcher hỏi `/updates/ban-moi?k=` và nhận khoá `full` của manifest (đo qua Internet: `ten=Bot-Noi-Bo-Setup-20260903.exe`, sha `c59bebeb…` khớp file trên VPS và bản cài thử). **Cả hai launcher chuyển sang HAI PHA** vì bộ cài ghi đè chính `start-bot.cmd` đang chạy — xem §7. Đo bằng bộ đo chạy PowerShell thật với máy chủ giả: backend chết → exit 0; trả 200 → tải, kiểm hash, ghi pha 2, exit 7; pha 2 parse được. `phat-hanh.mjs --with-app` dựng + đưa cả gói chở-app lên |
| 16 · Trang tải nói rõ bản nào | **XONG 03/09** — `{{PHIEN_BAN}}` · `{{NGAY_BAN}}` đọc từ **manifest** (cùng nguồn với feed và launcher, không gõ tay), hiện ở hero + footer + cả nhánh `?k=`; bỏ khối CTA cuối trang (nút tải thứ 3) và hai link footer lặp nav — trang còn đúng **một** nút tải ngoài nav. E2E cài từ web: bản cài **khớp từng byte** bản đang chạy (375/375 file, 288 chunk renderer, `Grok Bot.exe` cùng hash). Bẫy bắt được: bản chở-app dựng lần đầu mặc định `backend.txt = localhost:8788` vì thiếu `GROKBOT2_PUBLIC_BACKEND` lúc dựng — dựng lại, sha `0683b6db…` |
| 15 · Một trang tải | **XONG 03/09** — `/tai/` (máy chủ tĩnh cũ ngoài repo, phát client 0.20) → 301 `/agent/`; `?k=<token>` trên `/agent/` phát bản chở-app **0.29** (`Bot-Noi-Bo-Setup-20260903.exe`, 105 MB, Defender sạch); nút công khai phát gói 50 KB; cờ `chiRieng` chặn bản chở-app khỏi nút công khai **vô điều kiện** |

## 7 · Bẫy đã trả giá — chép nguyên văn để khỏi trả lần hai

**Trường có trong hợp đồng ≠ trường có người ĐỌC.** Một ngày, bốn cái bóng cùng hình dạng:
`generation`/`CursorTooOld` (client tự lấp bằng 198.691 lượt tra tail), `message_id` (chỉ để nhận mốc
lượt — khử trùng là việc của `clientNonce`), `is_fork` (client ghi `branched` mà **không chỗ nào
đọc**), và ví dụ case 21 (bot đã LÀM đúng như ví dụ dạy — lệch nằm ở bước sau). Cả bốn đều có tên
nghe rất hệ quả, đều tồn tại thật trong proto/lời nhắc, và sửa theo tên là dựng cơ chế cho không ai.
Thứ phân biệt: **đếm chỗ ĐỌC ở đầu bên kia** — proto nói trường tồn tại, chỗ đọc mới nói nó có hệ quả.

**Đo cái đang chạy, không đo mã nguồn.** Bốn lần đo parity đầu đo nhầm thứ: đọc văn bản prompt thay
vì đo hành vi. Một lượt đo đúng đắt hơn bốn lượt đo nhầm.

**Một lượt không kết luận được gì.** Hai lượt cùng cấu hình cho kết quả khác nhau. `parity-lap` sinh
ra vì lý do đó: nó in "3/3" hay "1/3" chứ không in một con số.

**Sổ trắng hoá ra không trắng.** Ba hằng số trỏ về `.data` của máy thật (`store.ts`,
`attachments.ts`, `observe.ts`) — chạy "từ đầu" mà vẫn nuốt dữ liệu cũ.

**Hàng đợi local-exec nằm trong bộ nhớ tiến trình server.** Một script `tsx` rời import
`local-exec.ts` chỉ nói chuyện với hàng đợi rỗng của chính nó. Tôi tự viết điều này trong chú thích
rồi quên, và mất một vòng chẩn đoán nhầm sang "lệnh quá dài".

**Bash nuốt một lớp backslash, kể cả trong heredoc `<<'EOF'`.** Hỏng ít nhất 6 lần: regex, `\n`,
đường dẫn Windows. Dùng Write/Edit thay heredoc khi chuỗi có backslash.

**Máy Windows: shell là POSIX, Node là Windows.** `$HOME` = `/c/Users/admin` nhưng Node không đọc
được `/tmp/...`. Shell nuốt `$` nên biến PowerShell viết trần đều hỏng. `tar` trần bị bắt sang
`/usr/bin/tar` của Git Bash — phải gọi `C:\Windows\System32\tar.exe`.

**Dòng lệnh Windows chặn ở 8.191 ký tự** — vượt thì im lặng hết giờ, không lỗi nào.

**Test xanh không có nghĩa là đúng.** `mock.timers.tick(120_000)` không chạy chuỗi `setTimeout` lồng
nhau; bài test xanh vì lý do sai. Chỉ lộ ra khi bài "tái hiện lỗi cũ" cũng xanh nốt.

**Một bài ĐO không được có quyền xoá thứ nó không tạo ra.** `parity-lap` bản đầu gọi `deleteAgents`
lên mọi bot — suýt xoá 6 bot việc thật.

**Sửa `src` trong lúc người dùng đang chat là cắt lượt của họ.** `tsx watch` nạp lại backend, và
lượt đang chạy chết giữa chừng — bot im, `isRunning=false`, mục cuối trong hội thoại là chính tin
người dùng vừa gõ. Xảy ra 31/08: tôi sửa `cookie-chrome.ts` trong khi một lượt thật đang chạy.
Luật "parity chạy thì không sửa src" áp cho MỌI lượt thật, không riêng lúc đo.

**"4 case lệch ổn định" của MỘT lượt đo không so được với lượt khác.** Đo hai lần, mỗi lần 3 lượt
đầy đủ (23 ca, 69/69 có trả lời): bản có `nguCanhMoiChon` ra 4 ca lệch (5, 6, 15 thiếu · 7 thừa),
bản đã tắt cũng ra 4 ca lệch — nhưng là (6, 11, 15 thiếu · 13 thừa). Cùng con số, tập hợp khác hẳn.
Giao của hai lần chỉ còn **case 6 và 15**. Nên `parity-lap --lan 3` đủ để loại nhiễu TRONG một lượt,
nhưng không đủ để so hai bản với nhau: muốn kết luận "sửa cái này có giúp không" thì phải lấy GIAO
của nhiều lần đo độc lập. Tôi đã kết luận sai một lần vì so 4 của lượt mới với 2 của lượt cũ.

**Guard của bài đo dựa vào một nhãn THU GỌN ĐƯỢC.** `app-replay-b2.mjs` xác nhận "đã mở đúng bot"
bằng chuỗi `"<tên bot>'s screen"` — nhãn của panel PHẢI. Panel đó thu gọn được, và khi nó gọn thì
guard luôn trả `false`: script bấm đúng bot rồi vẫn kết luận "không mở được" và bỏ cả lượt. Ngày
31/08 lượt 1 chạy, lượt 2 và 3 chết đúng kiểu đó, và thông báo lỗi ("không mở được sau 6 lần bấm")
chỉ đường sang chuyện khác.

Bản vá 31/08 đổi sang `[aria-selected="true"][data-agent-id]` và **cũng sai** — app không đặt
`aria-selected` bao giờ, nên biểu thức luôn trả `null` và mọi lượt vẫn rơi về đúng cái nhãn panel
thu-gọn-được mà bản vá ấy định thay. Guard trông như đã sửa suốt một ngày mà chưa từng chạy một lần.
Thuộc tính thật là **`data-active="true"`** (kèm `aria-current="page"`), đo 01/09 bằng cách in RA mọi
thuộc tính của hàng sidebar thay vì đoán tiếp. Bài học không phải "dùng data-active" mà là: **một
guard chỉ đáng tin khi đã thấy nó trả TRUE một lần** — cả hai bản trước đều chỉ được kiểm ở nhánh
sai, và nhánh dự phòng đã che mất chuyện đó.

**Bốn selector đoán, bốn lần sai — cách chữa là IN RA rồi đọc.** Đo E2E Reply ngày 01/09 vấp đúng
bốn lần, mỗi lần một chỗ khác: hàng đang mở (`aria-selected` → thật là `data-active`), bong bóng tin
(tiêu chí "phần tử nhiều chữ" bắt vào panel PHẢI — *"Routines are recurring tasks…"* — rồi vào hàng
sidebar), hàng transcript (thật là `[data-row-key]`), và nhãn nút Reply (thật là
**`"Reply to <tên bot> message"`**, có tên bot BÊN TRONG nhãn, nên khớp chính xác `"reply"` trượt).
Cả bốn chỉ mất vài phút khi đổi cách: đếm mọi thuộc tính `data-*` trên trang, và hover từng hàng rồi
**so danh sách nhãn nút trước/sau** — thanh công cụ tự nói ra nó có gì. Hàng của bot mọc ra ba nút,
hàng của người dùng mọc ra 0.

**`Runtime.evaluate` nuốt lỗi im lặng.** Một biểu thức sai cú pháp không trả lỗi: `result.value` là
`undefined`, rồi `JSON.parse` ngã ở dòng khác với thông báo `"undefined" is not valid JSON` — chỉ
đường sang chuyện khác. Phải đọc `result.exceptionDetails` và ném ngay tại chỗ. Lần này nó che một
dấu `)` thừa.

**Bài test ghi thẳng vào kho THẬT của người dùng.** `workflows.test.ts` gọi `create()` thật, hàm đó
lưu xuống đĩa, và đường dẫn là `.data` của máy đang chạy — nên chạy `npx tsx --test` một lần là menu
`/` của người dùng mọc thêm "dat-hang", "của A", "một", "hai". Đây là cái bẫy thứ TƯ cùng họ với
"sổ trắng hoá ra không trắng" ngay dưới, và tôi tự thêm nó vào dù đã đọc dòng cảnh báo đó. Nay
đường dẫn đọc từ `GROKBOT2_WORKFLOWS_FILE`, và bài test trỏ nó vào thư mục tạm TRƯỚC khi nạp module.

**Một bài đo hỏng vẫn báo cáo con số cũ.** Bộ ca parity nằm trong `kich-ban-b2.json` — chính là
ĐẦU RA của script xuất chat, nên một lần xuất lại (d1edf23) đã ghi đè nó, bot `Test Clone` biến mất,
và cả bốn bài (`parity-lap`, `parity-b2`, `app-replay-b2`, `doi-chieu-noi-dung`) chết ngay dòng nạp
ca. Không ai chạy lại nên không ai thấy, và "21/23 ổn định" vẫn nằm trong bảng này như sự thật hiện
hành suốt nhiều ngày. Hai luật rút ra: **dữ liệu ĐO không được nằm chung file với dữ liệu XUẤT**
(nay là `docs/parity-runs/bo-ca-parity.json`), và thiếu bộ ca thì bài đo phải NÓI RA rồi dừng.

**Một lượt hỏng có thể đội đúng lốt một lượt tốt.** `soatHanhDong` trả `{cho:true}` cả khi đã soát
và thấy ổn, lẫn khi không hỏi được (429 hết hạn mức). Đo lớp `subagent` hai lần, cả hai đều dính
429 mà bài đo không biết, nên tôi đọc thành "lớp soát mù" rồi đi sửa lời nhắc — chữa một thứ chưa
chắc hỏng. Tệ hơn: hạn mức **cạn giữa chừng rồi trúng mọi ca chạy SAU đó**, nên bảng đúng/sai từng
ca trông như một mẫu trong khi nó chỉ là "chạy trước hay sau lúc cạn". Nay có cờ `khongDoDuoc`, và
một ca không đo được là bỏ cả lượt.

**`callPool` KHÔNG bao giờ ném.** Hết hạn mức, mạng đứt, HTTP lỗi — tất cả về dạng
`{ok:false, text:""}`. Viết `try/catch` quanh nó là bắt một thứ không tồn tại; phải đọc `r.ok`.

**Khớp theo TÊN khi máy có hai bản cài.** Cùng một lớp lỗi, hai chỗ, phát hiện trong một giờ ngày
02/09. `patch-client.mjs --apply` hỏi `tasklist /FI "IMAGENAME eq Grok Bot.exe"` nên nó từ chối vá dù
bản đang vá đã đóng sạch — app của HÃNG trùng tên đang mở. Và `run.ps1` giết
`ProcessName -like 'Grok Bot*'` **không lọc đường dẫn**, nên một lần chạy launcher đưa app gốc từ 10
tiến trình xuống 0 — tôi tự đóng mất app tham chiếu của người dùng bằng chính bộ khởi chạy, ngay sau
khi vừa sửa đúng lỗi ấy ở chỗ kia. Cả hai guard đều trả lời đúng, nhưng trả lời **sai câu hỏi**: "có
app nào tên thế này không" thay vì "bản TÔI đang thao tác có đang chạy không". Nay cả hai lọc theo
`Path`.

**Cửa sổ đo không khớp với LƯỢT.** `app-replay-b2` gõ ca tiếp theo rồi quy mọi thứ xuất hiện sau đó
cho ca ấy — nhưng lượt của ca TRƯỚC có thể chưa xong. Đo 02/09: case 3 nhận một widget thật ra là của
case 2 (bot còn đang mở trang Updates), và hai ca liên tiếp ghi `stopped without replying` chỉ vì lượt
trước vẫn chạy. Hậu quả đúng kiểu khó thấy nhất: con số cho ca A phản ánh hành vi ở ca B, và "dao
động" trở thành cái thùng chứa mọi thứ lệch pha. Nên một ô "1/3" phải mở transcript ra đọc trước khi
đem đi sửa — tôi suýt đi sửa tiếp một bản chặn đang chạy đúng.

**Lớp phủ của client bật TRƯỚC khi backend vũ trang.** `startTeach` đặt `active` chỉ SAU năm lượt
`await cdpForAgent` tới Chrome của box qua hầm ssh, còn lớp phủ *"watching and learning"* là trạng
thái của client nên nó hiện ngay lúc bấm. `e2e-teach.mjs` đọc `getTeachRecordingStatus` **một lần**
ngay sau cú bấm, luôn trúng `IDLE`, và báo RED cho một sản phẩm đang chạy đúng — tôi mất một vòng
chẩn đoán nhầm sang "app không gọi RPC" trước khi `coverage.lastArgs` nói ra sự thật. Hai điều rút
ra: **trạng thái của client không phải trạng thái của backend**, và khoảng trống ấy là rủi ro thật
của sản phẩm chứ không riêng của bài đo — thao tác diễn trong giây đầu sẽ không được ghi.

**Bài đo đếm ở KHO CŨ sau khi sản phẩm đổi kho.** Cùng lượt đó, mốc "routine MỚI" đếm
`getAgentAutomations` trong khi teach nay lưu thành *skill* (`getAgentWorkflows`, khoá `id` chứ không
phải `agentId`). Kho cũ luôn `0 → 0`, nên bài đo nói "không tạo được" trong khi kho mới đã có bản ghi
đúng giây `stopTeachRecording` tới. Một bài đo trỏ vào kho cũ thì **không bao giờ xanh lại được**, và
nó tố cáo sản phẩm chứ không tố cáo chính nó.

**Một trần dùng đúng chỗ, sai việc.** `readAttachmentChunk` — đường client nạp VIDEO qua scheme
`sand-media://` — gọi `loadBytes`, và `loadBytes` đọc từ box với `length: TEXT_PREVIEW_CAP` (128 KB)
vì nó sinh ra cho bản xem trước VĂN BẢN. Nên video 129 KB bị cắt và `totalSize` báo về 131.072. Cùng
lúc, handler trả `{totalSize, bytesBase64}` mà **không có `mime`**, còn client thì kiểm
`a.mime == null` TRƯỚC khi phát — nên **mọi** video đều ra "Couldn't load media", 198 lượt theo
`coverage.lastArgs`, và không ai thấy vì ảnh đi đường khác (nhúng thẳng trong proto). Hai bài học:
một hằng số đặt tên theo VIỆC nó sinh ra (`TEXT_PREVIEW_CAP`) bị dùng cho việc khác thì tên nó không
cứu được ai, và **một đường chưa bao giờ chạy thì không có lỗi nào để mà thấy** — nó chỉ im.

**`coverage.json` đếm cả lượt của chính bài đo.** 01/09 tôi thấy 5 lệnh phòng-chung có `n=1` và
suýt báo "bảng theo dõi sai, client CÓ gọi". `lastArgs` cứu: `{"agentId":"agent-1","roomId":"r1"}`,
cả 5 cùng một phút — script của tôi. Số lượt là bằng chứng cho "đường này có ai đi", **không** cho
"client đi đường này". Đọc `lastArgs` trước khi kết luận.

**Không có đường nào điều khiển được app GỐC.** Đo 01/09, ba cửa đều đóng: CDP (app từ chối mọi cờ
lạ — `bad option: --enable-logging`), UIA/accessibility (12 node, chỉ vỏ `Chrome_WidgetWin_1` +
Minimize/Restore/Close, ổn định qua 3 lượt), và MCP `chrome-devtools` (nó **tự mở Chrome riêng**,
không gắn vào tiến trình sẵn có). Căn cứ về app gốc chỉ còn hai nguồn, và cả hai đọc được: **bundle
đã bung** và **SQLite của chính nó**. App local thì có CDP `:9222` — dùng CDP trần.

**"Thiếu" phải kèm "có ai gọi không".** Đếm 17 lệnh thiếu đọc như một đống việc; "17, trong đó 15
cái client tự tắt" mới quyết định được.

**Hai trang tải, một cái nằm ngoài repo và ngoài đường phát hành.** Máy thứ tư cài từ
`cinai.app/tai/?k=1bab0936…` và ra client **0.20.0** dù `/agent/` đã phát bản hôm nay. Truy ra: `/tai/`
→ nginx `cinai-app` → `127.0.0.1:8099` → **`/opt/botnoibo/serve-static.mjs`** (unit `botnoibo-site`),
một máy chủ tĩnh dựng tay ngày 26/08, file **không có trong repo**, phục vụ `dist/` **26/08** và bản
chở-app `full/<token>/Bot-Noi-Bo-Setup-20260826.exe` (123.874.690 B) — token là **tên thư mục**, nên
`grep` nội dung không thấy nó. `clientVersion` chỉ lên 0.29 từ 31/08 (`ac876c0`), nên mọi gói 26–27/08
đều là 0.20 với bộ vá cũ. `phat-hanh.mjs`, `deploy.sh`, feed, launcher tự cập nhật — **không cái nào
chạm tới `/tai/`**, và nó vẫn trả 200 đều đặn nên không cửa sức khoẻ nào kêu. Bài học: một đường
người dùng đi mà không nằm trong đường phát hành thì sẽ **cũ đi trong im lặng**, và nó cũ đúng vào lúc
mình tưởng mọi thứ đã mới. Chính thức là `/agent/`; `/tai/` phải 301 về đó.

**Một ranh giới pháp lý không được dựa vào ngày tháng của file.** Gói chở-cả-app (118 MB) chứa client
ĐÃ VÁ của nhà phát hành, và `docs/legal.md` viết thẳng *"Do not redistribute a modified client"*. Nó
đứng ĐẦU `SETUP_KINDS.windows`, nên trước 03/09 nút Tải công khai phát nó bất cứ khi nào nó có mặt;
sau khi đổi sang "độ mới thắng" thì nó chỉ thua **vì tình cờ cũ hơn**. Bài test mới nói ra điều đó:
hai file cùng `mtime` ⇒ loại đứng trước thắng ⇒ nút công khai phát 118 MB, không ai cố ý và không lỗi
nào nổi lên. Nay có cờ `chiRieng` — `newestSetup` bỏ qua nó **vô điều kiện**, chỉ cửa `?k=<token>`
đọc thẳng bằng `newestMatching`. Đo được: chưa bao giờ có file ấy trên VPS (`find` rỗng, cả `dist`
2.2 MB), nên trang công khai chưa từng phát nó — nhưng đó là **may**, không phải thiết kế.

**Trang hứa một cửa mà máy chủ không có cửa đó.** Trang tải nói *"hỏi chủ trang để lấy đường tải
riêng"*, và JS của nó đổi chữ thành *"bản chở cả ứng dụng (118 MB)"* khi thấy `?k=`. Nhưng `site.ts`
**không đọc `k` một dòng nào** — ai có token vẫn nhận gói 50 KB trong khi trang nói 118 MB. Một lời
hứa ở tầng giao diện mà tầng dưới không biết là loại sai không test nào bắt được, vì cả hai tầng đều
"đúng" theo tiêu chuẩn của riêng chúng. Nay cửa ấy có thật, và **token sai thì rơi về gói công khai
chứ không trả 403**: một câu 403 xác nhận "có bản khác ở đây" cho bất kỳ ai thử đoán.

**Mở một đường làm đường kia tự mở theo.** Phát hành kênh `stable` cho LAUNCHER khiến cửa updater
GỐC bắt đầu trả 200, vì hai cửa đọc chung một khoá manifest — tức vừa dựng xong đường chạy được thì
đồng thời dựng lại cái bẫy "banner hiện, Install thất bại". Nay `traLoi` (cửa gốc) **im lặng theo mặc
định**, mở lại bằng `GROKBOT2_NATIVE_FEED=1` cho ngày có chứng chỉ. Hai cửa dùng chung dữ liệu thì
phải có hai công tắc riêng.

**Một cơ chế an toàn có thể biến thành cơ chế chặn, và chặn thì im.** Cửa launcher bản đầu đổi đuôi
URL sang `/download/mac` nhưng vẫn trả `sha256hash` + `ten` của gói **Windows**. Launcher Mac sẽ tải
đúng gói mac, so với hash sai, thấy lệch, in một dòng rồi `exit 0` — **bỏ qua cập nhật mãi mãi**, mỗi
lần mở app một lần, không ai thấy. Bắt được ở lượt `curl` đầu tiên sau phát hành, không phải bằng đọc
mã. Nay mỗi nền một **bộ ba** `url + sha256 + tên file`, và manifest thiếu khoá `mac` thì Mac nhận
**204** chứ không nhận gói Windows đội lốt.

**Banner hiện ≠ cài được.** Hôm nay tôi mở đủ bốn cổng của kênh cập nhật rồi nói với người dùng
"đổi `--kenh stable` là người dùng thật thấy banner" — **nửa đúng, và nửa sai là nửa quan trọng**.
Trích `main.cjs` 0.30, hàm chạy installer:

```
if (c.data.status !== "Valid") throw new SandInstallerSignatureError(`signature status ...`);
if (!(signerAllowlist ?? nhi).includes(c.data.signerCommonName)) throw ... `unexpected signer`;
installOnQuit(e,t){ this.runInstaller(e, ["--updated","/S", …]) }        // NSIS
var nhi = ["Anysphere, Inc.", "Anysphere"];
```

Client **dò chữ ký Authenticode** trước khi chạy, đòi `status === "Valid"` **và** tên người ký nằm
trong một **danh sách trắng ghi cứng là tên của HÃNG**. Nên trình tự thật là: feed trả bản mới ✅ →
tải + xếp chỗ ✅ → banner hiện ✅ → bấm Install ❌ ném lỗi chữ ký. Publish lên `stable` lúc này sẽ dạy
người dùng bấm một cái nút không bao giờ chạy — tệ hơn là không hiện banner.

Điều đáng chép không phải kết luận (§5 mục 8 **đã ghi đúng** điều này: "kênh của mình: chặn bởi CHỮ
KÝ SỐ, không phải bởi mã"), mà là việc tôi vẫn nói sai **trong khi câu trả lời nằm trong tài liệu tôi
đang mở**. Bốn cổng mở được làm tôi tưởng cả đường đã mở, và tôi kiểm cổng thay vì kiểm ĐÍCH. Muốn
auto-update chạy thật thì cần một chứng chỉ ký số **cộng** một bản vá nới danh sách trắng — hai việc,
không phải một.

**`-forever` giữ được client ngắt, KHÔNG giữ được segfault.** Khung "màn hình của bot" trong app chỉ
còn một nút Connect không bao giờ nối được. Chuỗi là `nginx /flowvnc-grokbox/ → 127.0.0.1:7077
(websockify) → 5977 (x11vnc) → Xvfb :77`, và nó đứt ở đúng mắt cuối: `/var/log/x11vnc-grokbox.log`
ghi **`caught signal: 11`** lúc 12:45:37 ngay sau khi một viewer vừa bắt tay xong. Xvfb còn sống,
websockify còn sống, nên mọi thứ *trông như* đang chạy — không dòng lỗi nào ở phía backend, vì
backend không nằm trên chuỗi đó. Nặng hơn: **không ai sở hữu tiến trình ấy** — nó từng được bật bằng
tay, `grep -rln` cả `/root /opt /etc/systemd` không thấy script nào nhắc tên. Nay là
`grokbot2-vnc-grokbox.service` với `Restart=always`. Bài học: một mắt trong chuỗi mà không có ai
giám sát thì lần chết đầu tiên của nó là lần chết cuối cùng.

**Đếm tiến trình bằng `pgrep -af <tên>` là tự đếm chính mình.** Trong đúng lượt chẩn đoán trên, tôi
đọc "còn 1 x11vnc" và suýt kết luận sai — cái duy nhất khớp là **dòng lệnh ssh của chính tôi** có
chữ `x11vnc` trong đó. `pgrep -c` cho `0`, và `ss -ltn` mới là thứ trả lời được câu thật: cổng có
lắng nghe hay không. Cùng họ với bẫy `[x]11vnc` mà `displays.ts` đã chép; lần này nó bắt tôi ở cửa
chẩn đoán thay vì ở cửa dựng.

**Bash nuốt backtick TRONG heredoc, kể cả khi nội dung là chú thích.** Viết unit systemd qua
`<<EOF` (không đóng nháy) với chú thích chứa `` `-forever` `` → bash chạy nó và báo
`-forever: command not found`, unit ghi ra thiếu chữ. Đây là biến thể thứ hai của bẫy backslash đã
biết; cách chữa cùng một chỗ: **`<<"EOF"`**, luôn luôn.

**Một đường lúc nào cũng "có gì đó" thì không bao giờ kêu.** Đo E2E 03/09 bằng chính trình duyệt
trên `cinai.app/agent`: `/download/windows` trả gói hôm nay, `/download/mac` trả gói **27/08** —
thiếu bảy ngày. Không lỗi nào nổi lên, vì đường mac luôn có MỘT file để phát; chỉ là file cũ.
Nguyên nhân: `phat-hanh.mjs` chỉ `scp` gói của nền tảng dùng cho manifest. Nay đưa cả hai.

**Con số về một FILE thì phải ĐO file.** Trang tải ghi cứng "bộ cài 28 KB" trong khi gói đang phát
là **2.0 MB** — sai gần trăm lần, và sai theo cách không ai thấy được: con số nằm trong HTML còn file
đổi theo mỗi lần phát hành. Nay `site.ts` thay `{{CO_WIN}}` · `{{CO_MAC}}` · `{{CO_FULL}}` bằng kích
cỡ lấy từ chính file `/download/*` phát ra. Phần đáng chép là **cách tìm ra chỗ cuối cùng**: tôi sửa
hai chỗ nhìn thấy trong HTML, rồi bài test mới (`site.test.ts`, chặn dạng câu `bộ cài <số> KB|MB`)
bắt được chỗ THỨ BA — một đoạn `<script>` chạy sau, ghi đè lại đúng dòng vừa thay, chỉ trên đường
`?k=`. Đọc HTML bằng mắt không thấy được thứ JS ghi vào sau.

**Cùng một số phiên bản, hai lần dựng ra hai file khác nhau.** Phát hành lại `0.29.20260903` cho băm
`95d6d24f…` thay vì `8789fc41…` — bản dựng không tái lập được (dấu thời gian bên trong exe). Hiện
không hại vì manifest và file luôn lên cùng lượt, và **manifest lên SAU** (đúng thứ tự trong bước 5).
Nhưng đừng bao giờ chỉ chép lại manifest mà không chép gói.

**BỐN cổng cùng chặn một tính năng, và mỗi cổng đều "đúng".** Máy thứ tư của người dùng không thấy
banner cập nhật. Không có một nguyên nhân nào cả — có bốn, độc lập, mỗi cái đủ để chặn:

| # | cổng | trạng thái đo được 03/09 |
|---|---|---|
| 1 | gói trên VPS | `shared/data/dist` chỉ có bản **27/08**, dựng trước cả việc update-feed |
| 2 | manifest phát hành | **không tồn tại** trên VPS ⇒ `traLoi()` luôn trả 204 "không có gì mới" |
| 3 | launcher của bộ cài | `setup-exe.mjs` đặt `SAND_DISABLE_UPDATES=1`, thắng mọi cổng khác |
| 4 | phiên bản client | máy đó chạy **0.20.0**, mà `update-feed.mjs` chỉ có biến thể 0.29 và 0.30 |

Sửa một cổng không đổi gì cả — đó là điều đáng chép. Và cổng 1+2 lộ ra một khoảng trống trong chính
đường phát hành mình vừa dựng: `phat-hanh.mjs` ghi gói + manifest vào `.data` của **máy chạy nó**, và
**không có bước nào đưa hai thứ đó lên VPS**. `deploy.sh` cũng không, vì `.data` là `shared/` — vùng
mà deploy cố ý không đụng tới. Hai thứ đều đúng việc của chúng; đường phát hành thì đứt ở giữa.

Cổng 3 nay có điều kiện: `startBundled(khoaCapNhat)` chỉ giữ `SAND_DISABLE_UPDATES` khi bản app đóng
gói **chưa** có dấu `/*grokbot2:update-feed*/`. Hướng hỏng là GIỮ khoá — mất banner còn hơn để app
tự tải bản của hãng và xoá sạch bộ vá.

**Cửa sức khoẻ chỉ kiểm thứ nó biết kiểm.** `deploy.sh` build `./packages/*`, `dist/` nằm trong
`.gitignore`, và `git archive` chỉ lấy file đã theo dõi. Ba thứ đều đúng việc của chúng, và khoảng
trống nằm GIỮA chúng: `apps/grokbot-web` **chưa bao giờ được dựng trên VPS**. Hậu quả rơi xa nhất
khỏi nguyên nhân — app desktop mở `{backend}/loginDeepControl`, backend chuyển hướng vào `/app/`,
`/app/` trả 503 kèm câu *"Chạy `pnpm --filter @grokbot2/web build`"*, và người đọc câu đó là một
người dùng vừa cài app lên **máy thứ tư**, không có kho mã lẫn pnpm. Suốt thời gian ấy `/gw/health`
xanh 200. Nay `deploy.sh` build luôn web, kiểm `dist/index.html` tồn tại, và cửa sức khoẻ dò thêm
`/app/` (chỉ CẢNH BÁO, không tự lùi — bản cũ không có `apps/grokbot-web` vẫn chạy được). Bài học
chung: **một cửa sức khoẻ kiểm đúng thứ nó biết kiểm thì sẽ bỏ lọt đúng thứ nó không biết** — và
đường người dùng đi (tải → cài → đăng nhập) phải có ít nhất một mốc trong cửa ấy.

**Câu lỗi viết cho lập trình viên, hiện ra trước mặt người dùng cuối.** Cùng sự cố trên: trang 503
nói đúng lệnh cần chạy, và đó là lý do nó vô dụng ở nơi nó thật sự xuất hiện. Nay
`chuaDungHtml()` đọc `GROKBOT2_PUBLIC_PATH` — biến CHỈ máy chủ công khai mới đặt — để nói hai câu
khác nhau, thay vì thêm một cờ nữa phải nhớ đồng bộ.

**Hỏi sai KHOÁ thì hạ tầng khoẻ vẫn trả lời như đang sập.** Dò `/grok-exec/health` với
`x-grokbot2-owner: admin@cinai.tv` nhận `per-user mode: pool exhausted (5 in use)` — tôi suýt báo
"cả nhóm tool box đang chết". Owner thật là `auth0|grokbot2-user` (`DEFAULT_USER.authId`), và với
khoá đúng box trả `ok:true`, `root=/home/gb2u003/workspace`. Câu lỗi mô tả đúng trạng thái của một
câu hỏi SAI, nên nó nghe rất thuyết phục. Cùng lượt đó lộ một trần thật: dải chỉ có **5 tài khoản**
`gb2u001…005` và **cả 5 đã cấp** — người thứ 6 sẽ thấy mọi tool box hỏng cùng lúc, kèm câu lỗi viết
cho quản trị viên. Trần này chặn sớm hơn nhiều so với trần RAM (14 bot).

**`cmd` đọc file batch theo TỪNG DÒNG từ đĩa — nên bộ cài không được chạy đồng bộ từ trong launcher.**
Bộ cài ghi đè chính `start-bot.cmd`. Bản đầu của khối tự cập nhật (sáng 03/09) gọi `& cmd /c $tmp`
ngay trong launcher đang chạy: khi bộ cài xong, `cmd` đọc dòng kế tiếp từ file MỚI ở offset CŨ —
hành vi không đoán được, và không lỗi nào báo. Nay hai pha: pha 1 chỉ kiểm + tải + kiểm hash + ghi
một script ra `%TEMP%` rồi **thoát mã 7**; pha 2 chạy tách rời (`Start-Process powershell -File`),
chờ 2 giây cho `cmd` thoát, cài, rồi (chỉ bản chở-app, vì `[Run]` của Inno có `skipifsilent`) mở lại
`start-bot.cmd`. Khoá bằng test `doesNotMatch /& cmd \/c \$tmp/` và bằng bộ đo chạy PowerShell thật.

**Template literal lồng trong `String.raw` thì KHÔNG raw.** `ISS_FULL` là `String.raw\`…\``, nhưng
nhánh `${cond ? \`…\` : \`…\`}` bên trong là literal thường — nên `"{#SourceDir}\token.txt"` thành
`{#SourceDir}<TAB>oken.txt` và ISCC báo *"Error on line 31"*. Cùng họ với bẫy backslash của bash và
heredoc, chỉ khác vỏ; và lần này nó nằm sau **hai lớp** grep của tôi nên câu lỗi thật chỉ lộ khi chạy
`build-setup.mjs` trần. Cách chữa: `String.raw` cho cả hai nhánh lồng.

**Bộ đo tự chặn mình, rồi báo lỗi lên sản phẩm — hai lần trong một giờ.** (1) Regex tách dòng
PowerShell đòi đúng MỘT dấu cách trước `^`; ba dòng có hai → lệnh bị cắt cụt giữa mảng → PS báo
*"Missing expression after ','"* và tôi đã tưởng template hỏng. (2) Máy chủ giả chạy CÙNG tiến trình
với `execFileSync` — vòng lặp sự kiện bị khoá trong lúc PowerShell chờ → *"The operation has timed
out"*. Cả hai lần launcher đều đúng. Bài học cũ mặc áo mới: **một bộ đo báo đỏ thì nghi bộ đo trước**,
và một `catch{ exit 0 }` đúng trong sản phẩm là thứ phải **mở ra** trong bộ đo, nếu không nguyên nhân
không bao giờ lộ.

**Validator của client có điều kiện KHÔNG ghi trong schema.** `isBotTemplateImport` của renderer 0.43 đòi
`view` **không có** `sourceAgentId` (`a != null → false`), avatar phải nằm trong hai bảng `EB`/`SB` ghi cứng,
và mọi chuỗi `min(1)` — nên một skill người dùng lười viết mô tả là **cả mẫu** bị từ chối, im lặng, ở phía
import. Ba điều kiện ấy chỉ đọc được ở thân hàm (`Fct`/`Gct`), không ở zod `CB`. Bài học cùng họ với "trường
có trong hợp đồng ≠ trường có người đọc": **hình dạng đúng chưa đủ, phải đọc cả hàm kiểm ở đầu bên kia** — và
lấp chỗ trống bằng câu có nghĩa (`(chưa có mô tả)`) thay vì để client nuốt mẫu.

**`deleteAgent` không cascade sang kho skill.** Đo 05/09: xoá bot xong, `getAgentWorkflows{id}` vẫn trả đủ
skill của nó — kho `workflows.json` lớn dần bằng skill của bot đã chết, và menu `/` không hiện nên không ai
thấy. Bài đo E2E phải tự xoá skill trước khi xoá bot; sản phẩm thì chưa sửa (việc nhỏ, ghi §5).

**Ba bài test chỉ xanh khi cwd là gốc repo.** `anh-song-qua-tool` · `box-obs` · `kind-khong-bi-mat` đọc mã
nguồn bằng đường dẫn tương đối `services/grokbot-backend/src/…`; chạy từ trong `services/grokbot-backend` là
ENOENT — đỏ 3/655 mà không dính gì tới thay đổi đang đo. Chạy `npx tsx --test` từ gốc repo — **và đọc bẫy "bộ test xoá kho thật"
ngay dưới trước khi chạy trần**.

**Bảng tool dựng bằng grep thiếu đúng nhóm hay hỏng nhất.** 16 tool `browser_*` và 8 tool box nạp
vào `TOOLS` bằng vòng lặp ở mức module, nên grep tĩnh ra 47 trong khi thật là **75**. "Thiếu trong
bảng" trông y hệt "không tồn tại" — bảng tool phải lấy LÚC CHẠY
(`scripts/tool-hien-co.mts`). Và `boxHealth()` không bao giờ ném, nó *trả về* chuỗi lỗi: bản đầu
của script ấy bọc `try/catch` rồi in `SỐNG` đè lên đúng câu `KHÔNG tới được`.

**Bản cài local biến mất, và bằng chứng về giờ biến mất bị chính tay mình xoá.** 05/09 mở lại app local: bản chở-app
(`%LOCALAPPDATA%ProgramsBot Noi Bo`, cài 04/09, E2E khớp từng byte) **không còn trên đĩa** — quét trọn `C:Usersadmin`
chỉ ra ba bản chép cũ 08/14 và 08/27. Nghi phạm: NSIS của hãng chạy `--updated /S` lúc app gốc thoát ~11:15 (cùng họ
với "thư mục biến mất hoàn toàn" ngày 27/08 mà `run.ps1` đã chép). Nhưng **không kết luận được**: cách rẻ nhất để biết
giờ xoá là `LastWriteTime` của thư mục `Programs`, và tôi đã cài lại vào đúng chỗ đó TRƯỚC khi nghĩ tới việc đọc nó —
mốc giờ bị ghi đè thành 11:45:20, giờ cài của mình. Luật: **đọc mốc của thư mục cha trước khi tạo lại thứ vừa mất**.
Cài lại từ `Bot-Noi-Bo-Setup-20260903.exe` (`/VERYSILENT`, 13 s): patched, `token.txt` + `backend.txt` đúng,
E2E teach GREEN 11/11 ngay sau đó.

**`run.ps1` chết theo ba cách khác nhau khi không có ai gõ.** Cùng lượt đó: (1) danh sách ứng viên đường dẫn app
không có `ProgramsBot Noi Bo` — đúng `DefaultDirName` của bộ cài chở-app — nên launcher tìm bản ở
`ProgramsGrok Bot` (đã mất) và `--verify` đỏ; (2) `cmd /c start "grokbot2-backend" cmd /k …` chạy dưới
`Start-Process` có chuyển hướng output thì mất dấu nháy tiêu đề → `start` tưởng `grokbot2-backend` là file, backend
không lên, launcher chờ 40 s rồi thoát; (3) kiểm pool-key bằng "dòng đầu có `PASTE_`" báo NOT SET trong khi file mang
khoá `hal_` ở dòng dưới và `config.ts scan()` lấy đúng khoá ấy — backend chat bình thường suốt. Sửa (1) và (3); (2)
chỉ xảy ra khi launcher bị gọi từ script không console — bấm đúp `start-app.cmd` không mắc.

**Từ 0.43, "kết nối xanh" không còn nghĩa là "reply được nhận".** Client 0.43 mở với backend mình: transport
`connected`, SSE sống, health `ok`, mà roster hiện *"Can't reach your computer"* và transcript hiện *"Showing saved
messages"*. Tôi đi hết một vòng nghi ngờ kết nối (SSE, WatchSandBoxMigration, cờ server-routing, pha host) trước khi lần
theo mã lỗi `client/sidebar-sections-read-failed` và thấy: coordinator 0.43 kiểm **mọi** reply gateway theo schema nhúng
(deflate-raw + base64 trong chính `main.cjs` của nó) và coi reply thiếu một khoá `required` là **lệnh thất bại** — không
log, không 4xx, vì HTTP vẫn 200. `getHostSettings` thiếu `notifications.allowedApps` ⇒ banner một; tin người dùng thiếu
`isStreaming` ⇒ banner hai. Ba luật rút ra: (1) **rút schema ra và chạy validator của hãng trên reply của mình** trước
khi nghi kết nối — `scripts/kiem-reply-0-43.mjs` là bản chép đúng của `ft(...,"structural")`; (2) mode structural bỏ qua
khoá thừa nhưng bắt `null` ở nơi không nullable, nên "chưa có" phải là **vắng khoá**, không phải `null`; (3) 0.29 và
0.43 đọc hai hình dạng khác nhau ở vài lệnh (`getEffectiveMcpPlugins`, avatar) — gửi **cả hai** trong một reply là hợp lệ
và rẻ hơn dò bản client. Cùng họ với "trường có trong hợp đồng ≠ trường có người đọc", chiều ngược: từ 0.43 mọi trường
bắt buộc đều có một người đọc là máy.

**Bộ test xoá kho THẬT của người dùng, và lời dặn "chạy `npx tsx --test` từ gốc repo" ở ngay trên là cái bẫy.** Đo 05/09:
sau một lượt chạy bộ test đầy đủ, `.data/bot-templates`, `.data/box-secrets`, `.data/mcp-prefs` **biến mất**; listing Marketplace
đang hiện trên UI 0.43 thành *"No Bots available"*. Ba bài (`bot-templates`, `box-secrets`, `mcp-prefs`) có `sach()` =
`rmSync(DIR)` với `DIR = (GROKBOT2_DATA_DIR ?? <src>/../.data)/<kho>` — và biến ấy chỉ do `scripts/run-tests.mjs` đặt. Chạy
trần là biến vắng, là `.data` thật. Chính chú thích trong ba bài đó **đã tả đúng cái bẫy này** ("vá một nửa một cái bẫy thì cái
bẫy vẫn còn") rồi để lại đúng nửa kia: đọc env mà không có mặc định an toàn. Mất gì: mẫu bot (chỉ có mẫu tạm của tôi), bí mật box
(bản trên box còn — `BOX_SECRETS_FILE`), và mọi tắt/bật tool MCP + custom instructions người dùng từng đặt — **không khôi phục được**,
module đọc thẳng đĩa mỗi lần gọi. Hai luật: (1) bài test **không được có đường nào** dẫn tới dữ liệu thật — biến vắng thì tự
`mkdtemp`, không rơi về mặc định của sản phẩm (nay cả ba bài làm thế; chạy trần 36/36 và ba thư mục thật không mọc ra); (2) một
script debug `tsx` rời cũng là "chạy trần": cùng lượt tôi tạo một bot rác vào SQLite thật vì `store.ts` chỉ cách ly theo
`NODE_TEST_CONTEXT`/`GROKBOT2_STATE_FILE`, không theo `GROKBOT2_DATA_DIR` — `persist()` của backend sống `prune` nó ở lượt ghi kế,
nhưng đó là may. Đặt `GROKBOT2_STATE_FILE` + `GROKBOT2_DATA_DIR` + `GROKBOT2_WORKFLOWS_FILE` vào thư mục tạm cho MỌI script rời.

**Client 0.43 tự đúc id bot và tự gửi lời nhắc setup — hai thứ schema không ghi.** Import từ Marketplace gửi
`createAgentFromTemplate{agentId:<UUID>}` và vẽ hàng roster mang id đó TRƯỚC khi reply về; ta đúc `agent-1002` ⇒ hai hàng cùng tên,
hàng ma sống tới khi mở lại app. Rồi với `setup.kind:"recipe"` client đăng một tin người dùng dạy bot dùng `update_state` để tạo lại
skill mà server đã tạo. Rồi chặn tin ấy thì hàng "Creating…" treo vì client chờ NỘI DUNG đầu. Ba nút, ba lần đo trên UI, không nút nào
đọc được từ `gateway-schema-0.43.json`: id client đúc phải được **tôn trọng**, lời nhắc setup **chặn** (`isSetupSendSuppressed`),
và server **tự kích** lời giới thiệu. Cùng họ với "validator của client có điều kiện không ghi trong schema" — lần này là *luồng*
của client không ghi trong schema.

**Template literal thường nuốt `\B` — launcher của MỌI gói đã phát ghi `%APPDATA%Bot Noi Bo`.** Đo 05/09 khi soạn bộ cài
0.43: dòng `set "SAND_USER_DATA_DIR=%APPDATA%\Bot Noi Bo"` trong `setup-exe.mjs` và `setup-templates.mjs` nằm trong template literal
thường, và JS coi `\B` là escape không tồn tại ⇒ ra chữ `B`. Launcher đã cài trên chính máy này ghi `%APPDATA%Bot Noi Bo`, nên hồ sơ
người dùng (token, cache) nằm ở `AppData\RoamingBot Noi Bo` — thư mục ấy tồn tại thật, app vẫn chạy, không ai thấy. Cùng buổi, chiều
ngược lại: trong `String.raw`, `\${ten}` GIỮ backslash và TẮT nội suy, ISCC nhận nguyên chữ `${ten}` ("Unknown constant ten"). Hai
luật: (1) trong khuôn sinh file Windows, backslash luôn viết `\\` và không bao giờ đứng ngay trước `${` (đưa nó vào biến); (2) kiểm
khuôn bằng cách **RENDER rồi grep đầu ra** (`APPDATA|Programs|dp0`), không đọc mã nguồn — mã nguồn trông đúng ở cả hai lỗi. Sửa: `\\` +
launcher `move` thư mục cũ sang chỗ đúng một lần, người dùng không phải đăng nhập lại.

**Hai nút, hai câu — cùng một menu.** "Share as template" và "Update template" đều gọi `onTemplateAction({kind:"share"})`, và tôi
kết luận từ đó rằng cả hai gửi cùng một câu. Sai: bấm thật trên 0.43 local thấy Update gửi `Update the shared template of yourself.`
(i18n `sfB+W/`) — lượt đó chạy đúng chỉ vì lời nhắc chung đủ mạnh, còn cờ khoá `ask_question` và hướng dẫn 3 nhịp không bật.
Cùng họ với "trường có trong hợp đồng ≠ trường có người đọc": một handler chung không có nghĩa một chuỗi chung — chuỗi nằm ở chỗ GỌI.
Nay `laLuotChiaSeMau` nhận cả hai, và bài unit ghim nguyên văn cả hai câu.

**`el.click()` tổng hợp không chọn được mục menu Radix của client.** Đo 05/09: gọi `.click()` (kể cả dựng đủ chuỗi
`pointerdown/up` + `mousedown/up`) lên `[role=menuitem]` thì menu vẫn mở, không tin nào gửi đi — trong khi các bài E2E trước
bấm được nút thường và tab bằng đúng cách ấy. Chỉ sự kiện TRUSTED qua `Input.dispatchMouseEvent` tại toạ độ mới đi qua. Bẫy kèm:
nút của thẻ mẫu mang `title` ("Publish this template"), không `aria-label`, và chữ hiển thị chỉ là "Publish" — so khớp phải gộp
cả ba, và regex neo `^` trượt vì chuỗi ghép có dấu cách đầu. `e2e-chia-se-mau.mjs` chép cả hai bài học.

**Runner chạy 0 bài và thoát 0 — trông y như xanh.** `scripts/run-tests.mjs` không có đối số dùng glob `src/**/*.test.ts`
TƯƠNG ĐỐI với cwd; gọi từ gốc repo (đúng chỗ ba bài `anh-song-qua-tool` · `box-obs` · `kind-khong-bi-mat` cần) thì glob
không khớp gì, TAP in `1..0`, exit 0. Đo 05/09 đêm: tôi đọc "fail 0" trước khi đọc "tests 0". Từ gốc repo phải đưa glob
tường minh: `node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/**/*.test.ts"` → 685/685;
từ trong `services/grokbot-backend` thì 683 bài và đúng 3 đỏ ENOENT ấy. Một bộ đo báo "0 sai" phải kèm "trên bao nhiêu".

**`pnpm typecheck` khởi động lại backend đang chạy.** Turbo `typecheck` có `dependsOn: ["^build"]` nên nó DỰNG LẠI `dist/`
của `packages/*` trước, và `tsx watch` theo dõi cả import từ đó ⇒ backend restart (pid đổi, `startedAt` mới) — một lượt
`e2e-routine-nhac.mjs` đang chạy chết với `ECONNREFUSED :8788` và để lại bot thử chưa xoá. Cùng họ với "sửa `src` trong lúc
người dùng đang chat": typecheck toàn workspace là một thao tác ĐỘNG với backend sống; chỉ `tsc --noEmit -p` trong thư mục
backend là tĩnh. Và một bài đo đọc reply sai khoá (`entries` chứ không phải mảng trần) đỏ y như sản phẩm hỏng — hai lượt đo
"9 ĐỎ" hôm nay là bài đo, không phải bot; hàng sự kiện là ĐỒNG BỘ, nó đỏ cùng lúc với câu của bot thì nghi bài đo trước.

**"Không tới được box" + HTTP 200 + chứng chỉ của người khác = tên miền bị giữ ở ĐĂNG KÝ, không phải máy chủ chết.** 06/09:
lượt share trên VPS không chạy, log chỉ có *"memory load failed: fetch failed"*, `lastBusyAtMs: 0`. Từ VPS: `curl https://admin.halcion.vn/`
exit 60 (*unable to get local issuer*), nhưng `http://` trả 200 và chứng chỉ là `*.vnnic.vn` / *Vietnam Internet Network Information
Center*; `dig NS halcion.vn` rỗng; máy dev hỏi 8.8.8.8 và 1.1.1.1 cũng ra `117.122.125.107`. Tức resolver trả IP giữ chỗ của VNNIC —
pool, box, VNC đều "đứt" cùng lúc mà không máy nào trong số đó hỏng. Ba điều: (1) `curl --resolve <host>:443:<IP Cloudflare>` là phép
thử KHÔNG đổi gì để biết gốc còn sống — ở đây `/grok-exec/health` trả `ok:true`, `/v1/claude` trả 401 (có route, đòi khoá); (2) khi
đã chắc, một dòng `/etc/hosts` khôi phục dịch vụ cho mọi người dùng VPS trong 6 giây, còn việc thật (nhà đăng ký) là của chủ tên miền;
(3) máy dev vẫn chạy được E2E lúc 17:30 chỉ vì cache DNS — "bên tôi chạy được" không phải bằng chứng hạ tầng sống. Kèm: bài đo đầu
xoá bot thử TRƯỚC khi đọc transcript của nó, nên bằng chứng lượt đầu chết đi cùng nó — dọn sau khi đọc, không phải trong `finally` mù.

## 8 · Chưa chắc chắn

- ~~**App GỐC không mở lên được nữa (từ 02/09).**~~ **ĐÃ SỬA 03/09** — chạy chính trình cài
  `sand-update-0.30.0.exe` mà app đã tự tải về Temp (chữ ký Valid, `Anysphere, Inc.`): cài ~30 giây,
  app tự bật, 9 tiến trình, cửa sổ lên, và sống qua nhiều phút. Nguyên nhân gốc **chưa bao giờ tìm
  ra** — sáu nghi phạm dưới đây đều bị loại, và cái sửa được là *cài đè*, tức bệnh nằm đâu đó trong
  bản cài cũ mà `app.asar` 31 MB còn nguyên không nói lên được. Giữ bảng để phiên sau biết đường nào
  đã đi rồi:

  | nghi phạm | cách loại |
  |---|---|
  | khoá một-thực-thể với app local | đóng app local sạch (0 tiến trình) → vẫn thoát |
  | khoá treo trong `userData` | cho `SAND_USER_DATA_DIR` một thư mục mới → vẫn thoát |
  | biến môi trường mức User/Machine | cả 7 biến đều trống ở cả hai mức |
  | trình cài nạp sẵn tự chạy rồi thoát | không tiến trình `sand-update*` nào sinh ra, không UAC |
  | thư mục làm việc / cách gọi | `-WorkingDirectory` đúng như shortcut, và **chính shortcut** cũng thất bại |
  | hosts/DNS/proxy chặn miền hãng | hosts chỉ có `halcion.vn`; `api2.cursor.sh` phân giải được; không proxy |

  Dấu hiệu còn lại: thoát **dưới 3 giây**, im lặng (`ELECTRON_ENABLE_LOGGING=1` ra 0 byte), **không
  crash dump**, cài đặt nguyên vẹn (`app.asar` 31 MB, không dấu vết bộ vá). Nhưng nó **đi được khá
  xa**: `~/.grokbot` và `%APPDATA%\Grok Bot` đều có mốc ghi đúng lúc thử mở — nên không phải bail ở
  dòng đầu. Việc rẻ nhất chưa thử: **khởi động lại máy**. Việc tìm được nguyên nhân: trace Process
  Monitor đúng cửa sổ 3 giây đó.

  **TÁI PHÁT 05/09 ~11:45**, và lần này có bằng chứng hơn: `%APPDATA%Grok Botsand-update-apply-marker.json`
  = `{"phase":"staged","mechanism":"nsis","targetVersion":"0.43.0","fromVersion":"0.30.0"}` ghi lúc **07:42**, bộ cài
  `Tempsand-update-SiHCSDsand-update-0.43.0.exe` (115.666.848 B, chữ ký **Valid**, CN `Anysphere, Inc.`) tải cùng
  phút; app vẫn chạy bình thường 11:05–11:15 (buổi teach của người dùng), rồi sau khi thoát thì **mọi lần mở đều 0 tiến
  trình ngay giây đầu** (đo từng giây 12 s), không Crashpad, không Event Log. `Grok Bot.exe` vẫn 08/28 ⇒ 0.43 **chưa**
  được cài. Khớp lần 03/09 (khi ấy cũng có bộ cài 0.30 nằm sẵn trong Temp và cài đè là hết): giả thuyết mạnh nhất nay là
  **marker `staged` + bộ cài chưa áp ⇒ app tự thoát ở khởi động**. Cách chữa cùng kiểu: chạy bộ cài 0.43 — nhưng đó là
  đổi bản tham chiếu 0.30 → 0.43, **chờ chủ dự án quyết**.

  **Mất nó tốn gì:** app gốc là nguồn đối chiếu hành vi. Nhưng bộ ca parity ĐÃ chứa transcript của nó
  và SQLite của nó vẫn đọc được, nên phần lớn việc đối chiếu không cần app chạy — đúng như case 5 vs
  23 hôm nay làm được mà không mở app.


- **Mất mạng:** lịch sử chắc chắn đọc được (SQLite cục bộ), nhưng **chưa thử rút mạng** xem app có
  boot trọn không. Trích 01/09 cho thấy app gốc có hẳn một cơ chế cho chuyện này mà ta không có —
  `generation` + `CursorTooOld` + cờ `replay` để client biết nó đã bỏ lỡ gì:
  [0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md). Chưa vá, vì chưa biết hệ quả
  trên màn hình là gì — kể cả khả năng client tự xử được nhờ gọi `getAgentTranscriptTail` mỗi lần mở
  lại một bot.
- **Cloudflare có nhận ra Chrome của mình không** — chưa thử trang thật.
- **Tên binary cưỡng chế sandbox của hãng** — hàm trả đường dẫn bị minify, chưa truy ra.
- **Box của HÃNG** — chỉ đo được box của mình (`gb2u003`, không root, `sudo` đòi mật khẩu, có
  `DISPLAY=:77` + Xvfb). Box hãng không có quyền vào, nên không kết luận thay.
- **Kênh `cookie-origin-approval`** — khoá `frames` của batch rỗng là **phỏng đoán**: client mới chỉ
  long-poll, chưa nhận khung nào nên chưa đo được khoá thật.

## 9 · Tài liệu nào giữ cái gì

Bảng này để **không chép lại nội dung** — mỗi thứ có đúng một chỗ ở.

| tài liệu | giữ gì |
|---|---|
| **bảng này** | trạng thái · việc còn lại · bẫy đã trả giá |
| [system-xray.md](system-xray.md) | hệ thống này là gì, cho người **không rành kỹ thuật** |
| [con-thieu-so-voi-0-30.md](../plan/con-thieu-so-voi-0-30.md) | cách CHIA LOẠI thiếu: năng lực · dữ liệu · không thuộc về ta |
| [protocol-reference.md](../protocol-reference.md) | hợp đồng với client — **đọc trước khi đổi shape** |
| [nang-quyen-tren-may-nguoi-dung.md](../extracted/nang-quyen-tren-may-nguoi-dung.md) | nâng quyền: app gốc cho tới đâu |
| [tool-doi-chieu.md](../extracted/tool-doi-chieu.md) | 75 tool bên mình · vì sao không đếm được tool hãng · 4 cái thiếu trên máy người dùng |
| [loi-nhac-va-tool-app-goc.md](../extracted/loi-nhac-va-tool-app-goc.md) | system prompt hãng ở ĐÂU · số lái agent (model, trần ngữ cảnh, trần tool) · lời nhắc agent thoại nguyên văn |
| [ship-to-users.md](../plan/ship-to-users.md) | website → tải → cài · billing |
| [per-user-on-one-box.md](../plan/per-user-on-one-box.md) | tách OS user · thu hồi khi nghỉ |
| [one-display-per-bot.md](../plan/one-display-per-bot.md) | một màn hình mỗi bot · sức chứa box |
| [desktop-computer-use.md](../plan/desktop-computer-use.md) | điều khiển máy tính · dạy việc |
| [architecture.md](../architecture.md) | kiến trúc tổng, viết tay |
| [architecture/so-do-tu-sinh.md](../architecture/so-do-tu-sinh.md) | sơ đồ do MÁY vẽ từ import thật — `pnpm arch:graph` |
| [legal.md](../legal.md) | ranh giới: dùng cá nhân / nghiên cứu |
| [runbooks/trien-khai.md](../runbooks/trien-khai.md) | triển khai + **lùi bản** — §1 là nút lùi |
