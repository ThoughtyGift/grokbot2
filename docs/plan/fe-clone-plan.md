# Kế hoạch clone FE app gốc về `http://127.0.0.1:5173`

**Đích:** FE ở `apps/grokbot-web` khớp app gốc tới từng chi tiết đo được.
**Ranh giới:** không chép bundle/CSS/asset của hãng ([legal.md](../legal.md), ROADMAP R4). Đo rồi tự
viết. Avatar dùng `bloub` (MIT) — chính app gốc cũng dùng con bot đó.

**Thước đo:** `node services/grokbot-backend/scripts/ui-diff.mjs` — so từng thuộc tính giữa app
(CDP :9222) và FE (:5173) ở nhiều khổ cửa sổ, neo vào cấu trúc DOM chứ không vào ngưỡng pixel.

## Trạng thái đo (2026-08-22, 1920×1040)

```
khớp 40/40 (100%), 0 vùng thiếu, 1 mục không so được
```

Mẫu số đã tăng 28 → 40 vì mỗi việc xong đều **thêm anchor** cho vùng vừa dựng. 100% nói về 19 vùng
đã dựng; nó không nói gì về vùng chưa có (xem nhóm B và C).

Mục "không so được" là bubble của người dùng — hội thoại app đang mở là bot-với-bot nên không có
loại tin đó để so. Không so được thì ghi là không so được, không tính thành khớp.

Đã khớp: nền · chữ · sidebar 261 · row 236×54 · toolbar 52 · cột chat 1302 · transcript ·
bubble bot (nền 38,38,38 · bo 18/6 · đệm 8/12 · chữ 14/20) · bubble tôi (nền 90,90,90) ·
thanh hover 24px · nút hover 24×24 bo 8 · dock 60 · info-pane 357 · khung màn hình 325.

**96% là về những vùng đã dựng.** Nó KHÔNG nói gì về vùng chưa dựng — đó là phần dưới đây.

## Chia việc theo API

Xếp theo API vì đó là thứ quyết định việc *có làm được không*: task nhóm A chỉ cần sửa FE, nhóm B
cần route `/v1` mới, nhóm C cần cả hợp đồng mới ở backend.

### A — chỉ FE, API đã đủ

| # | Việc | Đo từ | API đã có | Nghiệm thu |
|---|---|---|---|---|
| ✅ A1 | **Gộp lượt nói (author run)** + đuôi bubble chỉ ở tin CUỐI của lượt | `sand-author-run`, `__column`; lệch duy nhất hiện nay | `transcript` đã có `author` | `ui-diff` hết dòng `bubble tôi radius` |
| A2 | **Transcript ảo hoá + phân trang** | `sand-virtual-transcript__inner/__row` | `GET /transcript?beforeSeq` (đã có, FE chưa dùng) | mở bot 500 tin: DOM < 100 row, cuộn lên nạp thêm |
| A3 | **Nhóm sidebar gập được + đếm số** ("BOT HTML **1**") | `sand-agents-section__header/__reveal` 236×30 | `/v1/host/sidebar` (GET) | gập/mở đúng, số đếm khớp roster |
| ✅ A4 | **Trạng thái rỗng** "No Bot selected." | ảnh app | — | không chọn bot ⇒ hiện đúng chỗ |
| ✅ A5 | **Toolbar phải**: `Bot settings`, `Close details` (đóng/mở info-pane) | nhãn @1710,12 và @1740,12 | — | đóng pane ⇒ cột chat giãn ra 1659 |
| ✅ A6 | **Composer**: placeholder `Prompt`, nút `Attach file`, `Start voice input` | `sand-prompt-pad` 1268×42 | upload đã có | `ui-diff` khớp pill 1268×42 |
| ⏸ A7 | **Đáy sidebar**: `Plugins`, `Grok Local` | nhãn @12,946 và @12,988 | cần **B4** | **hoãn**: vẽ hai nút bấm vào không làm gì thì tệ hơn không vẽ — làm cùng B4 |

### B — cần route `/v1` mới, backend đã có nghiệp vụ

Nghiệp vụ đã chạy sau `/gw`; thiếu đúng đường cho FE của mình — **cùng dạng việc như avatar và
reaction đã làm**: route mỏng gọi thẳng hàm domain, không viết lại logic.

