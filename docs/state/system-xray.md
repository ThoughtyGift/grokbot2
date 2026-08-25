# X-QUANG HỆ THỐNG GROKBOT2

Viết cho người **không rành kỹ thuật**. Mọi con số dưới đây **đo từ hệ đang chạy** ngày
25/08/2026, không phải đọc code đoán ra. Chỗ nào không đo được thì ghi thẳng **KHÔNG CHẮC CHẮN**.

Chạy lại phần đo: `node services/grokbot-backend/scripts/self-xray.mjs`

---

## 1 · Hệ thống này là gì

Hãy hình dung một **trợ lý ảo có máy tính riêng**.

- Bạn nhắn cho nó như nhắn tin cho nhân viên.
- Nó có một **máy tính thật ở xa** (thuê VPS) — mở trình duyệt, bấm chuột, gõ phím, đọc/ghi file.
- Nó **nhớ** việc cũ, **làm theo lịch**, và **học được quy trình** bạn dạy.

Ba mảnh ghép lại:

| mảnh | ví dụ đời thường |
|---|---|
| **Giao diện** (app trên máy bạn) | cái điện thoại bạn cầm |
| **Backend** (chạy trên chính máy bạn) | tổng đài — nhận lệnh, ghi sổ, điều phối |
| **Box** (máy Linux thuê ngoài) | cái bàn làm việc có máy tính, bot ngồi làm ở đó |

Bộ não thì đi thuê: mỗi câu trả lời được hỏi từ **Claude pool** (`admin.halcion.vn`).

**Điều quan trọng nhất:** toàn bộ **hội thoại của bạn nằm trên máy bạn**, không nằm trên mây.
Box hỏng thì mất việc đang dở, **không mất lịch sử chat**.

---

## 2 · Bản đồ hệ thống

```
        BẠN
         │  gõ tin nhắn
         ▼
┌──────────────────────────────────────────────┐
│  MÁY CỦA BẠN (Windows)                       │
│                                              │
│   App Grok Bot (đã vá)   ──┐                 │
│   Web local :5173        ──┤                 │
│                            ▼                 │
│              ┌────────────────────────────┐  │
│              │ BACKEND — 4 tiến trình     │  │
│              │  :8788  cửa chính, GHI SỔ  │  │
│              │  :8789  chạy lượt chat     │  │
│              │  :8790  điều khiển box     │  │
│              │  :8791  lịch + webhook     │  │
│              └──────┬──────────┬──────────┘  │
│                     │          │             │
│              ┌──────▼─────┐    │             │
│              │  SỔ SQLite │    │             │
│              │ 2.036 tin  │    │             │
│              │  8 bot     │    │             │
│              └────────────┘    │             │
└────────────────────────────────┼─────────────┘
                                 │ hầm SSH
        ┌────────────────────────▼─────────────┐
        │  BOX (VPS Linux) — bàn làm việc      │
        │   • Màn hình ảo 1920×1080 (xem VNC)  │
        │   • Chrome (giữ cookie đăng nhập)    │
        │   • workspace/ 152 MB — file bot tạo │
        │   • grok-memory/ — trí nhớ từng bot  │
        └──────────────────────────────────────┘

        BỘ NÃO ĐI THUÊ ─── admin.halcion.vn (Claude pool)
```

---

## 2b · Vận hành hàng ngày — khác app gốc chỗ nào

Đây là phần người dùng **cảm nhận được**, không phải phần trong code.

| việc | app gốc | bản này |
|---|---|---|
| **Bật app** | bấm đúp là xong | phải **bật backend trước**, rồi mở bằng **shortcut** — bấm đúp thẳng vào app là nó nói chuyện với server hãng |
| **Ai nuôi backend** | hãng nuôi, nằm trong box của họ | **máy bạn nuôi** — 4 tiến trình, tốn ~2 GB RAM |
| **Cập nhật app** | tự động, im lặng | **phải TẮT** (`SAND_DISABLE_UPDATES`) — không tắt thì bản vá bị xoá sạch |
| **Box** | cấp lúc đăng nhập, **ngủ đông khi rảnh** | VPS cố định ghi trong `.env`, **chạy 24/7 và bạn trả tiền cả lúc không dùng** |
| **Sao lưu** | hãng tự đồng bộ lên kho của họ | `.data/*.bak` trên máy bạn — **đã cứu thật 2 lần trong ngày 25/08** |
| **Đổi máy** | đăng nhập máy nào cũng có đủ dữ liệu | ❌ **dữ liệu nằm trên MỘT máy** — mở laptop khác là trắng trơn |
| **Đăng nhập** | tài khoản hãng, có mật khẩu | một chuỗi token trong file trên máy |
| **Mất mạng** | app rỗng (host nằm ở xa) | lịch sử chat **vẫn đọc được** vì nằm trong SQLite cục bộ; chat và box thì chết |

