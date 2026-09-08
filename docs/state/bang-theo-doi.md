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
hợp đồng 0.43  **155** lệnh · **24** chưa handler · 0/24 client từng gọi (`unknownPaths` rỗng) — sửa 07/09 bằng NGUỒN THỨ HAI: bảng lệnh của renderer biết thêm 5 lệnh `main-app.cjs` không khai (`noteMountedAgent` · `resolveAgentCreation` · `getServerAgentRoster` · `restoreTemporalAgentRouting` · `listVirtualCardPaymentMethods`). Độ phủ theo NHÓM tính năng của renderer: 14/22 nhóm đủ 100%; `user_form_vault` **0/4** là nhóm duy nhất trống hẳn và là nhóm duy nhất đẻ banner nếu bị gọi (reply đòi mảng, ta trả `{}`) — docs/plan/so-sanh-be-goc-vs-grokbot2.md §1.1
client gọi     148 lệnh · 0 đường còn 404
bản ghi sống   khung SSE `transcript` có `ordered` từ 06/09 (như app gốc 0.43): 38 → 5 lượt tải đuôi/lượt bot, trang đuôi New Bot 292 → ~146 KB — docs/extracted/0-43-transcript-context.md (§6 mục 29)
kênh           3: local-exec · webauthn · cookie-origin-approval
mã             backend 806 bài · 806 xanh (08/09, sau mục 46) · proto 7/7 · web avatar 7/7 · router box 3/3 · typecheck sạch (đo 06/09, runner từ GỐC repo với glob tường minh — xem §7 "runner 0 bài"); bài đỏ cũ `avatar.test` đã sửa (nó ghim viewBox cố định của bản trước 3e60bdf)
parity         0 ca lệch HÀNH VI — còn 21 (khác môi trường: WebGL) + 23 (khác cách vẽ: widget vs câu)
bản vá client  **11** mốc · 0.29: 6 áp · 0.43: **8** áp + 3 chứng minh thừa (`obsoleteIf`) · `--verify` xanh trên `C:cai043` và `ProgramsBot Noi Bo 043`. **Bản `0.43.20260907` phát hành 08/09 đã chở thân mới** (§6 mục 42) — máy nào chưa cập nhật thì bảng Computer vẫn đi bằng vé dùng chung; `ProgramsBot Noi Bo` trên máy dev vẫn ở bản cũ vì nó đang mở lúc đo, cập nhật ở lần hỏi feed kế tiếp. Từ 08/09 `--verify` kiểm cả THÂN chứ không chỉ marker — trước đó nó xanh vì lý do sai (§7)
E2E 0.43       **06/09 10:31–11:00 sau khi hạn mức pool mở lại — TRỌN BỘ XANH trên client 0.43 local + backend dev**: kiem-reply 29/29 · mẫu bot 20/20 · marketplace 26/26 · hai tài khoản 20/20 · routine XANH 5 nhịp · trang chia sẻ 17/17 · share-as-template 7/7 · **teach 15/15** (skill + link sau 132 s) · **bản ghi sống 5 lượt tải đuôi** (chuẩn) · **`e2e-tho-dung-bot` XANH** (§6 mục 31: bot mới + 2 skill + routine → widget → publish → listing, lượt 1 ~115 s, lượt 2 16 s). Trên VPS `20260906-031712`: kiem-reply 29/29 · routine XANH 5 nhịp · trang chia sẻ XANH. Kịch bản: [runbooks/kich-ban-e2e.md](../runbooks/kich-ban-e2e.md). Lượt 08:30 trước đó: teach đỏ vì hạn mức pool (*session limit · resets 10:30*), không phải sản phẩm · **06/09 21:36–21:40: `e2e-chia-se-mau` 7/7 BA LƯỢT LIỀN** trên client 0.43 mở với `--disable-backgrounding-occluded-windows` → §5 mục 19 ĐÓNG · `e2e-mau-bot` **24/24** (thêm 4 mốc routine, mục 32)
VPS            **`9596b28` deploy 08/09 ~18:55** (bản `20260908-125354`, chở câu báo lỗi TỰ CHỬ ĐƯỞ NG sang `local_shell` khi tệp nằm ngoài `localRoot` §6 mục 46; lùi: `bash /opt/grokbot2/current/infra/vps/rollback.sh`): health 200 · `/app/` 200 · `kiem-reply-0-43` **29/29** · cửa ops đo lại từ Internet **401 không giấy / 401 giấy bịa** · bản đang chạy có `chi-duong-ngoai-goc.ts` và **3** lần `chiDuongKhiNgoaiGoc` trong `tools.ts`. Trước đó **`1bcf6d8` deploy 08/09 ~16:05** (bản `20260908-090512`, chở bản vá cắt khối `TOOL_CALL` dư khỏi lượt bị ngắt §6 mục 45; lùi: `bash /opt/grokbot2/current/infra/vps/rollback.sh`): health 200 · `/app/` 200 · `kiem-reply-0-43` **29/29** · cửa ops đo lại từ Internet **401 không giấy / 401 giấy bịa** · bản đang chạy có `incompleteToolCallStart` ở cả `tool-calls.ts` và `chat/state.ts`. Trước đó **`fc60621` deploy 08/09 ~14:03** (bản `20260908-070327`, chở bản vá khung SSE cho tin của chính người dùng §6 mục 44; lùi: `bash /opt/grokbot2/current/infra/vps/rollback.sh`): health 200 · `/app/` 200 · `kiem-reply-0-43` **29/29** · cửa ops đo lại từ Internet **401 không giấy / 401 giấy bịa** · **nghiệm thu chính bản sửa TRÊN VPS bằng bot thử**: `sendPrompt` → khung SSE ĐẦU TIÊN là `e1293` `role:"user"` mang đúng `clientNonce`, seq 2→3, bot thử đã xoá. Trước đó **`51d04d9` deploy 08/09 ~11:10** (bản `20260908-040549`, chở bản vá cửa `/internal/ops/` + `ownerFromRequest` đọc vé §6 mục 43; lùi: `bash /opt/grokbot2/bin/rollback.sh`): health 200 · `/app/` 200 · `kiem-reply-0-43` 29/29 · **cửa ops đo lại TỪ INTERNET: 401 không giấy, 401 giấy bịa, 200 với vé thật**. Trước đó **`b8ac092` deploy 07/09 ~16:48** (bản `20260907-164759`, chở cụm cô lập máy theo người dùng §6 mục 39 + bản vá `awaitingUserResponse` §6 mục 40; lùi: `bash /opt/grokbot2/bin/rollback.sh`): health 200 · `/app/` 200 · **`kiem-reply-0-43` 29/29 · 0 sai với một bot đang chờ THẬT trên máy** (trước bản này là `29 · 1 sai`). Trước đó **`aac6b3e` deploy 07/09 ~05:15** (bản `20260906-220736`, thêm lưới thử-lại một lần khi chưa tới được daemon box §8; lùi: `bash /opt/grokbot2/bin/rollback.sh`): health 200. Trước đó `5411fc1` (`20260906-140811`, mang `local_write` + `local_shell_bg` + `local_copy_to_box`/`local_copy_from_box`; daemon box `/opt/exec-daemon.mjs` đã có `writeBytes`): health 200 · `/app/` 200. Bản trước `6da3ea3` (`20260906-043517`): health 200 · `kiem-reply-0-43` 29/29 · routine XANH 5 nhịp · trang chia sẻ XANH (sau 10:30) · **Thợ dựng bot + danh mục 9 bot** dựng trên VPS (10 listing, 4 Featured, thân thẻ gọn) · **`e2e-tho-dung-bot` XANH 7/7 trên VPS** (lượt 1 109 s, lượt 2 22 s, publish MỘT lệnh, link `cinai.app/agent/bot/…`) — Marketplace ngoài đã có tài nguyên. Kèm sửa sản phẩm: lượt nối tiếp sau widget nay bật `isRunning` (§6 mục 31)
bộ cài        **Bản 08/09 ĐANG PHÁT trên kênh stable — `0.43.20260907`** (`Bot-Noi-Bo-Setup-20260908.exe`, sha `434c2a23…`), bản ĐẦU TIÊN chở bản vá vé người dùng cho bảng Computer: đo từ Internet `ver=0.43.20260905` → 200, `ver=0.43.20260907` → 204; băm khớp manifest = cục bộ = VPS; **cài thử gói đã phát ra thư mục riêng: 5 lần `__grokbot2_ve`, `--verify` xanh trọn** (§6 mục 42). Trước đó: **Bản 06/09 ĐANG PHÁT trên kênh stable, manifest khai `0.43.20260905` = số `package.json` trong bundle (xem §7 "hai nguồn cho một số phiên bản")**. **Phát hành lại 06/09 18:43 để nghiệm thu đường `phat-hanh` đã sửa** (`npx tsx … --kenh stable --with-app --len-vps`, đúng dạng người vận hành gõ): test xanh → dựng → `⚠ bundle khai 0.43.20260905 nhưng tên gói mang ngày 20260906 — manifest theo BUNDLE` → manifest `0.43.20260905` → scp 3 gói + manifest. Đo từ Internet: `ver=0.43.20260905` → **204** (máy đã cập nhật không tải lại) · `ver=0.29.20260903` và `0.43.0` → 200 `Bot-Noi-Bo-Setup-20260906.exe` 111.213.207 B sha `b20d44fd…` = băm cục bộ = băm trên VPS · cfg `Cai-dat-Bot-Noi-Bo-win-20260906.cmd` sha `25284fd4…` · mac `d144d354…` · trang tải hiện `0.43.20260905` ×4. Launcher trong gói này gỡ `ELECTRON_RUN_AS_NODE` (render kiểm `set "ELECTRON_RUN_AS_NODE="`). Máy dev đã 0.29 → 0.43 qua launcher lúc 12:11 (hồ sơ giữ, CDP :9222 sống). **E2E đường người dùng 06/09 ~19:00 (yêu cầu chủ dự án)**: trang tải công khai (Chrome thật headless) hiện `0.43.20260905`, nút → `download/windows` → `Bot-Noi-Bo-Setup-20260906.exe` 111.213.207 B tải 3,8 s, sha `b20d44fd…` = manifest = VPS → cài đè `/VERYSILENT` lên `Programs\Bot Noi Bo` exit 0 sau 16 s, 871 file, `package.json` `0.43.20260905`, `start-bot.cmd` mới (18:40) có dòng gỡ biến, `backend.txt`/`token.txt` đúng → `start-app.cmd` mở lại 9 tiến trình, CDP :9222, hồ sơ giữ. Câu chữ trang qua JS đúng cho gói chở-app ("bộ cài 106.1 MB · không cần chuẩn bị gì trước" — `curl` chỉ thấy HTML trước JS, đừng đọc nhầm). Một lỗi nhỏ lộ ra: trang ghi *phát hành 05/09/2026* vì `NGAY_BAN` suy từ đuôi version — nay là ngày đóng dấu; sửa `ngayPhatHanh()` lấy ngày trong TÊN GÓI trước (`73689e7`, deploy `20260906-120404`) → trang ghi 06/09/2026. Lùi: `phat-hanh.json.bak-20260906` (trước phát hành) · `.bak-20260906b` (manifest `0.43.20260906` trước sửa tay) trên VPS + `Bot-Noi-Bo-Setup-20260903.exe` còn trong `dist/` (xem §6 mục 27)
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
| **ghi file lên máy Windows** | ✅ 06/09 | `local_write` → thẻ `write-file` → tệp 48 byte UTF-8 có dấu đúng từng chữ trên Desktop (`e2e-may-nguoi-dung` mốc 3) |
| **chạy lệnh nền sống qua lượt** | ✅ 06/09 | `local_shell_bg` → shellId 798773, pid; tệp lệnh nền tạo ra xuất hiện **14 s sau khi lượt đã xong**; đầu ra ở `terminals/<shellId>.txt` |
| gõ stdin vào lệnh nền | ❌ | daemon hãng **không có handler** `writeShellStdinArgs` (0.29 lẫn 0.43) — app gốc cũng không làm được trên Windows; lệnh nền phải tự chạy không hỏi |
| **chép tệp máy Windows → box** (CopyToBox) | ✅ 06/09 | `local_copy_to_box` → thẻ `read-file` → 13,6 MB đi 3 khúc 6 MiB, sha256 trên box = sha gốc (26 s qua Cloudflare); tệp 1,5 MB 3,7 s |
| **đọc/ghi tệp ngoài `C:\Users\admin`** | ❌ — trần của daemon HÃNG | đo 08/09: `local_read` lên `D:\111\Desktop\runway-workflows-5c286efc\model_response.json` → *"Path is outside the allowed local-exec root and was refused"*; **cùng tệp qua `local_shell` → exit 0, 86.182 byte, `cwd=C:\Users\admin`**. `localRoot` là thứ daemon TỰ KHAI trong khung `hello` và `containPath` chặn BÊN TRONG daemon ⇒ backend không nới được. Hai đường đi được: chuyển thư mục về dưới `C:\Users\admin`, hoặc để bot đọc bằng `local_shell`. **Từ 08/09 câu báo lỗi TỰ chỉ đường** (§6 mục 46) — trước đó bot phải mò ra `local_shell` bằng cách đoán |
| **chép tệp box → máy Windows** (CopyFromBox) | ✅ 06/09 | `local_copy_from_box` → thẻ `write-file` → 13,6 MB về 4 khúc, ghi Desktop nguyên từng byte (22 s); `e2e-chep-tep` 7/7: bot chép lên, `sha256sum` trên box, chép về — ba sha là một |

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
| 2 | Máy thứ hai trỏ vào VPS (`T2` · `4.8`) | cần máy thật thứ hai — **quy trình đo đã viết sẵn 08/09**: [runbooks/may-thu-hai.md](../runbooks/may-thu-hai.md), 4 mục A–D với mốc xanh cụ thể | mở app máy 2 → chat một lượt |
| 3 | Box qua hầm từ máy khác (`T3`) | như trên | — |
| 4 | Hai máy một box (`T5`) | **bắt buộc** hai máy thật | — |
| ~~20~~ | ~~Bảng Computer đi bằng vé CỦA NGƯỜI DÙNG~~ **XONG 08/09 ở bộ vá, CHƯA tới máy người dùng** — `computer-tab-ve` cất vé lúc `buildConnection` đúc ra nó, ba chỗ đọc ưu tiên vé; đo trên giao diện với môi trường không có vé dùng chung: `getSandMachines` → `saw:"user-ticket"`, bảng hiện đúng một máy `isCurrent:true` (§6 mục 41) | **hết chặn 08/09**: đã phát hành `0.43.20260907`, máy cũ nhận 200 ở lần hỏi feed kế (§6 mục 42) | `/gw/__coverage` → `/gw/api/getSandMachines` mang `saw:"user-ticket"` |
| ~~5~~ | ~~Billing `enforce`~~ **BẬT 02/09** | 11 ngày warn là đủ số; trình tự: test nhánh từ chối (5/5, lần đầu có) → chủ lên `pro` qua webhook → bật → đo sống: chủ được trả lời 8s, không bong bóng chặn | lùi: `GROKBOT2_BILLING=warn` trong `.env` + reload |
| 6 | Voice-call (5) + phòng chung (9) | cờ client đang tắt | chỉ làm khi bật cờ |
| 7 | ~~Cơ chế `generation` / `CursorTooOld`~~ **hạ ưu tiên 02/09** | client tra tail 198.691 lượt với `limit:500`, ta trả đủ → nhịp tra kế tiếp tự lấp. *06/09: con số 198.691 ấy chính là cái "giật" — mỗi khung SSE không `ordered` là một lượt tải đuôi; nay khung có `ordered` nên client chỉ tải khi mở bot/neo lại (§6 mục 29)* | chỉ còn hở khi mất kết nối mà bản ghi mọc **>500 entry** — xem [0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md) §7 |
| 8 | Tự cập nhật client | **chặn: XONG và đã áp** (`sandLab: true`, `--verify` xanh 02/09) · **kênh của mình: chặn bởi CHỮ KÝ SỐ**, không phải bởi mã | giao thức đã moi đủ: [spike-findings.md](../reverse/spike-findings.md) |
| **10** | **Trình duyệt bot lái** | **ĐÃ ĐỔI 02/09** sang Chrome của mình (9224, WebGL, tự lành) — đo: tab mọc đúng bên, CapCut vào được editor | giá còn lại: SwiftShader chậm (2/3 lượt parity chạm trần 900s ở ca cuối) — nếu thành vấn đề thật, cân nhắc quay lại 9223 cho ca không cần WebGL |
| ~~9~~ | ~~Sáu trường bỏ qua~~ **ĐÓNG 02/09** | cả sáu đều không có hệ quả đo được: `branched` không ai đọc, khoá gốc luồng là chuyện nội bộ client | [§8 + §8b](../extracted/0-30-transcript-watch.md) |
| ~~11~~ | ~~4 tool máy-người-dùng còn thiếu so app gốc~~ **XONG 06/09** — `local_write` (write-file, khung `upload`) + `local_shell_bg` (chạy nền sống qua lượt, `backgroundShellSpawnArgs`) đo 7/7 đường model; `send-input`/`forceBackgroundShell` **hãng cũng không có**: daemon không đăng ký handler (§6 mục 33, §7) | — | `node services/grokbot-backend/scripts/e2e-may-nguoi-dung.mjs` |
| ~~13~~ | ~~Gộp `/tai/` vào `/agent/`~~ **XONG 03/09** — bốn bước, đo qua Internet: `/tai/?k=…` → **301** `/agent/?k=…` · `/agent/download/windows?k=…` → `Bot-Noi-Bo-Setup-20260903.exe` (110.552.768 B, sha `66702e2c…` khớp cục bộ, Defender sạch) · không token → gói 50 KB · token sai → 50 KB, **200 không 403** · unit `botnoibo-site` disabled, `:8099` không còn nghe | lùi: khôi phục `cinai-app.bak-*` + `systemctl enable --now botnoibo-site` | — |
| ~~14~~ | ~~Teach: nút `+` đi đường CŨ~~ **XONG 06/09** — nút `+` đi đường VIDEO như hãng, bộ ghi CDP chạy song song làm nhật ký (§6 mục 25) | — | `CDP_APP=http://127.0.0.1:9225 CDP_BOX=http://127.0.0.1:9224 node services/grokbot-backend/scripts/e2e-teach.mjs` |
| ~~15~~ | ~~App gốc đã lên 0.43.0 (05/09) — hợp đồng đã trích vẫn là 0.30~~ **XONG 06/09** — hợp đồng 0.43 ra file riêng `docs/extracted/gateway-commands-0-43.json`: **150** lệnh (+13 / −10 phòng chung so 147 của 0.30); 19 chưa có handler = 6 cũ (5 voice-call + `resolveVirtualCardApproval`) + 13 mới (cookie-origin 3 · form vault 4 · voice 3 · `completeGithubConnect` · `stopCloudAgent` · `uploadAttachmentChunk`); **0/19 client từng gọi** sau một ngày dùng 0.43 (coverage), gateway trả `200 {}` + ghi `unknownPaths`. Schema coordinator (`kiem-reply-0-43`) có đúng 150 khoá = bảng ⇒ validator đã đọc đủ hợp đồng mới | — | viết handler khi `coverage.unknownPaths` báo có người gọi; chi tiết [0-43-so-voi-local.md §9](../extracted/0-43-so-voi-local.md) |
| ~~17~~ | ~~Lên client 0.43~~ **PHÁT HÀNH 06/09** — lên kênh `stable` cho mọi máy (§6 mục 27). **Cổng cuối ĐO XONG 06/09 12:05–12:17 trên máy dev**: đóng 10 tiến trình 0.29 (lọc theo ĐƯỜNG DẪN `Programs\Bot Noi Bo`, app hãng và `C:\cai043` không đụng) → `start-bot.cmd` của bộ cài hỏi feed → tải 106 MB → pha 2 cài → `Grok Bot.exe` 05/09 14:55 + `start-bot.cmd` 06/09 03:49 → mở lại qua `infra\scripts\start-app.cmd`: 9 tiến trình, CDP :9222, hồ sơ `Grok Bot (local)` giữ nguyên (không đăng nhập lại). Hai điều lộ ra: (1) lần mở đầu launcher **bỏ qua** cập nhật vì mốc `.lan-hoi-cuoi` mới 23 h (tiết chế 24 h); lùi mốc 2 ngày rồi chạy lại mới đi. App không mở lại sau `start ""` (cả lần 0.29 lẫn sau pha 2) là do **môi trường đo**: phiên Claude Code trong VS Code mang `ELECTRON_RUN_AS_NODE=1`, Electron chạy như Node rồi thoát im — `run.ps1` gỡ biến ấy (dòng 31) nên mở được, `start-bot.cmd` của bộ cài thì không; nay cả ba launcher phát ra ngoài đều gỡ (`launcher-env.test`), có hiệu lực từ gói dựng kế; (2) **bundle khai `0.43.20260905`** (ngày `patch-client --apply` đóng vào `C:\cai043`) trong khi manifest ghi `0.43.20260906` (ngày TÊN FILE) ⇒ máy vừa cập nhật vẫn nhận 200 — tải lại 106 MB mỗi 24 h. Sửa tay manifest VPS về `0.43.20260905` (đo: `ver=0.43.20260905` → 204, `0.29.20260903` → 200, `0.43.0` → 200); sửa gốc `phienBanTuBundle` (phat-hanh đọc số từ bundle, không tính; từ chối bundle chưa đóng dấu), 3 unit; `patch-client` bỏ dấu ngày UTC | — | `curl "https://cinai.app/agent/updates/ban-moi?nen=windows&ver=0.43.20260905&k=<token>"` → **204** |
| ~~16~~ | ~~`deleteAgent` để lại skill mồ côi trong `workflows.json`~~ **XONG 06/09** — `deleteAgents` gọi `removeForAgent(agentId)` của kho skill (import thẳng, `workflows.ts` không import gì của app nên không vòng); đo sống: bot thử có 1 skill → `deleteAgents` → `getAgentWorkflows{id}` = `[]`, kho toàn cục không đổi số của bot khác. Kèm một bẫy tự gây trong lúc đo: gọi `createAgentWorkflow` với `agentId: undefined` ghi một skill `agentId:""` vào kho THẬT (đã xoá) — bài đo tạo dữ liệu phải kiểm id trước khi ghi | — | unit `workflows.test` 17/17 |
| **19** | **MỞ LẠI 08/09 — bản sửa 06/09 đóng mục này chính là thứ đẻ ra lần đứng hôm nay.** Chủ dự án báo *"app local đang mở bot đang không phản hồi"*. Đo, không đoán: bot **không** kẹt — server có đủ **131 entry**, bot trả lời trọn (cài connector Lark, 19 tool, 3 lượt gọi thật) và hỏi lại bằng widget lúc 11:40:26, còn trả thêm một câu lúc 11:44:01. Cái đứng là **bản sao bản ghi trong client**: `epochHint` đúng lần khởi động hiện hành, `acceptedSequenceHint` **2352 đứng yên**, entry cuối client giữ là `e18231` lúc **11:31:12** — đúng ngay trước tin người dùng gõ. Pane kết thúc bằng ba hàng `nonce:<uuid>`, rồi client chuyển sang banner *Showing saved messages* và gắn *Failed to send* cho cả ba tin. **Ba cách chữa của mục cũ đều TRƯỢT**: tải lại renderer (khác hẳn mô tả 06/09), bấm sang bot khác rồi bấm về, và cho backend khởi động lại — cái thứ ba đáng ghi vì chú thích `sse.ts` khẳng định *"backend khởi động lại = epoch mới = neo lại, không đứng"*, mà đo thì client giữ nguyên epoch cũ: neo lại chỉ kích khi NHẬN được một khung, mà bot đang đứng yên nên không có khung nào. **Gốc tìm ra và đã vá 08/09** — xem §6 mục 44: `turn.ts` đẩy entry của người dùng vào bản ghi mà **không gọi `onUpdate`**, nên tin của chính họ không bao giờ có khung SSE; trước 06/09 client tự tải lại cả đuôi ở mỗi khung nên tình cờ ghép được `clientNonce`, từ khi khung mang `ordered` thì đường ghép duy nhất ấy mất. ~~ĐÓNG 06/09 21:40~~ — `e2e-chia-se-mau` **7/7 ba lượt liền** (21:36 → 21:40, client 0.43 mở với `--disable-backgrounding-occluded-windows`), mốc 4 (thẻ Update vẽ sống) xanh cả ba, `cham.getAgentTranscriptTail` `treo 0` sau 183 lượt; ba lượt đỏ trước đó (21:13–21:18, mốc 3) là cửa sổ bị che → trang `hidden` (§7 "occluded"), không phải bản ghi. ~~Bản ghi sống trên client 0.43 ĐỨNG ngắt quãng~~ (đo 06/09 04:12, một lần trong ~8 lượt hôm nay): entry mới không lên màn dù SSE + tail backend đủ, tải lại renderer là thấy. Client coi khung `transcript` không `ordered` là tiếng gõ → tự tải đuôi; nghi một lượt tải không về giữ `isFetchInFlight` (§7). **SỬA GỐC 06/09 ~07:40** (§6 mục 29): khung `transcript` nay mang `ordered` như app gốc 0.43 → client áp `entry` thẳng, không còn tải đuôi theo từng token (38 → 5 lượt/lượt bot) ⇒ không còn `isFetchInFlight` để mà kẹt. Coi là đóng khi `e2e-chia-se-mau` không tái hiện mốc 4 đỏ qua vài lượt **CỨU ĐƯỢC pane 08/09 ~13:50–14:00, và cách cứu không phải cái tôi đoán.** Bản vá `onUpdate` chỉ chữa tin gửi TỪ ĐÓ, còn pane đang đứng là trạng thái cũ nằm trong replica ĐÃ GHI ĐĨA — mốc ghi cuối của lát ấy là **11:33**, im suốt hai giờ sau. Bảy cách đều TRƯỢT: tải lại renderer · bấm sang bot khác rồi về · backend khởi động lại · **đóng app mở lại** (trạng thái persist nên mở lại không sạch) · xoá bốn hàng *Failed to send* bằng cú bấm thật · `GROKBOT2_TRANSCRIPT_ORDERED=0` · phát hai khung vô hại bằng `reactToMessage` bật-tắt. Thứ cứu được: **đóng app rồi xoá đúng một lát cache** `sand.client.slice.account.<authId>.transcript.replicas.<agentId>` trong `%APPDATA%\Grok Bot (local 043)\sand-client-persistence` (tên tệp base32; sao lưu cả thư mục 33 tệp trước khi xoá — sự thật nằm ở server nên đây là cache, không phải dữ liệu) **rồi cho client neo bằng một trang NHỎ trước**. Vì nửa sau mới là chỗ lạ: sau khi xoá lát, client hỏi đuôi **31 lượt** và **không lưu lại một byte** (lát không mọc lại), pane trống hẳn phần server kèm `plane-inset:leading` — tức nó áp một trang 0 entry. Van tạm hạ trần trang: **cap=1 → vẽ ngay**, rồi 4 → 16 → 40 → 80 → 110 → 130 → 150 → 164 đều vẽ, bỏ van thì pane khoẻ với entry mới nhất `e18296`, banner mất, **0 hàng "Failed to send"**. Nghĩa là replica LẠNH không dựng nổi từ trang 164 entry / 77 KB, nhưng đã neo bằng trang nhỏ rồi thì nhận trọn trang đầy — **chưa biết cơ chế**, và đó là việc còn mở. Công thức khẩn cho lần sau: xoá lát replica + cho một trang nhỏ đi trước. **Backend chưa bao giờ là chỗ hỏng, đo bằng một dòng log tại đúng chỗ quyết định**: mọi lượt của client ra `chu=auth0|grokbot2-user own=true co=164 tra=164`; reply qua schema 0.43 kể cả với ĐÚNG argv client gửi (`getAgentTranscriptTail:{"id":"agent-1078","limit":500}` → 0 sai); `cham` `maxMs 1 · treo 0`. **Hai giả thuyết của tôi bị số đo phản chứng, chép lại để khỏi đi lại**: (1) *quyền chủ* — client đi bằng `saw:"user-ticket"` nên tôi nghi vé phân giải ra chủ khác và `ownsAgent` trả false (reply vẫn hợp lệ mà RỖNG, im lặng); dòng log nói `own=true`; (2) *lỗ chuỗi `seq`* — `seq` suy từ id entry mà id entry là bộ đếm TOÀN CỤC, nên bot nào cũng khuyết (agent-1078: 24 lỗ, bước lớn nhất 47) và `agent-1088` (2 entry, 0 lỗ) là con duy nhất vẽ được ⇒ giả thuyết đẹp; `agent-1085` (45 entry, **21 lỗ**) vẽ đủ và không banner ⇒ phản chứng. Lỗ chuỗi vẫn là chuyện thật đáng nhìn lại (SSE đếm theo ĐỘ DÀI bản ghi, trang đuôi đếm theo ID toàn cục — hai phép đếm cho cùng một replica), nhưng nó KHÔNG phải nguyên nhân lần đứng này. | không chặn người dùng thường (mở lại bot là thấy) nhưng làm bài đo đỏ giả và người dùng "chờ bot" vô ích. **Đồng hồ đã gắn 06/09** (`packages/cursor-acl/src/lenh-cham.ts`, 4 unit): mỗi lệnh gateway đo từ điều phối tới lúc reply đi, log `chậm` khi > 5 s và `CHƯA VỀ` ngay khi qua 30 s, bảng ở `GET /gw/__coverage` khoá `cham` (`treo > 0` ở `getAgentTranscriptTail` = lời giải). Việc kế: lần đứng tiếp theo đọc `cham` TRƯỚC khi tải lại renderer; nếu `treo` = 0 mà pane vẫn đứng thì chỗ treo nằm ở coordinator/IPC của client, không ở backend; phương án xa: phát phong bì `ordered` cho `transcript` (đã thử 08/2026 và làm pane đứng — đọc chú thích `sse.ts` trước) | tái hiện: chạy `e2e-chia-se-mau` nhiều lần, mốc 4 đỏ mà tail có thẻ; xanh khi `n` lượt liên tiếp không đứng |
| ~~18~~ | ~~SỰ CỐ 06/09: tên miền `halcion.vn` mất NS ở đăng ký~~ **ĐÃ VỀ 06/09 trước lúc phát hành** — NS Cloudflare trở lại, dòng `/etc/hosts` tạm trên VPS đã gỡ (§6 mục 27), máy dev chưa từng vá. Trong vài giờ đó DNS công khai trả IP giữ chỗ của VNNIC nên pool + box + VNC "đứt" cùng lúc mà không máy nào hỏng — công thức chẩn đoán (`dig NS` · chứng chỉ · `curl --resolve`) chép ở §7 | — | `dig +short NS halcion.vn @8.8.8.8` có NS; `curl -sI https://admin.halcion.vn/` không exit 60 |
| ~~12~~ | ~~Dải tài khoản box chỉ 5, đã cấp hết~~ **XONG 06/09** — box có **30** tài khoản `gb2u001…030` (10 đã cấp), router đọc dải thẳng từ `/etc/passwd` mỗi lần cấp (thêm `useradd` là đủ, không sửa env/không restart), hết dải trả lỗi có mã `pool-exhausted` → `box-exec.ts` nói câu cho NGƯỜI DÙNG (§6 mục 26) | — | `node --test infra/vps/exec-router.test.mjs` 3/3 · trên box: `journalctl -u grok-exec` dòng `dải tài khoản: 30` |

