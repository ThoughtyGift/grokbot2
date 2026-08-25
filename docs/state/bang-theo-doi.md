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
| **Trang tải** | `/` + `/download/windows` (**bản chở app 118 MB**) + bản cấu hình 2 MB + macOS; phát cho máy LAN khác bằng `serve-site.mjs` |
| **Kiểm thử** | 31 file unit (**303 bài**) · 58 bộ e2e · máy đo tự động **9/9 xanh** *(26/08)* |
| **Chưa mở ra ngoài** | cả 4 cổng nghe `127.0.0.1`. **Lỗ `/oauth/token` đã bịt** (26/08) — xem §3b. Còn vướng: dữ liệu cũ chưa đổi chủ sở hữu |

**Tiến độ theo chặng (26/08):** ✅ 0 dọn · ✅ 1 đo tiền (`warn`) · ✅ 2 vá 3 lỗ đăng nhập ·
🟡 3 máy thứ hai (T1 xong · bộ cài chở app + trang tải LAN xong · T2–T5 chờ máy sạch) ·
🟡 **4 đưa BE ra ngoài** (đăng nhập thật xong 26/08 — xem §3b; còn chuyển quyền dữ liệu cũ + VPS) ·
⬜ 5 tách user trên box · ⬜ 6 FE.

**Đọc một dòng nếu chỉ đọc một dòng:** dọn xong, tiền đo được, đăng nhập đã siết, app đóng gói giống
hãng. Mảnh cuối để máy thứ hai **chat được** (không chỉ tải) là **chặng 4** — đưa backend ra khỏi
`127.0.0.1`.

---

## 2 · Máy đo tự động — **9/9** *(26/08, đo lại sau bản vá plugin)*

| mục | trạng thái |
|---|---|
| code chết (knip) | ok · 72 phát hiện (đúng mốc) — xem ô dưới về lượt đỏ 73 |
| kích thước code | ok · 3 file > 800 dòng · 16 hàm > 50 dòng (đúng mốc) |
| ranh giới tầng | ok · 7 luật đạt |
| ngân sách bundle | ok · 95 KB thô / 31 KB gzip |
| hợp đồng client | ok · khớp bản đã trích |
| spec `/v1` | ok · 29 route · 32 schema |
| docs | ok · 0 link chết · 0 mồ côi |
| nhật ký e2e | ok · 98 lượt — *xem cảnh báo §5* |
| không lặp lại | ok · hai lượt trước không đỏ cùng chỗ |

**Lượt 26/08 đỏ hai mục rồi xanh lại — đây là cái gì:**

`code chết` báo **73/72**, và `không lặp lại` đỏ theo. Truy ra: `+1` là
[`infra/vps/serve-static.mjs`](../../infra/vps/serve-static.mjs) — máy chủ đứng một mình do systemd
chạy trên VPS, **không ai import nên knip coi là rác**. Khai nó là điểm vào trong `knip.json`
(`infra/vps/*.mjs`) → về 72, và `không lặp lại` tự xanh ở lượt sau.

Cùng lượt đó `chat/state.ts` có hai bí danh export trùng (`nextId`→`nextEntryId`,
`persistState`→`persist`). Đã gộp về một tên; 20 chỗ gọi được đổi theo.

**Đã vá luôn một điểm mù của chính máy đo:** phát hiện loại *"file không ai import"* nằm trong từng
issue dưới cờ `files`, nhưng `keys` chỉ khoá `j.files` — khoá mà knip 6 luôn để rỗng. Nên loại này
không bao giờ vào danh sách khoá: **số tăng mà dòng delta vẫn nói "thêm: không"**, phải chạy knip
bằng tay mới truy ra. Đúng cái bẫy mà chú thích ngay trên đó nói là muốn tránh. Nay đã khoá cả hai.

---

## 3 · Việc còn lại — mỗi việc kèm cách kiểm

Thứ tự ở đây là **cái gì chặn cái gì**, không phải theo độ khó. Mỗi việc có một dòng **kiểm** — chạy
được, ra kết quả nhìn thấy. Không có dòng kiểm thì không tính là xong.

Lệnh chạy từ `services/grokbot-backend/` trừ khi ghi khác.

### Chặng 0 · Dọn — ✅ **XONG 25/08, cổng 9/9**

| # | việc | kiểm bằng | kết quả |
|---|---|---|---|
| 0.1 | ✅ Tách 6 hàm dài (backend) | `node scripts/code-size.mjs` | 28 → 22 |
| 0.2 | ✅ Sửa 5 bài `store.test` đỏ im lặng | `npx tsx --test src/store.test.ts` | 9/9 |
| 0.3 | ✅ `httpTransport` 182 → 6 hàm nhỏ | `npx tsx --test src/mcp-http.test.ts` | 28/28 |
| 0.4 | ✅ `oauthPortFor` → `pendingPort` + `tokenPort` | như trên | 28/28 |
| 0.5 | ✅ `mcp.ts` 936 → dưới 800 | `node scripts/code-size.mjs` | rời danh sách |
| 0.6 | ✅ `bootstrap.ts` 862 → dưới 800 | `node scripts/contract-test.mjs` | 46/46 |
| 0.7 | ✅ FE: `mdToHtml`·`renderRuns`·`messageActions`·`bootApp` | `npx tsx --test src/markdown.test.ts` | 10/10 |
| 0.8 | ✅ Xoá 3 export chết mới sinh | `npx knip` | về mốc 72 |
| 0.9 | ✅ **Sửa bẫy tự quy chiếu của cổng** | `node scripts/self-xray.mjs` | **9/9** |
| 0.10 | ✅ **Chạy E2E thật, không chỉ unit** | `e2e-native` · `e2e-mcp` · 3× `verify-*` | 60/60 · MCP xanh · 3/3 |
| 0.11 | ✅ Sửa bài kiểm ôm hợp đồng cũ (X8) | `node scripts/e2e-native.mjs` | 58/1 → **60/0** |

