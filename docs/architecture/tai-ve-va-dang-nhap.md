# Tải về & Đăng nhập — hãng chia thế nào, mình chia thế nào

> Đo 03/09/2026 từ bundle 0.30 đã bung, `docs/protocol-reference.md`, và VPS đang chạy.
> Sơ đồ nhìn được: artifact *"Bản đồ Tải & Đăng nhập"*. Đây là bản chữ, giữ số đo và lý do.

Mục đích: **đi một đường tải, tận dụng FE của client, dựng đúng hình dạng của hãng** — để mai sau dev
lại giao diện thì chỉ thay mỗi tầng FE, bốn tầng còn lại đứng nguyên.

---

## 0 · Kết luận trước

1. **Hãng chỉ ship FE.** Tải app gốc về là tải đúng một Electron client (asar **34 MB**) + runtime.
   API, BE, BOX đều ở cloud của họ và được **cấp sau khi đăng nhập** — `EnsureSandBox` trả về
   `gateway_url` · `vnc_url` · `exec_daemon_url` · token.
2. **Mình cùng hình dạng, đổi chủ.** FE = cùng client đó đã vá · API/BE = grokbot2 trên VPS · BOX = cùng
   VPS. Không có khoảng trống kiến trúc nào giữa hai đường tải — chúng chỉ khác ở việc *có chở client
   theo hay không*.
3. **Gói 118 MB là FE-only.** Không một tham chiếu tới `grokbot-backend`. Nó "cố định" FE, không cố
   định BE. Backend luôn phải sống ở VPS (hoặc `localhost:8788` khi dev).

---

## 1 · Pha TẢI VỀ — trong gói có gì

| | HÃNG (đo từ bundle 0.30) | MÌNH — gói 118 MB | MÌNH — gói 50 KB |
|---|---|---|---|
| dạng | 1 file NSIS, ký `Anysphere, Inc.`, cài im lặng `--updated /S` | 1 file Inno `.exe` (chưa ký) | 1 file `.cmd`, tự bung base64 |
| cài vào | `%LOCALAPPDATA%\Programs\Grok Bot\` | cùng chỗ (cạnh app hãng được, vì `SAND_USER_DATA_DIR` riêng) | vá client **đã có** ở đúng chỗ đó |
| bên trong | Electron runtime + `app.asar` 34 MB | **cùng cây app đã vá 8 chỗ** + `start-bot.cmd` + `backend.txt` + icon | `patch-client.mjs` 29 KB (8 bản vá) + `start-bot.cmd` 5.5 KB |
| máy chủ bên trong | **không** — 7 `createServer` là thư viện ws / dev-control / loopback | không | không |
| cần trước | không gì | không gì | client hãng đã cài **và** Node ≥ 20 |
| host ghim sẵn | `api2.cursor.sh` ×3 · `api3.cursor.sh` ×1 · feed `api2.cursor.sh/updates` | `%BE%` từ `backend.txt` (mặc định `https://cinai.app/agent/`) | như bên |
| cập nhật | updater gốc: tải → **dò chữ ký**, người ký ∈ `["Anysphere, Inc.","Anysphere"]` → chạy NSIS | launcher **chưa** tự cập nhật *(việc còn lại)* | launcher hỏi `/updates/ban-moi`, kiểm sha256, chạy bộ cài, fail-open |

Cây `app.asar` 34 MB của hãng, đo từng phần:

```
renderer               21 MB   giao diện (SolidJS), i18n hash catalog
electron-main           7 MB   IPC 152 method (tự trả lời), updater, cửa sổ, bảng cờ 702 + 248 cấu hình
local-exec-daemon       4 MB   daemon chạy TRÊN MÁY NGƯỜI DÙNG, nối RA backend — 7 hành động
deps                    3 MB
node-agent-coordinator  1 MB
electron-preload        1 MB   vnc · webview · main
native                  1 MB   sand-webauthn-signer.exe
```

Bốn biến môi trường là **toàn bộ hợp đồng** giữa launcher của mình và client hãng — thiếu cái nào hỏng
kiểu riêng: `CURSOR_API_BASE_URL` / `SAND_BACKEND_URL` (thiếu → nói với hãng) · `CURSOR_WEBSITE_URL`
(thiếu → đăng nhập bị đẩy sang `https://localhost:4443`) · `SAND_DISABLE_UPDATES` (thiếu → app tự cài đè
bản hãng, xoá sạch bộ vá).

---

## 2 · Pha ĐĂNG NHẬP — client nhận gì, theo thứ tự

Client nói trên **ba mặt phẳng**, và đăng nhập đi qua cả ba theo đúng thứ tự này:

