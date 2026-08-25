# BẢNG THEO DÕI — một chỗ duy nhất

Gộp X-quang · lộ trình · danh sách việc · E2E vào **một tài liệu để theo dõi**. Mọi thứ ở đây đo từ
hệ đang chạy ngày **25/08/2026**. Tài liệu sâu nằm chỗ khác (xem §6) — chỗ này chỉ giữ **trạng thái
và việc**, để không phải mở tám file mới biết đang ở đâu.

Chạy lại phần đo: `node services/grokbot-backend/scripts/self-xray.mjs`

---

## 1 · Hôm nay đang ở đâu

| | |
|---|---|
| **Backend** | 4 tiến trình · 15.687 dòng TS · 29 route `/v1` · 120 lệnh cổng (103 đã gọi thật) |
| **Dữ liệu** | 14 bảng · 2.036 tin nhắn · 8 bot · 8 routine · **10 bảng có `owner_id`** |
| **Bot** | 60 công cụ · 4 loại thợ phụ · màn hình ảo 1920×1080 trên box |
| **Trang tải** | `/` + `/download/windows` (**.exe 2 MB**) + `/download/mac` (.command 27 KB) |
| **Kiểm thử** | 26 file unit · 58 bộ e2e · máy đo tự động **7/9 xanh** |
| **Chưa mở ra ngoài** | cả 4 cổng nghe `127.0.0.1` — đó là thứ đang giữ an toàn, không phải xác thực |

**Đọc một dòng nếu chỉ đọc một dòng:** phần khó nhất (bot làm việc thật) đã chạy; phần còn lại là
**dọn nhà và mở cửa cho người thứ hai**.

---

## 2 · Máy đo tự động — 7/9

| mục | trạng thái |
|---|---|
| code chết (knip) | ok · 72 phát hiện (đúng mốc) |
| **kích thước code** | **ĐỎ** · 5 file > 800 dòng · 28 hàm > 50 dòng — **tăng** từ 3/16 |
| ranh giới tầng | ok · 7 luật đạt |
| ngân sách bundle | ok · 95 KB thô / 31 KB gzip |
| hợp đồng client | ok · khớp bản đã trích |
| spec `/v1` | ok · 29 route · 32 schema |
| docs | ok · 0 link chết · 0 mồ côi |
| nhật ký e2e | ok · 98 lượt — *xem cảnh báo §5* |
| **không lặp lại** | **ĐỎ** · cùng mục đỏ hai lượt liền → **dừng tính năng, sửa cái sinh ra nó** |

Năm file quá dài, theo thứ tự nên tách:

```
1840  apps/grokbot-web/src/main.ts
1224  services/grokbot-backend/src/runtime/tools.ts
1195  services/grokbot-backend/src/runtime/turn.ts
 936  services/grokbot-backend/src/mcp.ts
 863  packages/grokbot-proto/src/bootstrap.ts
```

Bốn hàm dài nhất: `handleNative` **564** · `buildCommands` **408** · `createGatewayRouter` **270** ·
`runTurn` **251**.

---

## 3 · Việc còn lại — một danh sách, theo thứ tự

Thứ tự ở đây là **cái gì chặn cái gì**, không phải theo độ khó.

### Chặng 0 · Dọn — luật của chính dự án đang đỏ

- [ ] Tách `main.ts` (1840) — nặng nhất, và là FE nên ít rủi ro nhất
- [ ] Tách `tools.ts` + `turn.ts` — nhóm theo họ công cụ, không cắt ngang một lượt chat
- [ ] Tách `handleNative` (564 dòng) thành bảng route
- [ ] Xoá export chết vừa tạo hôm nay (`describeCrops`, `readCrop`, `leasesSnapshot`…)
- **Xong khi:** `self-xray` **9/9 xanh**

> Thành thật: phần **tăng** từ 3/16 lên 5/28 là do việc của tôi hôm nay (`admin.ts:page`, các
> export chưa ai dùng). Luật "không lặp lại" đỏ chính vì để nó qua hai lượt.

### Chặng 1 · Đo được tiền *(chạy song song — chỉ một biến môi trường)*

- [ ] Bật `GROKBOT2_BILLING=warn`, để một tuần
- [ ] Bảng `plans` đang **rỗng** — chạy seed
- **Xong khi:** bảng `usage` có dòng thật (hiện **0 dòng** — chưa từng đo được gì)
- **Đừng** bật `enforce` khi chưa có số: đó là cách nhanh nhất tự khoá mình ra ngoài

