# Spike findings

How the self-host was validated, milestone by milestone.

## 1. The redirect seam works
Setting `CURSOR_API_BASE_URL=http://localhost:PORT` routes every backend call to localhost.
No TLS pinning, no cert check, no response signing. `x-cursor-checksum` is outbound-only.

**Gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set in the environment, the Electron exe runs as
plain Node (no GUI) and exits immediately. Unset it before launching.

## 2. Auth is stubbable
First call is `POST /oauth/token` with a stored refresh token. Returning a self-minted JWT is
accepted — the client decodes the payload (exp/email/sub) but does **not** verify the signature.

## 3. Bootstrap gates → UI enters
~15 ConnectRPC calls gate rendering. Returning valid protobuf (esp. `GetSandAccessStatus=GRANTED`,
`GetMe`, `EnsureSandBox`) moves the app past auth/paywall. The React renderer loads (a 1440×759
BrowserWindow is created) but stays **hidden** pending a healthy box.

## 4. Box gateway → window shows
The app connects to `gateway_url` and polls `/gw/api/*` + `/gw/health` + `/gw/events` (SSE).
Returning healthy JSON shapes (`getHostStatus.isBusy=false`, `listAgents:[]`, SSE kept open)
makes the app show its **main workspace UI** — verified with a screenshot: sidebar, composer
("Ask anything…"), account chip, all rendered against localhost.

## 5. Chat → Claude pool
Typing calls `sendPrompt` (not `StreamChat` directly — the agent loop lives in the box). The
gateway plays the box's agent-host role: append the user turn, call the Claude pool, append the
assistant turn; the frontend reads it back via `getAgentTranscriptTail`. Validated end-to-end at
the HTTP layer (`createAgent → sendPrompt → transcript`).

## What's NOT done
- The **VNC/exec box** — a real Linux desktop for the workspace pane. Chat doesn't need it.
- Rich transcript features (tool calls, streaming deltas, widgets) — only plain text so far.

## Reuse from OpenClaw (admin.halcion.vn)
- **Brain:** the Claude pool endpoint — subscription CLI, LB+failover, no API-token cost.
- **Box (future):** the VPS already runs `Xvfb + x11vnc + websockify + noVNC` per-account
  (`flow-chrome@`, `flow-vnc.sh`) — the same stack the Grok Bot box needs. See [roadmap.md](../../ROADMAP.md).

---

## Bản gốc đã đi tới 0.24.0 — bộ vá của mình chỉ chạy trên 0.20.0 (đo 26/08/2026)

Tải bản gốc từ chính trang `x.ai/bot` và bung ra so, **không chạy nó** (chạy sẽ thay bản 0.20.0 đã vá
trên máy):

```
https://downloads.cursor.com/grokbot/stable/win32-x64/0.24.0/Grok_Bot_0.24.0_Setup.exe
```

| | 0.24.0 (vừa tải) | 0.20.0 (máy đang chạy) |
|---|---|---|
| Bộ cài | **118,3 MB**, NSIS (electron-builder) | 120,0 MB |
| Payload | `$PLUGINSDIR/app-64.7z` → **656 file · 447 MB** | 1.385 file · 540 MB (đã bung + đã vá) |
| `resources/` | `app.asar` **49 MB** + `app.asar.unpacked` | `app/` (đã vá) + `app.asar.disabled-by-grokbot2` |

**Cấu trúc khớp hoàn toàn** — cùng bố cục Electron, cùng `resources/`, `locales/`, cùng bộ `.dll`.
Cây mình đóng gói giống cây họ phát.

### Cái KHÔNG khớp: cả ba bản vá đều trượt

Kiểm từng bản vá bằng chuỗi `find` của chính nó, trên bundle 0.24.0 vừa bung:

| bản vá | kết quả trên 0.24.0 |
|---|---|
| `win-drive-path` | ✗ **0 chỗ khớp** (cần 1) |
| `attach-upload-observable` | ✗ **0 chỗ khớp** (cần 1) |
| `get-ultra-redirect` | ✗ **file đích không còn**: `dist/renderer/assets/index-DNC736IO.js` |

Vì sao — đo được, không đoán:

- **Tên rút gọn đã đổi nghĩa.** Trong 0.20.0, `cOt` là hàm xử lý đường dẫn ảnh. Trong 0.24.0, `cOt`
  là `function cOt(r){return typeof r=="number"&&Number.isFinite(r)?r:void 0}` — **một hàm hoàn toàn
  khác**. Hàm xử lý đường dẫn nay mang tên khác (dấu vết dẫn tới `nde`, chưa xác minh).
