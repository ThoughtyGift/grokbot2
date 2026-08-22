# X-ray roadmap — bóc tách app gốc rồi clone FE về `127.0.0.1:5173`

Thay cho [fe-clone-plan.md](fe-clone-plan.md) (bản đó vẫn đúng, nhưng chỉ nói về vùng đã dựng).
Tài liệu này trả lời trước ba câu hỏi mà nếu không trả lời thì làm sẽ tù mù, rồi mới chia việc.

---

## 1. Có bóc tách được không? — CÓ, và đây là bằng chứng

Ba bộ đo, chạy trên app đang chạy, không đọc bundle:

| Script | Trả lời câu gì | Lệnh |
|---|---|---|
| [`x-ray.mjs`](../../services/grokbot-backend/scripts/x-ray.mjs) | bấm gì → đổi gì → chuyển động bao lâu | `node scripts/x-ray.mjs [--probe-clicks]` |
| [`ui-diff.mjs`](../../services/grokbot-backend/scripts/ui-diff.mjs) | lệch bao nhiêu, ở thuộc tính nào | `pnpm ui:diff` |
| [`ui-shots.mjs`](../../services/grokbot-backend/scripts/ui-shots.mjs) | lệch **trông** ra sao (chồng ảnh) | `pnpm ui:shots` |

`x-ray` mặc định **chỉ đọc**. `--probe-clicks` mới bấm, và chỉ bấm nhãn khớp danh sách an toàn
(mở/đóng panel, settings, back), từ chối mọi nhãn có *send/delete/run/new/attach…* — đây là app
thật với hội thoại thật của chủ máy, nên mặc định là không chạm.

### Đã đo được (2026-08-22)

**Panel kéo thả — CÓ, cả hai bên.** Không phải suy đoán:

```
81,0    12×1040   sand-sidebar-resize-handle     cursor:col-resize · role=separator  "Resize sidebar"
1563,0  10×1040   sand-info-pane__resize-handle  cursor:col-resize · role=separator  "Resize details"
```

**Sidebar có hai trạng thái.** Mở rộng 261px; thu gọn thành rail 88px với item **54×54**, `New` ở
đáy (30,944) và `Open account menu` (nút `GL`) ở 17,978.

**Panel phải là một stack điều hướng**, không phải một khối tĩnh: `sand-info-pane__nav-root` +
`__back` + `__subpage-title`. Bấm `View Bot settings` (nút danh tính trên toolbar, 128×28) đẩy vào
trang con `sand-agent-settings` 325×372 — trong đó có `sand-avatar-trigger__button` **64×64** và
input `Bot name`. `Back to details` pop ra.

**Animation của thao tác panel — số thật, lấy từ `transitionend`:**

```
width 240ms · opacity 160ms · background-color 120ms · padding-right 240ms
```

Bảng motion toàn màn hình: thời lượng `0.12s`(26 chỗ) · `0.2s`(12) · `0.15s`(8) · `0.1s`(4);
đường cong `ease`(33) · `cubic-bezier(0.22,1,0.36,1)`(17) · `ease-out`(5) · **một `linear()` 30+ mốc**
(3 chỗ — đó là cách CSS mô tả chuyển động đàn hồi); property được animate: `background-color`(32) ·
`color`(21) · `transform`(14) · `opacity`(11) · `width`(8) · `padding`(7).

> **Một số đo đã bị chính phép đo làm sai, và đã sửa.** Bản đầu lấy mẫu chữ ký layout 24 khung ×
> 28ms qua CDP rồi báo chuyển động "0–1008ms". Chi phí `evaluate` lấn vào kết quả. Đổi sang đọc
> `transitionend`/`animationend` thì ra 240ms. Ghi lại vì đây là cái bẫy sẽ tái diễn: một con số sai
> vẫn trông như một con số.

### Chưa lấy được, và vì sao

| Thứ | Vì sao | Cách lấy |
|---|---|---|
| Menu của `More message actions` | phải bấm mới biết, mà nút đó ngoài danh sách an toàn | mở tay một lần, chạy `x-ray` để chụp lúc menu đang mở |
| Animation lúc **gửi** một request | nhãn `send` bị `NEVER` chặn có chủ ý | gửi tay một tin trong app, `x-ray` đang chạy để bắt `transitionend` |
| Trạng thái gập nhóm sidebar | cần bấm `sand-agents-section__header` | thêm vào danh sách an toàn (không phá gì) |