Ba điều đáng nhớ nhất từ bảng này:

1. **Bạn được cái riêng tư, trả bằng cái tiện.** Dữ liệu không rời máy — nhưng đổi máy là mất, và
   không ai sao lưu hộ.
2. **Box tính tiền cả lúc ngủ.** Hãng ngủ đông box khi rảnh (`AdminHibernateSandBox`); bản này chưa
   có, nên VPS chạy suốt.
3. **Cập nhật là kẻ thù.** Một lần app tự cập nhật là bản vá biến mất và app quay về server hãng.

**KHÔNG CHẮC CHẮN:** dòng "mất mạng" — lịch sử chắc chắn đọc được vì nó nằm trong SQLite trên máy,
nhưng **tôi chưa thử rút mạng** để xem app có boot trọn vẹn không.

## 2c · Tải về rồi thì máy bạn giữ những gì

Đo trên chính máy này:

```
Ổ ĐĨA — khoảng 584 MB
├── App đã cài .......................... 537 MB
│   ├── app/ (bản đã vá, đang chạy) ..... 93 MB
│   ├── app.asar.unpacked ............... 47 MB
│   └── app.asar.disabled-by-grokbot2 ... 46 MB   ← bản gốc, dời sang một bên, KHÔNG được xoá
└── .data/ .............................. 47 MB
    ├── grokbot.sqlite .................. 2.1 MB  ← TOÀN BỘ hội thoại của bạn
    ├── 8 bản sao lưu .bak .............. ~17 MB  ← thứ đã cứu dữ liệu 2 lần
    ├── attachments/ .................... 2.5 MB
    └── secrets/ · oauth/ · mcp/ ........ <1 MB   ← khoá đăng nhập plugin

RAM khi đang chạy — khoảng 2.9 GB
├── App Grok Bot ........................ 924 MB
└── Backend (4 tiến trình) .............. ~1.96 GB
    └── tiến trình lớn nhất 1.030 MB — giữ hội thoại trong bộ nhớ
```

**Ba file không bao giờ được xoá:**

| file | mất thì sao |
|---|---|
| `.data/grokbot.sqlite` | mất sạch bot và hội thoại |
| `pool-key.txt` | bot không trả lời được nữa (không hỏi được não) |
| `app.asar.disabled-by-grokbot2` | không gỡ bản vá về được, phải cài lại app |

**Một điều đáng chú ý:** backend ăn **~2 GB RAM** — nhiều hơn cả app. Phần lớn nằm ở tiến trình giữ
hội thoại trong bộ nhớ. Máy 8 GB chạy được nhưng sẽ thấy chật; đó là cái giá của việc **backend nằm
trên máy bạn thay vì trên mây**.

## 3 · Một tin nhắn đi qua đâu

Ví dụ thật: bạn gõ **"Lập hoá đơn cho khách Trần Văn B: 2 hộp nến 120000"**

```
1. App gửi tin      →  POST /gw/api/sendPrompt
                       {"agentId":"agent-495","content":"Lập hoá đơn…"}

2. Cửa chính :8788  →  kiểm giấy tờ (token) → biết đây là tin của AI
                       ghi tin vào sổ SQLite

3. Chạy lượt :8789  →  gom: lời dặn hệ thống + trí nhớ + danh sách skill
                       + 60 công cụ  →  gửi hết sang Claude pool

4. Pool trả lời     →  "TOOL_CALL: read_file_v2({…/hoa-don/SKILL.md})"

5. Backend chạy tool → đọc file trên box, đưa kết quả lại cho pool

6. Pool trả lời tiếp →  "Tạm tính 255.000 · VAT 8% 20.400 · Tổng 275.400"

7. Ghi sổ + đẩy về app qua luồng SSE  →  bạn thấy chữ hiện dần
```

