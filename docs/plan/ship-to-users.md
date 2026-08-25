# Từ người lạ đến người trả tiền — đường đi A→Z

Trạng thái: **hiện trạng đo được + kế hoạch**. Tài liệu này trả lời bốn câu của một sản phẩm thật:
người ta **vào bằng cửa nào**, **cài thế nào**, **tiền tính ra sao**, **dữ liệu nằm đâu**.

Không lặp lại những gì đã có chỗ khác. Bốn tài liệu này là phần chi tiết, đọc khi cần:

| việc | ở đâu |
|---|---|
| Tách dữ liệu theo user (phase 0–6) | [multi-tenant-roadmap.md](multi-tenant-roadmap.md) |
| Cách ly máy: OS user + thu hồi khi nghỉ | [per-user-on-one-box.md](per-user-on-one-box.md) |
| Mỗi bot một màn hình | [one-display-per-bot.md](one-display-per-bot.md) |
| Gộp danh tính + ví với cinAPI | [cinapi-merge.md](cinapi-merge.md) |

## BE nằm ở đâu — và vì sao phải viết lại nó

Câu đầu tiên ai cũng hỏi: *app gốc đã có sẵn BE rồi, sao mình phải xây lại?* Trả lời bằng đo, và
phép đo này lật ngược một câu tôi từng nói sai (rằng host của họ chạy trên máy người dùng).

Bản gốc có **bốn tầng**, không phải hai:

| tầng | chạy ở đâu | chứa gì |
|---|---|---|
| FE (renderer) | máy người dùng | giao diện |
| Lớp mỏng trong Electron main | máy người dùng | cầu IPC, phía client của `/local-exec` và `/webauthn` — tức host **nhờ máy người dùng** làm hộ việc cục bộ |
| **Host ("box-host")** | **TRONG BOX của hãng** | 120 lệnh gateway, hội thoại, bộ lập lịch |
| Cloud `aiserver.v1.*` | máy chủ hãng | bộ não, cấp box, lắng nghe trigger, danh mục skill |

Ba bằng chứng, không phải suy đoán:

1. `docs/extracted/box-host-contract.json` — **tên là "box-host"**, và nó phục vụ đúng những
   đường mà `/gw` của mình phục vụ: `POST /api/<lệnh>`, `GET /events`, `GET /avatars/<id>`,
   `GET /health`. Health của nó trả `pid`, `startedAt`, `activeAgentId` — một tiến trình máy chủ.
2. `EnsureSandBoxResponse` trả cho app **`gateway_url` + `gateway_token`** — địa chỉ và giấy tờ để
   nói chuyện với host **của người đó**. Host có địa chỉ riêng nghĩa là host ở xa.
3. `GET /local-exec/requests` (auth **required**) — có thứ gì đó **hỏi host xem có việc gì cần chạy
   trên máy cục bộ không**. Chỉ có nghĩa khi host không nằm trên máy đó.

Nên: **BE không đi kèm bản tải về.** Thứ người dùng tải là FE cộng một lớp mỏng. Host nằm trong
box, mà box thì cloud của hãng chỉ cấp cho tài khoản trả tiền. **Không có gì để tái dùng.**

Và câu hỏi "vậy cái mình đang xây là Cloud à?" — **là cả hai**. Chính CLAUDE.md mô tả backend này
đúng như vậy: *"glue server: auth + bootstrap RPC + box gateway + chat bridge"*:

| grokbot2 làm vai gì | tương ứng tầng nào của họ |
|---|---|
| `/gw` — 120 lệnh, SQLite hội thoại, lịch, teach | **Host** |
| protobuf bootstrap (`EnsureSandBox`, `GetSandAccessStatus`, marketplace…) | **Cloud**, phần tối thiểu |
| trỏ não sang Claude pool | thay `AiService` |
| thuê một VPS làm màn hình | thay box của họ |

Một hệ quả đáng giá: vì host của họ **vốn đã ở xa** (HTTP + `gateway_token`), đưa backend của mình
lên VPS **không phải là chống lại thiết kế** — đó chính là thiết kế. Điều đó làm nhẹ đi câu hỏi
"mỗi người một backend hay chung một backend" ở cuối tài liệu: cả hai đều hợp với hình dạng gốc.

