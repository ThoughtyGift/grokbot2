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

- [x] **X2.1** Rail **88px**, hàng bot **54×54** — đo lại trên web đúng 54px. Gập bằng chính thanh
  chia (kéo xuống dưới 200px), không thêm nút: app gốc cũng không có nút gập riêng.
- [x] **X2.2** Kéo đổi bề rộng cả hai panel, **có ngưỡng snap** đúng vùng chết đo được — không phải
  `minSize`. Thanh chia là lớp **phủ** chứ không phải một cột của grid, vì ở app gốc nó vắt qua ranh
  giới (thanh 12px ở x=81 với sidebar rộng 88 → `left: calc(var(--sidebar-w) - 7px)`).
- [x] **X2.3** Nhớ bố cục qua lần mở sau, qua `/v1/host/settings` (X5.3 bên dưới). Nạp **trước** lần
  vẽ đầu, không sau — nạp sau thì mỗi lần mở app sidebar nhảy một cú từ mặc định sang bề rộng của mình.

`pnpm measure:resize` — **10/10**, mỗi ca dựng trạng thái trước bằng PATCH rồi tải lại:

| Ca | Kết quả |
|---|---|
| đang mở, kéo +50 | 300 → 350, đi theo tay |
| kéo +300 | kẹp **400** |
| kéo −150 (xuống dưới 200) | **gập về rail 88**, không co tiếp |
| đang rail, kéo +120 | **không đổi gì** — vùng chết |
| đang rail, kéo +260 | **snap sang mở** (348) |
| rail | hàng bot **54×54** |
| panel, kéo sang trái 60 | 400 → 460 (kéo trái là rộng thêm) |
| panel, kéo phải 300 | **đóng hẳn**, không kẹp |
| mở lại | nhớ đúng 350 / 430 |

> Bản đầu của bài đo này dùng delta cố định từ trạng thái đang có. Khi bố cục đã được nhớ thì trạng
> thái đầu không còn là 261 nữa, nên ba ca "rail" không bao giờ chạy tới — **bài kiểm vẫn xanh mà
> không kiểm gì cả**. Nên mỗi ca giờ PATCH dựng trạng thái rồi tải lại trang.

### X3 — stack điều hướng panel phải

- [x] **X3.1** Hai trang xếp chồng và **trượt**, không ẩn/hiện — ẩn/hiện thì không có hướng, mà hướng
  là thứ cho người dùng biết mình đang đi vào hay đi ra. Ra/vào **240ms** (`--t-pane`), nút
  `Back to details` **28×28**, tiêu đề `Bot settings`.
- [x] **X3.2** `Edit Bot avatar` **64×64** đúng số đo, nối vào bộ chọn ảnh đã có; `Bot name`,
  `Description`, toggle `Notifications`. Tên/mô tả ghi khi **rời trường** (`change`), không ghi từng
  ký tự — gõ một cái tên là hàng chục PATCH và hàng chục lần vẽ lại roster.
- [x] **X3.3** Toggle → `PATCH /v1/agents/{id}`. Backend đã nhận `notificationsEnabled` từ lâu; chỗ
  hỏng là **FE tự khai lại kiểu** `patchAgent(body: { name?, hidden?, description? })` nên trường đó
  không lọt qua được TypeScript. Giờ lấy `PatchAgentBody` từ hợp đồng — đúng món nợ T3 tưởng đã trả.

`pnpm measure:pane` — **10/10**, gồm ca đọc lại `/v1/agents` để xác nhận toggle **đi tới backend**
chứ không chỉ đổi hình.

> Bài kiểm đó lúc đầu báo FAIL `true → true`. Không phải tính năng sai: nó lấy `agents()[0]`, mà
> sidebar đã gom nhóm nên bot đầu trong sidebar không phải bot đầu trong API — **bài kiểm đang soi
> một con bot khác con bot vừa bị đổi.** Một bài kiểm đo sai đối tượng thì cái nó báo, đỏ hay xanh,
> đều không có nghĩa.

### X3.5 — gộp lại cho đồng nhất (làm cùng X3, vì cùng chỗ)

Nhận xét "giao diện chưa đồng nhất" là đúng, và `pnpm measure:consistency` nói cụ thể nó sai ở đâu:

| | trước | sau |
|---|---|---|
| dùng token | **47%** | **73%** |
| bán kính bo | 6 giá trị, có **ba cách viết** cho hai ý (`9999px`, `999px`, `50%`) | `--r-ctl/--r-row/--r-card/--r-pill` + `50%` cho avatar |
| cỡ chữ | 5 giá trị rời, 7 khai báo dùng token / 65 viết cứng | 60 / 12 |
| nút đăng xuất | **hai** chỗ (menu tài khoản + nút nổi trên `<body>`) | một |
| toolbar | 4 nút kiểu cũ (`đổi tên`, `ảnh`, `ẩn` bo viên thuốc 27px) cạnh nút mới bo 8px | nút danh tính + một nút icon, như app gốc |

Ba việc bỏ khỏi toolbar không mất đi: chúng vào **trang settings** — đúng chỗ app gốc đặt chúng, nên
việc gộp cho đồng nhất và việc làm X3 là **một** việc.

Hai lỗi của chính bộ đo, đã sửa:

- Bản đầu đếm "có bao nhiêu giá trị khác nhau" và coi mọi khác biệt là xấu — nên avatar **64×64**
  (số đo thật) và checkbox 16px cũng bị tính là không đồng nhất. **Làm đúng theo phép đo đó thì sản
  phẩm sai.** Số đáng đo là *tỉ lệ dùng token*: đa dạng có chủ ý là bình thường, cùng một ý viết
  bằng ba giá trị cứng ở ba chỗ mới là vấn đề.
- Một lượt thay hàng loạt quét cả **định nghĩa** token, làm `--r-pill: var(--r-pill)` tự trỏ chính
  nó. Từ đó chỉ thao tác trên phần CSS **sau** `:root`, và có phép kiểm token tự trỏ.

### X4 — transcript (chỗ mô hình cũ chặn đường)

**Đo trước khi viết, và số đo đổi quyết định.** ADR 0004 nói X4 sẽ kích hoạt việc chuyển sang React.
`pnpm measure:transcript` nói khác:

| transcript | node | một lần vẽ lại |
|---|---|---|
| 31 bubble | 657 | **0,84 ms** |
| 124 bubble | 2 628 | 4,52 ms |
| 496 bubble | 10 512 | 21,8 ms |
| 1 984 bubble | 42 048 | 52,0 ms |

"Vẽ lại tất cả" chỉ tốn **0,84 ms** ở cỡ đang dùng — 1/20 khung hình. Nó thành vấn đề từ khoảng
**500 entry**. Và lỗi thật hôm nay không phải hiệu năng mà là **mất vị trí cuộn**, mà React không
chữa cái đó. Nên X4 làm trên mô hình hiện tại; ADR 0004 chuyển sang **hoãn thi hành** kèm điều kiện
kích hoạt viết lại.

- [x] **X4.1** Cửa sổ **150 entry** trong DOM + nút *"Xem N tin cũ hơn"* — đúng ý `beforeSeq`: nới cửa
  sổ về phía trước thay vì dựng cả nghìn hàng. Neo cuộn theo **phần tử** (`data-entry`), không theo
  khoảng cách tới đáy: neo theo đáy chỉ đúng khi nội dung mọc ở trên, neo theo đỉnh chỉ đúng khi mọc
  ở dưới, mà transcript có cả hai.
- [x] **X4.2** Ghim đáy khi đang ở đáy (trong 64px), giữ nguyên chỗ đọc khi đang cuộn giữa chừng.
  `pnpm measure:transcript-scroll` **4/4**, vị trí cuộn `7516 → 7516`.
- [x] **X4.3** Sự kiện hệ thống là **chip** (`sand-kit-system-event__chip`), không phải dòng chữ xám
  giữa màn hình. Nhân đó đọc được cả nhánh `automation-changed` — trước đây nó in ra đúng chữ
  `"automation-changed"` cho người dùng xem.
- [x] **X4.4** Thẻ tệp bo **14px**, khung ảnh bo **12px** — hai số đo **khác nhau** ở app gốc, nên
  không dùng chung một token. Và khung ảnh là **344×200 CỐ ĐỊNH**: sáu ảnh trong transcript của app
  đều đúng 344×200 ở cùng toạ độ `x`, tức khung không co theo ảnh. Ta trước đây để `max-width: 320`
  và cao tự nhiên — mỗi ảnh một chiều cao, transcript nhấp nhô. Giờ `object-fit: cover` để không méo.

  > Số 344×200 đo ở **một** khổ cửa sổ. Câu còn bỏ ngỏ: khung đó cố định thật, hay co theo cột chat?
  > Đã thêm anchor `ảnh đính kèm` vào `ui-anchors` để lượt `ui-diff` sau (khi app mở lại với CDP)
  > **tự trả lời** thay vì tôi đoán — `ui-diff` chạy ở ba khổ, nên nếu nó co theo cột thì hai khổ
  > nhỏ sẽ báo lệch ngay.