- **Bundle renderer đổi tên theo hash mỗi lần build** — `index-DNC736IO.js` không tồn tại ở 0.24.0.
  Đây là hành vi bình thường của Vite, không phải họ cố tình.

**Đây chính là cơ chế an toàn đã thiết kế đang làm đúng việc:** `expected: 1` khiến bản vá **trượt và
báo đỏ** thay vì vá nhầm vào chỗ trông giống. Không có nó thì bộ vá sẽ ghi bừa vào bundle 0.24.0.

### Nghĩa là gì cho dự án

1. **Bộ cài 118 MB mình phát đang chở 0.20.0** — bản đã vá, chạy được, nhưng **chậm hơn bản gốc 4
   phiên bản**.
2. **Nâng lên 0.24.0 = dò lại cả 3 bản vá từ đầu**, vì tên rút gọn đã trôi. Đó là chi phí đã biết
   trước của Đường A (vá client của hãng) — xem [ship-to-users.md](../plan/ship-to-users.md), và là
   lý do Đường B (FE riêng) tồn tại.
3. **Đừng chạy bộ cài 0.24.0 trên máy này**: nó sẽ thay bản 0.20.0 đã vá, và bộ vá chưa dò lại được.

### 0.24.0 có gì mới so với 0.20.0 (đo 26/08/2026)

Bung cả hai bundle rồi đếm kiểu message — cách đọc "họ vừa làm gì" mà không cần source.

| mặt | 0.20.0 | 0.24.0 | chênh |
|---|---|---|---|
| `agent.v1` (giao thức agent) | 969 | 975 | **+6** |
| `aiserver.v1` (giao thức với cloud) | 3.579 | 3.692 | **+113** |
| `host-main.cjs` | 11,3 MB | 11,6 MB | +0,3 MB |

**Không có kiểu nào bị bỏ** — họ chỉ thêm. Nghĩa là hợp đồng cũ vẫn còn, phần mình đã map không mục nát.

#### Sáu kiểu mới ở `agent.v1` — đúng một tính năng

`GetPrCodeTour{Args,Error,Result,Success,ToolCall}` + `PrCodeTourRevisionSnapshot` — một **công cụ
mới cho bot**: dẫn người đọc đi qua thay đổi của một pull request. Đây là tính năng duy nhất chạm
tới tầng agent.

#### 113 kiểu mới ở `aiserver.v1` — gom theo chủ đề

| nhóm | số | là gì |
|---|---|---|
| **GrokBot*** | 27 | `GrokBotTemplate`, `CreateGrokBotAgent`, `GetPublicGrokBotTemplate`… — **mẫu bot dùng lại/chia sẻ được**, và transcript commit lên cloud |
| **BackgroundComposer** | 16 | chạy nền + `Admin*KillAll*` để quản trị dừng hàng loạt |
| **Secret / Keyring** | 13 | `KeyringSecret`, `CopyTeamSecretsToKeyring` — **kho khoá dùng chung cho cả đội** |
| **SandBox upgrade** | 9 | `ScheduleSandBoxUpgrade`, `RescheduleSandBoxUpgrade` — **hẹn lịch nâng cấp box**, hoãn được |
| **Canvas** | 7 | `CloudCanvasMetadata`, `GetCanvasPayload` |
| **Admin** | 8 | công cụ quản trị nội bộ |

**Đọc ra hướng đi của họ:** đội nhóm (mẫu bot chia sẻ, khoá dùng chung cho team) và vận hành nhiều
bot ở quy mô lớn (dừng hàng loạt, hẹn lịch nâng box). Không phải tính năng cho một người dùng lẻ.

#### App local có tự cập nhật lên 0.24.0 không

**Không, và cố ý.** Launcher đặt `SAND_DISABLE_UPDATES=1` ở mọi đường (`run.ps1`, `start-bot.cmd` cả
hai bản). Bỏ biến đó thì app **tự cập nhật và xoá sạch `resources/app`** — tức là mất cả ba bản vá,
quay về nói chuyện với server nhà phát hành.

Muốn lên 0.24.0 thì phải làm theo thứ tự: dò lại 3 bản vá trên bundle mới → `--apply` → đo lại →
mới đóng gói. Không có đường tắt, vì tên rút gọn đã trôi (xem mục trên).