| # | Việc | Lệnh `/gw` đã có | Route cần thêm | Nghiệm thu |
|---|---|---|---|---|
| B1 | **Routines** (nút `Create Routine` trong info-pane) | `getAgentAutomations`, `createAgentAutomation`, `updateAgentAutomation`, `deleteAgentAutomation`, `setAgentAutomationEnabled` | `GET/POST/PATCH/DELETE /v1/agents/:id/routines` | e2e: tạo → hiện ở cả `/v1` và app gốc → xoá |
| B2 | **Tìm bot thật** (hiện FE lọc cục bộ) | `searchAgents` | `GET /v1/agents?q=` | tìm theo cả nội dung, không chỉ tên |
| B3 | **Gập nhóm / cài đặt host** | `getHostSettings`, `setHostSettings` | `GET/PATCH /v1/host/settings` | gập nhóm sống qua F5 |
| B4 | **Plugins** | `getPluginSyncStatus` | `GET /v1/plugins` | danh sách khớp app gốc |
| B5 | **Khay việc nền / subagent** | kênh SSE `subagents`, `async-tasks` | thêm 2 loại event vào `/v1/events` | bot chạy subagent ⇒ FE hiện, không phải F5 |

### C — cần hợp đồng mới (chưa có ở đâu)

| # | Việc | Vì sao chưa có | Ghi chú |
|---|---|---|---|
| C1 | **Reply vào một tin** (nút thứ 2 trên thanh hover) | không có lệnh `/gw` nào, không có trường `replyTo` trong transcript | phải thiết kế: lưu `replyTo` trên entry + render trích dẫn |
| C2 | **More message actions** (nút thứ 3) | chưa đo được menu chứa gì | đo trước, thiết kế sau — **không đoán** |

## Đã xong (2026-08-22)

| Việc | Kết quả đo |
|---|---|
| **A1** gộp lượt nói | luật đuôi bubble suy từ dữ liệu: "đuôi ⇔ lượt có hiện tên" khớp **5/5**, "đuôi ⇔ tin cuối lượt" chỉ 2/5. Bất biến: nhãn tên = đuôi = số lượt mở đầu khối (8 = 8 = 8 trên 17 lượt / 25 bubble) |
| **A4** hai trạng thái rỗng | "Chưa chọn bot." ≠ "Bắt đầu một cuộc trò chuyện." — app phân biệt, trước đây mình gộp một câu |
| **A5** đóng/mở panel | cột chat **1302 → 1659** đúng như tiêu chí nghiệm thu đã ghi trước khi làm |
| **A6** composer | nút 28×28 (đo từ `Attach file` / `Start voice input`), placeholder đúng giọng app, mic **chạy thật** bằng Web Speech API — chỉ hiện khi trình duyệt hỗ trợ |

Ba lệch **thật** mà mắt không thấy, tìm ra khi làm bốn việc trên: avatar row sidebar là **36** chứ
không phải 40 · nút composer **28** chứ không phải 34 · guard animation trỏ vào `.msg-row` (class
bị A1 xoá) nên đã hở, giờ trỏ `.run-gutter`.

## Thứ tự đề nghị

1. **A1** — đóng nốt lệch duy nhất còn lại, rẻ nhất.
2. **A5 + A4 + A6 + A7** — vỏ giao diện, không đụng backend, làm `ui-diff` phủ thêm vùng.
3. **A2** — ảo hoá; cần trước khi hội thoại dài thành vấn đề thật.
4. **B1** — Routines là mảng chức năng lớn nhất đang trống (`0/2` theo coverage).
5. **B3 + A3** — gập nhóm cần chỗ lưu, nên đi cùng nhau.
6. **B2, B4, B5** — theo tần suất dùng thật.
7. **C1, C2** — sau cùng: phải đo và thiết kế, không phải chỉ nối dây.

## Luật khi làm

- Mỗi task xong thì chạy `ui-diff` và ghi lại con số **trước/sau**. Không có số thì không tính là xong.
- Vùng mới dựng phải **thêm anchor** vào `ui-diff`, nếu không nó nằm ngoài mẫu số và 96% thành con
  số dối: nó chỉ nói về vùng đã dựng.
- Route `/v1` mới đi kèm một bài e2e ghi nhật ký (`recordRun`) — cùng khuôn với `e2e-avatar` và
  `e2e-reaction`.
- Không chép CSS/asset của hãng. Đo, rồi viết lại.
