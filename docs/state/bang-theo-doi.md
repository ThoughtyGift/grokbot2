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
mã             76 file test · 82 file nguồn · 592 bài xanh · typecheck sạch (đo 02/09)
parity         0 ca lệch HÀNH VI — còn 21 (khác môi trường: WebGL) + 23 (khác cách vẽ: widget vs câu)
bản vá client  6 bản, `--verify` còn nguyên
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
| 13 · Teach a task qua giao diện | `e2e-teach.mjs` **11/11**: nút `+` → lớp phủ → recorder đúng tab → skill mới có instructions thật |
| 14 · Lớp tự soát 3 mặt | `computer` · `automation_write` · `subagent`, đo **7/7**; một ca không đo được là bỏ cả lượt (`khongDoDuoc`) |
| 8 · Tự cập nhật | moi xong cơ chế của hãng, chưa dựng |

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

**Bảng tool dựng bằng grep thiếu đúng nhóm hay hỏng nhất.** 16 tool `browser_*` và 8 tool box nạp
vào `TOOLS` bằng vòng lặp ở mức module, nên grep tĩnh ra 47 trong khi thật là **75**. "Thiếu trong
bảng" trông y hệt "không tồn tại" — bảng tool phải lấy LÚC CHẠY
(`scripts/tool-hien-co.mts`). Và `boxHealth()` không bao giờ ném, nó *trả về* chuỗi lỗi: bản đầu
của script ấy bọc `try/catch` rồi in `SỐNG` đè lên đúng câu `KHÔNG tới được`.

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