### Vì sao SmartScreen chặn bộ cài của mình mà không chặn của hãng

Đo bằng `Get-AuthenticodeSignature` trên đúng hai file:

| | `Grok_Bot_0.24.0_Setup.exe` | `Bot-Noi-Bo-Setup-*.exe` |
|---|---|---|
| Trạng thái | **Valid** | **NotSigned** |
| Người ký | `CN="Anysphere, Inc.", O="Anysphere, Inc.", L=San Francisco, C=US` | — |
| Nhà cấp | `Microsoft ID Verified CS EOC CA 03` | — |
| Dấu thời gian | có · `Microsoft Public RSA Time Stamping Authority` | — |

**Họ giải quyết bằng cách mua chứng chỉ ký mã và ký từng bản phát hành.** Không có mẹo nào khác:
SmartScreen tin **danh tính nhà phát hành đã được xác minh**, chứ không tin nội dung file.

Một chi tiết đáng học: chứng chỉ của họ **hết hạn 23/08/2026**, hôm nay 26/08 mà chữ ký vẫn `Valid` —
nhờ **dấu thời gian**. Timestamp chứng minh "file này được ký khi chứng chỉ còn hạn", nên chữ ký sống
lâu hơn chứng chỉ. Ai đi con đường ký mã đều phải làm bước này, không thì mỗi năm hết hạn là mọi bản
đã phát hành hoá chưa ký.

**Bốn lối đi, xếp theo giá:**

| cách | được gì | giá |
|---|---|---|
| Bấm **More info → Run anyway** | xong ngay | mỗi máy một lần, người lạ sẽ ngại |
| Dùng bản **ZIP** rồi chạy `start-bot.cmd` | không qua cửa SmartScreen của bộ cài | file to hơn (167 MB) |
| Chứng chỉ **OV** | có tên nhà phát hành | ~200–400 $/năm, **vẫn cảnh báo** tới khi đủ lượt tải tạo uy tín |
| Chứng chỉ **EV** | hết cảnh báo gần như ngay | ~400–600 $/năm + khoá cứng (token/HSM) |

Chứng chỉ tự ký **không giúp gì** — Windows không tin gốc do mình tự tạo.

### Có nên bê tính năng mới của 0.24.0 về app local không

Câu trả lời ngắn: **chưa dùng được, vì client đang cài không biết chúng.** Đo trên chính
`host-main.cjs` của bản 0.20.0 đang chạy:

| kiểu mới của 0.24.0 | có trong client 0.20.0 |
|---|---|
| `GrokBotTemplate` · `CreateGrokBotAgent` | **không** |
| `KeyringSecret` | **không** |
| `ScheduleSandBoxUpgrade` | **không** |
| `GetPrCodeTour` | **không** |
| `CloudCanvasMetadata` | **không** |

Backend mình đóng vai **host**, và host chỉ trả lời những gì client hỏi. Client 0.20.0 **không bao giờ
gọi** các RPC đó, nên có cài vào backend cũng không ai gọi tới — code chết ngay ngày viết xong.

**Ba đường, và chỉ đường 3 đáng đi bây giờ:**

1. **Nâng client lên 0.24.0** — phải dò lại cả 3 bản vá trước (tên rút gọn đã trôi). Được tính năng
   mới, nhưng trả bằng cả một vòng dò bundle, và lần sau hãng ra 0.25 thì lặp lại.
2. **Cài RPC mới vào backend, giữ client 0.20.0** — vô ích, không ai gọi.
3. **Lấy Ý TƯỞNG, tự làm theo cách của mình** ← nên chọn. Ba thứ đáng chép:
   - **mẫu bot dùng lại** (`GrokBotTemplate`) — mình đã có `agents` + prompt riêng, thêm "nhân bản từ
     mẫu" là việc của backend, không cần client biết kiểu mới;
   - **kho khoá dùng chung** (`KeyringSecret`) — trùng hướng với `.data/secrets/` đã có, và với chặng
     5 (tách theo người);
   - **hẹn lịch nâng box** (`ScheduleSandBoxUpgrade`) — trùng hướng với "thu hồi khi nghỉ" trong
     [per-user-on-one-box.md](../plan/per-user-on-one-box.md).

Còn `GetPrCodeTour`, `CloudCanvasMetadata`, `BackgroundComposer`, `Admin*` là tính năng của Cursor IDE
và của đội vận hành hãng — **không thuộc bài toán này**.
