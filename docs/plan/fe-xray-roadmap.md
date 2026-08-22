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

### Đã đo được bằng cách tự điều khiển app (2026-08-22, lượt sau)

Ba việc ở bảng *"chưa lấy được"* bên dưới từng ghi là **cần chủ máy thao tác tay**. Hai trong ba
không cần: `x-ray --drag --menu` tự kéo, tự mở, rồi **tự trả app về đúng trạng thái cũ** (kiểm bằng
hình học: `81,0 12x1040` và `1440,0 10x1040`, đúng từng pixel như trước khi đo).

**Sidebar có VÙNG CHẾT, không giãn liên tục.** Đây là phát hiện quan trọng nhất, và nó phủ định điều
tôi định dựng:

```
dx=+10 … +120   rows=63   bar=88    chat=1357      ← kéo mà không có gì xảy ra
dx=+240         rows=302  bar=327   chat=1118      ← nhảy một nhịp
dx=+400         rows=375  bar=400   chat=1045      ← kẹp ở đây
```

Nghĩa là: rail 63px **không** kéo giãn dần thành panel. Nó đứng yên tới khoảng +200px rồi **snap**
sang ~302px. Dựng bằng `react-resizable-panels` với `minSize` thường sẽ ra hành vi giãn dần — sai.
Muốn giống thì cần một ngưỡng snap, không phải một `minSize`.

| | sidebar | panel Details |
|---|---|---|
| khối bị kéo | `sand-agents-list__rows` | `sand-info-pane` |
| mặc định | 63px (rail) | 480px |
| giới hạn | 63–375px | 280–480px |
| đi theo tay | có | có |
| chỉnh lại lúc nhả | có (snap) | có (snap) |
| kéo quá mức tối thiểu | kẹp lại | **đóng hẳn panel** — thanh chia biến mất, mở lại bằng `View Bot settings` |
| chuyển động | `width`/`height`/`font-size` 200ms + keyframe `sand-18re5ia-B` 130ms | `background-color` 120ms |
| kéo theo | `sand-agents-sidebar`, `sand-agents-list`, `sand-chat`, `sand-chat-stage`, `sand-virtual-transcript` | `sand-chat`, `sand-chat-stage`, `sand-virtual-transcript`, `sand-info-pane__inner`, `__nav-root`, `__section-content` |

Thanh chia Details còn đặt tâm **lệch một hằng số 5px** so với con trỏ lúc nhả. Nghe như chi tiết vụn,
nhưng nó là lý do bản đầu của phép dò làm app trôi 5px mỗi lượt chạy — và một FE clone nhắm thẳng
vào toạ độ con trỏ sẽ trôi đúng như vậy.

**Gập nhóm — đo được (X0.1).** Sidebar của chủ máy để ở rail nên phép dò tự mở tạm rồi trả về rail
(x=87, đúng cũ). Cấu trúc thật:

```
sand-agents-sections            362x458   ← khối chứa tất cả nhóm
  sand-agents-section           362x320   ← một nhóm
    sand-agents-section__header 362x30    ← BUTTON, có aria-expanded
    sand-agents-section__reveal 362x290   ← phần co/giãn
      sand-agents-section__rows 362x290
        sand-agent-item         362x54
```

Ba điều dùng được ngay:

- Đầu nhóm là **`button` có `aria-expanded`**, cao **30px** — không phải `div` trang trí. Số đếm nằm
  **trong nhãn của chính nút đó** (`"BOT HTML1"` = tên + số), nên X1.2 không cần thêm phần tử mới.
- Gập là `height` trên `__reveal` (290 → 0), **200ms**, kèm `opacity` 120ms và `transform` 200ms.
  Nhóm gập lại còn đúng 30px = chiều cao đầu nhóm.
- Sidebar mở ra thì hàng bot rộng **362px** và cao **54px** — khớp con số 375 (giới hạn trên) đo được
  ở phần kéo thanh chia.

**Menu trên tin nhắn — đọc được nội dung thật:**

| Mở bằng | Hộp | Mục |
|---|---|---|
| `More message actions` | 200×74 | `Start a thread` · `Copy` |
| `Add reaction` | 246×44 | 👍 👎 ❤️ 😂 🎉 😮 · `More emoji` |

Cả hai mở bằng `opacity` 100ms + `transform` 100ms. Chỉ **hai** mục trong menu More — nhẹ hơn nhiều
so với mức tôi đã định thiết kế cho X6.2.