## Toàn cảnh

```mermaid
flowchart TB
  subgraph A["① VÀO — hai cửa"]
    D["Desktop: Grok Bot.exe đã patch<br/>token cổng trong .data/"]
    W["Web: apps/grokbot-web<br/>email + mật khẩu → JWT"]
  end
  subgraph B["② BACKEND — máy của bạn"]
    G["Gateway :8788<br/>checkAuth → owner"]
    RT["runtime :8789 — lượt chat"]
    OPS["ops :8791 — lịch + webhook"]
    CU["computer :8790 — box"]
  end
  subgraph C["③ DỮ LIỆU"]
    DB[("SQLite<br/>10 bảng có owner_id")]
    BOX[("Box VPS<br/>CHƯA tách theo user")]
  end
  subgraph M["④ TIỀN"]
    U["usage(auth_id, day, tokens)"]
    P["plans(cap, checkout_url)"]
    GATE["accessVerdict<br/>off | warn | enforce"]
  end
  D -->|"protobuf + /gw"| G
  W -->|"/v1"| G
  G --> RT & OPS & CU
  RT --> DB
  CU --> BOX
  RT -->|"mỗi lượt"| U
  U --> GATE
  P --> GATE
  GATE -->|"enforce: payment_required"| D
  RT -->|"HTTP"| POOL["Claude pool<br/>admin.halcion.vn"]
  style BOX fill:#3d1417,stroke:#6e2329
```

Ô đỏ là chỗ duy nhất chưa tách theo người dùng — và là chỗ chặn việc mở cho người thứ hai.

## ① Người dùng vào bằng cửa nào

**Hai cửa, hai loại giấy tờ.** Đo trong code:

| cửa | giấy tờ | ở đâu |
|---|---|---|
| App desktop | **token cổng** một chuỗi, sinh lúc cài, nằm ở `.data/gateway-token.txt` | `auth-gate.ts` |
| Web | **email + mật khẩu** → JWT ký HMAC | `web-auth.ts`, bảng `users(auth_id, email, password_hash, plan)` |

Cổng vào (`checkAuth`) nhận **cả ba**: `Bearer <token cổng>`, JWT của web, và cookie `cinapi_at`.
Chế độ `GROKBOT2_AUTH` = `off | warn | enforce`.

Một chi tiết dễ tưởng là lỗ hổng nhưng là cố ý: `/oauth/token` và `/auth/*` **luôn trả về một token
mới**, để màn hình đăng nhập của app hãng chạy trọn vẹn mà không cần máy chủ của họ. App **không
kiểm chữ ký** token đó (đã nghiệm bằng thực nghiệm), nên backend tự phát được.

**Còn thiếu để mở cho nhiều người:** app desktop hiện chỉ có MỘT token cổng cho cả máy. Muốn nhiều
người dùng app desktop thì token phải gắn với người, không gắn với máy.

## ② Từ website đến app chạy được

### Bản gốc đi thế nào

```mermaid
flowchart LR
  W["cursor.com<br/>trang tải"] --> I["installer<br/>Grok Bot.exe"]
  I --> L["Đăng nhập<br/>tài khoản hãng"]
  L --> C["Cloud aiserver<br/>EnsureSandBox"]
  C --> B["Cấp BOX cho người đó<br/>→ gateway_url + gateway_token"]
  B --> H["Host chạy TRONG box"]
  H --> A["App nói chuyện với host<br/>qua HTTP"]
```

Người dùng **chỉ tải FE**. Đăng nhập xong, cloud cấp một box, box chạy host, app nối vào host bằng
địa chỉ + token mà cloud vừa đưa. **Không đăng nhập thì không có box, không có host, app rỗng.**

### Bản mình đi thế nào