**Kết quả chốt chặng:** 3 file > 800 · 16 hàm > 50 — **đúng mốc**. BE 272/272 · FE 16/17 · hợp
đồng 46/46 · `/v1` đầu-cuối **60/60** · MCP xanh · ba cổng tiến trình xanh · self-xray **9/9**.

> **Một bài FE đỏ, và nó KHÔNG phải do chặng này:** `avatar.test.ts` — "SVG có thân, có hai mắt".
> Đã kiểm trên cây trước khi sửa: đỏ y hệt. Xếp vào nợ lẻ N8, đừng tính vào chặng 0.

### Chặng 1 · Đo được tiền — ✅ **BẬT XONG 25/08, đã có số thật**

| # | việc | kiểm bằng | kết quả |
|---|---|---|---|
| 1.1 | ✅ Seed bảng `plans` | `SELECT * FROM plans` | `free cap=100.000` · `pro` không giới hạn |
| 1.2 | ✅ Bật `GROKBOT2_BILLING=warn` | `curl /v1/me` | `plan:"free"` · `overQuota:false` |
| 1.3 | ✅ Gửi một lượt thật rồi đọc số | `SELECT * FROM usage` | **`tokens_in=46, tokens_out=2, turns=1`** (trước: 0 dòng) |
| 1.4 | ⬜ Chỉ khi có đủ số một tuần: cân nhắc `enforce` | `GROKBOT2_BILLING=enforce` | *chưa làm — cố ý* |

**E2E chốt chặng:** `e2e-native` **60/60** · unit **272/272** · hợp đồng **4/4 nhóm** · self-xray **9/9**.

**Vì sao bảng `plans` rỗng suốt từ đầu** — `seedPlans()` chỉ được gọi từ `ensureUser()` và
`getPlan()`, mà **không nơi nào ngoài `billing.ts` gọi hai hàm đó**. Không ai gọi → không seed →
`getPlan("free")` trả `null` → hạn mức không tồn tại → bật `warn` cũng chẳng có gì để so. Giờ gọi
thẳng lúc khởi động, và **chỉ khi** `billingMode() !== "off"`: một cài đặt không dùng billing thì
không nên tự mọc thêm bảng.

> **Bẫy mất 3 phút để tìm:** sửa `.env` xong **không tự nạp lại** — trình theo dõi của `dev` chỉ nhìn
> `src/`. Đo ra mới thấy: BFF khởi động **10:54:44**, `.env` sửa **10:55:05**. Muốn nạp thì `touch`
> một file trong `src/`, hoặc khởi động lại `pnpm backend`.

### Chặng 2 · Vá ba lỗ đăng nhập — ✅ **XONG 25/08, kiểm trên máy thật**

| # | việc | kiểm bằng | kết quả đo được |
|---|---|---|---|
| 2.1 | ✅ Thu hồi được token | logout rồi gọi lại `/v1/me` bằng token cũ | 200 → logout **204** → **401** |
| 2.2 | ✅ Chặn đoán mật khẩu | gọi `/v1/login` sai 6 lần | 401·401·401·401·401 → **429** + `Retry-After` |
| 2.3 | ✅ Khoá `/v1/register` | gọi khi chưa bật cờ | **403** `registration is closed` |
| 2.4 | ✅ Rút hạn JWT | giải mã token vừa phát | **30 ngày** (trước: 365) · có `tv` |

**E2E chốt chặng:** unit **278/278** · hợp đồng **4/4 nhóm** (nhóm `auth` 6/6) · `verify-native`
**8/8** · `e2e-native` **60/60** · self-xray **9/9**.

**Cách thu hồi — số đời token.** JWT không trạng thái nên không rút lại từng cái được. Mỗi người có
một số đời trong `users.token_version`; token web mang `tv`; đăng xuất thì tăng số, mọi token đời cũ
chết ngay. Không danh sách đen, không phải dọn rác.

> **Hai đường giấy tờ, và chỉ một đường bị siết.** App desktop vào bằng **token cổng** qua handshake
> không mật khẩu, và **không biết tự làm mới**. Nên token desktop giữ hạn dài 365 ngày và **không
> mang `tv`** — token thiếu `tv` vẫn hợp lệ, đúng lối tương thích ngược đã dùng cho `purpose`. Siết
> cả hai đường thì app chết sau 30 ngày mà người dùng không có nút nào bấm.

> **Đăng ký tự mở cho người đầu tiên.** Sổ trống → mở (không thì backend vừa dựng lên không ai vào
> được). Có người rồi → đóng, trừ khi bật `GROKBOT2_ALLOW_REGISTER=1`.