> **Ba lần sai liên tiếp ở cùng một chỗ, đáng ghi lại.** Bản 1 đọc `scrollTop` từ phần tử *vừa được
> tạo trong lượt vẽ này* — luôn là 0, nên phép tính "có đang ghim đáy không" luôn ra đúng và nó nhảy
> xuống đáy (7516 → 14103). Bản 2 giữ đúng **một** phần tử rồi cắm lại — nhưng `replaceChildren()`
> **tách** nó khỏi document và trình duyệt xoá vị trí cuộn của phần tử bị tách (7516 → 0). Bản 3 mới
> đúng: **chụp trạng thái trước khi vẽ**, vì sau khi vẽ thì không còn gì để đọc, bằng cách nào cũng
> không.

### X4.5 — mapping icon và animation gọi tool (từ ảnh chụp app đang chạy, 2026-08-23)

App đang chạy **không mở cổng gỡ lỗi** (`:9222` im) nên lượt này đo từ ảnh chụp, không đo bằng
`x-ray`. Ghi rõ để sau này biết con số nào đã được máy đo và con số nào chỉ đọc từ ảnh.

| | app gốc | trước đây bên mình | đã sửa |
|---|---|---|---|
| bot đang nghĩ / gọi tool | **ba chấm**, không có bubble | bubble xám kèm con trỏ khối `▍` | ba chấm |
| mic | hình tròn **trắng**, là nút mặc định bên phải | tròn trong suốt, đứng cạnh nút gửi | tròn trắng |
| nút gửi | **chỉ hiện khi ô nhập có chữ** | luôn hiện, màu xanh, cạnh mic | chỉ hiện khi có chữ |
| nút dừng | chỉ khi đang chạy | luôn hiện (mờ) | chỉ khi đang chạy |
| vạch thời gian | có (`Today 4:47 AM`) | **không có** | có |
| thẻ tool đang chạy | — (chưa thấy trong ảnh) | chữ `running` đứng im | ba chấm, cùng ngôn ngữ với lúc đang nghĩ |

Bubble rỗng kèm con trỏ nhấp nháy **sai cả hình lẫn ý**: một bubble ngụ ý "đã có tin rồi", ba chấm
ngụ ý "đang tới". Và một cái nhãn chữ `running` đứng im không nói được là việc còn chạy hay đã treo.

Nhịp ba chấm (1,4s, ba chấm lệch pha 0,16s) và ngưỡng vạch thời gian (30 phút) là **giá trị tạm** —
chưa đo được. Mở app bằng launcher F2 rồi `pnpm ui:xray` để chốt.

> **Lần thứ ba cùng một lỗi**, nên ghi thành luật: hễ một nút chỉ xuất hiện ở một số trạng thái thì
> `!` trên nó là lời khai sai. Cho nút dừng ẩn khi bot không chạy làm `paint()` ném
> `TypeError: Cannot set properties of null` ngay lần vẽ đầu, và người dùng thấy **"Không kết nối
> được BFF :8788"** trong khi backend hoàn toàn bình thường — một thông báo lỗi trỏ sai hoàn toàn
> chỗ hỏng.

### Đo chính xác từng pixel — hai đường, và biết khi nào dùng đường nào

Câu hỏi của chủ máy: *"có cách nào đo chính xác từng pixel trên app mapping lại được không"*. Có,
hai đường, và chúng khác nhau về độ tin cậy:

| | cần gì | độ chính xác | dùng khi |
|---|---|---|---|
| **`pnpm ui:xray` / `ui:diff`** (CDP `:9222`) | app mở bằng `pnpm dev:app` | **tuyệt đối** — đọc thẳng `getBoundingClientRect()` và computed style của chính DOM app | mặc định, luôn ưu tiên |
| **`pnpm measure:shot <ảnh.png>`** | chỉ cần một ảnh | tốt, nhưng **ảnh thường bị thu nhỏ** khi chụp/gửi, nên mọi số phải chia lại cho tỉ lệ | app mở kiểu thường, không có cổng gỡ lỗi |

`measure:shot` quét một dải dọc, tự đoán mức nền (không giả định nền đen), gom các đoạn liên tiếp
thành khối, rồi in ra hộp và khoảng cách tâm–tâm:

```
$ pnpm measure:shot docs/extracted/web-rail.png --x 43 --w 88
ảnh 1920x1040 · dải x 0..88 · mức nền 7
  y=  61   71x 44  x=17
  y= 119   75x 44  x=13   cách khối trên 14px · tâm cách tâm 58px
```

Chụp app gốc rồi chạy đúng lệnh đó lên ảnh của họ là ra bảng so sánh bằng **số**, hết cảnh "trông
bé hơn".

> **Giới hạn phải nói rõ.** Ảnh chụp gửi qua chat thường bị thu về 0,77–0,96 lần, nên một khối "14px"
> trong ảnh có thể là 18px thật. Tôi đã suýt chỉnh kích thước icon vài lần dựa trên ảnh bị thu nhỏ —
> đó là cách chắc chắn để chỉnh sai. Số từ ảnh chỉ dùng để **so tỉ lệ trong cùng một ảnh** (hình bot
> chiếm bao nhiêu phần trăm ô chứa), không dùng làm số tuyệt đối.

**Đã sửa được nhờ đo tỉ lệ trong cùng ảnh:** hình bot chỉ lấp **42% chiều ngang** ô 36×36, vì
`DEMI_VIEWBOX = 158` của bloub chừa lề cho vòng trang trí mà avatar tĩnh không vẽ. Giờ viewBox tính
từ chính biên của hình, và hình được phép tràn nhẹ ra mép (ô không có viền cũng không cắt) — lấp
**79–95%**. Ô ở rail lên **44px** (số đọc từ ảnh, chưa phải máy đo).

### Chốt bằng số tuyệt đối (2026-08-23, CDP mở lại)

Mở lại app bằng `Grok Bot.exe --remote-debugging-port=9222` (không chạy `run.ps1` để **không** đụng
vào bốn tiến trình backend đang sống — launcher có guard `Test-HttpOk` nên nó cũng sẽ bỏ qua, nhưng
làm tay thì chắc chắn hơn). Kết quả: **`ui-diff` 163/165 (99%), 0 mục lệch ở 1920×1040.**

Và số đo **bác bỏ ba lần tôi chỉnh bằng mắt qua ảnh chụp**:

| | tôi đoán từ ảnh | số đo qua CDP |
|---|---|---|
| ô avatar ở rail | 44px | **36px** — `.sand-agent-avatar` là 36×36 ở cả rail lẫn hàng mở rộng |
| hình lấp bao nhiêu ô | "cho tràn nhẹ" → 116% | **88,4%** — `viewBox="-15 -15 259 259"`, tức 229/259, lề đều 5,8% mỗi bên |
| nền `shell` | tưởng lệch | **trùng khớp** — `div.sand-shell` = `rgb(7,7,7)`, đúng bằng nền của mình; anchor cũ trỏ vào `body`, mà `body` của Electron là `rgba(0,0,0,0.5)` trong suốt |

Nên `APP_VIEWBOX_RATIO = 259 / 229` giờ là hằng số trong `avatar.ts`, có xuất xứ ghi kèm. Ba lần
đoán trước đó lần lượt cho 42% (viewBox cố định), 79% ("ôm sát biên"), 116% ("cho tràn nhẹ") — tức
lúc bé hơn app, lúc to hơn app. **Một số đo chấm dứt cả ba.**

Chốt thêm hai thứ trước đó là *giá trị tạm*:

- **vạch thời gian** = `sand-kit-timestamp`, **cao 28px · chữ 12px/16px · màu `rgba(252,252,252,0.6)`**.
  Chữ vẫn để tiếng Việt vì FE này nói tiếng Việt ở mọi chỗ khác — lựa chọn có ý thức, chỉ bề rộng khác họ.
- **sidebar của app CO THEO KHỔ CỬA SỔ**: 400px ở 1920, 240px ở 1440. Đây là lý do `ui-diff` phải
  đồng bộ lại ở **từng khổ**, không một lần trước vòng lặp — bản trước đồng bộ một lần rồi báo lệch
  toàn bộ cột chat/transcript/composer/hàng bot ở hai khổ nhỏ, trong khi cái lệch thật chỉ là bộ đo
  đang so bố cục khổ này với bố cục khổ khác.

> Hai lỗi của chính bộ đo, sửa trong cùng lượt: khối đồng bộ lúc đầu bị chèn **sau** phép đọc nên nó
> giúp khổ *sau* chứ không giúp khổ đang đo (1920 tụt xuống 44/11); và `/v1/session` không có thử
> lại nên một lượt trượt là cả khổ đó báo "thiếu hẳn" — một bộ đo phụ thuộc may mắn thì con số của
> nó không so được giữa hai lượt.