```
① AUTH        trình duyệt mở {CURSOR_WEBSITE_URL}/loginDeepControl?challenge&uuid
              → người dùng đăng nhập ở web
              → app poll {backend}/auth/poll?uuid&verifier  → token
              (làm mới: POST /oauth/token, client KHÔNG kiểm chữ ký JWT)

② BOOTSTRAP   ~15 RPC ConnectRPC trước khi vẽ cửa sổ:
   (vendor RPC)   GetMe → GetSandAccessStatus (1 GRANTED) → GetSandUsageStatus
                  → GetSandTrialClaimStatus → GetUserPrivacyMode
                  → EnsureSandBox  ⇐ ĐÂY LÀ LÚC BOX ĐƯỢC CẤP
                      trả: cluster · tenant_id · pod_id · gateway_url · gateway_token
                           · vnc_url · exec_daemon_url · exec_daemon_auth_token · terminals_folder
                  → WatchSandBoxMigration (stream, khung rỗng = không di trú)

③ GATEWAY     nối tới gateway_url:
   (box)          GET  /gw/health              (poll)
                  GET  /gw/events              SSE — phải mở suốt; "ready" ở đây mở cửa sổ
                  POST /gw/api/<147 method>    getHostSettings · listAgents · countAgents · getTrays
                                               · skillsCatalog · getForeverBoxStatus (⇐ mở khung VNC)
                                               · getTeachRecordingStatus · …

④ MÁY NGƯỜI DÙNG   local-exec-daemon đọc {backendUrl, credential} đã lưu
                   → "connection exchange" với backend → nhận kết nối box
                   (resolveRecreatedBoxConnection) → từ đây bot chạy lệnh TRÊN MÁY NÀY được
```

Mặt phẳng thứ tư — **App IPC, 152 method** — `Grok Bot.exe` tự trả lời trong tiến trình, không bao giờ
ra khỏi máy. Đây là phần lớn client mà một FE tự viết **sẽ không cần**.

### Bên mình, từng bước ấy ai trả lời

| bước | hãng | mình |
|---|---|---|
| ① `/loginDeepControl` | web của hãng | BFF `:8788` `login-page.ts` → chuyển vào `/app/` (`apps/grokbot-web`, build lúc deploy) |
| ① `/auth/poll`, `/oauth/token` | api2 | BFF — `auth.ts`, JWT tự ký, 365 ngày desktop / 30 ngày web |
| ② bootstrap gates | api2 (ConnectRPC) | `packages/grokbot-proto/bootstrap.ts` — cùng proto, byte-tương-thích |
| ② `EnsureSandBox` | cloud cấp pod | trả `gateway_url` = BFF · `vnc_url` = `admin.halcion.vn/flowvnc-grokbox` · `exec_daemon_url` = `/grok-exec` |
| ③ gateway 147 method | box của hãng | `gateway.ts` — 149 handler, 148/147 client gọi được, 0 đường 404 |
| ③ SSE `/gw/events` | box | `sse.ts` (và `/v1` native — hai bề mặt SSE tách biệt) |
| ④ daemon máy người dùng | cùng daemon | **cùng daemon của hãng**, nối về BFF qua 4 biến; hàng đợi nằm trong tiến trình server |
| bộ não | model của hãng | pool `admin.halcion.vn`, `claude-opus-5` |

---

## 3 · Cái gì nằm ở đâu — sau khi đăng nhập xong

```
MÁY NGƯỜI DÙNG                 VPS 103.75.186.63 (cs-linux-20251216104610892)         POOL
┌──────────────────────┐       ┌─────────────────────────────────────────────┐        ┌─────────────┐
│ Grok Bot.exe (đã vá) │──①②③─▶│ BFF :8788   auth · bootstrap · /gw · site   │──────▶│ halcion.vn  │
│  renderer / main     │       │ computer :8790 · runtime :8789 · ops :8791  │        │ claude-opus │
│  local-exec-daemon ──┼──④───▶│ /grok-exec → exec-router :1337               │        └─────────────┘
│  SQLite hội thoại    │       │   └─ daemon con mỗi người :13400+n  (gb2u001…010)
│  token, 4 env        │  VNC  │ Xvfb :77 → x11vnc 5977 → websockify 7077 → nginx /flowvnc-grokbox/
└──────────────────────┘◀──────│ Chrome của bot (CDP 9224, WebGL SwiftShader)
                               │ shared/data: grokbot.sqlite · dist/ · phat-hanh.json
                               └─────────────────────────────────────────────┘
```

Ba nơi, và người dùng giữ nơi quan trọng nhất: **hội thoại nằm trên máy họ** (SQLite), box và cookie
đăng nhập nằm trên VPS, mô hình chỉ nhận câu hỏi.

---

## 4 · "Một đường" — kế hoạch

**Hiện có HAI trang tải**, đo 03/09:

| trang | ai phát | gói Windows đang phát | tình trạng |
|---|---|---|---|
| `cinai.app/agent/` | BFF `:8788` — `site.ts`, nằm trong đường phát hành (`phat-hanh.mjs` → manifest → feed → launcher) | `Cai-dat-Bot-Noi-Bo-win-20260903.cmd` | **chính thức** |
| `cinai.app/tai/` | ~~`/opt/botnoibo/serve-static.mjs` :8099, unit `botnoibo-site`, dựng tay 26/08, **không có trong repo**~~ | ~~`Cai-dat-Bot-Noi-Bo-20260826.exe`; `?k=<token>` → `Bot-Noi-Bo-Setup-20260826.exe` (**client 0.20**)~~ | **→ 301 `/agent/` từ 03/09**, giữ nguyên đường con và `?k=`; unit disabled, `:8099` không còn nghe. Lùi: `cinai-app.bak-*` + enable unit |