**Còn lại một dấu vết:** tài khoản thử `chang2-probe@test.local` (đã đăng xuất, token đã chết) vẫn
nằm trong bảng `users` — chưa xoá vì **chỉ máy chủ được ghi sổ**, và dựng một người ghi thứ hai để
xoá một dòng là đúng cái đã gây mất dữ liệu hai lần. Xoá khi có đường quản trị.

### Chặng 3 · Test trên máy thứ hai

> **Trước khi chạm vào máy 2, đọc [test-may-thu-hai.md](../plan/test-may-thu-hai.md).** Luồng cài có
> **bốn màn hình trông như lỗi nhưng bình thường** (Chrome giữ file · SmartScreen · "Setting up…" ·
> "Can't reach your computer"). Không biết trước thì mỗi cái làm người test dừng lại tưởng hỏng —
> đúng chuyện đã xảy ra 26/08. — **T1 xong, T2–T5 chờ phần cứng**

Chi tiết mang gì / không mang gì: [system-xray.md §6c](system-xray.md).

| # | việc | kiểm bằng | kết quả |
|---|---|---|---|
| 3.1 | ✅ **T1** BE tự dựng từ 0 | chạy `index.ts` với `GROKBOT2_STATE_FILE` trỏ thư mục trắng, cổng 8797 | sổ **tự sinh** · `/v1/agents` trả `[]` · `/v1/health` ok |
| 3.1b | ✅ Đăng ký **tự mở cho người đầu tiên** (nhánh không unit-test được) | trên sổ trắng | người đầu **200** · người thứ hai **403** |
| 3.2 | 🟡 **T2** một lượt chat trên máy khác | máy 2 đã có app chạy được (T4) | chỉ còn: backend phải **mở ra mạng** (chặng 4 đã có code) + sửa `backend.txt` trên máy 2 |
| 3.3 | ⬜ **T3** box qua hầm từ máy khác | — | *chờ máy thứ hai* |
| 3.4 | ✅ **T4** bộ cài `.exe` chở app | cài trên **máy sạch thật** (26/08) | tải 118 MB → bấm đúp → SmartScreen *More info → Run anyway* → **app mở tới onboarding**, shortcut mang logo app |
| 3.5 | ⬜ **T5** hai máy một box | — | *bắt buộc hai máy thật* |

**Bộ cài chở cả app đã có (25/08)** — `build-setup.mjs --with-app` ra một file **118 MB**, gần đúng
bằng bộ cài của hãng (120 MB). Máy nhận **không cần client cài trước, không cần Node**: cắm vào là
chạy. Trước đó T2–T5 vướng ở chỗ máy thứ hai phải tự cài client rồi cài Node; giờ chỉ còn cần **máy**.

**T1 chạy được ngay tại đây** bằng thư mục dữ liệu trắng + cổng riêng. Nó **không** thay thế máy thứ
hai (không chứng minh được "máy chưa từng có repo này"), nhưng nó là chỗ dễ lòi đường dẫn ghim cứng
nhất — và nó đã lòi ra ba chỗ.

#### T1 tìm ra: "sổ trắng" hoá ra không trắng

Bản chạy sạch đầu tiên khởi động lên với **4 bot thật và 64 tệp đính kèm của máy này**. Ba hằng đường
dẫn ghim `.data` mặc định thay vì thư mục đang dùng:

| chỗ | hằng cũ | hậu quả |
|---|---|---|
| `store.ts` | `SNAPSHOT = join(DEFAULT_DIR, …)` | nuốt `snapshot.json` của máy thật |
| `attachments.ts` | `DISK = …/../.data/attachments` | "restored 64 attachment(s)" |
| `observe.ts` | `DIR = …/../.data` | coverage của máy thật |

Cả ba giờ đi qua **một nguồn duy nhất**: `store.dataDir()`. Chạy lại: `[]` bot, không dòng
`restored` nào.

#### T4 ĐÓNG (26/08) — cài thành công trên máy sạch thật

Chủ máy cài trên **một máy chưa từng có Grok Bot**, qua đúng đường công khai:

```
http://103.75.186.63:8099/?k=<token>  →  Tải cho Windows  →  bấm đúp  →  app mở lên
```

Chuỗi đầy đủ đã chạy: tải **118 MB** qua Internet → Chrome giữ file (vì HTTP) → **Keep** →
SmartScreen chặn → **More info → Run anyway** → cài → **app mở tới màn hình onboarding**, shortcut
Desktop mang **icon thật của app**.

**Quyết định: giữ `.exe` làm bản chính.** ZIP vẫn còn (`/download/zip?k=…`) nhưng chỉ là lối thoát —
bấm qua được SmartScreen thì không cần, và `.exe` mới là hình dạng bản gốc dùng.

**Hai cửa người dùng phải tự bấm qua — cả hai là thiếu hạ tầng, không phải lỗi:**

| cửa | vì sao | cách qua | cách bỏ hẳn |
|---|---|---|---|
| Chrome giữ file | trang chạy **HTTP** | bấm **Keep** | tên miền + HTTPS ([publish-download-site.md](../plan/publish-download-site.md)) |
| SmartScreen | bộ cài **chưa ký số** | **More info → Run anyway** | chứng chỉ ký mã EV (~400–600 $/năm) |