**Còn đúng một giá trị tạm:** nhịp ba chấm lúc bot đang nghĩ. Muốn đo phải có lúc app *đang* nghĩ,
tức phải gửi một tin — đó là X0.3, và tôi cố ý không tự gửi vào hội thoại thật của chủ máy.

### X5 — route `/v1` còn thiếu (nhóm B của kế hoạch cũ)

- [x] **X5.1 Routines** — bốn route `/v1/agents/{id}/routines[/{routineId}]`. Hình dạng trả về là
  **native**, không phải blob của client hãng: `toClientAutomation` gửi cùng một thứ dưới ba tên
  (`trigger`/`schedule`, `prompt`/`body`) vì các bản build của họ đọc chỗ khác nhau — FE của mình
  không phải học hai bộ từ vựng.

  Lịch là **cron 5 trường** (`0 9 * * *`), không phải câu tiếng Anh; backend **từ chối 400 ngay ở
  biên** nếu `parseCron` không đọc được. Nhận rồi im lặng không chạy thì tệ hơn nhiều — người dùng
  đợi một routine không bao giờ nổ. Câu tả cho người đọc (`scheduleText`, ví dụ *"9:00 daily"*) do
  backend sinh, FE không tự đoán.

  `runs` **luôn** là mảng kể cả routine vừa tạo: ở client hãng biểu tượng trạng thái đọc thẳng
  `runs[0]?.status` không kiểm tra gì, nên một bản ghi thiếu `runs` làm vỡ cả panel bên phải. Giữ
  nguyên bất biến đó cho FE của mình.
- [x] **X5.2 Tìm bot** — `GET /v1/search?q=`, **và FE đã nối** (2026-08-23). `searchAgents` đã tìm cả **tên lẫn nội dung
  transcript**, nên kết quả trả kèm `why: "name" | "transcript"`: không nói vì sao một bot khớp thì
  người dùng thấy một cái tên chẳng liên quan gì tới từ vừa gõ. `q` rỗng trả rỗng, **không** đổ cả
  roster ra.

  **FE:** ô Search gọi backend, gộp nhịp 250ms — gõ "marketing" là chín ký tự nhưng chỉ **một** lượt
  gọi mạng (đã đo). Trong lúc chờ vẫn lọc theo tên để danh sách không nhấp nháy trống, rồi thay bằng
  kết quả thật khi nó về; và kiểm lại từ khoá trước khi nhận, vì trả lời của một truy vấn cũ về sau
  truy vấn mới là cách chắc chắn để danh sách sai.

  Bot khớp theo **nội dung** được đánh dấu *"khớp trong nội dung"* ngay trước dòng xem trước. Đo
  thật: gõ `Marketing` ra 6 bot — `Marketing Lead` khớp theo tên (không có nhãn), năm bot còn lại
  khớp theo transcript (có nhãn). Không có nhãn đó thì người dùng thấy năm cái tên chẳng liên quan
  gì tới từ mình vừa gõ.

  > Chỗ này lộ ra vì `self-xray` báo `api.ts:searchAgents` là **code chết**: tôi thêm route và hàm
  > gọi từ hôm qua mà chưa nối vào UI. Mốc code chết bắt đúng thứ nó sinh ra để bắt.
- [x] **X5.5 Khay subagent** — `GET /v1/subagents`, chỉ đọc: đây là bảng đăng ký tĩnh, không phải
  danh sách đang chạy. Bốn loại: `browserUse`, `pastConversationExplorer`, `explore`, `shell`.
  `toolCount` là số **tiền tố** tool được phép gọi, không phải số tool cụ thể — `allow` khớp theo
  tiền tố (`browser_` phủ cả bộ), nên đếm tool cụ thể sẽ ra một con số sai mà trông đúng.
- [ ] X5.3 ✅ đã xong ở X2 · **X5.4 plugins — của phiên khác đang làm** (`src/plugins.ts` chưa vào
  git), tôi không chạm.

**FE (X5.1) đã nối:** panel Details trước đây là một đoạn chữ giới thiệu routine cộng một nút
*Tạo routine* không nối gì — tức một nút bấm vào không xảy ra chuyện gì, đúng thứ dự án này cấm.
Giờ là danh sách thật: tên · câu tả lịch · công tắc bật/tắt · nút xoá, thêm bằng nút `+` ở đầu khối.

Hai quyết định nhỏ nhưng có lý do:

- **Sau mỗi thao tác dùng luôn danh sách backend trả về**, không tự sửa mảng ở FE. Backend là chỗ
  duy nhất biết thứ tự và `scheduleText`; một bản sao tự suy ở FE sẽ lệch ngay lần đầu ai đó sửa
  routine từ **app gốc** — mà app gốc và FE này dùng chung một backend.
- **Routine tắt thì mờ đi, không biến mất.** Ẩn nó thì người dùng tưởng mình vừa xoá mất.

`pnpm measure:routines` — **8/8**, chạy trên stack thật: tạo → thấy trong panel → tắt trên UI thì
backend tắt theo → xoá trên UI thì backend xoá theo. Bài kiểm tự dọn ở `finally` kể cả khi hỏng
giữa chừng, và đã kiểm lại là không để routine thử nào sót trong dữ liệu của chủ máy.

> Bài kiểm đó hỏng lần đầu với `element is not visible` sau 30 giây chờ — không phải vì UI sai, mà
> vì **panel phải đang đóng**: bố cục nhớ theo tài khoản (X2.3) và lượt `ui-diff` trước đã đồng bộ
> nó theo app, lúc đó app đang đóng panel. Danh sách nằm trong DOM nhưng `display: none`. Bài kiểm
> phải **tự dựng trạng thái nó cần**, đây là lần thứ hai bài học đó xuất hiện (lần trước là
> `measure-web-resize` dùng delta cố định).

`pnpm test:routines` — **19/19**, gồm ba ca dễ bị bỏ qua: lịch không đọc được bị từ chối ở cả POST
lẫn PATCH, routine của bot A **không** sửa được qua đường bot B (404), và `runs` là mảng ngay từ
lúc tạo.

> Phép **tự kiểm `NAMED`** thêm hôm qua lập tức trả công: nó bắt đúng sáu schema mới
> (`Routine`, `RoutineRun`, `CreateRoutineBody`, `PatchRoutineBody`, `SearchHit`, `SubagentKind`)
> mà tôi quên khai, thay vì để chúng bị nhúng thẳng vào từng route và không ai biết. Spec giờ
> **27 route · 30 schema**.
- [x] **X5.3** `/v1/host/settings` — GET + PATCH, **theo từng tài khoản**. Bảng `host_settings` đã có
  sẵn nên không đổi schema: bố cục nằm dưới `uiByOwner[ownerId]` trong cùng blob JSON. Những khoá
  khác trong đó là cài đặt của *cái máy* (múi giờ, quyền tool, MCP) và đúng là dùng chung; bề rộng
  sidebar thì không — hai tài khoản cùng backend sẽ ghi đè bố cục của nhau.

  Kẹp ở **backend**, không chỉ ở FE (sidebar 88–400, panel 280–480 — ngưỡng đo được ở app gốc): một
  client hỏng ghi `sidebarWidth: 5000` thì lần mở sau app không dùng được mà người dùng không hiểu
  vì sao. `pnpm test:host-settings` — **10/10**, gồm hai ca chứng minh hai tài khoản không thấy bố
  cục của nhau và host không bị ghi đè.

### X6 — cần thiết kế mới

- [x] **X6.1 Trả lời — bằng TRÍCH DẪN, không phải luồng con.** Đã kiểm lại: `replyTo`, `threadId`,
  `parentEntry` **không tồn tại ở đâu** — cả hợp đồng lẫn backend. Nên một nút "trả lời" chỉ gắn cờ
  ở FE là thứ **model không bao giờ thấy**, tức trang trí. Bấm trả lời giờ chèn một dòng trích dẫn
  (`> Tên: 160 ký tự đầu`) vào ô nhập: model đọc được vì nó nằm trong chính nội dung tin, và không
  phải bịa ra một mô hình dữ liệu mà backend chưa honour được.

  **Đây không phải luồng con**, và mục dưới nói rõ như vậy. Muốn luồng con thật thì phải thêm
  `replyToEntryId` vào `TurnBody` + `Entry`, và runtime phải đưa tin được trích vào prompt — mà
  `runtime/turn.ts` đang là file phiên khác sửa, nên tôi không đụng.
- [x] **X6.2 `More message actions`** — hộp **200×74** đúng số đo, đúng **hai** mục như X0.2 đã đo:
  `Sao chép` (chạy được) và `Tạo luồng` (**để mờ kèm lý do** — cần mô hình dữ liệu chưa có). Vẽ ra
  một mục bấm vào không làm gì thì tệ hơn một mục mờ nói rõ vì sao.

  Hàng nút hover giờ đủ ba như app gốc, cùng nhãn: `Add reaction` · `Reply to X message` ·
  `More message actions`, mỗi nút **24×24**.

  Clipboard bị chặn (không phải ngữ cảnh an toàn) thì **nói ra**, không im lặng nuốt — một nút
  "sao chép" báo thành công mà không chép gì là kiểu hỏng khó phát hiện nhất.