Sau gộp, `/agent/` là **một địa chỉ cho cả hai gói**: nút công khai → 50 KB; `?k=1bab0936…` →
`Bot-Noi-Bo-Setup-20260903.exe` (105 MB, client 0.29 đã vá 8 chỗ, sha `66702e2c…`, Defender sạch).

Máy thứ tư cài từ `/tai/?k=…` nên ra 0.20.0 — không phải lỗi của bản mới, mà là **cài từ trang cũ**.
Token `1bab0936…` của `/tai/` là tên thư mục trên đĩa; `/agent/` nay có cửa `?k=` tương đương, đọc
`GROKBOT2_FULL_DOWNLOAD_TOKEN` — đặt cùng giá trị thì mọi link cũ vẫn chạy sau khi gộp.

Quyết định của chủ dự án (03/09): **một nút tải, phát gói chở-cả-app**, vì mục tiêu là dev lại FE và
trong lúc đó tận dụng FE của client. Gộp `/tai/` về `/agent/` là bước 0 của kế hoạch này. Ba việc,
theo thứ tự:

| # | việc | thay đổi | trạng thái |
|---|---|---|---|
| ~~1~~ | ~~Launcher gói 118 MB **tự cập nhật**~~ **XONG 03/09** | bộ cài nướng `token.txt`; launcher hỏi `/updates/ban-moi?k=` → khoá `full` của manifest; nhịp 1 lần/ngày; **hai pha** (bộ cài ghi đè chính `start-bot.cmd`); đo qua Internet + cài thử: `token.txt` đúng, launcher đủ dấu | xong |
| 2 | Nút công khai phát gói 118 MB | bỏ cờ `chiRieng` ở `Bot-Noi-Bo-Setup` trong `site.ts`; `phat-hanh.mjs` dựng `--with-app` và `scp` gói ấy; manifest trỏ `Bot-Noi-Bo-Setup-*.exe` | chưa — **chờ gật**, xem ranh giới dưới |
| 3 | Gói 50 KB | giữ làm đường phụ cho máy đã có client, hoặc bỏ | tuỳ |

**Ranh giới cần nói thẳng:** `docs/legal.md` viết *"Do not redistribute a modified client"*. Gói 118 MB
*là* client đã vá của Anysphere. Phát công khai là quyết định của chủ dự án, không phải của mã — nên nếu
làm bước 2, `legal.md` phải được sửa cùng lúc để nói đúng phạm vi mới, thay vì để hai tài liệu cãi nhau.
Ngày FE tự viết thay được client thì vấn đề này **tự tan**: gói tải chỉ còn mã của mình.

Chữ ký số vẫn đáng mua vì hai lý do độc lập với ranh giới trên: Defender xoá `.exe` chưa ký
(`Trojan:Win32/Wacatac.B!ml`, đo 03/09), và không có nó thì updater gốc không bao giờ cài được bản
của mình (danh sách trắng người ký).

---

## 5 · Dev lại FE — cái gì phải viết, cái gì biến mất

Từ bảng ba mặt phẳng: một FE tự viết chỉ cần nói **mặt phẳng ③** (gateway JSON + SSE) và một góc nhỏ
của **②** (auth). Cụ thể:

| phải có | số | ghi chú |
|---|---|---|
| gateway client | 147 method, ~90 thật sự được gọi | `docs/extracted/gateway-commands.json`; coverage đo bằng `gateway-coverage.mjs` |
| SSE `/gw/events` | 1 kênh | hình dạng payload: `docs/…/grokbot-sse-payload-shapes` — khoá bao **không** đồng nhất |
| transcript renderer | 6 kind | `message · tool-call · send-message · user-attachment · notice · event` |
| widget hỏi–đáp | 1 | `type:widget` với `prompt` + `options[{label,value,style}]` |
| auth | 3 đường | `/loginDeepControl` · `/auth/poll` · `/oauth/token` |
| VNC khung màn hình | 1 iframe noVNC | URL từ `getForeverBoxStatus` |

| biến mất | số | vì sao |
|---|---|---|
| App IPC | 152 method | chỉ tồn tại vì client là Electron của hãng |
| bootstrap ConnectRPC | ~15 RPC | FE của mình hỏi BE của mình bằng JSON là xong |
| updater gốc + danh sách trắng | — | launcher tự cập nhật đã thay |
| bảng cờ 702 + cấu hình 248 | — | của hãng, cho tính năng của hãng |
| bộ vá 8 chỗ + `patch-client.mjs` | — | không còn gì để vá |

Đó là lý do "đi đường gộp bây giờ" không tốn công về sau: bốn tầng dưới FE đã đúng hình, chỉ tầng FE
là thứ được thay.