*Bỏ khỏi bảng vì đã xong (02/09): "mở lớp tự soát sang `subagent`" — đã gắn đủ ba mặt trong
`tools.ts` (`computer`, `automation_write`, `subagent`) và đo 7/7; và "hai ca parity còn lệch" —
nay 0 ca lệch ổn định.*

## 6 · Đã xong — kết luận, không phải nhật ký

| chặng | kết quả |
|---|---|
| 46 · Câu "bị chặn" không nói đường đi; và ĐỌC ĐƯỢC cơ chế của cửa replica lạnh | **XONG 08/09** (chủ dự án duyệt cả ba việc). **(a) Widget treo 7 tiếng của `CinAI Email` đã trả lời** — bot hỏi "cần vào n8n mới đọc được danh sách workflow, đi đường nào" từ 11:14, cả mạch đứng ở đó. Đo trước khi chọn: **không có khoá n8n ở đâu cả** (`.env` 0 biến, `box-secrets` rỗng, 7 MCP không có n8n), còn n8n thì **có thật trên box** (cổng 5678, container `n8n`) ⇒ cả ba đường đều khả thi và đường API key là rẻ + bền nhất. Trả lời qua `respondToWidget{agentId,entryId,value}` kèm dặn *xin khoá bằng `request_secret`, đừng nhận khoá qua chat*: lượt chạy tiếp, bot phát đúng thẻ `secret-request` (`e18385`) — **khoá không đi qua bản ghi** (`submitSecret` cố ý không lưu giá trị). Cái chờ ấy park dưới kind `widget` nên **sống qua nạp lại** (kiểm `SELECT * FROM parked` trước khi sửa `src`, đúng cổng an toàn). **(b) Câu từ chối của daemon nay CHỈ ĐƯỜNG**: `runtime/chi-duong-ngoai-goc.ts` (module THUẦN, không import gì — `tools.ts` kéo pool + box nên bài đo không nạp được) nối một câu vào đúng ca `outside the allowed local-exec root`, nêu `local_shell` + ví dụ + **nói rõ mỗi lệnh vẫn hỏi người dùng bằng thẻ** (để model không đọc thành đường tắt bỏ qua quyền). Gắn ở CẢ HAI nhánh lỗi của `local_read`, và **cố ý KHÔNG gắn cho `local_write`** — đi vòng một hàng rào GHI là quyết định của chủ dự án, không phải của một câu báo lỗi; bài đo ghim đúng điều phủ định ấy bằng cách đọc mã. 6 unit `chi-duong-ngoai-goc.test`, 806/806, tsc sạch. **(c) Việc thứ ba: đọc renderer và ĐỔI được kết luận** — xem §8. Kèm nghiệm thu trên màn hình mà lượt trước chưa lấy được: người dùng mở `agent-1078` (con từng đứng) → pane vẽ 17 hàng, **0 banner, 0 *Failed to send***; và neo lành ở mọi bot đang dùng (`agent-1087` 155 · `agent-1084` 113 · `agent-1078` 172). **LÊN VPS `20260908-125354`** sau khi chủ dự án duyệt: health 200 · `/app/` 200 · `kiem-reply-0-43` 29/29 · cửa ops 401/401 từ Internet · nghiệm thu trên CHÍNH bản đang chạy (module thuần có mặt, 3 lần gọi trong `tools.ts`) — tức bot của người dùng ngoài đó cũng thôi phải mò đường khi đọc tệp ngoài thư mục gốc |
| 45 · Lượt bị cắt để lại khối `TOOL_CALL` thô; và bật lại `ordered` sau lượt chẩn đoán | **XONG 08/09** (chủ dự án duyệt cả hai). **(a)** Người dùng gửi ảnh: bong bóng của bot bày nguyên `TOOL_CALL: message_agent({"to":[…],"content":"app_token: …` rồi `⏹ (bị ngắt giữa chừng)`. Không phải bug mới — đó là **dấu vết của một lượt bị giết**, và người giết là tôi: entry `e18296` lúc 13:22:09, backend khởi động lại 13:22:11 (tôi bật cửa thoát khẩn). Khối JSON chưa đóng ngoặc nên `parseToolCalls` không khớp ⇒ nó không chạy và nằm lại thành CHỮ; `migrate()` đóng dấu ⏹ ở lần nạp kế. Đếm cả 164 entry: đúng **1** entry mang dấu ngắt, đúng **1** entry còn `TOOL_CALL` thô — cắt một lượt, không nhiều hơn. Việc mất thật: hai bot con chưa nhận token + 4 ID bảng; phát lại một lượt (`sendPrompt` "gửi lại tin…") thì `message_agent` đi đúng đường tool (`e18299`), cả hai bot con nhận đủ `app_token` và tự bắt việc. **Sửa**: `incompleteToolCallStart()` trong `tool-calls.ts` (anh em của `hasIncompleteToolCall`, nhưng trả CHỖ CẮT — không nhận `known` vì người gọi duy nhất là lúc NẠP bản ghi, nơi bảng tool không với tới được), `migrate()` cắt phần dư rồi mới đóng dấu; cắt xong không còn chữ nào thì bỏ hẳn entry. **Và một nhánh thứ hai, phát hiện bằng cách ĐO chứ không tin bản sửa**: entry đã đóng dấu ở lần nạp TRƯỚC có `streaming=false` trên đĩa nên nhánh kia không chạm tới — `e18296` vẫn 1600 byte sau khi deploy bản sửa. Nay dùng chính dấu ⏹ làm điều kiện dọn (bot nhắc `TOOL_CALL` trong lời giải thích thì không có dấu ấy nên không bị cắt oan). Đo sống sau khi nạp lại: `e18296` **1600 → 94 byte**, hết `TOOL_CALL`, hết `app_token`, còn đúng một dấu ⏹. 10 unit `luot-bi-cat-du-tool-call.test` (4 bài trên hàm thuần + 6 bài trên `migrate` qua export `_migrateForTest` — đo HÀNH VI, không đọc mã như bài cũ). **(b)** Gỡ `GROKBOT2_TRANSCRIPT_ORDERED=0` khỏi `.env`; `.env` chỉ đọc lúc khởi động nên phải ép một lần nạp lại. Đo: khung `transcript` mang lại `{replicaKey, epoch, sequence}` (seq 171→172), 0 lượt model (dùng `reactToMessage` bật-tắt hai lần, net-zero — kiểm lại: 0 entry còn phản ứng). **Cổng an toàn trước khi sửa `src`**: hỏi `/gw/health.isBusy`, và khi nó đứng `true` 17 phút thì đọc tiếp thay vì chờ mù — hoá ra một lượt đang ĐỖ chờ thẻ quyền (`req-51`/`req-53`, `local_read` trên máy người dùng, chờ 45 phút không ai bấm). Lượt đỗ nằm trong bảng `parked` kind `approval` **trên đĩa** nên nó sống qua nạp lại — đo bằng `SELECT * FROM parked` chứ không suy. 801/801, tsc sạch. **LÊN VPS `20260908-090512`** (`1bcf6d8`) sau khi chủ dự án duyệt: health 200 · `/app/` 200 · `kiem-reply-0-43` 29/29 · cửa ops 401/401 từ Internet. **(c) Công thức 3 bước cho pane: đã chạy, và nó KHÔNG đủ một mình** — xem §8 (đặt `ORDERED=0` + nạp lại + một khung thì client reset và tải đuôi **3 lần**, `treo 0`, mà replica **không nhận một byte**; phải hạ trần trang xuống 1 entry mới neo được). Sau khi neo: `agent-1078` đi từ `e18296` → **`e18306`** (đúng 10 entry chủ dự án nêu), `epochHint` từ **`null`** thành có giá trị, `acceptedSequenceHint` **172**. Dọn trọn: phép đo tạm gỡ bằng `git checkout`, hai dòng thêm vào `.env` đã xóa, `ordered` bật lại (khung mang `{replicaKey, epoch, sequence}`, seq 171→172), trang đuôi trả lại đủ 170/170 |
| 44 · Tin của NGƯỜI DÙNG không phát khung SSE — bong bóng treo "Failed to send", pane đứng vĩnh viễn | **XONG 08/09** (chủ dự án báo *"app local đang mở bot đang không phản hồi"*). Bot không hỏng, không mất gì: server đủ **131 entry**, bot trả lời trọn và hỏi lại bằng widget. Cái đứng là replica của client — `acceptedSequenceHint 2352` đứng yên, entry cuối `e18231` lúc 11:31:12, pane kết thúc bằng ba hàng `nonce:<uuid>`, banner *Showing saved messages*, ba tin *Failed to send*. **Tái hiện trên bot thử, một lượt**: `sendPrompt` trả `200 {accepted:true, entryId:"e18262"}`, bản ghi có đủ hai entry, mà SSE chỉ phát khung cho entry của BOT (`e18263`, seq 3) — **không khung nào cho `e18262`**; chuỗi `ordered` **0 chỗ nhảy**, tức server không phát lệch, nó chỉ không phát. Gốc: `turn.ts` `t.push(userEntry)` không kèm `onUpdate(agentId)` — mọi chỗ đăng entry khác trong file đều có. **Vì sao im nhiều tháng rồi bật lên, và đây là phần đáng chép**: khi khung `transcript` chưa mang `ordered`, client coi mỗi khung là tiếng gõ cửa rồi tự tải lại cả đuôi, nên nó gặp entry của chính mình ở lượt tải kế và ghép được `clientNonce`; từ 06/09 khung mang `ordered` (mục 29) client áp `entry` thẳng và THÔI tải đuôi ⇒ đường ghép duy nhất ấy mất. Tức bản sửa đóng §5 mục 19 chính là thứ mở ra lỗi này — nay mục 19 **mở lại**. `acceptance` map với chú thích *"the composer's poll confirms the bubble"* KHÔNG cứu được: client 0.43 **không gọi lệnh nào** để hỏi (trong `coverage.calls`, lệnh duy nhất mang chữ "prompt" là `sendPrompt`) — một cơ chế dựng cho không ai, đúng họ bẫy "trường có trong hợp đồng ≠ trường có người ĐỌC". Sửa: một lời gọi `onUpdate` sau khi push, có điều kiện `!args.silent && t.length > truocKhiDay` (phát khung cho một entry không tồn tại là đẩy client tới entry CŨ và tiêu một số thứ tự cho không gì). **Đo lại cùng bài**: khung đầu tiên nay là `e18264` `role:"user"` mang `clientNonce`, seq 2→3→4, 0 chỗ nhảy. 3 unit `tin-nguoi-dung-phat-khung.test` đọc mã (turn.ts kéo pool+box nên không nạp được). 791/791, tsc sạch. Kèm một bài đo của chính tôi báo đỏ giả hai lượt: parser SSE tìm dòng `event:` trong khi khung là `data: {"channel":…,"payload":…}` — lại đúng luật "một bộ đo báo đỏ thì nghi bộ đo trước". **LÊN VPS `20260908-070327` lúc 08/09 ~14:03** (chủ dự án: *"làm luôn cho mình"*): 791/791 trước khi đóng gói, health 200, `/app/` 200, `kiem-reply-0-43` 29/29, cửa ops vẫn 401/401 từ Internet. Và nghiệm thu **trên chính VPS** chứ không suy từ máy dev — bot thử `agent-75`, SSE mở TRƯỚC khi gửi (đo trên box để không đi qua Cloudflare, đường buffered): `sendPrompt` → `{accepted:true, entryId:"e1293"}` → khung đầu tiên `e1293` `kind:message` `role:"user"` mang đúng `clientNonce`, khung thứ hai là câu bot `e1294`, seq 2→3; bot thử xoá ngay. Tức mỗi tin người dùng ngoài đó nay có khung xác nhận |
| 43 · E2E "người mới đăng nhập lần đầu, máy local nối lần đầu" — và cửa `/internal/ops/` mở toang cho cả Internet | **XONG 08/09** (chủ dự án: *"tiếp theo làm gì test được E2E trên máy local khác khi lần đầu login kết nối computer máy local"*). Bài đo `scripts/e2e-may-lan-dau.mts` chạy **không cần máy thật thứ hai**, nhờ hai chi tiết đo được: `ensureSandBox` chỉ là hàm DỰNG (đóng `mintTicket(authId)` vào trường 11 rồi thôi — không chờ box, không chờ mạng) nên vé đúc được ngoài app bằng CHÍNH `mintTicket`, không chép lại công thức chữ ký; và máy local nối vào bằng HTTP thuần — SSE `GET /gw/local-exec/requests` → khung `welcome` mang `providerId` → `POST /gw/local-exec/responses` một khung `hello`, không gì trong đó cần Windows. 16 mốc, 7 phần: bảng của người vừa đăng nhập lần đầu **rỗng** (không 401, không máy của ai khác) · nối vào thì hiện đúng một máy với `isCurrent` · bảng của A không có máy của B · A đổi tên máy B bị từ chối **byte-identical** với máy không tồn tại · B đổi tên máy mình được và tên người đặt thắng tên daemon khai · B chỉ đích danh máy của A bị từ chối · rút SSE rồi máy vẫn còn trong sổ "đã từng nối". Không phủ được bốn thứ (runbook `docs/runbooks/may-thu-hai.md`): bộ cài trên Windows sạch · daemon THẬT của hãng gửi `hello` · `computerId` do client tự đúc · hai máy nối cùng lúc (T5). **Và bài đo làm đúng việc của nó: mốc 6 ĐỎ, và đỏ vì một lỗ thật.** Vé của B, chỉ đích danh `DESKTOP-7D2FJG8` của A, chạy `hostname` **trên máy A**, exit 0. Gốc thứ nhất: hai hàm suy chủ đọc hai tập giấy tờ khác nhau — `ownerFromAuth` (JWT → vé → mặc định) cho `/gw`, `ownerFromRequest` (JWT → cookie → mặc định) cho `/internal/ops/` và `lamTrenTrinhDuyet`; cụm cô lập máy (mục 39) bịt đường tool và đường `/gw`, cửa ops đi bằng hàm KHÁC nên vẫn rò — cùng họ với "hai mặt SSE". Truy tiếp bằng một phép dò **không chạy gì** thì lộ gốc thứ hai, nặng hơn nhiều: cửa `/internal/ops/` **không hỏi giấy tờ gì cả**, và nginx VPS có `location /agent/ { proxy_pass http://127.0.0.1:8788/; }` ⇒ `curl -X POST https://cinai.app/agent/internal/ops/local-exec -d '{"kind":"shell","command":"hostname"}'` từ Internet, không header nào, chạy lệnh shell trên máy Windows của người dùng và câu lỗi còn khai tên máy đang nối. Chú thích cũ ở chỗ ấy ghi *"loopback — this server binds 127.0.0.1"*: đúng chữ, nhưng nginx chạy TRÊN CÙNG MÁY nên `bindHost` là một địa chỉ, không phải một biên giới. Sửa ở CẢ HAI tầng vì mỗi tầng đủ để rò: `ownerFromRequest` đọc vé (`ownerOfTicket` trước cookie), và cửa ops đòi giấy **không phụ thuộc `GROKBOT2_AUTH`** — phép quyết định tách thành `giayDuChoOps(saw)` trong `auth-gate.ts`, viết theo hướng CHO PHÉP (thêm một `saw` mới thì mặc định là bị từ chối), 401 với câu cố ý mơ hồ *"cần Authorization"* (câu chi tiết ở cửa này là bản đồ cho người đang dò). 8 unit `cua-ops-doi-giay.test` ghim cả hai nửa. **Đo sống sau khi sửa**: không giấy → **401**; vé hợp lệ của B chỉ đích danh máy A → **404 "không có máy nào tên …"**, không lệnh nào chạy; vé của chủ → **200** `DESKTOP-7D2FJG8`. `e2e-may-lan-dau` **16/16**, chạy hai lượt liền. Kèm một bẫy bài đo tự gây và đã sửa: mốc "người mới bảng rỗng" đo bằng chính B, mà `MAY_B` là hằng số nên lượt chạy THỨ HAI thấy hàng cũ của B trong sổ "đã từng nối" — đúng thứ mốc 7 ghim — và đỏ. Nay mốc ấy dùng một danh tính mới tinh mỗi lượt **chưa từng nối gì** (không để lại hàng sổ nào), còn bảng của B chỉ ghim "không bao giờ chứa máy của ai khác". Hai bài E2E cũ gọi cửa ops (`e2e-may-nguoi-dung`, `e2e-chep-tep`) nay đọc vé từ `.data/gateway-token.txt`. 788/788, tsc sạch. **LÊN VPS `20260908-040549` ngay trong lượt** (`51d04d9`; lùi: `bash /opt/grokbot2/bin/rollback.sh`) — và đo lại từ Internet đúng cái request đã chạy được: `POST https://cinai.app/agent/internal/ops/local-exec` không header → **401**; Bearer bịa đặt → **401**; `/internal/ops/routines` không giấy → **401**, có vé của người vận hành → **200** (cửa ĐỌC, không chạm máy nào — cố ý chọn phép thử không chạy lệnh trên máy người dùng thật). Cổng sau deploy: health 200 · `/app/` 200 · `kiem-reply-0-43` **29/29 · 0 sai**
| 42 · Phát hành `0.43.20260907` — đưa bản vá vé người dùng tới máy đã cài; và đo nốt hai đường ghi của bảng | **XONG 08/09** (chủ dự án duyệt cả hai việc). **(a) Đo `updateSandMachineLabel` SỐNG**: lái qua cầu thật của client (`window.desktop.cursorAccount.updateMachineLabel`, CDP :9225) với **đúng tên máy đang có** — đo đường đi, không đổi trạng thái — ra `saw:"user-ticket"`, reply đúng bản ghi. Trước đó `cursorAccount.getMachines()` trả đúng dữ liệu backend mình, tức cầu ấy CHÍNH là cầu đã vá. **(b) `updateSandMachineLocalToolPermission` KHÔNG đo được, và lý do là một phát hiện**: `desktop.localToolPermission.set("always")` đi `setHostSettings` (41→42 lời gọi) chứ không gọi lệnh quyền-máy; dò sâu toàn bộ `window.desktop` không có cửa nào cho nó; đếm trong bundle thì **renderer 0.43 có 0 lần** nhắc `updateSandMachineLocalToolPermission`/`updateMachineLocalToolPermission` (so với `getSandMachines` 4 và `updateSandMachineLabel` 4), và **renderer 0.29 cũng 0**. Tức `computer-tab-permission` là bản vá cho một lệnh **không renderer nào gọi** — không hại, nhưng là "cơ chế cho không ai"; giữ lại vì gỡ ngay trước một lượt phát hành là rủi ro đổi lấy con số 0. Cùng họ với §6 mục 35: quyền chạm máy của client 0.43 đi bằng `setHostSettings`, không bằng lệnh máy. **(c) Phát hành**: `npx tsx phat-hanh.mjs --kenh stable --with-app --len-vps` với `GROKBOT2_CLIENT_DIR=C:\cai043` → manifest `0.43.20260907` (đọc từ BUNDLE, không tính — cảnh báo "tên gói mang ngày 20260908" đúng như thiết kế sau bẫy 06/09). **Đo từ Internet**: máy ở `0.43.20260905` → **200** `Bot-Noi-Bo-Setup-20260908.exe` sha `434c2a23…`; máy đã ở `0.43.20260907` → **204**; máy 0.29 → 200. Băm khớp ba nơi (manifest = file cục bộ = file trên VPS). **(d) Đo NỘI DUNG gói, không tin bước dựng**: 7-Zip 26.02 không mở được Inno mới nên cài thử `/VERYSILENT /DIR=` vào thư mục vứt đi (an toàn với client đang mở: bộ cài không khai `CloseApplications`/`AppMutex`, và cài sang thư mục khác nên không khoá file nào) → gói phát ra mang **5 lần `__grokbot2_ve`**, thân `computer-tab-ipc` đọc vé, `patch-client --verify` **xanh trọn trên chính gói đã phát**, `package.json` `0.43.20260907`, `backend.txt` = `https://cinai.app/agent/`. Bản cài sạch **580 file / 394 MB** (bản production 871 file là rác tích tụ của các lần cài đè, không phải gói thiếu). Dọn: xoá thư mục thử, **trả lại khoá registry** `…BOT2NOIBOFULL` (bộ cài dùng chung AppId nên `/DIR=` có ghi đè nó — sao lưu bằng `reg export` trước, kiểm sau khi trả). **Lùi**: sửa `stable.version` trong `/opt/grokbot2/shared/data/phat-hanh.json` về `0.43.20260905`, gói cũ còn trong `dist/`; launcher chỉ nhận bản MỚI HƠN nên máy đã cập nhật phải chạy tay gói cũ |
| 41 · Bảng Computer đi bằng vé NGƯỜI DÙNG — đo trên giao diện (§5 mục 20) | **XONG 08/09** — đo được: `/gw/api/getSandMachines` → **`saw:"user-ticket"`**, hai lượt mở liên tiếp, với môi trường tiến trình **KHÔNG có** `GROKBOT2_GATEWAY_TOKEN` (đúng cảnh máy tải về: biến ấy chỉ `run.ps1` đặt). Reply không rỗng: một máy `DESKTOP-7D2FJG8`, `isCurrent:true` khớp `currentMachineId` client tự khai; sổ máy còn đúng một hàng có `owner=auth0\|grokbot2-user`. Cách đo: mở tay `Grok Bot.exe` với đúng bốn biến `run.ps1` đặt **trừ** vé dùng chung (gỡ cả `ELECTRON_RUN_AS_NODE`, §7) — vì thân mới chỉ CHỜ vé khi không có biến fallback, nên đo với biến ấy còn thì kết quả không kết luận được gì. **Nhưng lượt đo mở ra một lỗ to hơn thứ đang đo**: bản vá `computer-tab-{ipc,label,permission}` viết lại thân ngày 07/09, còn `--verify` thì kết luận "applied" chỉ bằng *có marker + hết neo* — mà thân CŨ đã nuốt neo, nên nó báo XANH cho ba bản vá đang đọc `process.env.GROKBOT2_GATEWAY_TOKEN`, tức chưa bao giờ biết tới vé. Đúng ba bản cài trên máy này đều thế: bản dev `Programs\Bot Noi Bo 043`, **và bản ĐANG PHÁT HÀNH `Programs\Bot Noi Bo`** (`__grokbot2_ve` xuất hiện **0** lần, `GROKBOT2_GATEWAY_TOKEN` **3** lần). Sửa máy vá: `infra/patches/than-hien-hanh.mjs` — máy vá là `split(find).join(replace)` thuần chữ nên sau một lần áp, `replace` phải nằm NGUYÊN VĂN trong file; không biến thể nào có thân trong đó ⇒ thân do bản `patch-client` cũ đặt vào ⇒ ĐỎ, kèm câu nói đúng việc phải làm (không mời chạy lại `--apply`, vì bản tự chứa không có asar để trích và vá đè cũng không được — neo đã mất). Đo hai chiều: `C:\cai043` vừa áp trọn → xanh cả 10 mốc (nên phép kiểm không quá chặt), hai bản kia → đỏ đúng ba chỗ. Sửa bản dev bằng cách chép `resources/app` của `C:\cai043` sang (474 file / 35,3 MB, cùng bundle khác thân; bản lùi ở `resources\app.bak-20260908`) → `--verify` xanh trọn, mở lại, đo lại `saw:"user-ticket"`. 7 unit `patch-than-hien-hanh.test` (ghim chiều FALSE + hai ca dùng CHÍNH bản vá đang phát hành), 780/780, tsc sạch. **Còn lại và là quyết định của chủ dự án**: mọi máy đã cài bản 06/09 vẫn mang thân cũ ⇒ bảng Computer ở đó vẫn gửi `Bearer ` rỗng → 401 → trống. Chỉ một lần PHÁT HÀNH mới đưa bản sửa tới họ |
| 40 · `listAgents` trượt schema 0.43 ngay khi có bot đang chờ | **XONG 07/09** — lộ ra ở cổng sau khi deploy mục 39: `kiem-reply-0-43` đỏ **1/29** ở `listAgents`, câu báo `awaitingUserResponse: anyOf(required since | type null)`. Kiểm TRƯỚC khi đổ cho bản vừa deploy: tái hiện y hệt trên backend dev ⇒ lỗi có sẵn, và nó phụ thuộc **TRẠNG THÁI DỮ LIỆU** chứ không phụ thuộc bản. Gốc: `SandAgentAwaitingState` đòi `required:["reason","since","tabId"]` với `additionalProperties:false`, còn `turn.ts` chỉ đặt `{reason}` — nên mỗi khi có ít nhất một bot đang chờ, cả `listAgents` bị coordinator 0.43 coi là **LỆNH HỎNG** (HTTP 200, không log) và sidebar không vẽ được. Hai bot dính là `agent-1070`/`agent-1071` — đúng hai hàng *"Waiting for you"* trong ảnh chụp chủ dự án gửi đầu lượt, tức người dùng đã nhìn thấy triệu chứng trước khi bài đo thấy. Sửa ở HAI cửa, cố ý: `setPresence` hoàn thiện lúc ĐẶT (`since` = giờ đặt), và `summarise` hoàn thiện lại ở cửa DÂY cho bản ghi đã nằm trên đĩa từ trước — mốc của cửa dây lấy `updatedAt` (entry cuối) chứ không `Date.now()`, vì tính lại lúc đọc thì mỗi nhịp client hỏi roster là mốc chờ nhảy về hiện tại. `tabId` để chuỗi rỗng: của hãng nó trỏ tab trình duyệt trong luồng auto-review, bên ta không có tab nào và bịa một id là bịa dữ liệu. 4 unit trong `awaiting.test` (đủ ba khoá · mốc đứng yên qua nhiều lượt đọc · bản ghi cũ chỉ có `{reason}` vẫn ra dây đủ · `null` vẫn là `null`). Đo: `kiem-reply-0-43 listAgents` **0 sai** trên dev với đúng hai bot đang chờ ấy. **Lên VPS `20260907-164759`** (kèm cả cụm mục 39): health 200 · `/app/` 200 · `kiem-reply-0-43` **29/29 · 0 sai** — và lượt này KHÔNG xanh vu vơ: VPS đang có `agent-45` chờ thật, `{reason,since,tabId}` đủ ba khoá. Hàng ấy là bản ghi CŨ từ 06/09 và `since` ra **1788671418919 = 35,7 giờ trước**, tức nó đi đường hoàn thiện ở cửa DÂY và lấy `updatedAt` — nếu lấy `Date.now()` thì mốc đã là hiện tại
| 39 · Máy người dùng cô lập theo NGƯỜI DÙNG — và sổ máy thôi tự dựng `../.data` | **XONG 07/09** (chủ dự án hỏi: *"kiểm tra computer khi download ở trên máy khác khi login vào lần đầu không có đoạn ghép với máy tính ở local"*). Đúng — **không có bước ghép nào**, và nó hỏng theo hai kiểu tuỳ chế độ auth. Đo trước khi sửa: `getSandMachines` với `Bearer ` rỗng (đúng cái máy tải về gửi, vì `GROKBOT2_GATEWAY_TOKEN` **chỉ** do `infra/scripts/run.ps1` đặt — launcher phát ra ngoài không có) → **401**, bảng trống; nếu ai hạ về `warn`/`off` → **200 và bảng hiện máy của MỌI người**. Nhưng chỗ nặng hơn không ở bảng mà ở ĐỊNH TUYẾN: `mayDangNoi` là `Map` toàn cục + một file JSON duy nhất, `connectedMachine()` là "máy mới thấy nhất TOÀN HỆ", `findMachine` khớp cả tên rút gọn (`label.includes`) — nên bot của người B có đường gọi tên máy Windows của người A, và hàng rào còn lại chỉ là `standing` của daemon: một cài đặt theo MÁY, không theo NGƯỜI. `host-settings.ts` ngay cạnh đã làm đúng chuyện này từ trước (`byOwner[ownerId]`); sổ máy là thứ bị bỏ lại. **Danh tính vốn đã ở đúng chỗ** — `/gw/local-exec/requests` và `/responses` tới với `saw:"user-ticket"` (coverage: 1 luồng + 135 lượt), và `index.ts` bọc CẢ `handleGateway` trong `runWithOwner`, nên `currentOwner()` đọc được ngay tại lúc `hello` tới; không phải kéo dây gì. Sửa: `UserMachine` + `MayDaBiet` mang `owner`; `connectedMachine`/`connectedMachines`/`findMachine`/`userComputerConnected` **ĐÒI** owner (bắt buộc, không mặc định "tất cả" — chỗ nào quên là `tsc` đỏ, và chính nó lôi ra hai file tôi chưa nghĩ tới: `chep-tep.ts`, `local-browser.ts`); `runOnUserComputer` đòi `opts.owner`; mọi tool đi qua `chuLuot(ctx) = ownerOf(ctx.agentId)` chứ KHÔNG `currentOwner()` (lượt chạy tách khỏi request — cùng luật với trần lượt mục 38); `localProtocol(owner)` vì nó tiêm TÊN MÁY vào system prompt, tức bot người B từng được dạy tên máy người A; ba cửa gateway đóng `currentOwner()` tại chỗ trong `gateway.ts` để `cursor-acl` không phải biết khái niệm owner. Hàng sổ cũ **không có** `owner` thì bị BỎ lúc nạp, không gán cho danh tính mặc định: gán là leak y như cũ dưới một cái tên khác, còn bỏ thì bảng trống đúng vài giây rồi daemon tự điền lại. **Đo sống, hai danh tính THẬT, máy A đang nối**: A (mặc định) `hostname` → `DESKTOP-7D2FJG8` exit 0; B (`local|e2e-b@vi-du.vn`, JWT thật) → bảng Computer `[]`, `local-exec` **từ chối** cả khi gọi mù lẫn khi chỉ đích danh `DESKTOP-7D2FJG8`, `updateSandMachineLabel` lên máy của A **không đổi gì**; A đổi tên máy của mình vẫn được. Câu từ chối của "máy người khác" giống HỆT câu của "máy không tồn tại" — một câu khác đi là xác nhận id ấy có thật ở đâu đó. **Kèm một lỗ khác lộ ra và đã vá**: `may-da-biet.ts` ghim `join(HERE,"..",".data",…)` như hằng số, nên `may-da-biet.test.ts` gọi `nhoMay({computerId:"cu"})` ghi thẳng một máy **"Máy cũ"** vào sổ THẬT — hàng rác mang dấu thời gian 21:28:09 của lượt chạy 764/764, và người dùng thấy nó trong ảnh chụp bảng Settings của chính mình. Nay đọc `dataDir()` (một nguồn sự thật, đã biết `NODE_TEST_CONTEXT`) + `GROKBOT2_MAY_DA_BIET_FILE` cho bài đo tự `mkdtemp` vô điều kiện. Hàng rác tự biến mất ở lượt nạp kế vì nó không có `owner`. 5 unit mới (`may-da-biet.test` cô lập theo chủ + đổi chủ cùng id), 769/769, tsc sạch. **Còn mở, và là chỗ hở của BẢN VÁ chứ không của backend**: `computer-tab` gọi `getSandMachines` bằng vé DÙNG CHUNG (`GROKBOT2_GATEWAY_TOKEN`), mà vé cũ thì `ownerOfTicket` trả `null` ⇒ `currentOwner()` ra danh tính mặc định. Trên máy dev hai thứ trùng nhau nên bảng vẫn đúng (đo: 1 máy, `isCurrent:true`); muốn bảng đúng cho NHIỀU người thì bản vá phải đi bằng vé của người dùng — đã sửa ở bản vá (`computer-tab-ve` cất vé lúc `buildConnection` đúc ra nó, §5 mục 20). **Lên VPS `20260907-162928`**: health 200 · `/app/` 200; sổ máy trên VPS có **6 hàng KHÔNG hàng nào có `owner`** — chính cái leak này, dưới dạng dữ liệu sản xuất — cả 6 bị bỏ lúc nạp, và một máy đã tự đăng ký lại mang authId của một người dùng THẬT (không phải danh tính mặc định), tức `currentOwner()` lúc `hello` phân giải đúng theo người ở nơi có nhiều người thật |
| 38 · Trần lượt song song theo NGƯỜI DÙNG — việc cuối của roadmap đa người dùng | **XONG 07/09** — `multi-tenant-roadmap.md` chỉ còn đúng một việc mở: *"cô lập turn/inflight theo user"*. Đo lại trong mã: `inflight` khoá theo `agentId` nên nó chặn "hai lượt cùng viết vào một bot" và **không chặn gì ở tầng người** — một chủ có 10 bot mở được 10 lượt pool song song. Vô hại suốt thời gian `GROKBOT2_AUTH=off` vì mọi request là một danh tính; từ 07/09 `enforce` bật thì "nhiều người" thành chuyện đo được mà không ai giữ cửa. Sửa: `runtime/tran-luot.ts` — module THUẦN, tiêm được cả nguồn chủ lẫn danh sách đang chạy (`turn.ts` kéo pool+box+SQLite nên bài đo không được nạp nó, bẫy §7); `quaTranLuot()` đếm lượt của CÙNG CHỦ và **tự loại bot đang gửi** (`sendPrompt` đã đặt controller cho nó trước khi `startTurn` chạy — đếm cả nó thì trần 1 chặn mọi lượt đầu tiên); `GROKBOT2_MAX_TURNS_PER_USER` mặc định **4** vì đó là số lượt song song CÓ THẬT của một "đội" 4 bot con mà chính dự án dựng (§2), `0` = tắt. Cắm trong `startTurn` cạnh cửa billing, cùng ba tính chất: chủ lấy bằng `ownerOf(agentId)` (lượt chạy tách khỏi request nên `currentOwner()` ở đây là danh tính mặc định), quyết trước khi tốn gì, và từ chối bằng `postNotice` chứ không bằng miệng con bot. **Hai điều cấu trúc, cả hai đã khoá bằng bài đọc mã**: (1) `runTurn` KHÔNG hỏi trần — `continueAfterTool` gọi thẳng nó nên lượt nối tiếp luôn chạy hết, không bị cắt giữa đường; (2) cửa trần nằm TRƯỚC `await` đầu tiên của `startTurn` — đó là thứ làm nó không có đua: `void startTurn(...)` chạy phần đồng bộ ngay trong cùng nhịp với `inflight.set`, nên hai lượt gửi song song được quyết lần lượt; đẩy nó xuống sau một `await` thì 5 lượt cùng lúc sẽ CÙNG bị từ chối thay vì cho 4 qua. **Đo sống với trần hạ tạm về 1**: hai bot cùng chủ, gửi `Promise.all` — bot 1 chạy trọn lượt (đếm 1→20), bot 2 nhận `kind:"notice"` *"Bạn đang có 1 lượt chạy cùng lúc, trần là 1…"* sau **5 ms** (dấu thời gian 539170 → 539175), bong bóng rỗng `streaming:false`, **0 lời gọi pool**. 11 unit `tran-luot-moi-nguoi.test`, 764/764, tsc sạch. Một bẫy bài đo tự gây: lượt đọc đầu lọc `kind:"send-message"` nên báo "không có notice" — notice là `kind:"notice"` (§7). Chưa lên VPS |
| 37 · Desktop `:77` sống qua reboot — bảy unit thành file thật | **XONG 07/09** (theo lệnh chủ dự án *"viết bảy unit đó thành file thật để chúng sống qua reboot"*) — bảy unit dựng màn hình box trước đây là **transient** (`/run/systemd/transient/`, mất khi reboot, không ai sở hữu). Nay là bảy file trong repo `infra/box/systemd/` → scp vào `/etc/systemd/system/` → `enable --now`: `grok-xvfb-77` (root, Xvfb :77, `ExecStartPost` chờ `/tmp/.X11-unix/X77`) và sáu con chạy user `box` (`grok-wm-77` xfwm4 · `grok-picom-77` compton · `grok-dock-77` plank · `grok-term-77` xfce4-terminal · `grok-files-77` thunar · `grok-chrome-77` google-chrome CDP 9223), mỗi con `Requires=grok-xvfb-77` + `ExecStartPre` chờ socket X + `Restart=always` + `WantedBy=multi-user.target`. Đo: 7/7 `active enabled`, 0 unit transient còn lại, VNC + noVNC `active`, cổng 5977/7077/9223 nghe, ảnh chụp `:77` vẫn đúng dock 3 icon của mục 36. **Một lỗi thật lộ ra ngay lúc bật** và đó là phần đáng chép: `grok-term-77` báo `activating` chứ không `active`, và `NRestarts` đã lên **96** — `ExecStart=… --title=Grok Bot box` không có nháy, systemd tách theo khoảng trắng ⇒ `xfce4-terminal: Unknown option "Bot"` ⇒ `Restart=always` dập 3 s một lần. Sửa: nháy quanh title + `--disable-server` (thiếu nó terminal giao việc cho tiến trình server rồi tự thoát, systemd lại dập). Sau sửa: `active`, `NRestarts=0`, đúng 1 tiến trình `xfce4-terminal`, cửa sổ có dấu nhắc thật trên ảnh chụp. Hoàn tác: `systemctl disable --now` bảy unit + xoá khỏi `/etc/systemd/system/` (transient cũ không cần dựng lại — reboot là mất) |
| 36 · Dock màn hình box khớp bố cục app gốc | **XONG 07/09** — chủ dự án đối chiếu hai ảnh: app gốc có **1 Chrome + 2 ứng dụng khác**, local có **3 Chrome**. Không phải app vẽ sai: bảng "màn hình của bot" chiếu display `:77`, và dock ở đó là **Plank chạy dưới user `box`** (`grok-dock-77.service`, transient). Đọc `/home/box/.config/plank/dock1/launchers`: hai tệp `com.google.Chrome.dockitem` và `com.google.Chrome-1.dockitem` trỏ **CÙNG MỘT** `Launcher=…/com.google.Chrome.desktop` — ghim trùng từ 16/08 — cộng `vim.dockitem`, cộng cửa sổ Chrome đang chạy KHÔNG gộp được vào ghim (bamf không khớp vì Chrome mở với `--user-data-dir` riêng) ⇒ 6 icon. Sửa: bỏ cả ba ghim, để dock chỉ vẽ cửa sổ THẬT — `grok-chrome-77` có `Restart=always` nên Chrome luôn có mặt, không cần ghim. Kèm: user `box` chưa có `gtk-3.0/settings.ini` nên icon rơi về hình mặc định; đặt `gtk-icon-theme-name=Humanity` là Thunar và xfce4-terminal vẽ đúng icon. **Đo bằng ảnh chụp `:77` trước/sau qua `ffmpeg -f x11grab`**: 6 icon → 3 icon (Chrome · Thunar · terminal), đúng bố cục app gốc. Hoàn tác: đặt lại ba tệp `.dockitem` (nội dung mỗi tệp là 2 dòng, chép trong commit này) và xoá `settings.ini`. Việc lộ ra trong lượt này: đĩa box đầy 100% và desktop `:77` không có ai dựng lại sau reboot — xem §8 |
| 35 · Nút "Always allow" của thẻ chạm máy treo vĩnh viễn | **XONG 07/09** — người dùng báo *"đến panel hiển thị thông báo xong ấn Always allow đang bị treo"* trong lúc chạy E2E Figma. Không phải máy chậm: client 0.43 vẽ thẻ *"run commands on your local computer?"* nhưng khi bấm nút thì nó **không gọi** `resolveLocalToolPermission` — nó chỉ ghi `setHostSettings {localToolPermission:"always", localToolPermissionMachineId:"<uuid>"}` (đo bằng `coverage.lastArgs` trong một lượt thật: **15** lời gọi `setHostSettings`, **0** lời gọi `resolveLocalToolPermission`; `unknownPaths` rỗng nên không phải thiếu handler). Bên ta thì `standing === "always"` trơn cố ý KHÔNG mở cửa cho nhóm `CHAM_MAY_NGUOI_DUNG` (bối cảnh `always` cũ là BOX, không phải máy Windows). Hai quyết định đều đúng ở chỗ đứng của chúng, khoảng trống nằm GIỮA ⇒ thẻ nằm `pending` mãi và mỗi lệnh sau chồng thêm một thẻ. Sửa: `apDungQuyenChamMay()` trong `runtime/turn.ts` gỡ mọi thẻ chờ thuộc nhóm chạm máy khi cài đặt **mang mã máy** — mã máy là thứ phân biệt "trả lời cho ĐÚNG máy đang hỏi" với "đổi mức chung trong Settings", nên nhận nó không phải nới luật; cổng tuỳ chọn `applyLocalToolPermissionSetting` trong `ports.ts`, gọi từ `setHostSettings` của `commands.ts`. 5 unit `quyen-cham-may-qua-cai-dat.test` ghim ĐƯỜNG ĐI (thiếu mã máy ⇒ thẻ vẫn chờ; `never` cũng là câu trả lời; cổng cũ không có hàm ⇒ không ném). **Đo sống sau khi dựng lại gói**: thẻ `req-34` `pending` → gọi ĐÚNG một lệnh `setHostSettings` → `approved`, tool chạy, bot trả lời `DESKTOP-7D2FJG8`. 754/754 unit, tsc sạch cả backend lẫn `cursor-acl`. Chưa lên VPS |
| 34 · Chép tệp hai chiều máy người dùng ↔ box (mục 11b) | **XONG 06/09 ~21:10** — bản của ta cho `CopyToBox`/`CopyFromBox` của hãng (tên lộ trong câu báo của daemon: *"Shell, Read, and AwaitShell with machineId, plus CopyToBox and CopyFromBox"*). Dây: máy → backend đi khung `download` (`{kind:"file", bytesBase64}`) MỘT khung (nginx `cinai-app` 300m, daemon 100 MiB); backend → box đi op mới `writeBytes` của exec-daemon theo khúc **6 MiB** (`append`, khúc đầu tmp+rename) vì nginx `admin.halcion.vn` `client_max_body_size 20m`; box → backend `readBytes` (nay đọc theo vị trí, không nạp cả tệp mỗi khúc) khúc 4 MiB; backend → máy khung `upload`. Module `chep-tep.ts` nhận `Day` tiêm được — 7 unit ghim số khúc, cờ `append`, sha, đường mặc định (`tu-may/<tên>` trên box, `<localRoot>\Desktop\<tên>` trên máy), trần 100 MiB nói bằng tiếng Việt trước khi gửi. Tool `local_copy_to_box` (thẻ `read-file`) · `local_copy_from_box` (thẻ `write-file`); cửa ops `copy-to-box`/`copy-from-box` trả sha để đo. Daemon box thay tại chỗ (`/opt/exec-daemon.mjs`, bản cũ `.bak-20260906`), chỉ hạ daemon của `gb2u003` để router đẻ lại — daemon người khác giữ mã cũ tới khi bị thu. **Đo dây**: 1,5 MB lên 3,7 s / về 1,0 s; 13,6 MB lên 3 khúc 26 s / về 4 khúc 22 s, sha256 trùng cả ba nơi. **Đo đường model** `scripts/e2e-chep-tep.mjs` 7/7 lượt đầu: bot `local_copy_to_box` → `run_terminal_command_v2 sha256sum` → nêu đúng 64 ký tự → `local_copy_from_box` với `path` chỉ định → tệp về trùng sha. Một lần đỏ khi đo dây là do chính tôi vừa hạ daemon: lời gọi đầu chờ 60 s rồi nhận 520 từ Cloudflare (khởi động lạnh daemon + `waitPort` vượt `TIMEOUT_MS` phía backend), lời gọi kế xanh — ghi §8. 738/738 unit. Lên VPS `20260906-140811` (commit `5411fc1`), health 200 |
| 33 · Tool máy người dùng: ghi tệp + chạy nền (§5 mục 11) | **XONG 06/09 ~20:10** — theo lệnh chủ dự án *"Mục 11, bắt đầu bằng write-file rồi chạy nền vượt lượt"*. Đọc daemon 0.43 (`local-exec-daemon/main.cjs`) trước khi viết: `write-file` đi bằng khung RIÊNG `{kind:"upload", requestId, path, bytesBase64, approvalId?}` (không qua `serverMessage`; trả `{kind:"file"}`/`{kind:"file-error", error}`; `containPath` giữ trong `localRoot`, trần 100 MiB), chạy nền là `backgroundShellSpawnArgs{command, workingDirectory, toolCallId}` → `backgroundShellSpawnResult.success{shellId, pid, workingDirectory}`, đầu ra daemon ghi `<localRoot>/terminals/<shellId>.txt` với đầu tệp `status: running|succeeded|failed` và cuối `exit_code`. Bên ta: `LocalOp` thêm `write | spawn | stdin`, `khungGui()` xuất ra để test ghim hình dây, `docKetQuaMotNhanh()` đọc `oneof result` giữ tên nhánh lỗi; tool `local_write` + `local_shell_bg` (helper `chonMay`, đường dẫn trong ví dụ JSON đổi gạch xuôi vì `C:\Users` chép vào JSON là escape hỏng); thẻ quyền `hanhDongThe()` → `write-file`/`run-command` đúng tên daemon để client 0.43 vẽ đúng câu; cửa `/internal/ops/local-exec` nhận `write|spawn|stdin` để đo dây. **Đo dây** qua cửa ops: ghi 61 byte UTF-8 có dấu về nguyên, ngoài `localRoot` bị từ chối đúng câu, lệnh nền 6 tick mọc trong tệp terminals sau khi request đã về, footer `exit_code: 0 elapsed_ms: 11700`. **`send-input` KHÔNG làm được — và hãng cũng không**: gửi `writeShellStdinArgs` thật → *"No handler found for server message of type writeShellStdinArgs"*; `buildLocalExecManager` của daemon 0.29 lẫn 0.43 chỉ đăng ký 4 handler (`shellStreamArgs · backgroundShellSpawnArgs · readArgs · lsArgs`) — nên KHÔNG có tool `local_input`, lời nhắc dặn lệnh nền dùng cờ tự trả lời; nhánh `stdin` giữ trong `LocalOp` chỉ để cửa ops đo lại khi daemon đổi. **Đo đường model** `scripts/e2e-may-nguoi-dung.mjs` (bot thử → câu tiếng Việt → duyệt thẻ qua `resolveLocalToolPermission` như client → kiểm tệp trên đĩa): **7/7** ở lượt 3 — thẻ `write-file` · tệp đúng từng chữ · thẻ `run-command` · bot nói *"shellId **798773** (pid …)"* · tệp của lệnh nền mọc **14 s sau khi lượt đã xong**. Hai lượt đỏ trước là bài đo (§7): lọc thẻ theo hình `/v1` trong khi `/gw` trả entry thô, và đọc `message.text` thay cho `message.content`. 4 unit mới trong `local-exec.test`, 731/731. Lên VPS `20260906-132053` cùng lượt (health 200; đường model chỉ đo được ở máy dev vì máy Windows nối vào backend dev). Kèm: `run.ps1` nay tự đóng dấu soak (nền, im lặng) mỗi lần mở app — đo: mục 06/09 trong `soak-log.json` cập nhật `counts=true`, +679 lời gọi |
| 32 · Danh mục bot mẫu của mình — 9 bot, mỗi nhóm một | **XONG 06/09 ~10:10** — chủ dự án hỏi lại *"trích các bot template trong panel Marketplace app gốc để mapping sang local có tài nguyên"*. Đo trước khi trả lời: giải base32 33 lát cắt `sand-client-persistence` của app gốc (read-only) — **không có lát cắt marketplace/template nào** (chỉ roster · transcript · draft · sidebar), app gốc không CDP, thân skill trên box hãng ⇒ không trích được về kỹ thuật, và `legal.md` cấm phân phối lại; bản đo + đối chiếu HÌNH ở [marketplace-hang-0-43.md](../extracted/marketplace-hang-0-43.md). Thay bằng danh mục CỦA MÌNH: `src/danh-muc-mau.ts` — Trực Lỗi Sản Xuất · Duyệt Giao Diện · Xưởng Caption · Trực Chat Shop · Sổ Ý Tưởng · Sổ Thu Chi · Điều Phối Tuyển Dụng · Săn Khách Mới · Thư Ký Ngày (mỗi bot mô tả thẻ + SOP + 2–3 skill có `{input}`, luật chung hỏi-trước/không-bịa/request_secret), hàng rào `loiDanhMuc()` đúng luật validator client (chuỗi có chữ · nhóm đúng khoá · không trùng tên) chạy ở test lẫn script. `scripts/dung-danh-muc-mau.mts` dựng 0 lượt model, chạy lại an toàn — dev: `agent-1041…1049`, Marketplace 11 listing, Featured 4 thẻ (Trực Chat Shop · Xưởng Caption · Trực Lỗi Sản Xuất · Thợ dựng bot) như hàng 4 thẻ của hãng. 5 unit. **Routine đi theo mẫu XONG 06/09 21:45** (theo lệnh chủ dự án, mục 3 của lượt): sản phẩm (gateway `bindTemplateSources`) đã chở + dựng lại routine từ 05/09, thiếu chỉ ở đường dựng NGOÀI tiến trình — `mau-bot-ngoai.mts` nay hỏi backend đang chạy `getAgentAutomations{id}` rồi tiêm nguồn `routines` (kho routine nằm trong SQLite backend giữ mở, không mở kết nối thứ hai; không import `automations.ts` vì nó kéo `chat.js`; backend không lên → `routines: null` để bài đo phân biệt với "không có"); `e2e-mau-bot` thêm 4 mốc → **24/24**: recipe chở 1 routine · view import đủ name/description/content (`8:00 daily`) · bot mới nhận routine đúng cron `0 8 * * *` (client thấy `trigger:{type:"cron",schedule}`) · xoá bot là routine đi theo (`bindAutomationCleanup`). Danh mục 9 bot dựng lại sẽ chở routine nếu bot có — hiện 9 bot KHÔNG đặt routine, vì routine của bot mẫu là lượt model THẬT mỗi ngày trên VPS, đặt hay không là quyết định riêng. Chưa: ảnh người tạo |
| 31 · Thợ dựng bot — bot của mình chuyên dựng bot thành mẫu | **XONG 06/09 ~09:10** — trả lời câu hỏi chủ dự án *"tab Bots của app gốc (dr eggbot, Overheard, Tradbot…) có trích sang được không hay tự xây?"*: **tự xây**. Nội dung Marketplace của hãng là của hãng + người tạo bên thứ ba (`legal.md` cấm kéo/phân phối lại), và thân skill của họ nằm trên box hãng — chỉ thấy qua UI. Thứ đã chép là HÌNH (9 nhóm, Featured, thẻ, trang chia sẻ, import) — xong từ 05/09. Nay có bot đầu tiên của mình cùng vai dr eggbot: `src/tho-dung-bot.ts` (hồ sơ + SOP + skill `Dựng bot mới`, `source:"workflow"` để gõ `/`): hỏi tối đa 3 câu qua `ask_question` → `create_agent` → 2–4 `create_workflow{agent}` cho bot MỚI → `create_routine{agent}` nếu có nhịp → mời `share_bot_template{agent}` + `publish_bot_listing{agent,category}`; ghim luật validator client (mọi chuỗi phải có chữ) và cấm sao chép bot người khác. Kèm sửa sản phẩm: **`create_workflow` nhận `agent`** (trước cứng `ctx.agentId` — cùng lỗi `create_routine` 28/08: skill bot mẹ dựng cho bot con rơi vào bot mẹ). `scripts/dung-tho-dung-bot.mts` dựng bot + skill + mẫu (ngoài tiến trình như e2e-mau-bot) + listing `featured:true`, **0 lượt model**, chạy lại an toàn; đã chạy trên dev: `agent-1040`, mẫu `kqg4_izUYUfip-fRi6gaq`, slug `tho-dung-bot-kqg4xi`. 7 unit (`tho-dung-bot.test` · `create-workflow-target.test`). **Lượt thật `/Dựng bot mới` XANH 06/09 ~11:00** (`scripts/e2e-tho-dung-bot.mjs`, 7 mốc, 2 lượt model): Thợ nhận `@Dựng bot mới` + ba câu trả lời sẵn → `create_agent` → 2 `create_workflow{agent}` vào ĐÚNG bot mới (Thợ 1 → 1 skill) → `create_routine{agent}` (21:00 daily) → widget *Đưa lên Marketplace / Để riêng* → trả lời → `publish_bot_listing` → mẫu published + listing → dọn sạch. Sáu lượt đo để tới đó, và **năm lần đỏ là bài đo hoặc văn bản skill**: (1) bot chỉ tạo 1 skill → skill ghim "ÍT NHẤT HAI, kể tên trước khi gọi"; (2) kết bằng câu văn → luật widget vào cả SOP (`updateAgent` cho bot đã có), và câu đo "không hỏi lại" đổi thành "không hỏi lại ba câu đó"; (3) bot nói "đã dựng rồi, không tạo trùng" — bản ghi Thợ nhớ lượt trước dù bot thử đã xoá → mỗi lượt đo một việc + mã shop khác; (4)(5) bài đo đọc `isBusy` 3 s sau `respondToWidget` thấy rảnh rồi XOÁ bot trong khi lượt 2 đang gọi `share_bot_template{agent}` — `isBusy` (`native.ts` `running`) **không bật trong lượt do widget kích**, nay bài đo chờ theo bản ghi (bot viết entry mới rồi đứng yên 8 s). **Trên VPS đỏ thêm ba lượt (06/09 ~11:00–11:40), cả ba đều lộ chuyện thật**: (6) 8 s yên vẫn ngắn — model nghĩ 12 s giữa hai tool; truy tới gốc thì **`continueAfterTool` gọi thẳng `runTurn`, bỏ qua `startTurn` — nơi duy nhất đặt `isRunning:true`**, mà lượt đầu đã `clearPresence` khi đỗ chờ widget ⇒ suốt lượt nối tiếp roster báo bot rảnh, client không quay spinner (đúng cái "app đứng" `startTurn` đã chữa cho lượt đầu). Sửa sản phẩm `ed7e939`: `batLaiCoChay()` ở cả ba chỗ nối lượt (widget · bí mật · form · duyệt tool · thử lại), unit đọc mã `luot-noi-tiep-bat-co-chay.test`; bài đo nay đọc `isRunning` của Thợ trong `listAgents` + mốc theo **id entry** (đuôi có trần nên `length` sai); (7) chờ đúng rồi thì thấy model **dừng ở thẻ `share_bot_template`** ("mời bấm Publish") không gọi `publish_bot_listing` — bước 5 skill viết hai lệnh nối nhau; sửa `6da3ea3`: `publish_bot_listing{agent,category,description}` là MỘT lệnh (stage với thân thẻ do model viết → phát bản chờ → listing), skill chỉ gọi nó, `share_bot_template` chỉ khi người dùng muốn xem thẻ; unit `publish-listing-mot-lenh.test` 3/3. **Sau đó XANH 7/7 cả local (lượt 2 29–32 s) lẫn VPS (22 s), routine 21:00 lưu được**. 718/718 unit. **Thẻ duyệt của `create_routine` (06/09 ~12:00) hoá ra là lỗi ĐẦU VÀO của lớp soát**: đọc ba thẻ thật trên VPS, cả ba `reason` đều là *"người dùng chưa nhắc shop / chưa đồng ý nhịp chạy"* trong khi tin đầu nêu đủ; `boiCanhGanNhat` lấy 6 ENTRY cuối rồi mới lọc chữ — lượt dựng dài (3 câu tiến độ + 3 tool-call) đẩy tin người dùng ra ngoài, người soát đọc bối cảnh không có lời người dùng nào và trả đúng như nó thấy. Sửa `6caca29`: 6 DÒNG CHỮ gần nhất + luôn kèm tin người dùng gần nhất (không nới luật); unit `boi-canh-soat.test` 4/4; đo sau sửa: routine lưu thẳng **2/2** (local 8:30 thứ 2 · VPS 21:00 daily) so 1/4 trước; 722/722 unit; đã lên VPS `20260906-050247` |
| 30 · Routine: nhóm trigger 0.43 ("Add another") | **XONG 06/09 ~08:20** — ảnh app gốc: một routine mang *Every Monday at 8:49 AM · Every day at 12:15 AM · + Add another*, sự kiện *Updated routine*, bot nói *"giờ là mondays 8:49 hoặc mỗi ngày 00:15"*. Client gửi `SandTriggerGroup {type:"group", listeners:[≥2]}`; bên ta rơi vào `normaliseTrigger` → cảnh báo rồi thành `0 9 * * *`: panel vẫn vẽ đúng hai dòng (spec trả lại nguyên) nhưng routine CHẠY 9:00 mỗi ngày và câu nhắc nói lịch sai — sai im lặng đúng kiểu §7. Nay `docTrigger()` một phép đọc cho tạo lẫn sửa (cron · listener · group): lịch đầu vào `trigger`, lịch sau vào `extraCrons`, `cronsOf(rec)` cho `tick`/`dueIds`, listener trong nhóm vẫn ra thẻ connect, `triggerDescription` nối " hoặc "; câu nhắc dùng `rec.triggerDescription` và dặn *"routine có N lịch — nêu ĐỦ"* (đo: không dặn thì model bỏ lịch thứ hai). `e2e-routine-nhac` thêm nhịp 5: XANH sống — hàng *updated* thứ hai + *"`kiem-ke-sang` giờ chạy 8:49 thứ 2 hoặc 0:15 mỗi ngày."* + `getAgentAutomations` trả lại nhóm hai lịch. 5 unit `automations-nhom-lich.test` |
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
| 29 · Bản ghi + ngữ cảnh một phiên bot: chép đường của app gốc 0.43 | **XONG 06/09 ~07:40** — theo yêu cầu chủ dự án ("app gốc cuộn lên chỉ hiện một cửa sổ, local hiện từ đầu tới cuối nên giật; bộ não đọc ngữ cảnh kiểu gì"). Đọc ba tầng, kết luận ở [0-43-transcript-context.md](../extracted/0-43-transcript-context.md): (FE) cùng renderer nên cách TẢI y nhau — trang đầu `limit 500`, cuộn lên `limit 100 + beforeSeq`, danh sách ảo hoá; (API) khác ở ĐƯỢNG ĐẨY SỐNG — app gốc 0.43 gửi khung `transcript` có `ordered` `{replicaKey:"transcript:<bot>", epoch, sequence}` (bằng chứng: replica client app gốc ghi đĩa mang `epochHint`/`acceptedSequenceHint`), ta gửi khung không `ordered` nên client coi là tiếng gõ và **tải lại cả đuôi 292 KB sau MỖI token** (tick 45 ms) — đó là cái giật, và là gốc của §5 mục 19; (BE) ngữ cảnh model của ta đã bị chặn bởi `compaction.ts` (12k token + 8 tin, 11 bot có bản tóm tắt thật) — hãng nén ở ~100k/70 % cửa sổ, khác con số không khác cơ chế. Sửa: `sse.ts` phát khung phẳng `{type, agentId, entry, ordered}` (dùng `nextTranscriptOrdered` viết từ 08/2026), tắt khẩn `GROKBOT2_TRANSCRIPT_ORDERED=0`; entry `tool-call` ra `/gw` bỏ `rawArgs`+`result` (51 % trang, renderer đọc 0 lần). **Đo cùng bài `scripts/do-ban-ghi-song.mjs`, trước/sau 10 phút**: lượt tải đuôi trong một lượt bot **38 → 5**, DOM vẽ sống, replica client neo `acceptedSequenceHint: 37`; `kiem-reply-0-43` trang đầu + trang cũ 0 sai; 695/695 unit, tsc sạch. Chưa lên VPS |
| 28 · E2E tính năng mới chạy lại trên client 0.43 local + đối chiếu output với app gốc | **XONG 06/09 ~04:00–04:50** — theo lệnh chủ dự án sau khi phát hành: chạy lại trọn bộ trên client `0.43.20260906` (CDP :9225) + backend dev, so hình dạng/thứ tự thứ người dùng thấy với hành vi quan sát được của app gốc. Kết quả: `kiem-reply-0-43` 29/29 · `e2e-mau-bot` 20/20 · `e2e-marketplace` 26/26 · `e2e-hai-tai-khoan` 20/20 · `e2e-routine-nhac` XANH (4 câu, 6,1–8,3 s, 0 tin người dùng, bật+sửa → 1 câu) · `e2e-trang-chia-se` 17/17 (sau khi sửa mặc định SITE của bài đo, f81c358) · `e2e-teach` **15/15** (tin bàn giao 1 s sau Stop, skill + link `sand-workflow:wf-mtovdsbc-7` sau 61 s, không hỏi lại) · `e2e-chia-se-mau` **7/7** ở lượt 3 (lượt 1 đỏ vì store client giữ mẫu cũ, lượt 2 đỏ mốc 4 vì bản ghi sống đứng — hai bẫy §7). **Bảng đối chiếu app gốc ↔ local** ghi ở [0-43-so-voi-local.md §8](../extracted/0-43-so-voi-local.md): mọi luồng khớp hình dạng; ba chỗ lệch không chặn — bot ta xem video trong MỘT lượt (hãng tách subagent, `requestId` đổi), hãng kết teach bằng widget mời chạy thử (ta câu văn), trang `/bot/<id>` không có `og:image`. Lộ một lỗi thật của đường sống (§5 mục 19) |
| 27 · Phát hành client 0.43 lên feed cho mọi máy | **XONG 06/09 ~03:50** — một lượt "update 1 thể" theo lệnh chủ dự án, gồm mọi thứ tới `b64702e`. Cổng đi qua trước khi bấm: tên miền `halcion.vn` đã về (NS Cloudflare, hosts tạm trên VPS đã gỡ) · backend `6c6f617` deploy VPS, `kiem-reply-0-43` 29/29 · `coverage.unknownPaths` **0** đường gateway 404 sau một ngày client 0.43 đi Marketplace/Plugins/Share/Teach (§B của kế hoạch coi là đã quét bằng dùng thật) · `e2e-trang-chia-se` + `e2e-routine-nhac` xanh trên VPS · `patch-client --verify` xanh trên `C:\cai043`. Lệnh: `npx tsx scripts/phat-hanh.mjs --kenh stable --with-app --len-vps` với `GROKBOT2_CLIENT_DIR=C:\cai043` + `GROKBOT2_PUBLIC_BACKEND` + `GROKBOT2_PUBLIC_URL` + token — test 66/66 → dựng `Bot-Noi-Bo-Setup-20260906.exe` (cùng AppId `…BOT2NOIBOFULL` với bản 0.29 đang cài, KHÔNG phải biến thể `043`) → sha → manifest → scp 3 gói + manifest. **Đo từ Internet**: feed máy 0.29 có token → 200 `{version:0.43.20260906, sha 236bd7f5…, ten Bot-Noi-Bo-Setup-20260906.exe}`; không token → bản cfg sha `86c0fed0…`; máy đã 0.43.20260906 → 204; `/download/windows` phát đúng file 111.213.078 B; trang tải hiện `0.43.20260906` ×4; sha VPS = sha cục bộ. **Lùi**: launcher chỉ nhận bản MỚI HƠN nên không lùi được qua feed — máy chưa cập nhật: khôi phục `/opt/grokbot2/shared/data/phat-hanh.json.bak-20260906` (bản 0.29 vẫn nằm trong `dist/`); máy đã lên 0.43: chạy tay `Bot-Noi-Bo-Setup-20260903.exe`. Hai bẫy nhỏ ghi §7: `node` trần chết ở import `site.ts` (phải `npx tsx`), dấu ngày UTC ra "hôm qua" |
| 26 · Dải tài khoản box (§5 mục 12) | **XONG 06/09** — con số "5" trong bảng này đã sai từ trước: box có **10** tài khoản và sổ `/var/lib/grokbot2/users.json` đã cấp hết 10 (4 trong đó là owner THỬ: `auth0\|nguoi-A`, `auth0\|nguoi-B`, `kickstart@`, `cho@vi-du.vn`); router vẫn tưởng dải là 5 vì mặc định ghim cứng — và thứ nâng nó lên 10 là một drop-in systemd `user-pool.conf` ghim danh sách 10 tên, tức danh sách sống ở HAI nơi. Nay: tạo thêm `gb2u011…030` (`useradd -m -g gb2users`, home 700, đúng bước 0 của [per-user-on-one-box.md](../plan/per-user-on-one-box.md) — sudoers cố ý KHÔNG cho router `useradd`), router đọc dải từ `/etc/passwd` mỗi lần cấp (`GROKBOT2_USER_POOL` vẫn thắng nếu ai đặt), cổng daemon con = `13400 + số trong tên` (không theo vị trí danh sách), drop-in đổi thành chú thích, lỗi hết dải có `code:"pool-exhausted"` + `used/size` → `loiBox()` trong `box-exec.ts` nói *"không phải lỗi của bạn — báo quản trị viên"*. Đo: restart router → log `dải tài khoản: 30 (gb2u001…gb2u030)`; owner thật `auth0\|grokbot2-user` → daemon `gb2u003` lên cổng **13403** `root=/home/gb2u003/workspace`; owner giả cấp thử ra `gb2u011 (11/30)` rồi xoá khỏi sổ. Bài `infra/vps/exec-router.test.mjs` 3/3 (router có guard `LA_CHINH` nên import không mở cổng). Chưa: thu hồi 4 slot owner thử (xoá mapping + home là việc phá huỷ, chờ chủ dự án). **`/admin` hiện `used/size` từ 06/09 ~07:10**: router có `GET /pool` trả `{perUser,used,size,free,owners}` đọc sổ + passwd lúc hỏi (mapping trỏ tài khoản đã xoá không chiếm chỗ), backend `boxPoolStatus()` hỏi song song với lệnh đo và trả `null` thay vì ném khi router cũ, thẻ "Tài khoản box" đứng cạnh RAM/đĩa (đỏ khi còn ≤ 2). Router đưa lên box + restart lúc cả hai backend rảnh; đo thật: `{"used":12,"size":30,"free":18,"owners":12}`, `/admin` local vẽ *18 còn trống / 30 · đã cấp 12*. `exec-router.test` 4/4. Bản router cũ giữ ở `/opt/exec-router.mjs.bak-20260906b` |
| 25 · Teach: nút `+` đi đường VIDEO như hãng (§5 mục 14) | **XONG 06/09** — quyết định: video là đường chính, CDP là **nhật ký kèm** (thay cho "lịch sử Chrome" mà hãng đối chiếu; của ta tốt hơn vì có selector + URL thật). `startTeachRecording` bật cả hai (ffmpeg không chờ — reply là trạng thái pane); `stopTeachRecording{save:true}` dừng ffmpeg (SIGINT → chờ file đóng → ffprobe) rồi, nếu có clip, **bàn giao cho bot**: `sendPrompt` một tin `role:user` đúng câu hằng + `clientNonce` `teach-recording:<sha256(agentId:video)>:teach-<ISO>-<uuid>.json` (renderer 0.43 `Snn` vẽ kiểu teach-recording; `turn.ts` bật `luotHocTuBanGhi` khoá `ask_question` — cả hai so BẰNG với câu hằng, nên phần video/nhật ký đi qua `modelNote` mới trong `SendArgs`: nối vào lượt model, không vào bản ghi). Không có clip (không box) → đường cũ nguyên vẹn. `create_workflow` trả `id` + cú pháp `[Tên](sand-workflow:<id>)` — đọc renderer: `dft()` nhận `sand-workflow:<slug>` với slug `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, pill so `x.id===slug` → `focusSkillId`, nên slug PHẢI là `id` của ta (`wf-…` khớp). Video quay display của ĐÚNG bot (`displayOf(agentId)`, VPS bật per-bot display) thay vì `:77` cứng. **Đo sống trên client 0.43 local (06/09 ~19:55)**: bấm `+` → Teach → Start → demo example.com → Stop; tin bàn giao mọc, bot đăng 6 câu tiến độ (*"Khung ở giây thứ 8 là trang example.com, bản ghi ổn" → "xem hết video theo hai đoạn" → "khớp đúng với nhật ký thao tác. Mình ghi thành skill"*) và kết *"Mình đã lưu thành skill: [Mở trang example domains của IANA](sand-workflow:wf-mtot1ac1-2)"* — đúng nhịp bảng §2 của [teach-hang-0-30.md](../extracted/teach-hang-0-30.md), không hỏi lại. `e2e-teach.mjs` nay đo cả hai đường (15 mốc; chờ tin bàn giao 45 s, rồi chờ skill + link tới `TEACH_WAIT_MS`) — **6 lượt trong đêm 06/09, 4 lượt cuối GREEN 15/15**; sau khi sửa lệnh quay (`setsid -f`, §7 "subshell ôm ống") tin bàn giao tới **2 s** sau Stop (trước: 38 s), skill + link sau 72–114 s. Tin bàn giao mang `richText` chip `workflowReference` (id = skill thật) — ảnh chụp client 0.43: bong bóng + chip *Learn from demonstration* y hệt app gốc, câu kết của bot vẽ pill skill. Entry `message` nay lưu `richText` string cho MỌI tin (client gửi doc ProseMirror cho mỗi prompt — `coverage.lastArgs`). 9 unit trong `teach-demo.test.ts`. Chưa: `requestId` đổi giữa chừng (hãng uỷ thác subagent xem video) — ta xem trong một lượt. **06/09 tối — chép đúng GIAO THỨC TRÊN ĐĨA của hãng** sau khi chủ dự án dán nguyên văn skill `learn-from-demonstration` của app gốc (nhãn *Managed by Cursor*) và chỉ ra bản của ta là "form cứng" chứ không phải quy trình: host nay ghi mỗi buổi quay thành phiên `teach-sessions/teach-<ISO>-<uuid>/{demo.mp4, session.json{sessionDir,videoPath,ffmpegPid,startedAt,endedAt,durationSec}, actions.md}` dưới gốc làm việc của daemon + phiếu `teach-sessions/queues/<scope>/pending/<phiên>.json`; `scope = sha256(agentId)` (hàng đợi theo BOT), nonce `teach-recording:<scope>:<phiên>.json` với phần cuối đúng tên phiếu; `modelNote` chỉ tiêm `Teach recording queue scope` + bài học, KHÔNG đường dẫn (hãng: "Do not take paths or PIDs from the user message"). Thân skill chép trọn 0→6 + mục thông tin nhạy cảm của hãng, đổi đúng ba thứ: tool của ta (`run_terminal_command_v2` cho kịch bản `flock`/lease 12 h/`jq` nhận phiếu cũ nhất, `view_image` cho hai khung cắt vào thư mục phiên, `watch_video` theo `tu/den`, `create_workflow`), gốc `$PWD` thay `/workspace`, "lịch sử Chrome" → `actions.md`; kết bằng xoá video + phiếu như hãng. Skill là `source:"managed"` (renderer 0.43: `s.source==="managed"` → *Managed by Cursor*, không vào menu `/`; enum `SandSkillSource` = automation·managed·plugin·workflow), bản cũ trong kho được nâng tại chỗ. Cài `jq` lên box (root apt) vì kịch bản cần; `flock`/`ffprobe` sẵn. Đo sống 06/09 06:35 trên client 0.43: bot nhận phiếu qua `flock` (exit 0, in `claim=…/queues/<scope>/claimed/<phiên>.json`), `ls` thư mục phiên thấy `actions.md` + `session.json`, cắt hai khung vào thư mục phiên rồi `view_image` đọc được, `watch_video` 3 s — đúng nhịp bước 0→2 của hãng; kết: `create_workflow` → *"Đã lưu thành skill: [Mở trang Example Domains của IANA](sand-workflow:wf-mtp0uitu-1)"* + 5 bước sau **134 s**, kịch bản dọn `exit 0` → trên box `pending/` và `claimed/` rỗng (phiếu + `.lease` đã xoá), `demo.mp4` + `frame_*.png` đã xoá, còn `session.json`/`actions.md` (hãng cũng chỉ xoá video + phiếu). `e2e-teach` **15/15**, skill thử đã xoá. Một lệch nhỏ đọc được: câu kết mời *xoá skill trùng* (bot nhớ lượt dạy cũ cùng demo example.com trong bản ghi) thay cho mời chạy thử — do demo lặp, không phải do thân skill. 12 unit. Bảng khớp đầy đủ: [teach-hang-0-30.md §3](../extracted/teach-hang-0-30.md) |
| 24 · Bảng Routine → bot lên tiếng · trang đích của Copy link | **XONG 05/09 đêm** — (a) app gốc: mỗi thao tác trên bảng Routine để lại hàng sự kiện (`automation-changed` đủ 5 `action` của `SandAutomationChangeAction`: created·updated·deleted·**enabled·disabled**) và bot trả MỘT câu ngay, bật+sửa liền nhau → một câu, không tin người dùng nào. Bên ta: `automations.ts` phát sự kiện cho xoá/bật/tắt (trước chỉ tạo/sửa), `routine-nhac.ts` gom nhịp 1,5 s theo bot → lời nhắc `silent` qua `sendPrompt`, chờ bot rảnh (tối đa 60 s rồi bỏ), chỉ gắn ở CỔNG GATEWAY (bot tự sửa routine bằng tool không tự nhắc mình); `api-contract` mở enum. Đo sống `e2e-routine-nhac.mjs`: 4 nhịp → 4 câu (*"`kiem-ke-sang` đang tạm dừng rồi nhé, muốn mình bật lại lúc nào không?"*), 6–11 s, 0 tin người dùng. (b) Copy link của hãng trỏ `x.ai/bot/<id>` — trang tĩnh avatar · "<tên> by <người tạo>" · mô tả · miễn trừ · **Add to Grok Bot** = `grokbot://app/v1/bot-template?id=<id>` tự mở. Bên ta: `shareUrlOf` tính LÚC ĐỌC từ `GROKBOT2_PUBLIC_SITE` (vd `https://cinai.app/agent`) → `/bot/<shareId>`; `site-bot.ts` phục vụ trang ấy công khai (chỉ mẫu đã publish + public; nháp/xoá/riêng → cùng một trang 404; thoát HTML, CSP nonce, chỉ số đếm không lộ thân skill; og:title/og:url). 7 unit + 5 unit. **Đã bật trên VPS 06/09**: `GROKBOT2_PUBLIC_SITE=https://cinai.app/agent` trong `.env`, deploy `2e398bb`, đo qua Internet bằng `e2e-trang-chia-se.mjs` chạy trên VPS: bot thử stage mẫu 9 s → trước publish 404 → publish → `https://cinai.app/agent/bot/<id>` 200 với title/og/deep link/CSP → xoá → 404 lại (link thật đã mở, mẫu đã dọn). Lộ một lỗi: `/bot/<id>/` có gạch chéo cuối làm link tương đối `../download/windows` rơi vào `/agent/bot/download/windows` → nay 301 tương đối về dạng chuẩn. Cùng lượt đo lộ **sự cố tên miền `halcion.vn`** (§5 mục 18) — trước khi vá hosts, lượt share trên VPS không chạy được. **Icon mẫu khớp icon bot (06/09)**: người dùng thấy app gốc thẻ mẫu mang đúng icon bot (dr eggbot giọt nước đỏ) còn local New Bot sidebar viên thuốc cam mà thẻ tròn xanh — vì bản ghi không lưu `avatarShape/avatarColor`, client SUY từ id (`Sp`/`Af` renderer: FNV-1a → fmix → 8 hình; mulberry32 → 10 màu không black), ta rơi về hằng "blob"/"blue". Nay `avatar-mac-dinh.ts` chép đúng hai hàm ấy (ghim 5 id so với mã gốc), dùng cho snapshot mẫu, thẻ, View Details, trang `/bot/<id>`, avatar thông báo; đo sống `getAgentNotificationAvatar{agent-984}` → `tablet/orange`. Rủi ro: scheme `grokbot://` thuộc app MỞ SAU CÙNG (đo: `HKCU\Software\Classes\grokbot` → `C:\cai043\Grok Bot.exe`), app hãng mở lại là chiếm lại — trang web không chọn được app nào mở |
| 23 · Nút "Share as template" đúng luồng 0.43 | **XONG 05/09 tối** — trích từ renderer + cache client app gốc: client TỰ gửi `Create a template of yourself…` (Update template gửi câu KHÁC `Update the shared template of yourself.`), bot đăng tiến độ rồi entry `send-message` `bot-template-share` `{published:false, version}` → thẻ Unpublished · Publish → bấm Publish → `publishBotTemplate` → Published · Copy link, menu header đổi. Bên ta: bản CHỜ `staged` (đầu bảng giữ bản đã phát), publish nâng đúng bản chờ (không chụp lại đè mô tả bot viết), `toWireView` (5 mục cho hộp View Details, `activeVersion` vắng thay vì null), tool đăng tiến độ + thẻ, lượt nhận ra bằng hằng câu → khoá `ask_question`. Đo bấm thật tay trọn vòng 7 bước; `e2e-chia-se-mau.mjs` chép lại 7 mốc — chạy được **6/7** (mốc 7 sửa cách kiểm sau đó, chưa chạy lại trọn vì người dùng đang dùng app trên :9225); 7 unit mới; schema 0.43 0 sai. Chi tiết [0-43-so-voi-local.md §7c](../extracted/0-43-so-voi-local.md) |
| 22 · Đóng gói client 0.43 (mục 3·4·5 của bước A) | **XONG 05/09** — `GROKBOT2_SETUP_VARIANT=043` cho `build-setup.mjs --with-app`: bộ cài SONG SONG (AppId/AppName/`Programs\Bot Noi Bo 043`/shortcut/kho hồ sơ riêng), ghi vào `dist/043/` để không lọt vào đường phát hành; `Bot-Noi-Bo-Setup-20260905-0.43.exe` 111.213.560 B; cài im lặng exit 0, 578 file, `--verify` xanh, bản 0.29 nguyên. `start-app-043.cmd` + `run.ps1` đọc `GROKBOT2_CDP_PORT`: mở bản cài trên :9225, roster hiện từ backend, 18 tiến trình khác không đụng. `phat-hanh.mjs` đọc nền phiên bản từ `GROKBOT2_CLIENT_DIR/resources/app/package.json` (file repo `client-patch-state.json` đứng ở 0.29.0 là dự phòng). Kèm: sửa launcher mất backslash ở `SAND_USER_DATA_DIR` (§7) |
| 21 · Marketplace bot + hồ sơ người tạo (bước D của [len-0-43-marketplace-template.md](../plan/len-0-43-marketplace-template.md)) | **XONG 05/09** — kho listing (`marketplace.ts`, 9 nhóm của renderer, slug bỏ dấu, `featured` chỉ người vận hành đặt), hồ sơ người tạo (tên · ảnh · handles), 3 RPC proto main-side + blob recipe qua zod `Dct` của main, lỗi Connect có mã (404/403, khung end-stream cho `connect+proto`), 6 lệnh gateway, tool `publish_bot_listing`, ba cờ client bật. **Đo trên UI 0.43 thật**: tab Bots hiện thẻ Featured + nhóm, mở thẻ ra trang chi tiết, **Import Bot** ra bot mang đúng UUID client đúc + avatar chọn, skill đã dựng, bot tự chào. Cùng lượt sửa **đường GHI** cho schema 0.43: 5 lệnh tạo/sửa bot trả `SandAgentSummary`, 26 lệnh reply `null` (`REPLY_NULL`), `SandSkill` 11 khoá, `shareUrl`, `deleteAgents.transcript`. `e2e-marketplace.mjs` 26/26 · `e2e-mau-bot.mjs` 20/20 · `kiem-reply-0-43.mjs` 29 đọc + 13 ghi = 0 sai. Ba điều schema không nói: [0-43-so-voi-local.md §7b](../extracted/0-43-so-voi-local.md). **Ba mục còn thiếu XONG 06/09**: (1) tab Plugins ↔ MCP trên 0.43 — danh mục đã vẽ từ MCP của mình từ trước, nhưng Cài/Cập nhật/Gỡ trả `{ok}` trong khi schema 0.43 đòi `SandMcpState`/`SandMcpRemoveResult` ⇒ bấm là "thất bại" im lặng dù MCP đã ghi; nay trả đúng hình (kèm `ok` cho 0.29), bấm THẬT Add Context7 trên UI 0.43 → chip "Added", "9 installed", backend có id 18; gỡ qua gateway → `removed:true`, kho về 6 (UI không tự vẽ lại khi gỡ từ ngoài client — đúng hành vi, không phải lỗi); `kiem-reply-0-43` 3 lệnh 0 sai. (2) Tài khoản thứ hai qua web login: `e2e-hai-tai-khoan.mjs` **20/20** — B (JWT thật, đăng ký ngoài tiến trình vì `/v1/register` đóng) thấy listing của A, đọc mẫu public, import ra bot mang id client đúc thuộc B, roster hai bên tách, `listBotTemplates` của B không có mẫu của A, B gọi `deleteBotTemplate`/`unpublishBotListing` lên của A → không đổi gì. (3) Phân trang THẬT ở RPC `ListPublicGrokBotMarketplaceListings`: `page_size`(2) cắt, `page_token`(3) = offset, featured chỉ trang đầu, token rỗng khi hết, token lạ ⇒ trang đầu, trần 100, mặc định 24 (field number trích `proto.cjs` 0.43); unit 7/7, `e2e-marketplace.mjs` 26/26 |
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
thấy. Bài đo E2E phải tự xoá skill trước khi xoá bot; sản phẩm sửa 06/09 (`removeForAgent` trong `deleteAgents`, §5 mục 16).

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