**Đo thật từ nhật ký:** lệnh `getAgentTranscriptTail` (app hỏi "có gì mới không") đã chạy
**65.362 lần** — app hỏi liên tục, đó là cách nó cập nhật màn hình.

---

## 4 · Bot làm việc thế nào (luồng agent)

Bot **không tự làm được gì** ngoài nói. Muốn động tay phải gọi **công cụ**. Hiện có **60 công cụ**:

| nhóm | số lượng | làm gì | ví dụ |
|---|---|---|---|
| Trình duyệt | 16 | mở web, bấm, gõ, chụp | `browser_navigate`, `browser_click` |
| Máy tính | 3 | bấm chuột thật trên màn hình box | `computer_use` |
| Máy chủ | 9 | chạy lệnh, đọc/ghi file, tìm web | `run_terminal_command_v2` |
| Khác | 32 | nhắn bot khác, tạo routine, soạn email… | `task`, `await_task` |

Khi việc lớn, bot **thuê thợ phụ** (subagent) — hiện có 4 loại: `browserUse`, `explore`, `shell`,
`pastConversationExplorer`.

```
   Bạn giao việc
        │
        ▼
   Bot chính đọc: có skill nào hợp không?
        │
        ├── có ─────► đọc SKILL.md ──► làm theo đúng quy trình
        │
        └── không ──► tự nghĩ cách
                          │
                          ▼
              Việc nhỏ ──► gọi thẳng công cụ ──► xong
                          │
              Việc lớn ──► task(async) ──► thợ phụ làm nền
                                              │
                                    await_task ──► gom kết quả
```

**Bằng chứng chạy thật (hôm nay):** giao 2 việc nền mất 3 giây, một lần `await_task` thu cả hai sau
25 giây — nếu chạy nối đuôi thì không thể nhanh vậy.

---

## 5 · Sổ sách (cơ sở dữ liệu)

14 bảng. **10 bảng có cột `owner_id`** — tức đã biết dòng nào của ai.

```
users (auth_id, email, plan)                     ← người dùng
  │ 1
  │
  │ n
agents (id, name, owner_id)                      ← các bot            8 dòng
  │ 1              │ 1                │ 1
  │ n              │ n                │ n
entries        automations         todos
(hội thoại)    (routine)           (checklist)
 2.036 dòng      8 dòng             1 dòng
  │
  │ n
attachments_meta (64)   acceptance (1.371)   parked (19)   compaction (8)   handoffs (2)

usage (auth_id, day, tokens_in, tokens_out)      ← đếm để tính tiền
plans (name, monthly_token_cap, checkout_url)    ← bảng giá (dùng chung, đúng thiết kế)
host_settings (id, body)                         ← ⚠️ MỘT dòng cho TẤT CẢ mọi người
```

**Ví dụ một dòng `todos` thật:**
```
agent-11 | [{"text":"Doc log","done":true},{"text":"Sua bug","done":false}] | auth0|grokbot2-user
```

---

## 6 · Bản đồ API

Ba cửa, ba mục đích khác nhau.

### Cửa 1 — `/gw/api/<lệnh>` · app Grok Bot dùng (120 lệnh, đã từng gọi 103)

| lệnh | để làm gì | gọi thật |
|---|---|---|
| `getAgentTranscriptTail` | app hỏi "có tin mới không" | 65.362 |
| `getAgentChannels` | kênh liên lạc của bot | 37.184 |
| `listAgents` | danh sách bot ở cột trái | 14.977 |
| `sendPrompt` | **gửi một tin nhắn** | — |
| `createAgentAutomation` | tạo routine | 31 |

Ví dụ vào/ra thật:
```
VÀO : POST /gw/api/createAgentAutomation
      {"id":"agent-495","spec":{"name":"THU","prompt":"…",
       "trigger":{"type":"slack","channel":"#thu-nghiem",
                  "match":{"kind":"keyword","keyword":"hoa don"}}}}
RA  : [{"id":"automation-9","triggerDescription":"khi có tin nhắn Slack ở #thu-nghiem chứa \\"hoa don\\""}]
```

### Cửa 2 — `/v1/...` · web local dùng (29 route, 32 khuôn dữ liệu)

