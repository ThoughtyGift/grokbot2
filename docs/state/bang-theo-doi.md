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
mã             74 file test · 82 file nguồn · 587 bài xanh · typecheck sạch (đo 01/09)
parity         2 ca lệch ỔN ĐỊNH (case 12, 21) — đo 02/09 SAU khi sửa nhịp chờ; 14 đúng, 7 dao động
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

**Số đo hiện hành — 02/09, SAU khi sửa nhịp chờ: 2 ca lệch ổn định (12, 21).** 14 ca ổn định đúng,
7 ca dao động (5, 14, 15, 16, 19, 22, 23). Ba lượt đủ 23/23.

**Con số "0 ca lệch" của lượt đo TRƯỚC đó là số của một phép đo hỏng — đừng dùng lại.** Lượt ấy chạy
với `app-replay-b2` còn chờ theo cờ `streaming`, nên nó gõ ca sau khi lượt trước chưa xong: ca bị
giết (`stopped without replying`), và widget của ca này rơi vào cửa sổ của ca kia. Sửa nhịp chờ sang
`isRunning` thì `stopped without replying` về **0**, case 3/4/9/20 từ "dao động" thành "ổn định
đúng" — và **lộ ra hai ca lệch ổn định mà phép đo hỏng đang che**: case 12 (0/3 → 3/3 THỪA) và case
21 (2/3 → 3/3 THỪA).

Bài học lặp lại nguyên văn từ §7: cùng một con số "7 ca dao động", hai tập hợp khác hẳn. **Sửa bài đo
trước, rồi mới đọc số.**

Hai ca từng lệch ổn định:

| ca | 01/09 | 02/09 | sửa bằng gì |
|---|---|---|---|
| **1** *"tính năng nào mới"* | 3/3 mời chọn | **0/3 · ổn định đúng** | vế thứ ba trong lời nhắc: *không biết thì đi TRA* |
| **3** *"recording is finished"* | 2/2 mời chọn | **1/3 · dao động** | chặn `ask_question` bằng cờ `luotHocTuBanGhi` |

Case 3 phải đọc kỹ hơn con số. Ba lượt là ba chuyện khác nhau: một lượt đúng (bot chốt bản ghi rồi
giải thích), một lượt có widget **thuộc case 2** (*"Mình cài connector X cho khớp bản mới nhé?"* — bot
còn đang dở việc mở trang Updates thì tin case 3 tới), và một lượt `stopped without replying` vì case
2 vẫn đang chạy. Case 4 của cùng lượt ấy cũng im đúng kiểu đó, mà case 4 không liên quan gì bản sửa.
Xem bẫy "cửa sổ đo không khớp với lượt" ở §7.

Trước đây:

| | ca | mong đợi | ta | đọc là |
|---|---|---|---|---|
| lệch | **1** · *"bản moi nhất grok bpot có tinh năng nào mới"* | không mời chọn | **3/3 mời chọn** | ổn định THỪA |
| lệch | **3** · *"The recording is finished. Learn the task from it."* | không mời chọn | **2/2 mời chọn** | ổn định THỪA |
| đã chữa | **10** · *"buid cho mình dàn bot"* | không mời chọn | 0/2 | ổn định đúng |
| đã chữa | **6** · *"Partner ID … lấy ở đâu"* | mời chọn | 2/2 | ổn định đúng |
| bỏ ngỏ | **9, 12, 14, 15, 17, 21, 22** | — | 1/2 | dao động |

Case 10 là câu trả lời cho dòng "đã chỉnh lời dặn, chưa đo lại" của bản trước: **bản chỉnh có tác
dụng**. Case 3 thì đáng chú ý vì nó là chính luồng *teach a task* — sau khi bản ghi kết thúc, app gốc
học rồi làm, còn ta hỏi thêm một câu.

**Đã sửa cả hai ca lệch, đo bằng `do-mot-ca` (01/09):**