**Lần thứ hai, và lần này bộ test GHI chứ không xoá — nên không có gì trông như hỏng.** 07/09 chủ dự án gửi ảnh bảng
Settings → Computer, trong đó có một máy tên **"Máy cũ"**. Không phải máy thật: `computerId` là `"cu"`, không phải UUID, và nguồn
là dòng `nhoMay({computerId:"cu", label:"Máy cũ"})` ở cuối `may-da-biet.test.ts` — hàng rác mang dấu thời gian **21:28:09 cùng
ngày**, tức lượt chạy 764/764 của chính tôi, vài phút trước khi người dùng mở bảng. `may-da-biet.ts` ghim
`join(HERE,"..",".data","may-da-biet.json")` như hằng số ở mức module nên **không biến môi trường nào** cứu được: kể cả
`run-tests.mjs` cũng không chuyển hướng nổi. Ba điều đáng chép, và điều thứ ba là điều đắt nhất: (1) hướng XOÁ thì lộ ra (Marketplace
trống trơn), hướng GHI thì lặng lẽ mọc thêm dữ liệu và trông y như thật — nên "không thấy gì hỏng" không phải bằng chứng bộ test
sạch; (2) cách phân biệt rẻ nhất là **hình dạng id**: một `computerId` không phải UUID trong sổ máy chỉ có thể đến từ bài đo;
(3) chú thích của `dataDir()` trong `store.ts` **đã chép đúng bài học này** từ trước — *"`attachments.ts` và `observe.ts` từng tự
dựng đường dẫn `../.data` của riêng chúng… một nguồn sự thật thì không lệch được"* — và `may-da-biet.ts` là module thứ TƯ làm đúng
cái việc đó, viết sau khi dòng chú thích ấy đã tồn tại. Một luật viết ở chỗ nó vừa được học không tự lan sang file kế tiếp; muốn nó
lan thì phải **cấm cái hình dạng** (`join(HERE,"..",".data")` không được xuất hiện lần thứ năm), không phải dặn thêm một lần nữa.

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