`/v1/login` · `/v1/register` · `/v1/me` · `/v1/agents` · `/v1/events` · `/v1/plugins` ·
`/v1/attachments` · `/v1/search` · `/v1/host/settings` · `/v1/billing/webhook` · …

```
VÀO : POST /v1/login  {"email":"a@b.com","password":"…"}
RA  : {"token":"eyJ…","user":{"authId":"local|a@b.com","plan":"free"}}
```

### Cửa 3 — `/admin` · bảng theo dõi máy (mới làm hôm nay)

```
VÀO : GET /admin?token=<token cổng>
RA  : trang HTML — "còn cấp thêm được 11 bot", RAM 6.7/21.5 GB, đĩa 13.9 GB trống
```

---

## 6b · Ba mảng bạn hỏi: đăng nhập · trình duyệt/Cloudflare · thanh toán

### A · Đăng nhập / đăng xuất — **CÓ, và đang chạy thật**

Gọi thẳng vào backend đang chạy lúc viết dòng này:

| gọi | trả về |
|---|---|
| `POST /v1/register` mật khẩu `"abc"` | **400** · `{"error":"password must be at least 8 characters"}` |
| `POST /v1/login` sai mật khẩu | **401** · `{"error":"invalid email or password"}` |
| `GET /v1/me` không token | **401** · `{"error":"unauthorized"}` |
| `POST /v1/logout` | **204** |

Mật khẩu lưu bằng **scrypt + muối ngẫu nhiên riêng từng người**, so sánh bằng `timingSafeEqual`
(không thư viện ngoài). Trong sổ hiện có **đúng 1 tài khoản**: `trinhdung3110@gmail.com`, gói `free`.

Lưu ý có **hai đường đăng nhập khác nhau**, dễ nhầm:
- **App Grok Bot** — không có mật khẩu, dùng một token trong file trên máy.
- **Web local** — email + mật khẩu như trên.

**Ba lỗ, chỉ lộ khi mở cho nhiều người:**

1. **Đăng xuất không thu hồi gì.** Token sống **365 ngày**; mất token là mất tài khoản trong một năm.
2. **Không giới hạn số lần đoán mật khẩu** — tìm cả mã nguồn, không có dòng nào chặn.
3. **`/v1/register` mở cho bất kỳ ai gọi được cổng** — không mã mời, không công tắc tắt.

Hôm nay ba lỗ này **chưa nguy hiểm**, vì cả 4 cổng chỉ nghe `127.0.0.1` (đo bằng `netstat`) — máy
khác không với tới được. Nhưng đúng ba việc này **phải xong trước khi rời máy cá nhân lên VPS**.

### B · Trình duyệt & Cloudflare — **có trình duyệt thật, KHÔNG có xử lý Cloudflare**

Cái đang có:
- **16 công cụ trình duyệt**, lái một **Chrome thật** trên box (không phải headless).
- **Hồ sơ riêng giữ cookie**: `/home/box/.config/grok-chrome-77/Default/Cookies` — đăng nhập Shopee
  một lần, lần sau vẫn còn.

Cái **không có**: quét toàn bộ mã nguồn, **0 dòng** nhắc tới `cloudflare` · `turnstile` · `captcha` ·
`stealth`.

Nghĩa thực tế: **gặp trang chặn thì bot không biết mình đang bị chặn.** Nó chỉ thấy một trang lạ rồi
loay hoay. Cách duy nhất hiện nay là `computer_use` bấm tay vào ô "Tôi không phải robot" — làm được,
vì đó là Chrome thật trên màn hình thật, nhưng **không có gì tự động**.

**KHÔNG CHẮC CHẮN:** Cloudflare có nhận ra Chrome của mình là máy điều khiển không. Chrome khởi động
**không** có cờ chống nhận diện, và bật CDP thường làm lộ `navigator.webdriver` — nhưng **tôi chưa
thử vào một trang có Cloudflare thật**. Phép thử này mất khoảng 5 phút và nên làm trước khi bàn cách
chống.

> Nếu "CF Browser" ý bạn là **Cloudflare Browser Rendering** (thuê trình duyệt của Cloudflare thay vì
> Chrome trên box): **chưa có**, và đổi sang nó sẽ **mất phần đáng giá nhất** — màn hình nhìn được
> qua VNC và cookie đăng nhập giữ lại giữa các phiên.