> **Nút hover-actions có mặt trong DOM ngay từ đầu nhưng chỉ nhận chuột khi con trỏ đang ở trong tin
> nhắn.** `click()` thẳng thì hết giờ; phải `mouse.move` vào nó trước. Bản kiểm kê control thấy nút
> đó từ lượt đầu nên tôi đã tưởng là bấm được — thấy trong DOM không có nghĩa là bấm được.

**Cái giá đã trả để học ba điều trên.** Bản đầu của phép dò để lại app của chủ máy lệch 312px và
panel Details **đóng hẳn**, vì nó (a) đoán thanh chia thay đổi khối nào theo "khối rộng nhất nằm sát"
— và ra `sand-chat`, tức phần co giãn còn lại chứ không phải panel đang bị kéo; (b) trả về theo bề
rộng thay vì theo toạ độ thanh chia; (c) kéo cứng ±820px nên vượt qua ngưỡng đóng. Cả ba đã sửa và
phép dò giờ tự kiểm phần trả về trước khi báo kết quả. Luật rút ra: **phép dò nào chạm vào app thật
thì phải chứng minh trả về được, ngay trong cùng lượt chạy.**

### Chưa lấy được, và vì sao

Còn đúng **một** thứ, và nó nên tiếp tục ở lại đây:

| Thứ | Vì sao vẫn chưa lấy | Cách lấy |
|---|---|---|
| Animation lúc **gửi** một request | `send` nằm trong `NEVER` **có chủ ý**. Script tự gửi tin là ghi vào hội thoại thật của chủ máy và tốn token pool — không phải chuyện khó, mà là chuyện không nên | chủ máy gửi một tin trong lúc `x-ray` đang nghe `transitionend` |

Hai thứ còn lại đã tự đo được, xem mục trên. Trạng thái gập nhóm sidebar: `--probe-clicks` xử lý
được vì nút đó vốn nằm trong danh sách an toàn.

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

- [x] **X0.1** `x-ray --groups` tự mở sidebar khỏi rail, bấm đầu nhóm, đo `height` 200ms trên `__reveal`, rồi trả sidebar về rail
- [x] **X0.2** `x-ray --menu` tự mở: More = 200×74 gồm `Start a thread` · `Copy`; Add reaction = 246×44 gồm 6 emoji + `More emoji`. Không cần chủ máy bấm
- [ ] X0.3 Chủ máy gửi một tin → `x-ray` bắt `transitionend` → lấy **animation lúc gửi** (cố ý không tự động: script tự gửi là ghi vào hội thoại thật)
- [x] **X0.4** `x-ray --drag` tự kéo và tự trả về: sidebar 63–375px **có vùng chết ~200px rồi snap**, Details 280–480px và **đóng hẳn nếu kéo quá mức tối thiểu**

### X1 — nguyên tử: những thứ không phụ thuộc gì

- [x] **X1.1** Đầu sidebar cao **52px**, chỉ có nút `New` **24×24** căn phải — khối brand (`grokbot2` +
  phụ đề) đã bỏ. App gốc không có brand ở đây; nó chỉ có đúng một nút.
- [x] **X1.2** Đầu nhóm là **`button` có `aria-expanded`**, cao 30px, gập được, và **số đếm chỉ hiện
  khi nhóm đang gập** — đúng như đo được (`BOT HTML 1` với `aria-expanded=false`, còn nhóm đang mở
  thì không có số). Nên X1.2 và việc gập là **một** tính năng, không phải hai; phần co giãn chuyển
  `grid-template-rows` 200ms, cùng thời lượng `height` của họ.
- [x] **X1.3** Đáy sidebar hai hàng **40px**: `Plugins` (chưa dựng — X5.4, nên để `disabled` có
  tooltip thay vì một nút bấm không làm gì) và `Open account menu`. Menu tài khoản nhận luôn ba hành
  động vừa bỏ khỏi đáy (bot mới · hiện bot ẩn · xoá) cộng Đăng xuất, nên nút `⎋` nổi trên `<body>`
  không còn cần thiết.
- [x] **X1.4** Nút danh tính `View Bot settings` cao **28px** thay cho `h1` trơ; bấm mở panel phải —
  đúng chỗ trang settings sẽ nằm khi làm X3.
- [x] **X1.5** (thêm) Ô Search: app gốc để nó là **`button` 362×32**, bấm mới thành ô nhập. Bản
  trước của tôi là `<input>` luôn — sai hành vi, và đó là lý do X5.2 tưởng là "chỉ cần nối API".
- [x] **X1.6** (thêm) 7 anchor mới trong `ui-anchors.mjs` cho đúng những vùng trên. Không có anchor
  thì con số "khớp bao nhiêu %" chỉ nói về phần đã dựng từ trước — đúng cái bẫy đã sập bốn lần.

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