**Runner cấp MỘT `GROKBOT2_DATA_DIR` cho cả bộ, còn `node --test` chạy các file SONG SONG.** 06/09: ba file chạy chung → 4 đỏ
(404 giả ở `site-bot.test`, thiếu khoá ở `bot-templates.test`), từng file chạy riêng xanh hết. `bot-templates.test.ts` có `sach()`
xoá cả kho mẫu, và kho ấy là kho chung của mọi tiến trình con trong lượt chạy ấy — nó xoá đúng lúc bài kia vừa publish. Bộ đầy
đủ 685/685 trước đó xanh chỉ vì hai bài không trùng nhịp. Luật: bài nào tạo dữ liệu thì tự `mkdtemp` **vô điều kiện** (không
`??=` theo env của runner); env của runner chỉ là lưới bảo vệ `.data` thật, không phải hàng rào giữa các bài.

**"App local tự bịa icon" — hằng mặc định ở server không phải mặc định của client.** Bản ghi bot không lưu hình/màu thì client
KHÔNG vẽ "blob"/"blue": nó suy từ id bằng hai hàm băm (`Sp`/`Af`). Mọi chỗ server tự điền "blob"/"blue" (mẫu, thẻ, avatar thông
báo) đều lệch với sidebar, và chỉ lộ khi đặt hai icon cạnh nhau. Cách tìm: grep `avatarShape` trong bundle renderer → `??mR(t.id)`
→ kéo `$ee/ZRe/WRe/KRe/XRe` ra chạy nguyên văn trong Node để lấy giá trị ghim, RỒI mới chép sang TS (`avatar-mac-dinh.ts`).