#### T4 (25/08): bộ cài chở app ra đúng folder như hãng, nhưng boot đầy đủ cần máy sạch

**Chứng minh được, đo tận nơi:**
- Cài im lặng vào `C:\BotNoiBo` → **827 file · 499 MB**, cấu trúc **y hệt app gốc**: `Grok Bot.exe` ·
  `resources/` · `locales/` · các `.dll` · `resources.pak` … cộng `start-bot.cmd` + `backend.txt` của
  mình. `resources/app` đã vá, **không còn `app.asar` gốc**. `backend.txt` = `http://localhost:8788`.
- `Grok Bot.exe` trong folder đó **khởi động được** — CDP lên (Chrome/149).

**Chưa chứng minh được trên máy này, và vì sao:** app vừa cài **khởi động rồi thoát ngay**, 0 lượt
RPC. Gần như chắc do **Electron single-instance lock** — máy này đã có sẵn bản trong `Programs\Grok Bot`
và userData dùng chung, hai bản đá nhau. Đúng cái T4 sinh ra để bắt: **"máy chưa từng có app này"**
không giả lập được trên máy đã có nó. Cần một máy sạch thật.

**Một lỗi của tôi, đã ghi để khỏi lặp:** cài im lặng lần đầu treo 0 file — tôi đoán "đường dẫn dài",
sai. `install.log` chỉ ra: **Git Bash biến `/VERYSILENT` thành đường dẫn POSIX** (`C:/Program Files/Git/VERYSILENT`),
bộ cài không nhận cờ nên mở wizard chờ bấm. Chạy đúng: `MSYS_NO_PATHCONV=1`, hoặc qua một file `.cmd`,
hoặc **bấm đúp như người dùng thật** (Explorer không mangle). Người dùng cuối không gặp lỗi này.

### Chặng 4 · Đưa BE ra khỏi máy cá nhân — 🟡 **5/7 xong · 4.3 và 4.5 CHƯA**

| # | việc | kiểm bằng | kết quả |
|---|---|---|---|
| 4.1 | ✅ Bỏ ghim cứng `127.0.0.1` | `GROKBOT2_BIND=0.0.0.0` rồi gọi qua IP LAN | `BFF nghe trên 0.0.0.0:8796` · `/v1/health` **200** qua `192.168.100.203` |
| 4.2 | ✅ CORS cho tên miền, từ chối nguồn lạ | `GROKBOT2_ALLOW_ORIGIN=…` + gửi Origin | tên miền khai → trả đúng nó · nguồn lạ → **không** mượn được origin |
| 4.2b | ✅ Chốt an toàn: mở mà chưa `enforce` thì cảnh báo to | bind 0.0.0.0 với AUTH≠enforce | in `⚠ MỞ RA MẠNG…` |
| 4.4 | ✅ `host_settings` theo người | `host-settings.test.ts` | hai người hai múi giờ không đè nhau; cài đặt máy vẫn chung |
| 4.6 | ✅ Bịt lỗ `/oauth/token` + đăng nhập thật | §3b | đo đầu-cuối qua HTTP · 403/403/200/403 |
| 4.7 | ✅ Sửa lối mở trỏ đăng nhập sang **máy chủ hãng** | `launcher-env.test.ts` | 3/3 — xem ô dưới |
| 4.3 | ❌ **HTTPS — CHƯA** | `curl -I https://103.75.186.63:8099/` | **000**, không có TLS · cổng 8099 chỉ HTTP |
| 4.5 | ❌ **T6 — CHƯA** | `curl http://103.75.186.63:8099/v1/health` | **404** — VPS mới chỉ có **trang tải**, chưa có backend |

**Cách mở an toàn (một lệnh):**
```
GROKBOT2_BIND=0.0.0.0 GROKBOT2_AUTH=enforce GROKBOT2_ALLOW_ORIGIN=https://tai.tenmiencuaban.com pnpm backend
```
Mặc định vẫn `127.0.0.1` + `auth off` nên **không đổi hành vi cũ**; phải khai rõ mới mở.

**E2E chốt chặng:** unit **281/281** · hợp đồng **4/4 nhóm** · bind 0.0.0.0 + enforce + CORS đo tận
nơi qua IP LAN.

> **Một lối mở đang trỏ đăng nhập sang máy chủ của hãng — đã sửa 26/08.** Cả `run.ps1` lẫn hai bộ
> cài đều đặt `CURSOR_WEBSITE_URL=https://cursor.com`. Vô hại suốt thời gian `/auth/poll` còn cấp
> token cho mọi lời gọi, vì đăng nhập chỉ là bắt tay giả. Từ khi đăng nhập là thật thì bấm "Sign in"
> mở `https://cursor.com/loginDeepControl?challenge=…&uuid=…`: trình duyệt vào trang của **họ**, đăng
> nhập không bao giờ xong, và uuid + challenge của phiên trên máy người dùng bị giao cho họ. Nay cả
> ba chỗ trỏ vào chính backend, và `launcher-env.test.ts` đọc thẳng các tệp phát ra để khoá lại.

---

## 3c · Muốn E2E trên máy thứ hai thì còn thiếu đúng những gì

Đo ngày 26/08, không phải ước lượng:

| | đo được | |
|---|---|---|
| backend nghe ở | `127.0.0.1:8788` | chỉ máy này gọi được |
| tường lửa cổng 8788 | **không có luật nào** | máy 2 không gõ cửa được |
| VPS `103.75.186.63:8099` | `/` **200** · `/v1/health` **404** | mới chỉ là **trang tải**, chưa có backend |
| HTTPS | `https://…:8099` → **000** | chưa có TLS |

### Đường A · Cùng mạng LAN — làm được **hôm nay**, không cần VPS

| # | việc | ai làm | kiểm bằng |
|---|---|---|---|
| A1 | `.env`: `GROKBOT2_BIND=0.0.0.0` + `GROKBOT2_AUTH=enforce` — **đổi cùng nhau** | tôi | log in `nghe trên 0.0.0.0:8788` · `mode=enforce` |
| A2 | Mở cổng 8788 trên tường lửa | **bạn** (cần quyền admin) | `New-NetFirewallRule -DisplayName "grokbot2-be-8788" -Direction Inbound -Protocol TCP -LocalPort 8788 -Action Allow -Profile Private` |
| A3 | Chuyển quyền 3.524 dòng sang tài khoản email | **bạn quyết** | `node scripts/adopt-legacy-owner.mjs --to <email> --yes` |
| A4 | Máy 2: `backend.txt` ghi `http://192.168.100.203:8788` | bạn | mở app → không còn "Can't reach your computer" |
| A5 | Máy 2: bấm Sign in → trình duyệt mở trang đăng nhập **của bạn** | bạn | URL phải là `192.168.100.203:8788/app/?login_uuid=…` |

> **A2 và A3 tôi không làm hộ được:** một cái cần quyền admin, một cái viết lại chủ sở hữu của dữ
> liệu thật. A1 thì làm được ngay, nhưng bật `enforce` mà chưa làm A3 thì app hiện **0 bot**.

### Đường B · Khác mạng (VPS) — thêm lên trên đường A

| # | việc | ghi chú |
|---|---|---|
| B1 | Dựng backend đầy đủ lên VPS | khác hẳn `serve-static.mjs` đang chạy: cần Node, `.data/`, khoá pool |
| B2 | HTTPS | thêm một server block nginx trỏ `127.0.0.1:<cổng BE>`, **không** sửa block đang có |
| B3 | Máy 2 trỏ `backend.txt` vào tên miền HTTPS đó | rồi lặp lại A5 |

**Vì sao B1 không phải copy-paste:** VPS đang chạy `admin.halcion.vn`, `foodaymart.vn`,
`media.halcion.vn`, `convex` — hạ tầng thật của bạn. Backend grokbot2 mang theo SQLite, MCP spawn
tiến trình con, và khoá pool. Đưa lên đó là một quyết định riêng, không phải một bước của T6.

---

## 3b · Cửa cấp token — ✅ **bịt xong 26/08**

Đây là thứ đã chặn chặng 4 suốt hai ngày, và nó **không phải hạ tầng**.

**Lỗ:** `/oauth/token` và `/auth/poll` phát token cho bất kỳ ai gọi. Đo từ máy khác trong LAN:
`POST /oauth/token` thân **rỗng** → token **199 ký tự**, token đó `GET /v1/agents` được, đọc ra tên
mọi bot.

**Hợp đồng lấy từ chính bản dựng của client, không đoán:**

| cửa | client dùng để làm gì | nay hỏi gì |
|---|---|---|
| `/oauth/token` | `runRefreshAccessToken` gửi `{grant_type:"refresh_token", refresh_token}` | token cũ đó **có phải ta phát không** — `verifyJwt` (chữ ký + số đời) |
| `/auth/poll` | lần đăng nhập **đầu** trên một máy | đã có người đăng nhập thật và duyệt **đúng phiên** đó chưa |
| `/loginDeepControl` | trang client mở trong trình duyệt | chuyển hướng vào **giao diện đăng nhập đã có** ở `/app/` |

Luồng đầu là PKCE S256: `challenge = base64url(sha256(verifier))`. `uuid` đi qua thanh địa chỉ trình
duyệt nên coi như lộ, còn `verifier` **không rời khỏi app** — nên poll phải chứng minh giữ verifier.
**Đo trên app thật:** challenge app gửi khớp tuyệt đối với hàm của ta.

**Không dựng form đăng nhập thứ hai.** `apps/grokbot-web` đã có sẵn email + mật khẩu + tạo tài khoản
+ đăng xuất; nó chỉ nằm trên Vite `:5173`, nơi app desktop không với tới. Nay backend phát chính bản
build đó ở `/app/` (xem [`web-app.ts`](../../services/grokbot-backend/src/web-app.ts)).

**Đo đầu-cuối qua HTTP thật:** hỏi vòng trước khi duyệt **403** · sai verifier **403** · duyệt xong
**200 đúng tài khoản** · hỏi lại lần hai **403**. Từ IP LAN: `POST /oauth/token` **không** ra token,
`/v1/agents` không token **401**.

**Ba mức như phần còn lại của cổng:** `off`/`warn` vẫn cấp (máy đang chạy không chết giữa chừng),
`enforce` mới từ chối. Đây là công tắc phải bật **trước khi** mở cổng ra mạng.

### ⚠ Việc còn lại của chặng 4 — chuyển quyền dữ liệu cũ

