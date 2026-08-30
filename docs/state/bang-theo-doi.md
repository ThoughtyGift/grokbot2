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
khiển được **cả box Linux lẫn máy Windows thật** của người dùng, và bám app gốc **21/23** ca đo
được. Phần chưa làm gần như trọn vẹn nằm sau các cờ tính năng mà **chính client đang tắt**.

```
lệnh gateway   hợp đồng 147 · có handler 149 · thiếu 16 (15 cái client tự tắt)
client gọi     148 lệnh · 0 đường còn 404
kênh           3: local-exec · webauthn · cookie-origin-approval
mã             70 file test · 80 file nguồn · 523 bài xanh · typecheck sạch
parity         21/23 ổn định qua 3 lượt · 20 bản ghi phát lại
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

Vì sao **không** thêm đường nâng quyền — đo từ chính daemon của hãng:
[nang-quyen-tren-may-nguoi-dung.md](../extracted/nang-quyen-tren-may-nguoi-dung.md).

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

## 4 · Bám app gốc

`21/23` ca khớp, ổn định qua 3 lượt. Hai ca còn lệch là hai **đầu đối nghịch của cùng một cái núm**:
vặn cho bot mời chọn nhiều hơn thì ca "biết edit video" khá lên và ca "tự đăng ký giúp" hỏng, vặn
ngược lại thì ngược lại.

| vòng | đổi gì | lệch ổn định |
|---|---|---|
| 1 | "mời chọn SAU khi đã tra" | **2** ← giữ bản này |
| 2 | thêm "việc cụ thể thì phải đi TRA" | 3 |
| 3 | thu hẹp còn "hỏi mình CÓ CÔNG CỤ gì" | 3 |

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
| 7 | Hai ca parity còn lệch | cần cách khác, không phải thêm luật | `parity-lap --lan 3` |
| 8 | Tự cập nhật client | đã moi xong cơ chế, chưa dựng | — |

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

**"Thiếu" phải kèm "có ai gọi không".** Đếm 17 lệnh thiếu đọc như một đống việc; "17, trong đó 15
cái client tự tắt" mới quyết định được.

## 8 · Chưa chắc chắn

- **Mất mạng:** lịch sử chắc chắn đọc được (SQLite cục bộ), nhưng **chưa thử rút mạng** xem app có
  boot trọn không.
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