Cách chung cho cả ba: **chủ máy thao tác tay, script chỉ ngồi bắt event.** Không cần script tự bấm.

---

## 2. Stack — vấn đề thật không phải thiếu thư viện

FE hiện tại là vanilla TS + Vite, một hàm `paint()` dựng lại **toàn bộ** cây DOM mỗi lần đổi. Kiểu
đó đã sinh ra bốn lỗi **trong đúng phiên làm việc này**, tất cả cùng một gốc:

| Lỗi | Phải chữa bằng |
|---|---|
| Gõ vào ô Tìm bot mất focus sau một ký tự | tự khôi phục focus + vị trí con trỏ sau mỗi lần vẽ |
| Mỗi lần vẽ để lại một vòng `requestAnimationFrame` chạy trên node đã rời DOM | tự giữ danh sách animator và `stop()` tay |
| `root.addEventListener` cộng dồn mỗi lần vẽ | thêm cờ `closeMenusBound` |
| Guard animation trỏ `.msg-row` — class bị A1 xoá nên guard **hở im lặng** | đổi sang `.run-gutter`, và chỉ phát hiện nhờ đọc lại code |

Bốn lỗi này không phải do viết cẩu thả; chúng là **giá của mô hình vẽ lại tất cả**. Và A2 (ảo hoá
transcript) thì không thể làm trên mô hình đó: ảo hoá cần cập nhật có khoá, giữ vị trí cuộn khi
prepend, và giữ node sống qua các lần vẽ.

### Đề xuất: React + hai thư viện đúng bài

| Nhu cầu | Thư viện | Trạng thái (đã tra 2026-08-22) |
|---|---|---|
| Panel kéo được, gập được, nhớ kích thước | `react-resizable-panels` | v4.12.3 · MIT · ~32M lượt tải/tuần · có `Separator` cho bàn phím |
| Transcript ảo hoá kiểu chat | `@tanstack/react-virtual` | có **guide riêng cho chat**: `anchorTo:'end'`, `followOnAppend`, prepend giữ đúng vị trí, ghim đáy khi tin cuối phình ra lúc stream |

Đúng hai thứ khó nhất của bản clone, và cả hai đều là *headless* — không áp style, nên số đo từ
`ui-diff` vẫn là thước duy nhất.

**Nói ngược lại cho công bằng:** viết lại tốn thời gian, và ROADMAP §2 S13 xếp `apps/grokbot-web`
là **đường lùi cho rủi ro R2**, không phải sản phẩm chính. Nếu đích chỉ là "có chỗ debug backend"
thì đừng viết lại. Viết lại chỉ đáng khi đích là *clone từng chi tiết* — mà đó đúng là đích bạn
đang đặt. Điểm quyết định là **A2**: tới đó thì mô hình cũ chặn đường, không phải làm chậm.

Backend thì **không cần đổi gì**: nghiệp vụ đã tách module (`directory`, `conversation`, `runtime`,
`computer`, `ops`), SQLite là hot path, `/v1` là hợp đồng riêng. Việc thiếu chỉ là route mỏng —
đúng như avatar và reaction đã làm.

---

## 3. Cấu trúc thư mục — sửa chỗ lệch, không đảo lại từ đầu

Repo đã là pnpm workspaces + Turborepo, tức đã đúng khuôn. Ba chỗ lệch thật:

| Chỗ | Hiện tại | Nên |
|---|---|---|
| Script đo/e2e | **63 file** phẳng trong `services/grokbot-backend/scripts/` | tách `scripts/e2e/`, `scripts/measure/`, `scripts/gate/`. Đang phẳng nên đã có lúc `import` một script và nó **chạy luôn cả bài đo** |
| Hợp đồng `/v1` | định nghĩa nằm trong `native.ts` + `native-map.ts` | `packages/api-contract/` (schema + type dùng chung cho cả FE và BE) — hết cảnh FE tự khai lại `NativeAgent` |
| `.claude/` | có `commands/` | thêm `agents/` (subagent riêng cho dự án), `skills/` (quy trình đo/gate), giữ `CLAUDE.md` ở gốc làm điểm vào |

Đích:

```
apps/grokbot-web/          FE (đường lùi hôm nay, bản clone mai sau)
packages/api-contract/     schema /v1 — nguồn sự thật duy nhất cho FE+BE
packages/cursor-acl/       lõi vĩnh viễn: dịch /gw ↔ domain
packages/grokbot-proto/    lõi vĩnh viễn: bootstrap protobuf
services/grokbot-backend/  BFF + domain module
  scripts/{e2e,measure,gate}/
docs/extracted/            số đo từ app gốc (ui-xray, ui-diff anchor, motion)
.claude/{commands,agents,skills}/
```

---

## 4. Checklist — từ nhỏ nhất lên

Mỗi mục là một vòng **ĐO → SO → LÀM → NGHIỆM**, và mục nào cũng phải thêm anchor vào
`ui-anchors.mjs`, nếu không nó nằm ngoài mẫu số của `ui-diff`.

### X0 — dựng thước cho phần chưa đo (làm trước mọi thứ)

- [ ] X0.1 Thêm `sand-agents-section__header` vào danh sách an toàn của `x-ray`, chạy `--probe-clicks` → lấy chuyển động **gập nhóm**
- [ ] X0.2 Chủ máy mở `More message actions` một lần → `x-ray` chụp menu → biết nó chứa gì (đang là **C2**, chưa dám thiết kế)
- [ ] X0.3 Chủ máy gửi một tin → `x-ray` bắt `transitionend` → lấy **animation lúc gửi**
- [ ] X0.4 Kéo thử hai thanh chia → ghi min/max width thật của sidebar và info-pane

### X1 — nguyên tử: những thứ không phụ thuộc gì

- [ ] X1.1 Đầu sidebar: bỏ khối brand, `+` lên đúng hàng (ô chênh lệch sidebar đang sáng ~45px vì lệch này)
- [ ] X1.2 Số đếm bên phải nhãn nhóm (`BOT HTML  1`)
- [ ] X1.3 Đáy sidebar: `Open account menu` (nút `GL`) — nút `New` đã có
- [ ] X1.4 Toolbar: nút danh tính `View Bot settings` 128×28 (hiện là `h1` trơ)

### X2 — hai trạng thái + kéo được (cần `react-resizable-panels` nếu đổi stack)

- [ ] X2.1 Sidebar rail 88px, item 54×54 — nút gập
- [ ] X2.2 Kéo đổi rộng cả hai panel, `width` chuyển **240ms**
- [ ] X2.3 Nhớ kích thước qua lần mở sau (cần **B3** `/v1/host/settings`)

### X3 — stack điều hướng panel phải

- [ ] X3.1 `details` ⇄ `settings`: `__back` + `__subpage-title`, ra/vào 240ms
- [ ] X3.2 Trang settings: `Edit Bot avatar` 64×64 (nối bộ chọn ảnh đã có), `Bot name`, `Description`, toggle `Notifications`
- [ ] X3.3 Toggle `Notifications` → `/v1` PATCH (backend đã có `setAgentNotificationsEnabled`)

### X4 — transcript (chỗ mô hình cũ chặn đường)

- [ ] X4.1 Ảo hoá + phân trang `beforeSeq` (`anchorTo:'end'`, `followOnAppend`)
- [ ] X4.2 Ghim đáy khi tin cuối phình ra lúc stream
- [ ] X4.3 Chip sự kiện hệ thống (`sand-kit-system-event__chip` — "Open exchange with …")
- [ ] X4.4 Thẻ đính kèm `sand-attachment` bo **14px**, khung ảnh bo 12px

### X5 — route `/v1` còn thiếu (nhóm B của kế hoạch cũ)

- [ ] X5.1 Routines · X5.2 tìm bot thật · X5.3 host settings · X5.4 plugins · X5.5 khay subagent

### X6 — cần thiết kế mới

- [ ] X6.1 Reply vào một tin (`replyTo` chưa tồn tại ở đâu)
- [ ] X6.2 `More message actions` — chỉ sau X0.2

---

## 5. Luật

- Không có số thì không tính là xong. `pnpm ui:diff` trước/sau, mỗi mục.
- Vùng mới dựng phải vào `ui-anchors.mjs` — cả `ui-diff` và `ui-shots` đọc chung bảng đó.
- Route `/v1` mới đi kèm e2e có ghi nhật ký (`recordRun`).
- Không chép CSS/bundle/asset của hãng. Đo, rồi tự viết. Avatar dùng `bloub` (MIT).
- Nghi ngờ một con số thì đo lại bằng cách khác. Trong tài liệu này đã có một con số như vậy
  (240ms vs "1008ms").