Trước khi có đăng nhập thật, app dùng chung danh tính vô danh `auth0|grokbot2-user`, và **3.524 dòng
trên 9 bảng** mang tên nó. Đăng nhập bằng tài khoản email thật thì app thấy **0 bot** — không mất gì,
nhưng trông y hệt mất sạch.

```
node scripts/adopt-legacy-owner.mjs                        # chỉ xem, không đổi
node scripts/adopt-legacy-owner.mjs --to <email> --yes     # sao lưu rồi đổi, một giao dịch
```

**Trạng thái 26/08:** `.env` đang để `GROKBOT2_AUTH=off` + `GROKBOT2_BIND=127.0.0.1` — hai dòng này
**phải đổi cùng nhau**, vì `off` + `0.0.0.0` là mở lại đúng lỗ trên ra cả mạng.

### Hai lỗi có sẵn lộ ra khi làm việc này

1. **Di chú chưa từng chạy trên bản cài này.** `index.ts` gọi `enableWriting()` ở dòng 13, nhưng ESM
   nâng mọi `import` lên trước, mà `host-settings.ts` và `chat/state.ts` gọi `loadState()` ở cấp
   module — sổ mở dưới danh nghĩa tiến trình đọc, bỏ qua di chú, rồi nhớ luôn kết nối đó. Nên cột
   `token_version` của **chặng 2 chưa từng tồn tại**, tức `/v1/logout` chưa thu hồi được gì. Nay
   người ghi tự dựng schema kể cả khi sổ đã mở.
2. **Ngân sách bundle đang đọc 0 KB và đậu.** `base: "./"` làm index.html trỏ `./assets/…`, biểu thức
   của máy đo chỉ nhận `/assets/`. Một phép đo luôn ra 0 thì tệ hơn không đo — nay là **109 KB thô /
   34 KB gzip**.

### Chặng 5 · Tách người dùng trên box — **ba tầng**

Kế hoạch đầy đủ: [per-user-on-one-box.md](../plan/per-user-on-one-box.md).

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 5.1 | ⬜ Bước root một lần (`useradd` + sudoers) | `sudo -n -l` trên box | daemon chạy được lệnh dưới `gb2u*` |
| 5.2 | ⬜ Chuyển Chrome profile sang home user | `ls -ld /home/gb2u001/.config` | chủ sở hữu là `gb2u001` |
| 5.3 | ⬜ Chuyển `grok-memory` + `workspace` | như trên | như trên |
| 5.4 | ⬜ **Thử rò**: bot của A đọc file của B | `run_terminal_command_v2` đọc chéo | **Permission denied** |
| 5.5 | ⬜ Thu hồi khi nghỉ | để idle quá ngưỡng | tiến trình bị thu, đĩa giảm |
| 5.6 | ⬜ Mượn hình dạng `SandboxPolicy` | policy có `additional_readwrite_paths` | lệnh ngoài allowlist bị từ chối |

**E2E chốt chặng 5**
```
node scripts/e2e-box-tools.mjs      → công cụ box còn chạy sau khi đổi user
node scripts/e2e-desktop.mjs        → 29 mục · điều khiển máy tính không vỡ
node scripts/test-real-box.mjs      → box thật, không phải giả lập
```

### Chặng 6 · FE riêng

| # | việc | kiểm bằng | ĐẠT khi |
|---|---|---|---|
| 6.1 | ⬜ Routines: danh sách + tạo + sửa | `node scripts/e2e-routine-ui.mjs` | tạo được routine ngay trên web |
| 6.2 | ⬜ Đối chiếu với app gốc | `node scripts/ui-diff.mjs` | không lệch vùng đã dựng |

**E2E chốt chặng 6**
```
node scripts/e2e-routines.mjs       → routine nổ đúng điều kiện
node scripts/measure-routines-ui.mjs → giao diện khớp bản gốc
```

### Nợ lẻ — không chặn ai, nhưng đừng quên

| # | việc | kiểm bằng |
|---|---|---|
| N1 | ⬜ Thử Cloudflare thật rồi thêm bước nhận biết trang chặn | mở một trang có CF, xem bot nói gì |
| N2 | ⬜ Bộ cài macOS chạy trên máy Mac thật | `bash Cai-dat-Bot-Noi-Bo-mac-*.command` |
| N3 | ⬜ `.exe` cài thử trên máy sạch | chạy file, xem Apps & features có mục |
| N4 | ⬜ `self-xray` **tự ghi mình vào nhật ký e2e** → làm hỏng chỉ số | sửa chỗ ghi log, xem §5 |
| N5 | ⬜ 6 bot xoá 24/08 — **chờ bạn quyết** cứu hay bỏ | `grokbot.sqlite.7.bak` |
| N6 | ⬜ `bot.log` in token Telegram | đổi token + xoay log |
| N7 | ⬜ `publishSkill` cần registry | thuộc hạ tầng |
| N8 | ⬜ `avatar.test.ts` đỏ từ trước — "SVG có thân, có hai mắt" | `npx tsx --test apps/grokbot-web/src/avatar.test.ts` |
| N9 | ⬜ App hiện "Couldn't render this" ở cuối transcript · console: `TypeError: Cannot read properties of undefined (reading 'find')` trong `ms()` của renderer | mở app, bấm một bot, đọc console qua CDP 9222 |
| N11 | ✅ **Plugin “không mất”** — pane vẽ Error cho memory/CinAI/toolbox sau mỗi lần mở app. electron-main (`j7n`) chỉ hiểu `connected · needsAuth · loading · error`; ta gửi `disconnected` → rơi vào nhánh `default` = *Error · Not reported by Grok Bot's computer*. Dịch ở biên ACL (`wireStatus`). **Đo lại trên app thật: cả ba đọc `Connected`.** Test `src/mcp-wire-status.test.ts` 4/4 |
| N10 | ⬜ Ảnh cũ trong transcript hiện "Image unavailable" | **đã giải thích, không phải lỗi**: kho đính kèm giữ 64 file mới nhất (857–920), tin cũ trỏ tới `369-*` đã bị dọn. Cần quyết: giữ nhiều hơn, hay vẽ "ảnh đã hết hạn" thay vì "không có" |