### X7 — mapping tin nhắn & header (2026-08-23, đo qua CDP trước khi sửa)

Chủ máy so hai ảnh chụp và nói đúng: *"giao diện 5173 chưa mapping app local"*. `ui-diff` lúc đó
165/165 — tức cái lệch nằm ở vùng **chưa có anchor**. Probe chỉ-đọc trên app đang chạy chốt năm
điểm, sửa cả năm:

| | app gốc (đo CDP) | bên mình trước đó |
|---|---|---|
| markdown trong bubble bot | render thật: `<p>/<code>/<ul>`; code chip nền `rgba(119,119,119,.173)` chữ `rgb(255,86,103)` bo 4px đệm 0/4 viền `rgba(252,252,252,.1)` mono 13px; `ul` margin 0 / padding-left 20px | `createTextNode` — `**đậm**`, `` `code` ``, `- bullet` hiện nguyên ký hiệu |
| nhãn tên lượt người dùng | **không có** — 12 lượt liên tiếp, mọi `sand-group-author` đều là tên bot, lượt user `author: null` | in chữ "bạn" trên mỗi khối |
| header phải | nút danh tính + đúng MỘT icon-button `Grok Bot's Computer` (icon màn hình); trạng thái nằm ở chấm trên avatar | pill chữ "sẵn sàng / đang trả lời" + glyph `‹/›` |
| đầu nhóm sidebar | `text-transform: none · letter-spacing: normal` | `uppercase + 0.04em` |
| placeholder ô nhập | `Message Claude` — theo tên bot | câu chung chung |

`markdown.ts` là renderer tự viết ~100 dòng, **escape toàn bộ đầu vào trước rồi mới thay thẻ** —
an toàn theo cấu trúc, không cần sanitizer; link chỉ nhận `http/https`. 10/10 test
(`npx tsx --test apps/grokbot-web/src/markdown.test.ts`), gồm ca HTML sống ở mọi nhánh và ca
`javascript:` không có đường vào. Khoảng cách khối 8px và style `pre` là **giá trị tạm** — app chưa
có tin nào chứa chúng để đo.

**Bug nháy khi streaming** (chủ máy báo giữa phiên) — hai gốc, sửa cả hai:

- `paint()` dựng lại toàn bộ DOM mỗi chunk SSE nên **mọi** bubble chạy lại `bubble-in`
  (opacity từ 0) → cả transcript chớp. Giờ `markSeen`: entry đã render một lần thì mang class
  `.still` (animation: none), chỉ tin lần đầu xuất hiện mới trượt vào. Đo trong lúc stream: 6 mẫu
  cách 700ms, `bubble.still == bubble` ở mọi mẫu, cuộn không nhảy.
- `void loadTranscript()` mỗi sự kiện SSE → các fetch chồng nhau, cái cũ về sau cái mới thì
  transcript **nhảy lùi một nhịp** rồi nhảy tới. Giờ nạp có gộp: đang nạp thì chỉ ghi cờ `dirty`,
  vòng lặp nạp lại một lần khi xong.

> Trong cùng lượt, `ui-diff` báo `shell bg` lệch (`rgba(0,0,0,0.5)`) — không phải regression:
> `PAINTED_BG` lấy "phần tử sâu nhất phủ ≥90% khung có nền đục", và app lúc đó đang mở một dialog
> nên nó vớ được `ui-dialog-backdrop`. Một backdrop nửa trong suốt lọt qua phép kiểm "nền đục" là
> lỗ của chính bộ đo; đóng dialog là số về lại 165/165. Probe thẳng `.sand-shell` vẫn `rgb(7,7,7)`.