**Một phát hiện ngoài lề, đo được lúc kiểm tra:** Chrome đang chạy trên box **không phải của
grokbot2** — nó là `--user-data-dir=/root/flow-vps-profile`, chạy **dưới quyền root**, qua proxy
`127.0.0.1:8888`, mở `labs.google/fx/flow`. Box đang dùng chung với việc khác của bạn, và tiến trình
đó **quyền cao hơn bot**.

### C · Thanh toán — **mã có đủ, nhưng chưa từng chạy một lần nào**

Đo trong sổ:

| đo | kết quả |
|---|---|
| bảng `usage` (đếm token) | **0 dòng** |
| bảng `plans` (bảng giá) | **rỗng** |
| `GROKBOT2_BILLING` | không đặt → **`off`** |

Đã viết xong: đếm token mỗi lượt · hạn mức theo gói (`free` 100.000 token/tháng) · chặn khi vượt ·
webhook `/v1/billing/webhook` cho nhà thanh toán báo về · ba mức `off | warn | enforce`.

Chưa có: **nút trả tiền trong app**, **trang thanh toán thật**, và **chưa ai bật `warn`**.

Nói thẳng: **billing đang là mã chết** — không phải hỏng, mà là **chưa bật**. Muốn biết nó đúng hay
sai thì bật `warn` một tuần, xem bảng `usage` có mọc số không, rồi mới dám `enforce`. Bật `enforce`
ngay lúc chưa có một dòng đo nào là cách nhanh nhất để tự khoá mình ra ngoài.

### Việc tiếp theo — xếp theo thứ tự nên làm

| # | việc | vì sao là bây giờ | xong khi |
|---|---|---|---|
| 1 | **Bật billing mức `warn`** | `usage` 0 dòng nghĩa là **chưa từng đo được gì**; không có số thì không có gì để tính tiền | sau 1 tuần bảng `usage` có dòng thật, có cảnh báo khi vượt |
| 2 | **Dọn code đang ĐỎ** | luật của chính dự án đang đỏ **hai lượt liền** — luật nói dừng thêm tính năng | `self-xray` xanh 9/9 |
| 3 | **Vá 3 lỗ đăng nhập** | mất một ngày, và **bắt buộc** trước khi rời `127.0.0.1` | token thu hồi được · đoán sai 5 lần bị chặn · đăng ký cần bật mới mở |
| 4 | **Thử Cloudflare thật** rồi thêm bước nhận biết trang chặn | rẻ, và đang đoán mò | bot **nói được** "tôi đang bị chặn" thay vì loay hoay |
| 5 | `host_settings` tách theo người | đang **một dòng dùng chung** cho tất cả | mỗi người một dòng cài đặt |
| 6 | Tách OS user trên box | cookie và trí nhớ đang dùng chung | bot của A đọc file của B **bị từ chối** |
| 7 | FE routines | mảng trống lớn nhất của giao diện | tạo/sửa routine ngay trên web |

Thứ tự này không phải theo độ khó mà theo **cái gì chặn cái gì**: không đo được thì không tính tiền
được (1); code đỏ càng để càng đắt (2); và mọi việc mở cho nhiều người đều phải qua (3).

## 6c · Test trên một máy thứ hai trước — rồi mới xây tiếp

**Vì sao máy thứ hai lại là bước đầu tiên:** nó là **cái thước đo ranh giới**. Suốt dự án ta vẫn
đoán "phần này của máy khách, phần kia của VPS". Máy thứ hai trả lời bằng thực nghiệm:

> Cái gì **phải chép tay** sang máy mới → thuộc **bộ cài** hoặc thuộc **VPS**.
> Cái gì **tự sinh lại được** → đúng là của **máy khách**.

Không cần mua VPS thứ hai. Một cái laptop khác, hoặc một tài khoản Windows khác trên cùng máy, là đủ.

### T0 · Mang gì sang — và cố tình KHÔNG mang gì

| mang sang | dung lượng | vì sao |
|---|---|---|
| mã nguồn (git clone) | — | rồi `pnpm install` |
| `pool-key.txt` | 97 byte | chìa khoá hỏi não |
| `box-token.txt` | 48 byte | chìa khoá gọi box |
| `._env.mts` | 862 byte | đặt `CLAUDE_POOL_KEY` · `GROKBOT2_GATEWAY_TOKEN` · `GROKBOT2_JWT_SECRET` · `GROKBOT2_BILLING_WEBHOOK_SECRET` |
| `~/.ssh/id_ed25519` | — | hầm ssh vào box |