| ca | trước | sau | sửa bằng gì |
|---|---|---|---|
| **1** | 3/3 mời chọn | **0/3** · bot `web_search` ×2 → `web_fetch` ×2 → trả dữ kiện thật ("bản stable 0.29.0, ra 27/08…") | thêm **vế thứ ba** vào lời nhắc: *không biết thì đi TRA*, kèm ví dụ chép nguyên văn |
| **3** | 2/2 mời chọn | **0/3** · bot gọi `demo_stop` rồi nói một câu | **chặn bằng công cụ**: cờ `luotHocTuBanGhi` khoá `ask_question` đúng lượt tin hệ thống `CAU_GHI_XONG` |
| kiểm đầu kia | — | case 6 **3/3 CÓ** widget · case 11 **3/3 CÓ** widget | núm không bị vặn sang đầu kia |

Case 3 là lần đầu chữa parity bằng **cấu trúc** thay vì câu chữ, và nó chỉ làm được vì ca đó có mốc
để bám: văn bản tin là một hằng số do client gửi. Các ca khác không có mốc ấy — nên vế thứ ba của
case 1 vẫn phải là một ví dụ trong lời nhắc.

Một chỗ suýt sai khi chặn bằng công cụ: nhánh `ask_question` **park** lượt lại để chờ người bấm và
tắt presence. Chặn mà vẫn đi vào nhánh ấy thì bot **IM** — tệ hơn hẳn widget thừa. Nên câu chặn trả
về như kết quả của một tool thường, và đã kiểm bằng cách đọc chữ chứ không chỉ đếm widget: bot nói
*"Ok, mình chốt bản ghi lại rồi xem nó dạy việc gì."* rồi gọi `demo_stop`.

**Số ở bảng trên chưa đổi theo hai kết quả này**, và đó là cố ý: `do-mot-ca` đi thẳng cửa
`sendPrompt`, còn bảng đo qua **giao diện thật** với ngữ cảnh các ca trước. Hai bài đo khác nhau thì
không được trộn số. Muốn đổi bảng phải chạy lại `parity-lap --lan 3`.

**Đọc con số này cho đúng.** Mẫu số phần lớn là **2**, không phải 3: lượt 1 cạn hạn mức sau 2 ca, nên
chỉ case 1 có đủ ba lượt. Với hai lượt thì "1/2" nằm đúng giữa và không phân biệt được nhiễu với tín
hiệu — đó là lý do 7 ca ghi "chưa đủ dữ liệu" thay vì bị đếm thành lệch. Và con số 2 này **không so
trừ được** với "21/23" hay "22/23" của các bản trước: §7 đã trả giá cho chuyện đó — hai lần đo cùng ra
"4 ca lệch" nhưng là hai tập hợp khác hẳn.

Lịch sử vặn lời nhắc dưới đây giữ lại vì nó giải thích vì sao case 6 và 10 hết lệch:

| vòng | đổi gì | lệch ổn định |
|---|---|---|
| 1 | "mời chọn SAU khi đã tra" | **2** ← giữ bản này |
| 2 | thêm "việc cụ thể thì phải đi TRA" | 3 |
| 3 | thu hẹp còn "hỏi mình CÓ CÔNG CỤ gì" | 3 |
| 4 | dữ kiện "mảng này đã mở chưa" (`nguCanhMoiChon`) | 4 → **đã tắt** |
| 5 | ba VÍ DỤ thật đưa vào lời nhắc (trước nằm trong chú thích) | 5 — hết THIẾU, sinh THỪA |
| 6 | thêm vế NGƯỢC ("biết bước tiếp thì làm, đừng hỏi") | **1** ← bản hiện tại |

Vòng 5 mới là chỗ đổi cục diện, và nó buồn cười: bốn ví dụ mô tả chính xác luật ĐÃ nằm trong
`tools.ts` từ lâu — trong một khối chú thích. Người đọc code thấy; model thì không, vì chú thích
không đi vào chuỗi nào. Ba vòng vặn luật văn xuôi trước đó là ba lần diễn đạt lại một quy tắc mà
bản mô tả chính xác nhất của nó nằm cách đó mười dòng và chưa bao giờ được gửi đi.

Vòng 6 thêm vế ngược, vì vòng 5 chữa hết THIẾU nhưng sinh THỪA — dạy "khi nào mời chọn" mà không
dạy "khi nào thôi" thì được đúng một nửa. Ca lệch của vòng đó (case 10 · "dựng dàn bot") là cái giá
của bước đặt lịch vừa thêm: bot ta hỏi bằng widget, app gốc hỏi bằng một câu thường. Lời dặn đã chỉnh,
và **lượt đo 01/09 xác nhận nó hết lệch** (0/2) — xem bảng đầu mục.