**Một danh sách sống ở HAI nơi thì cái mình đọc luôn là cái cũ.** Bảng này ghi "dải tài khoản box chỉ 5, đã cấp hết" từ
05/09; router mặc định ghim `gb2u001…005`; nhưng box đã có **10** tài khoản và sổ đã cấp hết 10 — vì ai đó (đúng kế
hoạch) tạo thêm tay rồi nâng dải bằng một **drop-in systemd** `user-pool.conf` ghim đủ 10 tên. Tôi thêm 20 tài khoản, đổi
router sang đọc `/etc/passwd`, restart — log vẫn nói `10`: drop-in thắng, và `systemctl cat` mới lộ nó (tôi đã `grep` đúng
file unit chính và kết luận "không có Environment"). Luật: nguồn sự thật cho "có tài khoản nào" là passwd; mọi bản chép của
nó (env, doc, mặc định trong mã) đều sẽ cũ, nên đọc thẳng nguồn và **đọc cấu hình hiệu lực (`systemctl show -p Environment`),
không đọc file**. Kèm hai bẫy nhỏ cùng lượt: `set -e` + `node --check tệp.mjs.new` đứt vì đuôi `.new` không phải ESM ⇒ cả
chuỗi dừng TRƯỚC lệnh `mv`, router cũ vẫn chạy mà lệnh dò sau đó vẫn báo lỗi "POOL is not defined" y như bản mới hỏng; và
`PORT = BASE + POOL.indexOf(user)` — một hằng số bị xoá nhưng còn một chỗ đọc nằm ngoài vùng tôi sửa, `node --check` không
bắt được vì đó là lỗi lúc CHẠY. Bài test import module chỉ chạy được nhờ guard `LA_CHINH`; nó bắt đúng cả hai nếu có
sớm hơn một lượt.