```mermaid
flowchart LR
  I["Cài Grok Bot.exe<br/>từ nhà phát hành"] --> P["patch-client.mjs<br/>dời app.asar sang<br/>app.asar.disabled-by-grokbot2"]
  P --> S["Shortcut start-app.cmd"]
  S --> E["run.ps1 đặt 4 biến"]
  E --> R["App nối vào backend<br/>trên CHÍNH máy đó"]
  X["Bấm thẳng Grok Bot.exe"] -.->|"KHÔNG có biến nào"| V["Nói chuyện với server hãng<br/>+ TỰ CẬP NHẬT, xoá sạch bản vá"]
  style V fill:#3d1417,stroke:#6e2329
```

Khác biệt nằm ở hai chỗ, và cả hai đều là hệ quả của việc **mình không phát hành app**:

- **Không có website tải.** Người dùng cài app của hãng rồi mình vá tại chỗ.
- **Không có cloud cấp box.** Backend chạy sẵn trên máy đó và tự đóng vai host; box là một VPS
  cấu hình cứng trong `.env`, không phải thứ được cấp lúc đăng nhập.

### Cái nào chạy ở máy khách, cái nào ở box

Đây là bản kiểm kê đo được, không phải sơ đồ ước lệ:

```mermaid
flowchart TB
  subgraph CL["MÁY KHÁCH (Windows) — mọi thứ thuộc về người dùng"]
    direction TB
    APP["Grok Bot.exe đã patch<br/>renderer + main · CDP :9222"]
    BE["backend — 4 tiến trình<br/>BFF :8788 · runtime :8789<br/>computer :8790 · ops :8791"]
    DBX[("SQLite .data/grokbot.sqlite<br/>bot · HỘI THOẠI · routine · đính kèm")]
    KEY["pool-key.txt · gateway-token.txt · .env"]
    TUN["đường hầm SSH<br/>9223 + 9301..9304"]
    APP --> BE --> DBX
    BE --- KEY
    BE --> TUN
  end
  subgraph BX["BOX / VPS (Linux) — chỗ bot LÀM VIỆC"]
    direction TB
    X["Xvfb :77 + fluxbox<br/>x11vnc :5977"]
    CH["Chrome — CDP 9223<br/>hồ sơ grok-chrome-77 (3.7 GB)<br/>COOKIE đăng nhập"]
    DMN["exec daemon<br/>API mà backend gọi"]
    WS["workspace/ (152 MB)<br/>file bot tạo ra"]
    MEM["grok-memory/ · .claude/skills/"]
    DRV["/tmp/grokbot2<br/>driver desktop + bộ ghi"]
  end
  POOL["Claude pool<br/>admin.halcion.vn — BỘ NÃO"]
  TUN -->|"CDP"| CH
  BE -->|"HTTPS exec"| DMN
  BE -->|"mỗi lượt chat"| POOL
  DMN --- WS & MEM & DRV
  X --- CH
  style CL fill:#0d2818,stroke:#2a6
  style BX fill:#0d1f2d,stroke:#268
```

Đọc ra ba điều, và cả ba đều là quyết định chứ không phải tình cờ:

1. **Hội thoại không bao giờ rời máy khách.** SQLite nằm trên Windows. Box mất thì mất *việc đang
   dở*, không mất lịch sử chat. Bản gốc ngược lại: transcript nằm trong box và đồng bộ lên kho của
   họ.
2. **Box không giữ danh tính, giữ CÔNG VIỆC.** File bot viết, trí nhớ, skill, và quan trọng nhất là
   **cookie đăng nhập Shopee/Facebook** trong hồ sơ Chrome.
3. **Chỉ một phụ thuộc ngoài duy nhất**: pool. Hỏng pool thì chat chết, mọi thứ khác vẫn sống.

Chi tiết cổng, ai được ghi SQLite, và bốn bất biến vận hành: [../architecture.md](../architecture.md).

### Đích: đi đúng đường app gốc, nhưng bằng FE của mình

Muốn giống hãng hoàn toàn — **trang tải riêng, app riêng, backend làm host** — thì mảnh quyết định
không phải trang web hay bộ cài. Là **client**.

Hai đường, và chỉ một đường đi tới đích:

| | Đường A — client đã vá | **Đường B — FE của mình** |
|---|---|---|
| Máy của bạn | ✅ đang chạy, dùng tốt | ✅ |
| Giao cho người khác tải | ❌ phải phát hành lại app của Anysphere đã sửa | ✅ app của mình, phát hành thoải mái |
| Vỡ khi hãng cập nhật | ✅ vỡ — mỗi bản mới phải dò lại bản vá | ✅ không liên quan |
| Đổi giao diện theo ý mình | ❌ phải dò trong bundle đã minify | ✅ |
| Công còn lại | 0 | phần đang dở ở `apps/grokbot-web` |

Đường A là **công cụ để làm việc và để đo**, không phải sản phẩm để giao: nó là bản đổi thương hiệu
của Cursor (Anysphere), nên phát hành lại một bản đã sửa là phân phối phần mềm của họ. Nó cũng vỡ
mỗi lần hãng ra bản mới — đã đo, và đó là lý do `SAND_DISABLE_UPDATES` phải có.

**Đường B đã đi được nửa đường rồi**, và số liệu có sẵn: `apps/grokbot-web` — 3.849 dòng, `ui-diff`
báo **khớp 40/40 trên 19 vùng đã dựng**. Kế hoạch chi tiết ở [fe-clone-plan.md](fe-clone-plan.md),
đã chia việc theo API (nhóm A chỉ cần sửa FE · nhóm B cần route `/v1` mới · nhóm C cần hợp đồng
mới) — mảng lớn nhất còn trống là **Routines**.

Nói thẳng cái con số 40/40 KHÔNG nói: nó đúng cho **19 vùng đã dựng**, không nói gì về vùng chưa
dựng. Muốn biết còn bao xa thì đọc nhóm B và C trong tài liệu đó, đừng đọc con số này.

### Ba mảnh của một sản phẩm phát hành được

Xếp theo thứ tự làm, và mảnh 1 là mảnh quyết định:

| # | mảnh | việc | trạng thái |
|---|---|---|---|
| 1 | **FE riêng** | làm nốt nhóm A, rồi B (Routines trước) | **đang dở** — [fe-clone-plan.md](fe-clone-plan.md) |
> **macOS chưa có, và khoảng cách đo được là ba việc.** Client gốc **có** bản Mac — bundle
> `main.cjs` có 49 dấu vết `darwin`, 13 nhánh `process.platform === "darwin"`, cả nhánh sandbox
> và zsh riêng. Thiếu là phía mình: `patch-client.mjs:35` chỉ tìm `%LOCALAPPDATA%\Programs\Grok Bot`
> (Mac là `/Applications/…app/Contents/Resources`), `patch-client.mjs:206` chặn nhánh áp dụng ở
> `win32`, và `install.cmd` + `start-bot.cmd` là shell Windows (Mac cần `.command`). Backend thì
> **đã chạy được** — Node thuần, không có lệnh Windows nào trong đường chạy chính.

| 2 | Trang tải + bộ cài | một trang, một file cài đặt gói sẵn backend | **bản đầu đã chạy** — `/` + `/download/windows` (`src/site.ts`), gói dựng bằng `scripts/build-setup.mjs`. Còn thiếu: gói **chưa mang backend** theo, người tải vẫn phải tự dựng |
| 3 | Cấp box khi đăng nhập | đăng nhập xong mới cấp VPS + phát token | chưa — chặng C |

Khi mảnh 1 xong thì mảnh 2 **đơn giản hẳn**: không còn phải dời `app.asar`, không còn bốn biến môi
trường, không còn cái bẫy `CURSOR_API_BASE_URL` đè lên Cursor IDE. Bộ cài chỉ còn là **app của mình
+ backend**, đúng hình dạng mà hãng phát hành.

## ② bis · Bốn biến môi trường

Đây là phần khác biệt lớn nhất so với hãng: **mình không phát hành app, mình vá app của họ.**

```mermaid
flowchart LR
  I["Cài Grok Bot.exe<br/>từ nhà phát hành"] --> P["patch-client.mjs<br/>dời app.asar sang<br/>app.asar.disabled-by-grokbot2"]
  P --> S["Dùng shortcut<br/>start-app.cmd"]
  S --> E["run.ps1 đặt 4 biến"]
  E --> R["App nói chuyện với<br/>backend của mình"]
  X["Bấm thẳng Grok Bot.exe"] -.->|"KHÔNG có biến nào"| V["Nói chuyện với server hãng<br/>+ TỰ CẬP NHẬT, xoá sạch bản vá"]
  style V fill:#3d1417,stroke:#6e2329
```