---

## 4 · E2E — quy trình và danh sách

### Quy trình (bắt buộc theo thứ tự)

```
1. Kiểm bot có rảnh      curl -s localhost:8788/v1/health   → isBusy phải là false
2. Chạy bộ của chặng     (bảng dưới)
3. ĐỎ?  → sửa NGAY tại gốc, không ghi nợ, không bỏ qua
         → trước khi sửa: bài kiểm sai hay code sai?  (xem ô dưới)
4. Chạy lại tới khi XANH
5. Xanh rồi mới cập nhật docs + commit
```

> **Bài kiểm sai hay code sai?** Mặc định là **code sai**. Chỉ kết luận bài kiểm sai khi tìm được
> chỗ hợp đồng đã cố ý đổi, kèm lý do — và khi sửa bài kiểm thì phải kiểm **chặt hơn** trước, đừng
> chỉ nới cho qua.
>
> Ví dụ thật (25/08): `e2e-native` đỏ ở "POST non-image is 400" nhưng nhận 201. Route đã đổi ở X8 —
> app gốc đính kèm được **mọi loại tệp**, nên `400` mới là hợp đồng sai. Sửa bài kiểm, và thêm một
> khẳng định nữa: **tệp phải giữ đúng tên**, vì chỉ so mã 201 thì một lần âm thầm lưu nhầm thành
> ảnh vẫn lọt.

### Runner: `node` hay `npx tsx`?

**61 bộ chạy bằng `node`. Bốn bộ này BẮT BUỘC `npx tsx`** vì chúng import thẳng `src/*.ts`:

```
npx tsx scripts/e2e-mcp.mjs        npx tsx scripts/e2e-browser.mjs
npx tsx scripts/e2e-attachment.mjs npx tsx scripts/e2e-drafts-todo.mjs
```

Chạy nhầm bằng `node` thì lỗi là `ERR_UNKNOWN_FILE_EXTENSION ".ts"` — trông như hỏng code, thực ra
chỉ là sai runner. Tìm ra được cũng vì chạy thật (25/08).

### Danh sách — bộ nào phủ cái gì

| bộ | lệnh | phủ | lần chạy gần nhất |
|---|---|---|---|
| **Unit backend** | `node scripts/run-tests.mjs` | 288 bài · store, auth, mcp, site, đường dẫn client, **trạng thái MCP gửi cho client** | ✅ 288/288 · 26/08 |
| **Unit FE** | `cd apps/grokbot-web && npx tsx --test src/*.test.ts` | markdown, avatar | ⚠️ 16/17 — **N8 đỏ từ trước** |
| **Hợp đồng client** | `node scripts/contract-test.mjs` | 46 · routes·auth·commands·channels | ✅ 46/46 · 25/08 |
| **`/v1` đầu-cuối** | `node scripts/e2e-native.mjs` | 60 · roster CRUD·gửi·ngắt·SSE·đính kèm | ✅ 60/60 · 25/08 |
| **MCP** | `npx tsx scripts/e2e-mcp.mjs` | liệt kê tool·gọi tool·lỗi tool·args hỏng | ✅ · 26/08 — 4 server spawn thật, trả tool thật |
| **Plugin qua agent** | `npx tsx scripts/e2e-mcp-plugin.mjs` | agent có **dùng** được tool của plugin không | ⚠️ **1/3 · 26/08** — kẹt ở pool, xem ô dưới |
| **App đầu-cuối** | `node scripts/e2e-app-full.mjs` | 16 bước qua UI thật: tạo bot·mở·gửi·trả lời·avatar·xoá | ⚠️ **12/16 · 26/08** — hai đỏ cùng một nguyên nhân pool |
| **Cổng tiến trình** | `node scripts/verify-native.mjs`<br>`node scripts/verify-runtime.mjs`<br>`node scripts/verify-ops.mjs` | BFF·runtime·ops còn đúng vai | ✅ cả ba · 25/08 |
| **Điều khiển máy tính** | `node scripts/e2e-desktop.mjs` | 29 · chuột·phím·dạy việc | 27–29/29 · *chập chờn 10–20%* |
| **Việc song song** | `node scripts/e2e-tasks.mjs` | 14 · `task`/`await_task` | ✅ 14/14 |
| **Routine** | `node scripts/e2e-routines.mjs` | nổ đúng điều kiện·bộ lọc | — |
| **Trình duyệt** | `npx tsx scripts/e2e-browser.mjs` | 16 công cụ trình duyệt | — |
| **Box** | `node scripts/e2e-box-tools.mjs` | chạy lệnh·đọc/ghi file trên box | — |