### Chặng 2 · Vá ba lỗ đăng nhập — bắt buộc trước khi rời `127.0.0.1`

- [ ] Thu hồi token được (hiện `logout` **không thu hồi gì**, JWT sống **365 ngày**)
- [ ] Chặn đoán mật khẩu (hiện **không có** giới hạn nào)
- [ ] Khoá `/v1/register` sau người đầu (hiện **mở cho bất kỳ ai** gọi được cổng)
- **Xong khi:** đoán sai 5 lần bị chặn · token cũ hết hiệu lực sau logout · đăng ký cần bật mới mở

### Chặng 3 · Test trên máy thứ hai — cái thước đo ranh giới

Chi tiết + tiêu chí từng bước: [system-xray.md §6c](system-xray.md).

- [ ] **T1** `pnpm backend` trên máy sạch → `/v1/health` ok · `.data/grokbot.sqlite` **tự sinh**
- [ ] **T2** một lượt chat thật (chỉ mang 4 file bí mật < 1 KB)
- [ ] **T3** box qua `box-tunnel.ps1` → bot liệt kê được `/home/box/workspace`
- [ ] **T4** chạy **.exe** trên máy sạch → có shortcut mang logo, app mở lên
- [ ] **T5** hai máy cùng một box → *dự đoán **ĐỎ***; nếu đỏ thật thì đó là **bằng chứng hiện
      trường** cho Chặng 5, đừng sửa vội, ghi lại đúng cái xảy ra

### Chặng 4 · Đưa BE ra khỏi máy cá nhân *(cần Chặng 2 xong)*