| **cố tình KHÔNG mang** | vì sao |
|---|---|
| `.data/` (sổ SQLite + 8 bản `.bak`) | **để trống mới là phép thử** — xem BE có dựng lại từ số 0 được không |
| thư mục `app/` đã vá | phải vá lại trên máy sạch — chính đó là việc bộ cài sẽ phải làm thay người dùng |

Bốn file bí mật kia cộng lại **chưa tới 1 KB**. Đó đã là câu trả lời sớm cho câu hỏi phân tách: phần
"bí mật" của hệ thống nhỏ xíu; phần cồng kềnh (537 MB app) thì ai tải cũng được.

### T1 → T6 · Thứ tự chạy, mỗi bước đo một thứ

| # | làm gì | ĐẠT khi | bước này **đo được điều gì** |
|---|---|---|---|
| **T1** | `pnpm install` → `pnpm backend`, chưa mở app | `curl /v1/health` → `{"ok":true,…}` · `.data/grokbot.sqlite` **tự sinh**, 0 bot · `register` + `login` trả token | BE có tự dựng từ con số 0 không, hay đang bám vào dữ liệu máy cũ |
| **T2** | `pnpm web` → chat **một** lượt | có một câu trả lời thật hiện ra | chìa khoá mang sang đã đủ chưa — hay còn thứ gì chỉ máy cũ mới có |
| **T3** | chạy `box-tunnel.ps1`, bảo bot liệt kê thư mục | bot liệt kê được `/home/box/workspace` · VNC hiện màn hình | **box không thuộc máy khách** — chỉ cần khoá ssh + token là với tới |
| **T4** | cài app gốc sạch → `patch-client.mjs --apply` → mở bằng shortcut → `check-app.cmd` | đếm được RPC thật về backend local trong 6 giây · có file `app.asar.disabled-by-grokbot2` | bộ vá **tái lập được trên máy sạch** không — đây chính là phần bộ cài phải tự động hoá |
| **T5** | **máy 1 và máy 2 cùng sai bot mở trình duyệt** | *(xem dưới)* | mức độ đụng nhau khi dùng chung một box |
| **T6** | đưa BE lên VPS, máy khách trỏ vào | máy 1 và máy 2 thấy **cùng một** dữ liệu | phần nào **thật sự** phải nằm trên VPS |

**T5 là phép đo đáng giá nhất, và tôi đoán trước là nó sẽ ĐỎ.** Hai máy dùng chung một hồ sơ Chrome
và chung cookie, nên nhiều khả năng bot bên này cướp tab hoặc lẫn phiên đăng nhập của bot bên kia —
đúng cái lỗi bạn từng gặp với Shopee. Nếu đỏ thật thì việc tách OS user không còn là lý thuyết trong
tài liệu nữa mà là **bằng chứng hiện trường**. Cứ ghi lại đúng cái gì xảy ra, đừng sửa vội.

**T6 chưa chạy được ngay.** Có hai thứ chặn, đều đo được:

1. `src/index.ts:355` — `server.listen(config.port, "127.0.0.1")` **khoá cứng loopback**. Máy khác
   không gọi vào được, dù có mở tường lửa.
2. Ba lỗ đăng nhập ở mục 6b. Còn ở `127.0.0.1` thì vô hại; đưa lên VPS là thành thật.

Nên **T6 phải chạy sau khi vá xong ba lỗ đó**, không phải trước.

### Phân tách — sau khi T1–T4 xác nhận

| nằm ở đâu | gồm những gì | bằng chứng từ test |
|---|---|---|
| **Máy khách** (tải về) | app Grok Bot đã vá (537 MB) · 4 biến môi trường lúc khởi động · shortcut | T4: vá lại được trên máy sạch |
| **VPS / BE** | 4 tiến trình · sổ SQLite · đăng nhập · billing · điều phối box | T1: tự dựng từ 0 · T6: hai máy chung dữ liệu |
| **Box** | màn hình ảo · Chrome + cookie · workspace · trí nhớ bot | T3: chỉ cần ssh + token, không cần gì của máy khách |
| **Thuê ngoài** | Claude pool (`admin.halcion.vn`) | T2: một chìa khoá 97 byte là đủ |