Vòng 4 là lần đầu đo TRỌN bộ (23 ca × 3 lượt, 69/69 có trả lời). Nó cũng dạy cách đọc con số: bản
có hàm ấy ra 4 ca lệch (5, 6, 15 thiếu · 7 thừa), bản đã tắt cũng ra 4 — nhưng là (6, 11, 15 thiếu ·
13 thừa). Cùng số, khác tập hợp. **Giao của hai lần đo là case 6 và 15** — đó mới là 2 ca thật.

Muốn tiến thêm phải đổi thứ khác một luật văn xuôi — dạy bằng ví dụ trong ngữ cảnh, hoặc một tool
riêng cho "tra catalog" để mô hình phân biệt bằng công cụ chứ không bằng cách hiểu chữ.

## 5 · Việc còn lại, theo thứ tự đáng làm

| # | việc | chặn bởi | kiểm bằng |
|---|---|---|---|
| 1 | Dùng máy Windows vào việc thật | cần nêu một việc cụ thể | cửa đã thông hai chiều |
| 2 | Máy thứ hai trỏ vào VPS (`T2` · `4.8`) | cần máy thật thứ hai | mở app máy 2 → chat một lượt |
| 3 | Box qua hầm từ máy khác (`T3`) | như trên | — |
| 4 | Hai máy một box (`T5`) | **bắt buộc** hai máy thật | — |
| 5 | Billing `enforce` | cố ý chờ đủ số một tuần | `GROKBOT2_BILLING=enforce` |
| 6 | Voice-call (5) + phòng chung (9) | cờ client đang tắt | chỉ làm khi bật cờ |
| 7 | ~~Cơ chế `generation` / `CursorTooOld`~~ **hạ ưu tiên 02/09** | client tra tail 198.691 lượt với `limit:500`, ta trả đủ → nhịp tra kế tiếp tự lấp | chỉ còn hở khi mất kết nối mà bản ghi mọc **>500 entry** — xem [0-30-transcript-watch.md](../extracted/0-30-transcript-watch.md) §7 |
| 8 | Tự cập nhật client | đã moi xong cơ chế, chưa dựng | — |
| ~~9~~ | ~~Sáu trường bỏ qua~~ **ĐÓNG 02/09** | cả sáu đều không có hệ quả đo được: `branched` không ai đọc, khoá gốc luồng là chuyện nội bộ client | [§8 + §8b](../extracted/0-30-transcript-watch.md) |

*Bỏ khỏi bảng vì đã xong (02/09): "mở lớp tự soát sang `subagent`" — đã gắn đủ ba mặt trong
`tools.ts` (`computer`, `automation_write`, `subagent`) và đo 7/7; và "hai ca parity còn lệch" —
nay 0 ca lệch ổn định.*

## 6 · Đã xong — kết luận, không phải nhật ký

| chặng | kết quả |
|---|---|
| 0 · Dọn mã | cổng 9/9; `mcp.ts` 936 → <800; `bootstrap.ts` 862 → <800 |
| 1 · Đo được tiền | `GROKBOT2_BILLING=warn` có số thật; `enforce` cố ý chưa bật |
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

## 8 · Chưa chắc chắn

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
| [ship-to-users.md](../plan/ship-to-users.md) | website → tải → cài · billing |
| [per-user-on-one-box.md](../plan/per-user-on-one-box.md) | tách OS user · thu hồi khi nghỉ |
| [one-display-per-bot.md](../plan/one-display-per-bot.md) | một màn hình mỗi bot · sức chứa box |
| [desktop-computer-use.md](../plan/desktop-computer-use.md) | điều khiển máy tính · dạy việc |
| [architecture.md](../architecture.md) | kiến trúc tổng, viết tay |
| [architecture/so-do-tu-sinh.md](../architecture/so-do-tu-sinh.md) | sơ đồ do MÁY vẽ từ import thật — `pnpm arch:graph` |
| [legal.md](../legal.md) | ranh giới: dùng cá nhân / nghiên cứu |
| [runbooks/trien-khai.md](../runbooks/trien-khai.md) | triển khai + **lùi bản** — §1 là nút lùi |