**Lần thứ hai, và lần này nạn nhân là HỢP ĐỒNG LỆNH của chính mình.** 07/09 kiểm lại "còn tính năng nào chưa làm":
`gateway-commands-0-43.json` khai **150** lệnh, trích từ bảng `dl("gateway",{methods:{…}})` trong `main-app.cjs` — MỘT
nguồn. Trích thêm bảng lệnh trong **renderer** (`{args:…,reply:…}` cho từng lệnh) thì nó biết **5 lệnh nữa** mà main
không khai: `noteMountedAgent` · `resolveAgentCreation` · `getServerAgentRoster` · `restoreTemporalAgentRouting` ·
`listVirtualCardPaymentMethods`. Tức hợp đồng thật là 155 và số thiếu là 24, còn con số "150 · thiếu 19" đã nằm trong
bảng này như sự thật hiện hành từ 06/09. Điều đáng chép: §3 của chính tài liệu này **đã làm đúng phép hai nguồn** cho
hợp đồng 0.30 ("Xác nhận bằng đường trích thứ hai") rồi khi lên 0.43 thì chỉ trích một nguồn — một phương pháp đã trả
giá không tự động đi theo phiên bản sau. Kèm một phép đo rẻ hơn nhiều mà nên chạy TRƯỚC: đếm độ phủ theo **NHÓM tính
năng do renderer tự chia** (`approvals`, `user_form_vault`, `listeners`…). Nó lộ ra thứ danh sách phẳng không lộ được —
14/22 nhóm đủ 100%, và nhóm nào *nửa vời* mới là chỗ người dùng bấm được nút mà không ai trả lời.

**Một chuỗi `&&` chạy nền là một subshell, và subshell ấy ôm ống stdout của daemon.** `A && B && setsid ffmpeg … > log 2>&1 &`
— dấu `&` áp cho CẢ danh sách, bash fork subshell chạy danh sách đó, chỉ riêng ffmpeg được chuyển hướng còn subshell thì
kế thừa ống của `execFile` trong exec-daemon; `execFile` chờ ống đóng ⇒ lệnh "bật quay" trả về đúng lúc hết `timeoutMs`
(40 s), và ffmpeg bị hạ theo. Bốn lượt đo đầu 06/09 đều ra video **đúng 40 s** và tin bàn giao tới **38 s** sau Stop — tôi
đổ cho `pkill -f x11grab` tự bắt mình (cũng là một lỗi thật, sửa luôn) và chỉ tìm ra khi đo qua router bằng hai câu lệnh
tối giản: dạng cũ 12,2 s với `timeoutMs` 12 s, dạng `( … ) > log 2>&1 < /dev/null &` 1,2 s. `demo_start` của bot (01/09)
đã chịu đúng 40 s ấy suốt năm ngày mà không ai đo. Cùng họ với "đo cái đang chạy": một con số tròn trịa trùng với một
hằng số trong mã (`40_000`) là dấu tay của timeout, không phải của việc.

**Lệnh phát hành chết SAU bước tốn nhất, và số phiên bản mang ngày của "hôm qua".** 06/09: `node phat-hanh.mjs` chạy
test (66/66), dựng gói 106 MB (~4 phút), rồi chết ở dòng `import("src/site.ts")` — `node` không nạp `.ts`, nhánh dự phòng
`../src/site.js` không tồn tại; manifest chưa ghi, VPS chưa nhận gì, và đầu file vẫn dặn `node …`. Phải `npx tsx`. Cùng
lượt, `stamp = toISOString().slice(0,10)` là ngày UTC: dựng lúc 03:38 (UTC+7) ra `…-20260905.exe`, trùng số với bản dev 043
dựng chiều trước. Nay dấu ngày theo giờ máy, và header ghi `npx tsx`. Bài học: một script phát hành phải được **chạy trọn
một lần ở dạng người vận hành sẽ gõ** trước ngày cần nó — 03/09 nó chạy được là vì hôm đó gõ khác.

**Client 0.43 giữ trạng thái mẫu trong store persist — xoá mẫu từ NGOÀI client thì menu header nói dối tới khi tải lại.**
06/09 ~04:00: `e2e-chia-se-mau` đỏ **0/7** ngay mốc 1 — menu header của `New Bot` hiện *View template details · Update template ·
Delete Template* trong khi backend `getBotTemplateForSourceAgent` → `null` và `listBotTemplates` rỗng. Không phải backend: store
`botTemplates` của renderer đã ghi "bot này có mẫu đã phát" từ lượt đo trước, và mẫu ấy bị dọn qua gateway (không qua nút Delete
của chính client) nên client không bao giờ nhận tín hiệu xoá. Cùng họ với "UI Plugins không tự vẽ lại khi gỡ từ ngoài client" (§6
mục 21): client 0.43 chỉ đọc lại theo THAO TÁC CỦA CHÍNH NÓ. Lần đầu tải lại renderer (`page.reload` qua CDP :9225) là menu về
*Share as template*; nhưng lần sau — khi bản ghi đã có thẻ `bot-template-share` mang `published:true` — tải lại KHÔNG đủ: đọc
renderer, `j(N)` gọi `getBotTemplateForSourceAgent` và với reply `null` nó vẫn lấy `U(x0(store, N))`, tức suy "đã phát" từ chính
các THẺ trong bản ghi. Cách reset duy nhất là bấm *Delete Template* của client (đánh dấu `user-deleted` theo shareId, ba thẻ đổi
sang *This template was deleted*, menu về *Share as template*) — `deleteBotTemplate` qua gateway trả `null` cho id không còn, vô hại.
Luật cho bài đo: dọn mẫu bằng ĐÚNG NÚT của client, không qua gateway; và một menu "sai" trên client 0.43 phải so với backend
TRƯỚC khi nghi backend — hai bên có thể cùng đúng theo nguồn của riêng mình. Cùng lượt đó, `e2e-trang-chia-se` đỏ 2/17
(`shareUrl` · `og:url`) chỉ vì bài đo gõ GW ở `127.0.0.1` còn `shareUrlOf` rơi về `localhost` khi thiếu `GROKBOT2_PUBLIC_SITE` —
sửa mặc định SITE của bài đo (f81c358), 17/17.