**X7.1 — phím tắt composer (cùng ngày).** App không khai `aria-keyshortcuts` ở đâu (probe ra rỗng),
composer của họ là textbox `aria-multiline=true`; hành vi xác nhận từ chính app: **Enter gửi,
Shift+Enter xuống dòng**. Web trước đó chỉ gửi bằng nút ↑, Enter chèn xuống dòng. Đã map, kèm hai
điều dễ hỏng: IME tiếng Việt đang ghép vần thì Enter là "chốt chữ" (`isComposing`/`keyCode 229`
cho qua), và Enter chỉ gửi khi nút ↑ đang hiện — không gửi được thì nuốt phím, không chèn dòng
trống. Ô nhập tự cao theo nội dung (trần 160px = `max-height` sẵn có; số dòng tối đa của app chưa
đo). Nghiệm bằng phím thật qua CDP: Shift+Enter xuống dòng + cao 40→60, Enter gửi + co về 40,
Enter lúc rỗng không làm gì — 3/3.

**X7.2 — quét control app ↔ web (cùng ngày).** So bảng kiểm kê control của `ui-xray` với web, bốn
control app có mà web thiếu, làm cả bốn và nghiệm trên stack thật:

| control app | web trước đó | đã map |
|---|---|---|
| `sand-group-author` = NÚT `Open X's chat` | div trang trí | button, bấm mở chat bot đó (dùng chung `selectBot`) |
| chấm `Unread activity` (`sand-kit-status-dot` 8px `rgb(16,132,254)`, aria `"X, Unread activity"`) | chấm đã có, đúng màu — nhưng **không bao giờ tắt** | mở chat là PATCH `unread:false` (app clear qua `kickstartAgent`); nghiệm: dựng `unread:true` → chấm hiện + aria đúng chuỗi → bấm → FE lẫn backend về false |
| `Open image full screen` quanh ảnh đính kèm | ảnh là trang trí | nút mở lightbox, nền `rgba(0,0,0,.5)` = số đo từ `ui-dialog-backdrop` của họ; Esc/bấm để đóng. Nghiệm qua đường upload thật |
| `sand-row-timestamp` — giờ theo hàng, 12px `rgba(252,252,252,.4)` (= `--fg-3`), opacity 0 → hover, mép phải | không có | `.erow` + `.row-time`; vị trí cho lượt CỦA MÌNH chưa đo được (app đặt mép phải, mình để cạnh trái bubble — suy đoán có ghi) |

Kéo thả / panel đo lại nguyên bài: `measure:resize` **10/10**, `measure:pane` **10/10**,
`ui-diff` **165/165 (100%)** cả ba khổ sau toàn bộ thay đổi.

**Còn thiếu, và vì sao chưa làm** (đây là danh sách tính năng, không phải danh sách quên):

- **Plugins** — X5.4, phiên khác đang dựng (`src/plugins.ts` chưa vào git), không chạm.
- **Tạo luồng** — cần `replyToEntryId` trong `TurnBody`/`Entry` + runtime đưa tin trích vào prompt;
  `runtime/turn.ts` là file phiên khác đang sửa. Menu đang để mờ kèm lý do, đúng X6.2.
- **Đính kèm file KHÔNG phải ảnh** — `/v1/attachments` từ chối `not an image` ở backend; app gốc đi
  đường box-upload riêng cho file thường (xem spike-findings về hai đường đính kèm). Cần route mới,
  là việc backend X8, không phải việc FE.
- **Bộ emoji trong picker** — của mình là 8 emoji tự chọn; bộ của họ (6 + `More emoji`) vẫn chưa đo
  được vì toolbar hover của họ không giữ trạng thái qua CDP (ghi từ X6).
- BFF `:8788` chết giữa phiên đo (ba cổng kia sống) — khởi động lại thì mọi bài xanh; **chưa rõ vì
  sao chết**, đáng soi ở lượt sau nếu tái diễn.

Chưa mapping (biết, và chưa làm): tài khoản web hiện **email** ở đáy sidebar vì tài khoản web chỉ
có email — app hiện tên (`Grok Local`) vì tài khoản của máy có tên. Và roster hai bên **khác nhau
là đúng**: web đăng nhập tài khoản riêng (`local|…`), app là chủ máy (`auth0|grokbot2-user`) —
multi-tenant scoping đang làm đúng việc của nó, không phải UI thiếu.

---

## 5. Luật

- Không có số thì không tính là xong. `pnpm ui:diff` trước/sau, mỗi mục.
- Vùng mới dựng phải vào `ui-anchors.mjs` — cả `ui-diff` và `ui-shots` đọc chung bảng đó.
- Route `/v1` mới đi kèm e2e có ghi nhật ký (`recordRun`).
- Không chép CSS/bundle/asset của hãng. Đo, rồi tự viết. Avatar dùng `bloub` (MIT).
- Nghi ngờ một con số thì đo lại bằng cách khác. Trong tài liệu này đã có một con số như vậy
  (240ms vs "1008ms").