Bốn biến, thiếu cái nào cũng hỏng theo kiểu riêng:

| biến | thiếu thì |
|---|---|
| `CURSOR_API_BASE_URL` / `SAND_BACKEND_URL` | app nói chuyện với **server hãng** |
| `CURSOR_WEBSITE_URL` | đăng nhập bị đẩy sang `https://localhost:4443` |
| `SAND_DISABLE_UPDATES` | app **tự cập nhật và xoá sạch bản vá** |

Và một cái bẫy đã ghi sẵn trong launcher: **đừng `setx` bốn biến này ở mức người dùng.**
`CURSOR_API_BASE_URL` cũng được **Cursor IDE thật** đọc — máy có cài Cursor sẽ bị trỏ vào backend
này và hỏng. Vì thế: shortcut, không phải biến toàn cục.

**Còn thiếu để giao cho người khác:** hiện quy trình này là thủ công trên máy của bạn. Muốn giao
cho người thứ hai cần một bộ cài đặt tự làm ba việc: dời `app.asar`, tạo shortcut có sẵn biến, và
ghi token cổng của người đó.

## ③ Tiền — đã chạy được đến đâu

Khác với chú thích cũ trong `billing.ts` (nói "INERT until wired"), **đường tiền đã nối**. Đo:

```
index.ts        access: accessVerdict(rpcUser) · usage: currentPeriodUsage(rpcUser)
turn.ts:788     billingMode() === "enforce" && accessVerdict(...) === "payment_required" → chặn lượt
bootstrap.ts    GetSandAccessStatus: ctx.access === "payment_required" ? (3,7) : (1,1)
```

Ba chế độ, `GROKBOT2_BILLING`:

| chế độ | hành vi |
|---|---|
| `off` (mặc định) | không đếm, không chặn |
| `warn` | **đếm thật**, ghi log phán quyết, vẫn cho chạy |
| `enforce` | hết hạn mức → `GetSandAccessStatus` trả `payment_required`, app hiện màn hình chặn |

Đơn vị đo là **token**, không phải tiền: bảng `usage(auth_id, day, tokens_in, tokens_out, turns)`
và `plans(name, monthly_token_cap, checkout_url)`. Thanh usage trong app đọc
`GetCurrentPeriodUsage`, và nó ghi rõ trong `display_message` rằng đây là **token ước lượng**, không
phải số tiền — cố ý, vì grokbot2 không có bảng giá theo token.

**Còn thiếu:** nút bấm khi bị chặn. Bản gốc dùng `ErrorButton` do máy chủ điều khiển để mở trang
thanh toán; `checkout_url` đã có chỗ trong bảng `plans` nhưng chưa được gắn vào phán quyết.

## ④ Dữ liệu người dùng nằm đâu

**Mặt dữ liệu đã tách** — mười bảng mang `owner_id`, đo trên kho thật:

```
agents · entries(2036) · parked · automations · attachments_meta
acceptance(1371) · todos · handoffs · compaction          ← đều có owner_id
users · usage                                             ← khoá theo auth_id
plans                                                     ← toàn cục, đúng thiết kế
host_settings                                             ← ❌ MỘT dòng dùng chung
```

**Mặt máy chưa tách gì** — `memory.ts`, `skills.ts`, `displays.ts`, `desktop.ts`, `teach.ts` không
nhắc tới owner một lần nào. Chi tiết và cách sửa: [per-user-on-one-box.md](per-user-on-one-box.md).

## Kế hoạch A→Z

Bốn chặng. Mỗi chặng **tự nó dùng được** — không có chặng nào chỉ để chuẩn bị cho chặng sau.

```mermaid
flowchart LR
  A["A · Một người<br/>ĐANG Ở ĐÂY"] --> B["B · Giao được cho người khác<br/>bộ cài + token riêng"]
  B --> C["C · Nhiều người an toàn<br/>cách ly máy"]
  C --> D["D · Thu tiền<br/>enforce + trang thanh toán"]
  style A fill:#0d2818,stroke:#2a6
```