Còn **58 bộ e2e** khác trong `scripts/`; bảng này chỉ liệt kê những bộ **đã dùng để chốt một chặng**.

### Bộ nào chạy cho chặng nào

| chặng | chạy tối thiểu |
|---|---|
| **0 · Dọn** | unit BE + unit FE + hợp đồng + `e2e-native` + `e2e-mcp` + ba `verify-*` |
| **1 · Đo tiền** | `e2e-native` + `e2e-run` |
| **2 · Đăng nhập** | `auth-cinapi.test` + `site.test` + `gw-auth` |
| **3 · Máy thứ hai** | `verify-sqlite` + `verify-runtime` + `check-app.cmd` |
| **4 · Ra ngoài** | `e2e-native` + `contract-test` |
| **5 · Tách user** | `e2e-box-tools` + `e2e-desktop` + `test-real-box` |
| **6 · FE** | `e2e-routine-ui` + `e2e-routines` |

### ⚠ Chặn thật hiện nay: **pool trả về "Your group's usage limit is set to $0"**

Mọi bài E2E cần **agent trả lời** đều dừng ở đây, không phải lỗi code. Đo 26/08:

| bài | kết quả | bước đỏ |
|---|---|---|
| `e2e-app-full` | 12/16 | *"the reply RENDERS"* · *"a tool actually ran against the box"* — cả hai in ra chính câu trên |
| `e2e-mcp-plugin` | 1/3 | agent không gọi được tool — cùng câu đó |

Chuỗi `"Your group's usage limit is set to $0"` **không có trong kho này** (đã tìm) — nó do
`admin.halcion.vn` trả về. Tức là hạn mức của nhóm trên pool đang là **0 đô** — việc của tài khoản,
không sửa được bằng commit. **Nâng hạn mức xong mới đóng được các bước đó.**

Phần **không** cần model thì xanh hết: tạo bot · hiện lên thanh bên 269 ms · mở bằng chuột ·
gõ vào ô soạn · lời nhắn tới backend · avatar HTTP 200 · pane máy tính có trạng thái.

### Ba cái bẫy đã trả giá

1. **Đừng chạy bộ đụng màn hình khi `isBusy` là `true`** — cắt ngang một bot đang làm việc thật.
2. **Nhóm dựa vào thị giác chập chờn 10–20%** (đo 5 lượt: 29·27·28·29·28). Đỏ một lượt ở **chỗ khác
   nhau mỗi lần** là hình dạng của bài toán, không phải một lỗi sửa bằng một commit. Đỏ **cùng một
   chỗ** hai lượt mới là lỗi thật.
3. **Số "x/20 lượt gần nhất đỏ" đang bị nhiễu** — `self-xray` ghi chính nó vào `e2e-history.jsonl`.
   Xem §5, và nợ N4.

---

## 4b · Sự cố 25/08 — mất 2.030 tin nhắn, đã khôi phục, đã sửa gốc

**Chuyện gì:** lúc ~10:58 sổ tụt từ **2.036 tin / 8 bot** xuống **6 tin / 4 bot**. Khôi phục từ
`grokbot.sqlite.2.bak` (09:20) — đủ **8 bot · 2.036 tin · 64 đính kèm · 4 routine**.

**Cơ chế — hai lỗi cộng lại, cả hai đều có sẵn từ trước:**

1. `pnpm backend` chạy **bốn tiến trình**, và cả bốn cùng `exec(SCHEMA)` + `ALTER TABLE` mỗi lần mở
   sổ. Bốn người cùng xin khoá ghi trên một file WAL thì có lúc một người thua.
2. Người thua ném lỗi → `loadState()` **im lặng lùi về JSON** → `snapshot.json` từ **16/08** (4 bot,
   0 tin) → tiến trình chạy tiếp như không có gì → lần lưu kế tiếp `writeSnapshot` **cắt tỉa** sổ
   xuống đúng bằng ảnh chụp cũ.

Việc thêm cột `token_version` của chặng 2 là **giọt nước** làm một tiến trình thua khoá, không phải
nguyên nhân.

**Đã sửa gốc:**

- **Chỉ tiến trình ghi mới chạy migration.** Ba tiến trình đọc chỉ mở file ra đọc.
- **Có sổ mà đọc hỏng thì NÉM, không lùi.** Lùi về JSON chỉ còn đúng khi **chưa có sổ nào** (máy
  mới). Dừng ồn ào hơn là chạy tiếp với trạng thái nghèo rồi ghi đè phần còn thiếu.

**Chốt mới này bắt ngay một lỗi của chính tôi:** `e2e-native` đỏ với `no such table: agents` — tôi
hỏi `existsSync` **sau** `new DatabaseSync`, mà lệnh đó tự tạo file, nên sổ mới toanh trông như đã
tồn tại và bị bỏ qua bước dựng bảng. Hỏi trước khi mở là xong.

**Sau khi sửa:** 278/278 unit · `e2e-native` 60/60 · hợp đồng 4/4 · sổ vẫn **8 bot / 2.036 tin** sau
mọi phép thử.

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