**Khung SSE `transcript` của ta không phải dữ liệu — client 0.43 coi nó là tiếng gõ cửa rồi tự đi tải lại đuôi.** Đọc
renderer 06/09 (`ne=V=>{const{ordered:K}=V; if(K==null){… if(me.isFetchInFlight){me.isActivityRefreshQueued=!0;return} Q(me) …}`):
khung không có phong bì `ordered` thì client BỎ `entry` trong khung, chỉ gọi `Q` = `getAgentTranscriptTail` rồi ghép; đang có
một lượt tải chưa về thì chỉ ghi cờ "tải lại sau". Hệ quả đo được lúc 04:12: thẻ `bot-template-share` bản 2 (e17273) và câu chốt
(e17274) **không bao giờ lên màn** dù backend phát đủ khung SSE (thí nghiệm ghi song song 15 phút sau cho thấy 6 khung `appended`
+ `updated` đi ra đúng) và `getAgentTranscriptTail` trả đủ, tải lại renderer là thấy. Cùng lượt Update ấy chạy lại thì vẽ live
ngay, 0 lỗi console. Nghi phạm chính: một lượt `getAgentTranscriptTail` không bao giờ về (coordinator → backend) giữ
`isFetchInFlight` = true mãi, mọi tiếng gõ sau chỉ ghi cờ. Bài học cho bài đo: đỏ ở mốc "thẻ phải vẽ" thì
đọc `getAgentTranscriptTail` trước — tail đủ mà DOM thiếu là client đứng, không phải backend.

**Sửa gốc ba giờ sau (06/09 ~07:40), và bài học nằm ở CHÚ THÍCH cũ.** `sse.ts` mang một đoạn viết 08/2026 khẳng định *"NO
`ordered` on transcript events — the original does not send one either … sending it is what froze the pane"*, kèm bằng chứng đọc từ
đĩa. Bằng chứng ấy ĐÚNG — cho client **0.30**. Đọc đĩa của app gốc **0.43** cùng cách (`sand-client-persistence/…transcript.replicas.<bot>`)
thì bot đang dùng mang `epochHint: "fbf22d21-…"`, `acceptedSequenceHint: 9`: hãng đã chuyển bản ghi sang replica có thứ tự, và
renderer 0.43 đọc khung PHẲNG `{type, entry, agentId, ordered}` (không lồng `event` như ta gửi — nên `entry` của ta chưa bao giờ được
đọc). Một kết luận đo đúng trên một bản client được ghi thành luật không có ngày hết hạn, rồi bản client đổi mà luật còn. Cùng lượt lộ
thêm: entry `tool-call` ta gửi mang `rawArgs` + `result` = 51 % trang đuôi mà schema `SandToolCallEntry` không có khoá nào trong hai cái
đó và renderer đọc 0 lần. Đo trước/sau cùng bài (`do-ban-ghi-song.mjs`): 38 → 5 lượt tải đuôi một lượt bot. Luật: **một chú thích
"đừng làm X, đã đo" phải ghi bản client đã đo**, và khi lên bản mới thì đo lại X trước khi tin.

**Bài đo chờ 6 s cho một việc mất 45 s, rồi rẽ nhầm đường và báo đỏ sản phẩm.** `e2e-teach.mjs` bản đầu 06/09 tìm tin
bàn giao `teach-recording` trong 6 s sau khi bấm Stop; không thấy ⇒ kết luận "đường cũ" ⇒ đếm skill ⇒ `0 → 0` ⇒ RED.
Trong khi đó backend đang dừng ffmpeg (SIGINT → chờ file đóng → ffprobe, ba lượt qua hầm ssh) rồi mới bàn giao, và bot đã
tạo skill "Mở trang example domains của IANA" với link `sand-workflow:wf-mtot1ac1-2` — đọc transcript mới thấy. Cùng họ
với "cửa sổ đo không khớp với LƯỢT": ngưỡng chờ của bài đo phải suy từ ĐƯỜNG ĐI của sản phẩm (đếm số lượt qua hầm), không
từ cảm giác. Nay chờ 45 s và in ra tin tới sau bao lâu.

**Bài đo ngủ bằng `setTimeout` TRONG trang, cửa sổ bị che là Chromium bóp timer — `Runtime.evaluate` không về, bài treo 10 phút không in gì.**
06/09 ~08:40, `e2e-chia-se-mau` treo hai lượt liền sau mốc 2 (`grep` ở đầu ống còn nuốt luôn output nên không thấy nó dừng ở đâu). Hàm `bam()`
chạy một async IIFE trong trang với `await sl(700)` qua `awaitPromise`; mọi nhịp chờ phía node (`choLuotXong`, `choDen`) vẫn chạy, chỉ nhịp
chờ phía trang đứng — dấu tay của timer bị bóp khi cửa sổ Electron không ở trước/bị che. Ba sửa: đồng hồ 60 s cho MỌI lệnh CDP (ném có tên
lệnh), mọi `sleep` về phía node (trang chỉ làm việc đồng bộ: chọn, đo, thử điểm bấm), `Page.bringToFront` trước khi đo. Cùng lượt lộ thêm
hai bẫy nhỏ: (1) nút **Publish của thẻ làm ngơ cú bấm trong lúc bot còn gõ** — "số hàng đứng yên 4 s" không phải "lượt xong" vì câu chốt
gõ vào hàng cuối không thêm hàng; hỏi thẳng `/gw/health.isBusy` mới đúng; (2) hộp View Details của client 0.43 **chỉ vẽ mục có dữ liệu**
— bot thử không có routine thì không có "Routines", mốc 6 ghim theo dữ liệu của bot hôm qua chứ không theo sản phẩm. Bốn lần đỏ, cả bốn là
bài đo; sản phẩm 7/7 khi bài đo đúng. Kèm: bài bấm thật đo trên "bot đang mở", mà bot việc của người dùng (New Bot) nay CÓ mẫu đang lên
Marketplace ⇒ mốc 1 đỏ là ĐÚNG, không phải store client nói dối — nay `chon-bot-cdp.mjs` mở một bot thử riêng rồi trả lại bot cũ.

**Hết hạn mức pool GIỮA lượt trông y như bot bỏ dở.** `e2e-teach` 06/09 ~09:00: tin bàn giao tới 1 s, bot nhận phiếu, cắt khung đúng nhịp,
rồi câu cuối của bản ghi là *"You've hit your session limit · resets 10:30am"* — bài đo chờ 302 s rồi báo "0 → 0 skill". Cùng họ với
"một lượt hỏng có thể đội đúng lốt một lượt tốt" (429 ở lớp soát): bài đo đọc số skill, không đọc câu cuối của bot. Trước khi kết luận một
lượt dài đỏ, đọc entry cuối của transcript — chữ *session limit* là hạn mức, không phải sản phẩm.