### Chặng A — một người dùng (đang ở đây)
Chạy được rồi. Việc còn lại chỉ là dọn: `host_settings` thêm `owner_id`, và sửa chú thích cũ trong
`billing.ts` (nó nói tính năng chưa nối, trong khi đã nối).

### Chặng B — giao được cho người khác
Mục tiêu: một người **không phải bạn** cài được và dùng được, vẫn trên máy của họ.

| # | việc | xong khi |
|---|---|---|
| B1 | Bộ cài: dời `app.asar`, tạo shortcut kèm 4 biến, sinh token cổng | máy sạch → cài → mở app → chat được, **không đụng vào Cursor IDE** nếu máy có |
| B2 | Token cổng gắn theo **người**, không theo máy | hai token khác nhau → hai `owner` khác nhau ở `checkAuth` |
| B3 | Trang "máy chủ của tôi ở đâu" trong web | người dùng tự đổi được URL backend, không phải sửa `.env` |
| B4 | Hướng dẫn một trang | người chưa từng đọc repo làm theo được, không hỏi lại |

Chặng này **chưa cần đụng box** — mỗi người tự chạy backend trên máy mình, box riêng của họ.

### Chặng C — nhiều người trên MỘT backend
Đây là chỗ box thành vấn đề. Chi tiết ở [per-user-on-one-box.md](per-user-on-one-box.md); tóm tắt:

| # | việc | xong khi |
|---|---|---|
| C1 | Bước root trên VPS (sudoers + nhóm) | daemon chạy được `sudo -n -u gb2u001 id` |
| C2 | `os-users.ts` + `box-exec` chạy dưới `runuser` | cờ tắt: e2e 29 phép kiểm vẫn xanh |
| C3 | `memory` · `skills` · `displays` · `desktop` theo home của user | bot A đọc file của B **bị từ chối** |
| C4 | Thu hồi ba tầng (10 phút · 30 phút · 7 ngày) | `/admin` hiện thu được bao nhiêu, và số rò = 0 |
| C5 | `host_settings` theo owner | hai người đặt múi giờ khác nhau |

**Đừng mở cho người thứ hai trước khi C3 xong** — cookie Shopee và trí nhớ bot rò ngay lập tức.

### Chặng D — thu tiền
| # | việc | xong khi |
|---|---|---|
| D1 | Chạy `GROKBOT2_BILLING=warn` một tuần | số token trong `usage` khớp số thực tế gọi pool |
| D2 | Gắn `checkout_url` vào phán quyết `payment_required` | app hiện nút, bấm ra trang thanh toán |
| D3 | `ErrorButton` do backend điều khiển (chép hợp đồng hãng) | người dùng hết hạn mức thấy nút, không thấy lỗi trống |
| D4 | Bật `enforce` | vượt cap → chặn lượt, có đường trả tiền để mở lại |

Nếu đi đường cinAPI thì D1–D3 **không cần làm lại** — ví và trang thanh toán đã có bên đó, xem
[cinapi-merge.md](cinapi-merge.md).

## Ba quyết định nên chốt trước khi code chặng B

1. **Mỗi người một backend, hay chung một backend?** Chặng B giả định mỗi người chạy backend trên
   máy mình (dễ, không cần C). Chung một backend thì C thành bắt buộc và phải làm trước.
2. **Token cổng cấp thế nào?** Sinh lúc cài, hay phát từ web sau khi đăng nhập? Cái sau gắn được
   với `users` và mở đường cho billing; cái trước đơn giản hơn.
3. **Ai trả tiền pool?** Hiện một `pool-key.txt` cho cả máy. Nhiều người dùng chung một khoá thì
   `usage` đếm đúng theo người nhưng **hoá đơn vẫn về một chỗ** — chấp nhận được nếu bạn là người
   bán, không chấp nhận được nếu mỗi người mang khoá riêng.

Câu 3 là câu quyết định mô hình kinh doanh, không phải câu kỹ thuật, nên nó nằm cuối cùng ở đây và
đáng trả lời trước tiên.