Hôm nay **cột "VPS/BE" đang nằm nhầm trên máy bạn**. Toàn bộ việc còn lại của dự án, gói gọn, là
**dời đúng một cột đó sang VPS** — không phải viết lại hệ thống.

### Thứ tự xây, sau khi test xong

| # | việc | phụ thuộc | xong khi |
|---|---|---|---|
| **B1** | Bộ cài gói 4 việc tay (cài app → vá → đặt biến → tạo shortcut) | T4 | máy sạch: bấm một lần là chạy |
| **B2** | Vá 3 lỗ đăng nhập | — | thu hồi được token · chặn đoán mật khẩu · khoá đăng ký |
| **B3** | Cho BE nghe ra ngoài: đổi `listen` + CORS + HTTPS | **B2** | T6 chạy được |
| **B4** | Tách OS user trên box | **T5** đỏ | bot của A đọc file của B bị từ chối |
| **B5** | `host_settings` theo từng người | B3 | hai máy đặt hai múi giờ khác nhau |

**Chạy song song ngay trên máy 1, không cần chờ:** bật `GROKBOT2_BILLING=warn`. Đó là **một biến môi
trường**, không phải code, nên không đụng gì tới loạt test trên — mà bảng `usage` cần một tuần dữ
liệu thật trước khi ai đó dám bật `enforce`.

**Một điều nên nói trước:** T1–T4 nhiều khả năng sẽ lòi ra vài chỗ hardcode đường dẫn máy này mà
hiện chưa ai thấy. Đó **là mục đích** của bài test, không phải sự cố. Mỗi chỗ như vậy tìm được sớm
trên máy thứ hai rẻ hơn nhiều so với tìm được sau khi người dùng đầu tiên tải về.

## 7 · Vấn đề — và **vì sao** nó là vấn đề

Xếp theo mức đau, không theo thứ tự tìm ra.

### 🔴 1. Nhiều người dùng chung một box → **lộ hết**
- **Đo:** mọi bot chạy dưới cùng một tài khoản Linux (`uid=1001`).
- **Vì sao đau:** cookie đăng nhập Shopee của bạn **là cookie của mọi bot**; trí nhớ bot người này
  đọc được bởi bot người khác.
- **Ví dụ đời thường:** mười nhân viên dùng chung một máy tính, chung một tài khoản, không khoá màn
  hình.
- **Đã có kế hoạch:** [../plan/per-user-on-one-box.md](../plan/per-user-on-one-box.md)

### 🔴 2. Cài đặt dùng chung (`host_settings` một dòng)
- **Vì sao đau:** người này đổi múi giờ thì người kia chịu.

### 🟠 3. Code phình — **mục ĐỎ trong máy đo của chính dự án**
- **Đo:** 5 file > 800 dòng · 28 hàm > 50 dòng (**tăng** từ 3 file / 16 hàm).
- **Vì sao đau:** file càng dài càng khó sửa mà không làm hỏng chỗ khác.
- **Thành thật:** phần tăng thêm **do việc hôm nay của tôi** — `admin.ts:page` và các export mới
  chưa ai dùng (`describeCrops`, `readCrop`, `leasesSnapshot`…).

### 🟠 4. Luật "không lặp lại" đang ĐỎ
- **Đo:** cùng một mục đỏ hai lượt liền.
- **Vì sao đau:** đây là luật tự đặt của dự án — **dừng thêm tính năng, đi sửa cái sinh ra nó**.

### 🟡 5. Bước "nhìn màn hình rồi bấm" chập chờn ~10–20%
- **Đo:** 5 lần chạy e2e: 29/29 · 27/29 · 28/29 · 29/29 · 28/29 — lỗi rơi vào **chỗ khác nhau mỗi
  lần**, và luôn là bước dựa vào thị giác.
- **Vì sao đau:** không phải lỗi sửa bằng một commit — đó là **hình dạng** của việc bấm không toạ độ.

### 🟡 6. Hai lần mất dữ liệu trong một ngày (đã sửa gốc)
- **Chuyện gì:** một script phụ nạp sổ cũ rồi ghi đè → mất 2 bot + 1.790 tin.
- **Đã sửa:** chỉ máy chủ được ghi sổ; tiến trình khác đọc được, ghi thì bị bỏ qua.