**Hai nguồn cho MỘT số phiên bản — và chúng lệch nhau đúng một ngày.** Máy dev cập nhật 0.29 → 0.43 xong (06/09 12:17),
`package.json` khai `0.43.20260905`; manifest ghi `0.43.20260906`. `phat-hanh.mjs` lấy nền `0.43` từ bundle rồi ghép NGÀY TRONG
TÊN FILE bộ cài; còn số launcher khai là do `patch-client --apply` đóng dấu vào `C:\cai043` — ngày vá (05/09), không phải ngày
phát hành. `moiHon("…06","…05")` = true ⇒ mọi máy vừa cập nhật nhận 200 và **tải lại 106 MB mỗi 24 h, mãi mãi**, không lỗi
nào nổi lên; chính chú thích trong `phat-hanh` đã tả đúng vòng lặp này cho `major.minor` ("launcher 0.43 sẽ thấy bản mới
mãi mãi") rồi để hở đúng thành phần thứ ba. Cùng họ với "một danh sách sống ở HAI nơi": số manifest phải là **bản chép của
file launcher đọc**, không phải một phép tính khác cho ra cùng kết quả vào ngày đẹp. Nay `phienBanTuBundle` đọc thẳng số
của bundle và từ chối bundle chưa đóng dấu; manifest VPS sửa tay về `0.43.20260905` (`.bak-20260906b`). Kèm hai bẫy nhỏ cùng
lượt: launcher tiết chế 24 h so `LastWriteTime` của `.lan-hoi-cuoi` — mốc 23 h là bỏ qua im lặng (muốn ép thì lùi mốc); và
`patch-client` còn dấu ngày UTC (`toISOString`) như bẫy phat-hanh đã trả giá — đã đổi sang giờ máy. Và một bẫy của
CHÍNH PHIÊN ĐO: shell của Claude Code trong VS Code mang `ELECTRON_RUN_AS_NODE=1`, nên mọi launcher mở `Grok Bot.exe` từ đó
mà không gỡ biến là app "mở" rồi thoát ngay, 0 tiến trình, 0 lỗi — tôi đã suýt ghi "0.29 không mở lại, chưa rõ vì sao" như
một lỗi sản phẩm. `run.ps1` gỡ nó từ lâu (dòng 31, có chú thích CRITICAL); `start-bot.cmd` của bộ cài thì không, nay đã gỡ ở
cả ba khuôn launcher. Luật: một app Electron "không lên" khi mở từ phiên này thì kiểm `$env:ELECTRON_RUN_AS_NODE` trước.

**Bài đo hỏi `isBusy` để biết lượt xong — nhưng lượt do widget kích không bật `isBusy`.** `e2e-tho-dung-bot` 06/09: trả lời
widget qua `respondToWidget`, ngủ 3 s, thấy `/gw/health` rảnh ⇒ coi lượt 2 xong ⇒ XOÁ bot mới; trong khi bot đang gọi
`share_bot_template{agent:"RUOA TikTok CS"}` và nhận "không thấy bot theo tên" — sản phẩm đúng, bài đo tự phá bằng chứng. `isBusy`
là `running.length` ở `native.ts`, chỉ lượt qua `sendPrompt` vào đó; lượt tiếp sau widget đi `continueAfterTool` và không. **Truy tiếp trên VPS (06/09 ~11:20) thì gốc nằm ở SẢN PHẨM, không ở cửa health**: `continueAfterTool` gọi thẳng `runTurn` mà bỏ qua `startTurn` — dòng `setPresence({isRunning:true, thinking})` duy nhất nằm trong `startTurn`; lượt đầu đã `clearPresence` khi đỗ chờ widget, nên cả lượt nối tiếp (12 s nghĩ + các tool) roster báo `isRunning:false` — người dùng bấm widget xong thấy bot im, không spinner, đúng cái "app trông như chết" mà chú thích `startTurn` mô tả cho lượt đầu. Cờ ấy được đặt đúng cho lượt ĐẦU nên ai đọc mã cũng tin nó bật cho MỌI lượt. Sửa: `batLaiCoChay()` ngay sau mỗi `inflight.set` của lượt nối tiếp (`ed7e939`), khoá bằng bài đọc mã. Hai bài học:
(1) một tín hiệu "rảnh" chỉ đáng tin khi đã thấy nó BẬT cho đúng loại lượt đang đo — cùng họ với "guard chỉ đáng tin khi đã thấy nó
trả TRUE"; (2) bản ghi là nguồn sự thật: "bắt đầu" = bot viết entry mới, "xong" = đứng yên 8 s. Kèm một bẫy nhỏ cùng bài: bản ghi của
bot đo (Thợ) giữ ký ức các lượt trước dù bot nó tạo đã bị xoá — lặp cùng một yêu cầu là bot nói "đã dựng rồi, không tạo trùng" (đúng!),
nên mỗi lượt đo phải là một việc khác, mang một mã riêng.

**Hành động có trong danh sách của daemon ≠ handler có trong daemon — lần thứ sáu của cùng một bẫy, và
lần này tài liệu của chính mình là nguồn sai.** `tool-doi-chieu.md` §2b ghi "hãng có `send-input`" vì
`isSandLocalToolAction` liệt kê nó và `describeLocalExec` có nhánh `writeShellStdinArgs`; bảng theo dõi chép
thành việc còn lại số 11. Gửi khung thật xuống daemon thật (06/09) mới lộ: *"No handler found for server
message of type writeShellStdinArgs"* — `buildLocalExecManager` chỉ đăng ký BỐN handler, ở cả 0.29 lẫn 0.43.
Danh sách hành động là để VẼ THẺ (client cần tên cho câu hỏi), handler là để CHẠY; hai bảng ấy không cùng độ
dài. Cách đo đúng cho mọi "hãng có X" từ nay: **đếm chỗ đăng ký handler**, không đếm chỗ nhắc tên.

**`curl.exe` từ Git Bash nhận argv qua codepage Windows — chữ Việt trong `-d '…'` tới máy chủ đã hỏng.**
Đo `local_write` lần đầu: tệp trên đĩa mang `EF BF BD` (U+FFFD) chỗ "à", "ò", "—" và "?" chỗ "ừ" — tôi suýt
đi tìm lỗi mã hoá trong daemon. Bytes hỏng ngay ở `body.toString("utf8")` phía backend, tức `curl.exe` đã
chuyển argv sang CP1252 (chữ có trong bảng → byte đơn không phải UTF-8 hợp lệ → FFFD; chữ không có → `?`).
Thân JSON đọc từ FILE do Node ghi (`--data-binary @w.json`) → 61 byte về nguyên. Cùng họ với bẫy `perl -i`
chữ Việt và bẫy backslash của bash: **mọi chuỗi không-ASCII đi qua dòng lệnh Windows đều phải nghi trước**.

**Bài đo lọc thẻ quyền theo hình của cửa KHÁC.** `e2e-may-nguoi-dung` lượt 1 tìm `kind:"tool-call"` +
`needsApproval` + `status:"pending"` — đó là hình trang `/v1` (`toNativeTranscriptPage` trộn thẻ vào hàng
tool-call); còn `/gw/api/getAgentTranscriptTail` trả entry THÔ: thẻ là `send-message` mang
`message.type:"local-tool-permission"`, `ask{status,action,target,requestId}`. Không thấy thẻ ⇒ không duyệt ⇒
lượt đứng chờ ⇒ 1/7, và bot đã gọi đúng tool. Lượt 2 đỏ mốc 5 vì đọc `message.text` trong khi câu của bot
nằm ở `message.content`. Hai lượt, hai lần đọc sai KHOÁ của chính hợp đồng mình viết; sản phẩm đúng cả hai
lần. Luật cũ áp lại: **đổ bản ghi ra file TRƯỚC khi dọn** — lượt 1 xoá bot trong `finally` rồi mới muốn đọc.

**Cửa sổ client bị che thì trang `hidden`, và trang hidden không vẽ khung nào — nút Publish của thẻ mới đứng ở opacity 0 mãi.**
06/09 21:13 `e2e-chia-se-mau` đỏ ba lượt y nhau ở mốc 3 với câu báo trỏ sang sản phẩm (đúng chỗ §5 mục 19 vừa sửa buổi sáng),
trong khi backend chưa từng nhận `publishBotTemplate` và `cham.getAgentTranscriptTail.treo = 0`. Dò DOM: `document.visibilityState
= "hidden"` (cả 0.29 lẫn 0.43; cửa sổ không thu nhỏ, phiên console active, không cửa sổ topmost nào), `sand-row-content` của thẻ mang
`opacity: 0; transform: scale(.94) translateY(12px)` — animation vào chưa chạy khung đầu — và virtualizer xếp hàng theo chiều cao ước
lượng cũ nên `elementFromPoint` ở MỌI điểm trong nút trả `sand-virtual-transcript__inset`. Gốc: Chromium coi cửa sổ nằm sau cửa sổ
khác là *occluded* và ngừng vẽ (`document.hidden`); cờ ấy KHÔNG gỡ được từ ngoài — `Page.bringToFront`, `Page.setWebLifecycleState
active`, `ShowWindow`/`SetForegroundWindow`/`SetWindowPos` đều thử, vẫn hidden — chỉ mở lại app với
`--disable-backgrounding-occluded-windows` (run.ps1 nhận `GROKBOT2_APP_ARGS`) là `visible` ngay, và 7/7 ba lượt liền. Buổi sáng xanh
vì cửa sổ client nằm TRƯỚC. Ba luật: (1) bài bấm thật kiểm `visibilityState` TRƯỚC mốc 1 và nói thẳng cách mở lại; (2) "bấm mù" phải in
phần tử đang đè — `<p>` hàng sau (bẫy 05/09) và `inset` là hai bệnh khác nhau, cách chữa khác nhau; (3) một bài đo đỏ ở ĐÚNG chỗ vừa sửa
không có nghĩa chỗ sửa hỏng — đọc `cham` + coverage của lệnh mà nút PHẢI gọi trước khi nghi sản phẩm. Kèm: `bam()` chọn "phần tử cuối
DOM" trong khi DOM ảo hoá không theo thứ tự nhìn thấy — bot có nhiều thẻ Unpublished thì có thể bấm Publish của thẻ cũ; nay xếp theo toạ độ.

**Thẻ của client và câu trả lời của client đi HAI cửa khác nhau.** 07/09 người dùng bấm *Always allow* trên thẻ "run commands on
your local computer?" và thẻ đứng mãi. Phản xạ đầu là nghi backend chậm hay thẻ vẽ sai; `coverage.lastArgs` nói ra chuyện khác: **15**
lời gọi `setHostSettings` mang `localToolPermission` + `localToolPermissionMachineId`, **0** lời gọi `resolveLocalToolPermission`,
`unknownPaths` rỗng. Tức client 0.43 vẽ thẻ bằng một cơ chế và trả lời bằng một cơ chế khác, và bên ta chỉ nghe đúng cửa thứ hai.
Cùng họ với "hành động có trong danh sách ≠ handler có trong daemon": **một nút hiện ra không nói gì về lệnh nó sẽ gửi** — đọc
`lastArgs` của lượt bấm THẬT trước khi tin rằng nút gọi cái lệnh trùng tên với nó. Và chỗ chữa không phải là nới `standing`:
`localToolPermissionMachineId` mới là thứ biến một mức chung thành câu trả lời cho đúng máy đang hỏi.

**Bài đo import `@grokbot2/cursor-acl` là đọc `dist/`, không đọc `src/`.** Cùng lượt: sửa `commands.ts` xong chạy bài mới → 2 đỏ với
"gọi 0 lần", trông y như dây chưa nối. Gói được nạp qua bản đã dựng, nên `pnpm --filter @grokbot2/cursor-acl build` là một BƯỚC của
việc sửa, không phải việc dọn dẹp sau. Kèm hệ quả phải tính trước: dựng lại `packages/*` là `tsx watch` nạp lại backend (pid đổi) —
cùng bẫy với `pnpm typecheck`, nên chỉ làm khi không lượt nào đang chạy.

**`activating` không phải "sắp xong" — nó có thể là một vòng lặp chết đang chạy.** Bật bảy unit `:77` (07/09), sáu cái
`active`, `grok-term-77` `activating` và tôi định ghi "còn đang lên". Đọc kỹ thì `Restart=always` + `RestartSec=3s` cộng
`auto-restart` cho ra đúng chữ `activating` **giữa hai lần dập**, và `NRestarts` đã là **96**. Nguyên nhân: systemd tách
`ExecStart` theo khoảng trắng, nên `--title=Grok Bot box` viết trần thành ba đối số và xfce4-terminal chết với
`Unknown option "Bot"` — dòng lệnh ấy chạy đúng khi gõ trong shell, sai khi đặt vào unit. Hai luật: (1) một unit
`Restart=always` phải đọc **`NRestarts`**, không đọc `is-active` — trạng thái tức thời của một vòng lặp chết trông giống
trạng thái của một thứ đang khởi động; (2) mọi đối số có khoảng trắng trong `ExecStart` phải nằm trong nháy kép. Kèm một
bẫy thứ hai cùng chỗ: `xfce4-terminal` không có `--disable-server` thì giao việc cho một tiến trình server rồi **tự
thoát**, và với `Type=simple` systemd đọc đó là "main process exited" ⇒ lại dập — cùng họ với bẫy `setsid`/subshell ôm ống.

**"29/29 xanh" hôm qua không nói gì về hôm nay, khi lỗi phụ thuộc TRẠNG THÁI DỮ LIỆU.** 07/09, cổng
sau deploy: `kiem-reply-0-43` đỏ ở `listAgents` với `awaitingUserResponse: anyOf(required since |
type null)`. Bảng này ghi **29/29 ngày 06/09** trên cùng bài đo, cùng backend, và cả hai con số đều
đúng — hôm 06/09 không bot nào đang chờ, nên nhánh sinh ra lỗi chưa bao giờ được chạy qua. Hai hệ
quả. (1) Phản xạ "vừa deploy xong mà đỏ thì là bản vừa deploy" sai ở đây: tái hiện trên backend dev
mất 30 giây và nó đỏ y hệt — **tái hiện ở chỗ CHƯA đổi trước khi đổ cho chỗ vừa đổi**. (2) Một bộ
đo chạy trên dữ liệu rỗng thì nó đo hình dạng của mã, không đo hình dạng của reply: `kiem-reply`
chỉ chạm được `awaitingUserResponse` khi CÓ bot đang chờ, `memberIds` khi CÓ nhóm, `lastEntry` khi
CÓ bản ghi. Cùng họ với "một đường chưa bao giờ chạy thì không có lỗi nào để mà thấy", chỉ khác là
ở đây đường ấy chạy hay không do dữ liệu người dùng quyết, nên nó bật lên vào một ngày ngẫu nhiên.
Và triệu chứng đã ở trước mặt người dùng trước khi bài đo thấy: hai hàng *"Waiting for you"* trong
ảnh chụp chủ dự án gửi đầu lượt chính là hai bot làm reply trượt schema.

**Một bản vá đổi THÂN thì `--verify` không phân biệt được với bản cũ — và nó báo xanh.** 08/09, đi
đo bảng Computer thì phát hiện thứ khác: `patch-client --verify` kết luận "applied · 0 unpatched"
bằng hai dữ kiện — *có marker* và *không còn neo nào chưa vá*. Cả hai đều ĐÚNG với một bundle đã vá
bằng bản vá của tuần trước, vì thân cũ đã nuốt mất neo nên không còn gì để đếm. Hậu quả đo được:
ba bản vá `computer-tab-{ipc,label,permission}` (viết lại 07/09 để đọc vé người dùng) báo xanh trên
**cả bản dev lẫn bản đang phát hành**, trong khi thân của cả ba vẫn đọc
`process.env.GROKBOT2_GATEWAY_TOKEN` — tức bản vá `computer-tab-ve` áp thêm cũng vô ích, vì ba chỗ
ĐỌC vé đều là bản cũ. Ba điều đáng chép. (1) Đây là mặt sau của luật "một guard chỉ đáng tin khi đã
thấy nó trả TRUE một lần": guard này chưa bao giờ được thấy trả FALSE, nên nó xanh bằng cách không
bao giờ nhìn. (2) Phép kiểm đúng rẻ đến mức đáng ngượng vì máy vá là `split(find).join(replace)`
THUẦN CHỮ: sau một lần áp, `replace` phải nằm nguyên văn trong file — hỏi `src.includes(replace)`
theo TẬP biến thể là xong, và nó phân biệt được ngay hai bản cài trên cùng một máy. (3) Dòng
*"bản vá client 10 mốc · `--verify` xanh cả hai"* đã nằm trong §1 của chính bảng này nhiều ngày như
sự thật hiện hành, và nó xanh vì lý do sai — cùng họ với "test xanh không có nghĩa là đúng", chỉ
khác là ở đây thứ xanh sai là **cửa kiểm của bộ vá**, thứ mọi kết luận khác về client dựa vào.
Kèm một hệ quả về đường phát hành: `--apply` luôn dựng từ staging trích ra từ asar của hãng, mà bộ
cài chở-app tạo ra bản **tự chứa không có asar** — nên bản đã cài không vá đè lại được, và đường
duy nhất đưa thân mới tới máy người dùng là một lần PHÁT HÀNH.

**`bindHost 127.0.0.1` là một ĐỊA CHỈ, không phải một biên giới — và cửa ops mở ra Internet suốt nhiều
tháng.** 08/09, `e2e-may-lan-dau` mốc 6 đỏ, và truy tới gốc thì thứ tìm được lớn hơn thứ đang đo:
`POST https://cinai.app/agent/internal/ops/local-exec` với thân `{"kind":"shell","command":"hostname"}`,
**không một header nào**, chạy lệnh trên máy Windows của người dùng. Chú thích ngay trên khối ấy ghi
*"loopback — this server binds 127.0.0.1, not via /gw"* và **cả hai vế đều đúng chữ**; cái sai là phép
CỘNG. nginx trên VPS có `location /agent/ { proxy_pass http://127.0.0.1:8788/; }` và nginx chạy trên
CÙNG MÁY, nên loopback không loại ai ra cả — nó chỉ mô tả chặng cuối. Bốn điều đáng chép. (1) Một câu
chú thích đúng về CƠ CHẾ có thể sai hoàn toàn về HỆ QUẢ, và nó sống lâu chính vì đọc lên nghe có lý;
phép kiểm rẻ là gõ URL công khai từ ngoài, không đọc lại đoạn chú thích. (2) Cửa ấy đứng ngoài
`GROKBOT2_AUTH` — mức siết `enforce` đã bật trên VPS từ 07/09 mà cửa vẫn mở, vì `checkAuth` chỉ gác
`/gw`; "đã bật auth" không phải câu trả lời cho "cửa nào có gác". (3) Hai hàm suy chủ đọc hai tập giấy
tờ khác nhau (`ownerFromAuth` xét vé, `ownerFromRequest` thì không) là một nguồn sự thật thứ hai, và
cụm cô lập máy 07/09 chỉ bịt hàm thứ nhất — cùng họ với "hai mặt SSE": **bịt một mặt thì phải đi đếm
xem có mấy mặt**. (4) Bài đo tìm ra nó không phải bài đo bảo mật: nó là bài E2E "người mới đăng nhập
lần đầu", và mốc đỏ là mốc *"việc của B không rơi sang máy của A"*. Một bài đo dựng đúng hai danh tính
rồi hỏi "bên này có thấy bên kia không" tìm ra lỗ mà mọi lượt đo một-danh-tính không thể thấy.

**Một bản sửa "đã deploy" không tự dọn dữ liệu ĐÃ đóng dấu — và tôi đã suýt báo xanh.** 08/09: vá `migrate()` để cắt khối `TOOL_CALL` dư của lượt bị cắt, chạy 7/7 unit, ép nạp lại, rồi đọc `e18296` để nghiệm thu — **vẫn 1600 byte, y nguyên**. Vì lần khởi động lại ĐẦU TIÊN (13:22) đã đặt `streaming = false` và LƯU, nên điều kiện của nhánh mới (`e.streaming`) không còn đúng với chính cái entry sinh ra nó. Bản sửa đúng — cho lượt bị cắt TỪ GIỜ; dữ liệu cũ thì cần một nhánh thứ hai. Luật: một bản vá ở đường NẠP phải được nghiệm thu trên **hàng dữ liệu đã tồn tại**, không chỉ trên hàng mình vừa dựng trong unit — hai thứ đó đi qua hai nhánh khác nhau. Và đây là lý do đáng đo lại trên bản ghi thật thay vì đọc số test: 10/10 xanh trong khi thứ người dùng nhìn thấy chưa đổi một byte.

**Bài đo đọc mã bằng CỬA SỔ ký tự cứng thì đỏ khi hàm dài ra.** `kind-khong-bi-mat.test` cắt `state.slice(indexOf("function migrate"), +3000)` rồi tìm danh sách trắng trong đó. Thêm một nhánh vào `migrate` là danh sách rơi ra ngoài cửa sổ ⇒ bài đỏ, và câu báo trỏ sang "migrate sẽ XOÁ các kind này" — tố cáo sản phẩm cho một lỗi của phép ĐO. Nay cắt tới đúng biên hàm (`}` đầu dòng). Cùng họ với "guard dựa vào một nhãn thu gọn được": một phép đo dựa vào KÍCH CỠ của thứ nó đọc sẽ sai vào ngày thứ đó lớn lên.

**Một ngưỡng tìm bằng CHIA ĐÔI không phải một cơ chế — và tôi đã viết nó vào bảng này như thể là.** 08/09 tôi đo cap=1 áp được, cap=170 không, rồi ghi *"replica LẠNH không dựng nổi từ trang 164 entry / 77 KB"*. Câu ấy đọc lên như một TRẦN, và trần thì mời đi sửa kích cỡ. Đọc renderer thì cửa không hỏi kích cỡ một chữ nào: nó so **đồng nhất tham chiếu** của object cửa sổ lúc phát lệnh tải, cộng một phép so `fetchAttempt` — tức là một **cuộc đua**, và kích cỡ chỉ đổi xác suất thắng. Hai hệ quả khác nhau hẳn: với một trần thì cách chữa là chia trang mãi mãi; với một cuộc đua thì cách chữa là **đừng chạm vào replica trong lúc trang đang bay** — rẻ hơn, và không cần sửa sản phẩm. Bài học: chia đôi tìm ra **CHỖ** hỏng rất giỏi và không nói được **VÌ SAO** một chữ; đừng đóng dấu cơ chế bằng một đường cong đo được. Cùng họ với "đo cái đang chạy, không đo mã nguồn" nhưng ở chiều NGƯỢC: có những câu hỏi chỉ mã trả lời được, và "tôi bisect ra ngưỡng" là lúc dễ quên điều đó nhất.

**Một reply HỢP LỆ mà RỖNG trông y hệt một reply hợp lệ mà ĐỦ — và tôi đo bằng vé của MÌNH trong khi client đi bằng vé của nó.** 08/09, pane đứng: tôi gọi `getAgentTranscriptTail` bằng vé dùng chung, nhận **164 entry**, rồi thấy client vẽ 0 và suy ra "client bỏ thứ nó nhận". Nhưng `transcriptTail` có một cửa quyền chủ ngay dòng đầu — `(agentId && ownsAgent(agentId) && transcripts.get(agentId)) || []` — nên với một danh tính khác nó trả `entries: []`, HTTP 200, schema xanh, không lỗi nào. Hai câu hỏi khác nhau: "đường này trả gì cho TÔI" và "trả gì cho NGƯỜI GỌI THẬT". Thứ trả lời được chỉ mất 30 giây: **một dòng log tại đúng chỗ quyết định**, in cả `currentOwner()` lẫn `ownsAgent` lẫn số entry — nó dập luôn hai giờ giả thuyết (`chu=auth0|grokbot2-user own=true co=164 tra=164` ở MỌI lượt của client). Cùng họ với "hỏi sai KHOÁ thì hạ tầng khoẻ vẫn trả lời như đang sập": ở đây là hỏi đúng khoá nhưng **bằng giấy tờ của người khác**. Luật: reply nào phụ thuộc danh tính người gọi thì đừng suy từ lượt gọi của mình — hoặc phát lại bằng giấy của họ, hoặc log tại nhánh.

**`coverage` đếm cả lượt của bài đo — lần thứ hai, và lần này thứ phân biệt là `saw`.** Cùng lượt: `getAgentTranscriptTail` n đi 26 → 28 → 31 và tôi định đọc đó là "client đang hỏi liên tục", trong khi phần lớn là `kiem-reply-0-43` của chính tôi. Chỗ tách được hai nguồn: bảng `auth.unticketedPaths` ghi `saw` theo đường — client tới bằng `user-ticket`, lượt của tôi tới bằng `matching-bearer`. Số lượt trần không phân biệt được ai; **loại giấy tờ thì phân biệt được**.

**Một giả thuyết khớp 11/11 bot vẫn có thể sai — phải tìm ca ĐỐI CHỨNG trước khi đi sửa.** `seq` của trang đuôi suy từ id entry, mà id entry là bộ đếm toàn cục, nên mọi bot có bản ghi đều khuyết chuỗi; đúng lúc ấy `agent-1088` (2 entry, **0 lỗ**) là con DUY NHẤT vẽ được, và client 0.43 thì chỉ nhận `sequence === accepted + 1`. Ba dữ kiện khớp nhau đẹp đến mức tôi đã viết ra kết luận. Phép thử rẻ nhất là mở một bot NHIỀU lỗ khác: `agent-1085` (45 entry, 21 lỗ) vẽ đủ, không banner ⇒ giả thuyết chết trong 15 giây. Tương quan trên một mẫu duy nhất không phải nhân quả, và cái mẫu duy nhất ấy còn khác ở một chiều nữa (2 entry so với 164).

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
- ~~**Khởi động lạnh daemon box vượt trần 60 s của backend (06/09).**~~ **XỬ LÝ 07/09** — hai phần. (1) **Không tái hiện** được 60 s: hạ daemon `gb2u003` rồi gọi ngay qua Cloudflare, `health` lạnh 0,9 s, `writeBytes` 6 MiB lạnh **1,6 s**, daemon lên lại ~4 s; `waitPort` của router bác ở **8 s** (không phải 60), và khi bác thì router trả `200 {error}` chứ KHÔNG bao giờ 520. Nên 520/60 s hôm 06/09 là nhất thời lúc thay chính tệp daemon giữa nhịp đẻ, không phải lỗi đứng của `spawnChild`/`waitPort`. (2) **Vẫn thêm lưới**: backend thử lại ĐÚNG một lần khi lỗi thuộc lớp "chưa TỚI được daemon" (`-> HTTP 5xx` gồm 520 · `daemon con không lên` · `box unavailable` · `fetch failed`) — những lỗi này xảy ra TRƯỚC khi daemon đọc thân nên op **chưa chạy**, thử lại an toàn kể cả `append`; KHÔNG thử lại AbortError (daemon đã nhận, chạy chậm → ghi đôi), `pool-exhausted`, hay lỗi daemon thật. `box-exec.ts` `laLoiKhoiDongLanh()` + `viaDaemon` bọc `goiDaemonMotLan`; `GROKBOT2_BOX_RETRY_MS` (mặc định 1500, 0 = tắt). 7 unit `box-exec-thu-lai.test` (máy chủ HTTP thật đếm số lần gọi). Đo sống: hạ daemon rồi `copy-to-box` qua backend → xanh 2,0 s. 745/745. Đường xa nếu tái phát: nâng `waitPort` của router (8 s → 20 s) — nhưng đó là restart `grok-exec`, chỉ làm lúc box rảnh.
- **`sudo` ghi TOKEN của daemon box vào journald.** Router đẻ daemon bằng `sudo --preserve-env=GROKBOT2_EXEC_TOKEN…`, và `sudo` log dòng `ENV=GROKBOT2_EXEC_TOKEN=…` vào journal (đọc được với root — thấy khi đọc `journalctl -u grok-exec` 06/09). Không lộ ra ngoài máy, nhưng token nằm trong log là thứ không nên; sửa bằng `Defaults!/usr/bin/node env_reset`/`log_allowed` hay chuyển token qua tệp 600 thay vì env. Chưa làm — chờ chủ dự án vì đụng sudoers.
- ~~**Đĩa box ĐẦY 100% (đo 07/09).**~~ **TỰ VỀ 07/09, không ai prune** — đo lại vài giờ sau: **65% dùng, còn 36 GB, Build
  Cache 0 B**. `docker build` của cinapi đang chạy dở lúc đo lần đầu đã xong và trả lại ~35 GB. Tức con số "29,93 GB build
  cache thu hồi được 100%" là ảnh chụp GIỮA một lần build của người khác, không phải rác tồn đọng — và quyết định KHÔNG
  prune trên máy dùng chung hoá ra đúng vì lý do mạnh hơn tôi biết lúc ấy. Giữ lại số cũ dưới đây để lần sau đọc được cách
  phân biệt: `docker system df` khai "reclaimable" theo trạng thái tức thời, một build đang chạy trông y hệt rác.
  Số cũ: `/var/lib/docker` **50G** (build cache 29,93 GB / 0 mục đang dùng + 2,4 GB image thừa), `/root/flow-profiles` 13G
  (hồ sơ Chrome của automation KHÁC trên cùng máy), `/var/log` 1,2G, journal 614M. Lộ ra vì một lệnh `cp` tầm thường
  báo *No space left on device*. Cái ăn chỗ: `/var/lib/docker` **50G**, trong đó `docker system df` khai **build cache
  29,93 GB với 0 mục đang dùng** (thu hồi được 100%) + 2,4 GB image thừa; ngoài ra `/root/flow-profiles` 13G (hồ sơ Chrome
  của automation KHÁC trên cùng máy), `/var/log` 1,2G, journal 614M. `docker builder prune` lấy lại ~30 GB và không đụng
  container đang chạy — **không làm**: box này chở cinapi/convex/n8n của người khác. Hệ quả nếu đĩa đầy thật: mọi thứ ghi
  đĩa trên box hỏng im lặng — daemon, ảnh chụp, tệp chép sang, và cả bài đo.
- ~~**Desktop `:77` không có ai dựng lại sau reboot (đo 07/09).**~~ **ĐÓNG 07/09** — bảy unit nay là file thật trong repo
  (`infra/box/systemd/`), xem §6 mục 37.
- **~~Replica LẠNH không dựng nổi từ trang đuôi lớn~~ — ĐỌC ĐƯỢC CƠ CHẾ 08/09, và nó KHÔNG phải trần kích cỡ mà là một CUỘC ĐUA.** Tìm ra hàm nhận trang đuôi trong renderer 0.43 (`index-Df98_wE4.js`, hàm `$` @3255435). Khi trang về mà **không có anchor** — đúng cảnh `ORDERED=0`, vì `observedAnchor` chỉ được đặt bởi khung CÓ `ordered` — nó chỉ áp trang nếu **cả ba** đúng: `me.epoch == null` **và** `me.value === Y.windowAtDispatch` **và** `observedAnchor == null`. Điều kiện giữa là phép so **ĐỒNG NHẤT THAM CHIẾU** với object cửa sổ lúc lệnh tải được PHÁT ĐI (`Q` @3258327 chụp `windowAtDispatch: Y.value`): bất cứ thứ gì thay object ấy trong lúc trang đang bay là trang bị bỏ, im lặng. Và trong trạng thái đứng thì **điều kiện 1 và 3 chứng minh được là ĐÚNG** (lát đo được `epochHint: null`; `ORDERED=0` nên không khung nào gọi `O(V,K)`, mà nhánh không-`ordered` còn tự xoá `observedAnchor`) ⇒ **chỗ bỏ trang chỉ có thể là điều kiện 2**. Còn một kẻ vô hiệu hoá THỨ HAI, độc lập: dòng đầu của tay nhận reply trong `Q` là `if(te !== V.fetchAttempt) return`, và nhánh không-`ordered` của `ae` (@3261007) làm `me.fetchAttempt += 1` — một khung tới giữa nhịp là reply bị bỏ ngay ở dòng đầu. **Nên kích cỡ không phải hàng rào, nó chỉ quyết ai thắng cuộc đua**: trang 1 entry về đủ nhanh để kịp áp, trang 170 entry / 77 KB thì không. Điều này cũng giải thích vì sao lúc BÌNH THƯỜNG (`ordered` bật) không ai gặp: cả `ae` lẫn `ne` đi nhánh ordered, không bump `fetchAttempt`, không thay cửa sổ — đo được neo lành ở ba bot đang dùng. **Dự đoán CHƯA ĐO, và là việc kế tiếp**: một trang ĐẦY vẫn áp được nếu phát **đúng MỘT khung rồi im**, không cần hạ trần trang. Đo bằng: `ORDERED=0` → nạp lại → một khung duy nhất → chờ → đọc lát. Nếu đúng thì công thức khẩn gọn lại còn "một khung rồi im", và cửa thoát khẩn `ORDERED=0` bớt nguy hiểm đi nhiều. **Một giả thuyết của tôi trong lượt này bị chính số đo giết, chép lại để khỏi đi lại**: tôi thấy khung `type:"snapshot"` không mang `ordered` và nghi nó đang de-anchor mọi replica; sai — khung ấy ở kênh **`outline`** (`sse.ts:300`), nó vào reducer outline và không bao giờ tới replica bản ghi. (Ảnh chụp cũ, giữ để đối chiếu: lần đầu xoá lát rồi client hỏi đuôi 31 lượt, backend trả đủ 164 entry mỗi lượt, lưu 0 byte, pane `plane-inset:leading`; lần hai 3 lượt, trang 170 entry, cũng 0 byte.)

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
| [tool-doi-chieu.md](../extracted/tool-doi-chieu.md) | 75 tool bên mình · vì sao không đếm được tool hãng · máy người dùng: 5/7 hành động và 5 là trần của chính daemon hãng |
| [loi-nhac-va-tool-app-goc.md](../extracted/loi-nhac-va-tool-app-goc.md) | system prompt hãng ở ĐÂU · số lái agent (model, trần ngữ cảnh, trần tool) · lời nhắc agent thoại nguyên văn |
| [0-43-transcript-context.md](../extracted/0-43-transcript-context.md) | bản ghi + ngữ cảnh MỘT phiên bot: trang đuôi · replica `ordered` · trọng lượng entry · nén ngữ cảnh hãng vs ta |
| [ship-to-users.md](../plan/ship-to-users.md) | website → tải → cài · billing |
| [per-user-on-one-box.md](../plan/per-user-on-one-box.md) | tách OS user · thu hồi khi nghỉ |
| [one-display-per-bot.md](../plan/one-display-per-bot.md) | một màn hình mỗi bot · sức chứa box |
| [desktop-computer-use.md](../plan/desktop-computer-use.md) | điều khiển máy tính · dạy việc |
| [architecture.md](../architecture.md) | kiến trúc tổng, viết tay |
| [architecture/so-do-tu-sinh.md](../architecture/so-do-tu-sinh.md) | sơ đồ do MÁY vẽ từ import thật — `pnpm arch:graph` |
| [legal.md](../legal.md) | ranh giới: dùng cá nhân / nghiên cứu |
| [runbooks/trien-khai.md](../runbooks/trien-khai.md) | triển khai + **lùi bản** — §1 là nút lùi |