- [ ] Đổi `server.listen(config.port, "127.0.0.1")` — [index.ts:355](../../services/grokbot-backend/src/index.ts#L355)
- [ ] CORS + HTTPS
- [ ] `host_settings` theo từng người (hiện **một dòng dùng chung cho tất cả**)
- **Xong khi:** **T6** — máy 1 và máy 2 thấy **cùng một** dữ liệu

### Chặng 5 · Tách người dùng trên box — **ba tầng**, không phải hai

Kế hoạch đầy đủ: [per-user-on-one-box.md](../plan/per-user-on-one-box.md).

- [ ] Bước root một lần (`useradd` + sudoers) — **chỗ chặn duy nhất cần người quản trị VPS**
- [ ] Chuyển từng mặt hàng sang home của user (Chrome profile · grok-memory · workspace)
- [ ] Thu hồi khi nghỉ — chỗ quyết định chi phí
- [ ] Mượn **hình dạng** `SandboxPolicy` của hãng (allowlist đường dẫn + `NetworkPolicy`), tự làm
      phần cưỡng chế
- **Xong khi:** bot của A đọc file của B **bị kernel từ chối**

> Đã sửa một giả định sai: **hãng không giải bài này** — ranh giới giữa người với người của họ chính
> là **cái box**, mỗi người một cái. Trong bundle không có lời giải để chép.

### Chặng 6 · FE riêng

- [ ] **Routines** — mảng trống lớn nhất ([fe-clone-plan.md](../plan/fe-clone-plan.md))

### Nợ lẻ — không chặn ai, nhưng đừng quên

- [ ] **Cloudflare:** thử một trang có chặn thật (5 phút), rồi thêm bước để bot **biết mình đang bị
      chặn** thay vì loay hoay. Hiện **0 dòng** mã nhắc tới cloudflare/captcha
- [ ] Bộ cài **macOS chưa chạy trên máy Mac thật** — chỉ có bài kiểm đường dẫn
- [ ] **.exe mới dựng, chưa cài thử** — cần một máy sạch, hoặc chấp nhận cài đè lên máy này
- [ ] `self-xray` **tự ghi chính nó vào nhật ký e2e** → làm hỏng chỉ số (xem §5)
- [ ] 6 bot xoá 04:16–04:42 ngày 24/08 **vẫn cứu được** từ `grokbot.sqlite.7.bak` — **chờ bạn quyết**
- [ ] `bot.log` trên box **in token Telegram ra log** → đổi token + xoay log
- [ ] `publishSkill` cần một registry — thuộc hạ tầng, không thuộc client

---

## 4 · E2E — chạy gì, khi nào

**58 bộ** trong `services/grokbot-backend/scripts/`. Bốn bộ hay dùng nhất:

| bộ | lệnh | phủ gì |
|---|---|---|
| Desktop | `node scripts/e2e-desktop.mjs` | 29 mục · điều khiển máy tính + dạy việc |
| Task | `node scripts/e2e-tasks.mjs` | 14 mục · `task` / `await_task` |
| Hợp đồng | `node scripts/contract-test.mjs` | 46 mục · shape trả về cho client |
| Unit | `npx tsx --test src/*.test.ts` | 26 file |

Trước khi làm tiếp, nên chạy: **unit → hợp đồng → desktop**. Nhóm dựa vào thị giác chập chờn
**10–20%** (5 lượt đo: 29/29 · 27/29 · 28/29 · 29/29 · 28/29) — lỗi rơi vào **chỗ khác nhau mỗi
lần**, đó là hình dạng của việc bấm không toạ độ, không phải một lỗi sửa bằng một commit.

**Luôn kiểm trước khi chạy bộ có đụng màn hình:** `curl -s localhost:8788/v1/health` → `isBusy`
phải là `false`. Cắt ngang một bot đang làm việc thật là hỏng việc của người dùng.

---

## 5 · Chưa chắc chắn — và cảnh báo về chính số đo

- **"12/20 lượt e2e gần nhất đỏ" là số bị nhiễu.** `self-xray` ghi mỗi lần chạy của chính nó vào
  `e2e-history.jsonl` với `pass:false` khi cổng đỏ. Hôm nay tôi chạy nó nhiều lần, nên phần lớn
  "lượt đỏ" là chính nó. **Đừng đọc con số này là "e2e đang hỏng"** cho tới khi sửa chỗ ghi log.
- **Mất mạng:** lịch sử chắc chắn đọc được (SQLite cục bộ), nhưng **chưa thử rút mạng** xem app có
  boot trọn không.
- **Cloudflare có nhận ra Chrome của mình không** — chưa thử trang thật.
- **Tên binary cưỡng chế sandbox của hãng** — hàm trả đường dẫn bị minify, chưa truy ra.
- **File tên hỏng** `{"contents_after_edit":…}` trong workspace — chưa truy được lượt nào tạo ra.

---

## 6 · Tài liệu nào giữ cái gì

Bảng này để **không chép lại nội dung** — mỗi thứ có đúng một chỗ ở.

| tài liệu | giữ gì |
|---|---|
| **bảng này** | trạng thái + việc còn lại + E2E |
| [system-xray.md](system-xray.md) | x-quang toàn hệ cho người không rành kỹ thuật · vận hành · test máy thứ hai |
| [ship-to-users.md](../plan/ship-to-users.md) | website → tải → cài · billing · cái gì ở máy khách cái gì ở VPS |
| [per-user-on-one-box.md](../plan/per-user-on-one-box.md) | tách OS user · thu hồi khi nghỉ · cách hãng cô lập |
| [one-display-per-bot.md](../plan/one-display-per-bot.md) | một màn hình mỗi bot · sức chứa box |
| [desktop-computer-use.md](../plan/desktop-computer-use.md) | điều khiển máy tính · dạy việc |
| [fe-clone-plan.md](../plan/fe-clone-plan.md) | FE riêng, chia việc theo API |
| [protocol-reference.md](../protocol-reference.md) | hợp đồng với client — **đọc trước khi đổi shape** |
| [architecture.md](../architecture.md) | kiến trúc tổng |
| [legal.md](../legal.md) | ranh giới: dùng cá nhân / nghiên cứu |

---

## 7 · Ba câu hỏi nên trả lời trước khi code tiếp

1. **Dọn trước hay làm tiếp?** Luật của dự án nói dọn (đỏ hai lượt liền). Tôi cũng nghĩ vậy — chặng
   0 mất khoảng một lượt làm việc, và mọi chặng sau đều đụng vào đúng mấy file đó.
2. **6 bot đã xoá — cứu hay bỏ?** Bản sao còn đó, nhưng càng để lâu càng dễ lẫn với dữ liệu mới.
3. **Test máy thứ hai bằng máy nào?** Một laptop khác, hoặc một tài khoản Windows khác trên chính
   máy này cũng đủ cho T1–T4. Riêng **T5 cần hai máy thật**.