### KHÔNG CHẮC CHẮN
- **Ai đang ghi `bot.log` 10 MB** trong workspace — là bot Telegram Python của bạn, **không phải
  grokbot2**. Nó in **token bot ra log**; nên đổi token.
- **File tên hỏng** `{"contents_after_edit":…` — một lệnh ghi file lỗi, chưa truy được lượt nào.
- 7/20 lượt e2e gần nhất đỏ: **chưa phân tích từng lượt**, không kết luận nguyên nhân.

---

## 8 · Lộ trình làm lại

```
SỬA NGAY          →  REFACTOR        →  KIẾN TRÚC      →  AGENT        →  TỐC ĐỘ     →  BÁN ĐƯỢC
(1–2 ngày)           (1 tuần)           (2–3 tuần)        (1 tuần)        (vài ngày)     (sau cùng)
```

| chặng | việc | xong khi |
|---|---|---|
| **Sửa ngay** | `host_settings` theo từng người · xoá export chết vừa tạo | self-xray hết đỏ mục "không lặp lại" |
| **Refactor** | tách 5 file > 800 dòng · 28 hàm > 50 dòng | self-xray xanh 9/9 |
| **Kiến trúc** | tách theo OS user + thu hồi khi nghỉ | bot của A đọc file của B **bị từ chối** |
| **Agent** | lọc trigger theo điều kiện (**xong hôm nay**) · thêm `create_diagram` | routine chỉ nổ đúng kênh/từ khoá |
| **Tốc độ** | giảm `getAgentTranscriptTail` 65.362 lượt bằng SSE | số lần hỏi giảm rõ, màn hình vẫn mượt |
| **Bán được** | FE riêng → bộ cài → cấp box khi đăng nhập | [../plan/ship-to-users.md](../plan/ship-to-users.md) |

---

## 9 · Sơ đồ một app TODO (vẽ theo **code thật** của dự án)

Grokbot2 **đã có** chức năng todo — bảng `todos` và công cụ `todo_write`/`todo_read`. Đây là luồng
thật, không phải ví dụ tưởng tượng:

```
  ┌─────────────────────────────────────────────────────────────┐
  │  TẠO                                                        │
  └─────────────────────────────────────────────────────────────┘
   Bạn: "liệt kê 2 việc: đọc log, sửa bug"
      │
      ▼
   Bot gọi:  todo_write(["Doc log","Sua bug"])
      │
      ▼
   Lưu vào bảng todos  ──►  agent_id | body(JSON) | owner_id
      │
      ▼
   Trả về danh sách đã vẽ:   ☐ Doc log
                             ☐ Sua bug

  ┌─────────────────────────────────────────────────────────────┐
  │  XEM                                                        │
  └─────────────────────────────────────────────────────────────┘
   Bot gọi todo_read  ──►  đọc todos theo agent_id  ──►  vẽ lại

  ┌─────────────────────────────────────────────────────────────┐
  │  CẬP NHẬT  (đánh dấu xong)                                  │
  └─────────────────────────────────────────────────────────────┘
   Bot gọi: todo_write([{"text":"Doc log","done":true},
                        {"text":"Sua bug","done":false}])
      │
      ▼
   GHI ĐÈ cả danh sách (không sửa từng dòng)
      │
      ▼
   ☑ Doc log
   ☐ Sua bug

  ┌─────────────────────────────────────────────────────────────┐
  │  XOÁ                                                        │
  └─────────────────────────────────────────────────────────────┘
   Gửi danh sách MỚI, thiếu việc muốn bỏ  ──►  ghi đè  ──►  việc đó biến mất
      │
      └── Xoá bot  ──►  todos của bot đó bị dọn theo
```

**Một điểm thiết kế đáng biết:** không có "sửa một dòng" hay "xoá một dòng". Mỗi lần đều **ghi đè
cả danh sách**. Đơn giản hơn nhiều, và hợp với cách dùng thật — bot luôn có sẵn cả danh sách trong
đầu khi nó viết lại.

**KHÔNG CHẮC CHẮN:** giao diện app có vẽ checklist này thành ô tick hay chỉ hiện chữ — chưa mở app
để đối chiếu.
