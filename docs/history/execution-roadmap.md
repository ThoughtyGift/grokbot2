# Execution Roadmap — khớp bản gốc Grok Bot

> Kế hoạch triển khai chi tiết, 8 plan (P0 → P7), mỗi plan có task cụ thể, 4 cửa kiểm E2E,
> và một vòng lặp bắt buộc: **code → E2E → so với app gốc → ghi điểm chưa khớp → sửa → chạy lại**.
>
> Nền tảng: bản X-quang hệ thống 17/08/2026. Nguồn sự thật cho phần giao thức là router của
> box host **trích từ `app.asar`**, không phải suy đoán. Xem [§14 Phụ lục](#14-phụ-lục--dữ-liệu-đã-trích).
>
> **Lưu ý số mục:** thứ tự thực thi khác thứ tự tên plan — §9 là **P6**, §10 là **P5**, §11 là **P7**.
> P6 chen lên trước P5 có lý do, xem [§9.4](#94-cửa-kiểm-p6--và-vì-sao-cửa-c-mất-hiệu-lực).
>
> Tài liệu liên quan: [parity.md](../parity.md) · [protocol-reference.md](../protocol-reference.md) ·
> [HANDOFF.md](../session/HANDOFF.md) · [agent-brain.md](../reverse/agent-brain.md) · [box-architecture.md](../architecture/box-architecture.md)

---

## 0. Tóm tắt điều hành

| | |
|---|---|
| **Vấn đề** | Việc map với bản gốc đang làm bằng cách đoán hình dạng dữ liệu rồi xem app có vẽ không. `parity.md` ghi lại **6 lần** cùng một loại lỗi "sai tên trường", và một cuộc điều tra đã loại **5 giả thuyết** mà vẫn chưa xong. |
| **Nguyên nhân gốc** | Không có người phán xử máy đọc được, **và** backend trả `200 {}` cho mọi đường dẫn nó không biết — nên một endpoint bị thiếu là vô hình. |
| **Chìa khoá** | `app.asar` **chứa sẵn bản cài đặt của chính cái server ta đang giả lập** (hàm router `x3s`). Trích nó ra thành hợp đồng → "so với bản gốc" thành một bài test có đúng/sai. |
| **Kết quả mong đợi** | 9/9 route · 111/120 lệnh · ảnh đại diện bot hiện · nhiều công cụ trong một lượt · kênh Slack/Discord chạy thật. (Avatar nhấp nháy: **đã xong**, xem §8.) |
| **Tổng công** | ≈ 4–5 tuần cho P0–P7, trong đó P0+P1 (2,5 ngày) là điều kiện cần của tất cả. |
| **Đã xong** | **P0** Đợt 1–3 · **P1** (gồm P1-3) · **P2** · **P3** · **P4** — Cửa A xanh cả 4 nhóm, `parity-report` = **111/120** |
| **Còn chặn** | **P0-5 enforce** — app không gọi lại `EnsureSandBox` sau restart · **P6-2** — cần token nền tảng của người dùng · **đổi khoá pool** |

### Chạy toàn bộ bằng một lệnh

```
node scripts/e2e-run.mjs --regression
→ PASS  P0 A · P1 A · P2 A/B/C · P3 A/C      all gates green
```

### ⚠️ Thứ tự đã sửa sau khi đo: Đợt 3 phải đi SAU P2

Pha quan sát của Đợt 2 tìm ra **3 endpoint app đang gọi thật** mà backend im lặng trả `200 {}`.
Nếu bật `GROKBOT2_STRICT_404=1` ngay bây giờ, cả ba sẽ nhận 404 → **app hỏng thật**.

```
                     ┌── Đợt 1 ✅ vá bảo mật
   P0 ───────────────┼── Đợt 2 ✅ quan sát (404 cài sẵn, TẮT)
                     └── Đợt 3 ⛔ CHỜ P2 ──┐
                                            │
   P1 ─► P2 (cài 4 endpoint) ───────────────┘  rồi mới bật 404
```

**Đây chính là giá trị của việc chia hai pha** — nó vừa chặn một lần làm hỏng app.

### Thứ tự thực thi

```
P0 ─► P1 ─► P2 ─► P3 ─► P4 ─► P6 ─► P5 ─► P7
 │     │                             │     │
 │     └── dựng người phán xử         │     └── port thuật toán từ hermes
 └── vá bảo mật + mở mắt dụng cụ đo   └── nhiều công cụ / lượt

P6 (bê nguyên từ hermes) chen lên TRƯỚC P5 vì nó không cần port dòng nào
và đóng bề mặt cuối cùng còn thiếu trong bảng đo song song.
```

---

## 1. Điều kiện phải có trước khi bắt đầu

### 1.1 Checklist môi trường

- [ ] `pnpm install` xong ở gốc repo
- [ ] Pool key có trong `services/grokbot-backend/pool-key.txt` (dạng `hal_` + 48 hex)
- [ ] `.env` ở gốc repo có: `GROKBOT2_VNC_URL`, `GROKBOT2_BOX_EXEC_URL`, `GROKBOT2_EXEC_TOKEN`, `GROKBOT2_BROWSER_CDP`
- [ ] Backend chạy: `pnpm backend` → `http://localhost:8788`
- [ ] Box exec daemon tới được: `POST $GROKBOT2_BOX_EXEC_URL/health` → `{"ok":true,...}`
- [ ] Đường hầm SSH tới Chrome trong box đang mở (`infra\scripts\box-tunnel.ps1`)
- [ ] `app.asar` đọc được: `%LOCALAPPDATA%\Programs\Grok Bot\resources\app.asar` (≈48,7 MB)

### 1.2 Hai app chạy song song

```powershell
# APP LOCAL — trỏ vào backend của mình, CDP 9222
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:CURSOR_API_BASE_URL = 'http://localhost:8788'
$env:CURSOR_WEBSITE_URL  = 'https://cursor.com'
& "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe" --remote-debugging-port=9222

# APP GỐC — KHÔNG set CURSOR_API_BASE_URL, profile riêng, CDP 9333
$exe = "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe"
& "$exe" --remote-debugging-port=9333 --user-data-dir='C:\Users\admin\Desktop\grokbot2\.data\profile-real'
node services/grokbot-backend/scripts/label-window.mjs --cdp http://127.0.0.1:9333 --title "GOC"
```

> Khoá single-instance được tính theo profile, nên `--user-data-dir` riêng là điều kiện để mở
> được app thứ hai. Chi tiết: [HANDOFF.md §3](../session/HANDOFF.md).

### 1.3 Nếu thiếu điều kiện thì mất gì

| Thiếu | Hậu quả | Xử lý |
|---|---|---|
| Backend không chạy | không cửa nào chạy được | bắt buộc phải có |
| App local `:9222` | mất Cửa B và C | bắt buộc từ P0 |
| App gốc `:9333` | **mất Cửa C** | Cửa A vẫn là chuẩn — dùng nó, ghi rõ "Cửa C bị bỏ qua vì không có app gốc" trong tệp run |
| App gốc không nối được máy chủ hãng (subscription hết) | **Cửa C vô nghĩa** — đang so với một app cũng đang lỗi | dừng dùng Cửa C, ghi rõ lý do, không được coi là "xanh" |
| `app.asar` không đọc được | không dựng được hợp đồng → cả kế hoạch mất người phán xử | bắt buộc cho P1 |

---

## 2. Vòng lặp thực thi

### 2.1 Sơ đồ

```
   ┌────────────────────────────────────────────────────────────┐
   │  1. CODE  theo danh sách task của plan                     │
   └───────────────────────┬────────────────────────────────────┘
                           ▼
   ┌────────────────────────────────────────────────────────────┐
   │  2. node scripts/e2e-run.mjs --plan P2                     │
   │     chạy tuần tự, DỪNG ở cửa đỏ đầu tiên                   │
   │                                                            │
   │     Cửa A  hợp đồng   ← so với asar, không cần app          │
   │        │ xanh                                              │
   │        ▼                                                   │
   │     Cửa B  E2E local  ← CDP :9222, hành vi thật             │
   │        │ xanh                                              │
   │        ▼                                                   │
   │     Cửa C  song song  ← :9222 vs :9333, đếm DOM             │
   │        │ xanh                                              │
   │        ▼                                                   │
   │     Cửa D  hermes     ← chỉ cho P6 / P7                     │
   └───────────────────────┬────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
           ĐỎ │                         │ XANH hết
              ▼                         ▼
   ┌──────────────────────────┐   ┌──────────────────────┐
   │ 3. GHI ĐIỂM CHƯA KHỚP    │   │  4. CHỐT PLAN        │
   │ docs/parity-runs/        │   │  • thêm cửa vào bộ   │
   │   P2-run-03.json         │   │    hồi quy           │
   │ {gate, check, expected,  │   │  • commit            │
   │  actual, loai:1|2|3}     │   │  • sang plan sau     │
   └────────────┬─────────────┘   └──────────────────────┘
                ▼
   ┌──────────────────────────────────────────────────────┐
   │ PHÂN LOẠI — quyết định cách sửa                      │
   │   loại 1 GIAO THỨC  → đọc lại asar, sửa cho khớp     │
   │   loại 2 BỀ MẶT     → xây tính năng                  │
   │   loại 3 NĂNG LỰC   → KHÔNG sửa ở plan này, đẩy P5   │
   └────────────┬─────────────────────────────────────────┘
                ▼
        quay lại bước 1  ──►  TRẦN 3 VÒNG / cửa
```

### 2.2 Bốn cửa kiểm

| Cửa | Tên | Chạy gì | Cần app? | Vai |
|-----|-----|---------|----------|-----|
| **A** | Hợp đồng | `contract-test.mjs` | Không | So phản hồi backend với bản trích từ `app.asar`. Nhanh, tất định. |
| **B** | E2E local | `e2e-*.mjs --cdp :9222` | Local | Kiểm hành vi thật trong app. |
| **C** | Song song | `parity-gate.mjs --local 9222 --goc 9333` | Cả hai | Đếm trên DOM, so local với gốc. |
| **D** | Đối chiếu hermes | `pytest` của hermes + gửi tin thật | hermes | **Chỉ cho P6/P7** — nơi bản gốc không có tính năng để mà so. |

### 2.3 Hai luật bắt buộc

**LUẬT DỪNG.** Sau **3 vòng** mà một cửa vẫn đỏ: ngừng sửa. Viết **một phép đo mới** để trả lời
"vì sao", rồi mới sửa tiếp.
*Lý do:* lỗi presence đã ăn **sáu** vòng sửa liên tiếp vì mỗi lần đều sửa tiếp thay vì đọc lại
bảng của client. Nguyên nhân thật — sai **tên kênh** — nằm sẵn trong `app.asar` suốt thời gian
đó (xem §8). Luật này tồn tại để không lặp lại chuyện ấy.

**LUẬT CẤM.** Không bao giờ làm test lỏng ra cho vừa code. Hợp đồng đến từ `app.asar`; nếu hợp
đồng sai thì sửa **bộ trích**, và nói rõ vì sao trong commit.

### 2.4 Mẫu tệp ghi điểm chưa khớp

Mỗi vòng chạy sinh **một tệp** trong `docs/parity-runs/`. Tệp này là thứ làm cho vòng lặp
diff được giữa các lần.

```json
{
  "plan": "P2",
  "run": 3,
  "atMs": 1786958000000,
  "backendCommit": "c0a1258",
  "gates": {
    "A": { "pass": false, "checks": 14, "failed": 2 },
    "B": { "skipped": "cửa A đỏ — không chạy tiếp" },
    "C": { "skipped": "cửa A đỏ" }
  },
  "mismatches": [
    {
      "gate": "A",
      "check": "GET /gw/avatars/<id> · if-none-match",
      "expected": 304,
      "actual": 200,
      "loai": 1,
      "note": "so ETag bằng == nhưng client gửi kèm dấu ngoặc kép"
    }
  ],
  "regression": { "P0": "pass", "P1": "pass" }
}
```

**Ba quy tắc khi ghi:**

1. **Mỗi điểm chưa khớp phải có `loai`.** Không phân loại thì không biết nên đọc lại asar
   (loại 1), xây tính năng (loại 2), hay đẩy sang P5 (loại 3).
2. **`expected` phải trích từ hợp đồng**, không phải từ suy nghĩ của người sửa. Nếu không tìm
   được giá trị mong đợi trong hợp đồng → đó là lỗ của bộ trích, ghi thành task cho P1.
3. **`regression` luôn có mặt.** Một plan xanh mà làm plan trước đỏ thì chưa xong.

---

## 3. Bốn script mới

Đặt trong `services/grokbot-backend/scripts/`. Ba script cũ dùng lại nguyên trạng.

| Script | Việc | Xuất ra |
|---|---|---|
| **`extract-contract.mjs`** *(mới)* | Đọc `app.asar`, trích router `x3s` + bảng hằng số + 120 lệnh thành hợp đồng máy đọc được. **Neo bằng chuỗi literal**, không dùng offset byte. | `docs/extracted/box-host-contract.json` |
| **`contract-test.mjs`** *(mới)* | **Cửa A.** Gọi thật từng route trên `:8788`, so status + trường bắt buộc + nhánh 401/404. | `docs/parity-runs/<plan>-run-<n>.json` |
| **`parity-gate.mjs`** *(mới)* | **Cửa C.** Bọc `diff-capabilities.mjs` và thêm ngưỡng đúng/sai cho từng bề mặt. | cùng tệp run |
| **`e2e-run.mjs`** *(mới)* | Điều phối A→B→C→D theo plan, dừng ở cửa đỏ đầu tiên, đánh số vòng, gộp hồi quy. | exit code 0/1 |
| `diff-capabilities.mjs` | Dùng lại — đếm 12 bề mặt trên DOM qua CDP. | stdout |
| `probe-indicator.cjs` | Dùng lại — hash ảnh vùng avatar để đo **chuyển động**. Cần cho P4. | stdout |
| `tool-coverage.mjs` | Dùng lại, nhưng **sửa đường dẫn tương đối** (hiện chỉ chạy được từ đúng một thư mục). | stdout |

### 3.1 Hình dạng hợp đồng

```json
{
  "extractedFrom": "app.asar",
  "appVersion": "0.20.0",
  "anchors": { "router": "not found: ", "paths": "/local-exec/requests" },
  "routes": [
    { "method": "GET",  "path": "/health", "auth": false,
      "responseFields": ["ok","pid","isBusy","activeAgentId","startedAt","lastBusyAtMs"],
      "optionalFields": ["busyOnlyAwaitingApproval"] },
    { "method": "GET",  "path": "/events", "auth": "ifTokenSet",
      "contentType": "text/event-stream",
      "eventShape": ["channel","payload"],
      "queryFiltersChannels": true },
    { "method": "POST", "path": "/prepare-upgrade", "auth": "ifTokenSet",
      "responseFields": ["quiescing","runningTurns"] },
    { "method": "GET",  "path": "/avatars/<agentId>", "auth": "ifTokenSet",
      "status": { "ok": 200, "noAvatar": 404, "crossSite": 403, "ifNoneMatch": 304 },
      "headers": ["etag","cache-control","content-type","content-disposition",
                  "x-content-type-options","content-security-policy"] },
    { "method": "GET",  "path": "/local-exec/requests",  "auth": true },
    { "method": "POST", "path": "/local-exec/responses", "auth": true },
    { "method": "GET",  "path": "/webauthn/requests",    "auth": true },
    { "method": "POST", "path": "/webauthn/responses",   "auth": true },
    { "method": "POST", "path": "/api/<command>", "auth": "ifTokenSet" }
  ],
  "fallback": { "status": 404, "bodyContains": "not found: " },
  "auth401": [
    { "when": "local-exec && no token", "msg": "local-exec requires gateway authentication" },
    { "when": "webauthn && no token",   "msg": "webauthn requires gateway authentication" },
    { "when": "token set && mismatch",  "msg": "unauthorized" }
  ],
  "gatewayCommands": ["... 120 tên ..."],
  "intentionallySkipped": ["... 9 lệnh shared-room ..."]
}
```

### 3.2 Rủi ro của chính bộ trích

Tên biến trong bundle là tên rút gọn và **trùng nhau giữa các chunk** — đã gặp thật: tìm `y3s`
ra một hàm hoàn toàn khác thuộc chunk khác. Vì vậy `extract-contract.mjs` **phải**:

1. Neo bằng **chuỗi literal** (`"not found: "`, `"/local-exec/requests"`), không bằng tên biến
   và không bằng offset byte — app update là offset đổi.
2. **Fail loudly** khi không tìm thấy neo. Bộ trích im lặng trả về thiếu còn tệ hơn không có.
3. Chạy hai lần cho ra tệp **giống nhau từng byte**.

---

## 4. P0 — Vá lỗ bảo mật & mở mắt dụng cụ đo

> **Chặn:** toàn bộ các plan sau · **Công:** ≈1 ngày · **7 task**

**Mục tiêu.** Không còn khoá chờ lộ, không còn secret trong log, và **mọi request lạ đều để lại
dấu vết**. Đây là điều kiện cần của mọi plan sau.

### 4.1 Task

#### P0-1 · Khoá đang chờ lộ lên GitHub

- **Chỗ sửa:** `services/grokbot-backend/poolkey.tmp`, `.gitignore`
- **Việc:**
  1. Kiểm: `git check-ignore -v services/grokbot-backend/poolkey.tmp` → hiện **không bị ignore**
  2. Xoá tệp (nó là tệp tạm)
  3. Thêm vào `.gitignore`: `*.tmp` và `poolkey*`
  4. `git log --all --full-history -- services/grokbot-backend/poolkey.tmp` — nếu từng bị commit
     → **đổi khoá** ở `admin.halcion.vn` → API Keys
- **Chấp nhận:** `git status --porcelain` không còn tệp nào chứa `hal_`; `git check-ignore` báo bị ignore

#### P0-2 · Secret trong log

- **Chỗ sửa:** `services/grokbot-backend/src/redact.ts` *(mới)*, `src/forever-box.ts`
- **Việc:** viết `redact(text: string): string` che `password=…`, `token=…`, `hal_…`, `Bearer …`.
  Dùng trong `reportBoxConfig()` và **mọi** `console.log` có URL.
- **Bối cảnh:** `GROKBOT2_VNC_URL` chứa `password=` và đã bị in nguyên văn **5 lần** vào log
- **Chấp nhận:** `Select-String -Path <log mới> -Pattern 'password=|hal_|Bearer '` → rỗng

```ts
// src/redact.ts
const PATTERNS: [RegExp, string][] = [
  [/([?&](?:password|passwd|pwd|token|access_token|auth)=)[^&\s]+/gi, "$1***"],
  [/\bhal_[A-Za-z0-9]{8,}/g, "hal_***"],
  [/\b(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, "$1***"],
];
export const redact = (s: string): string =>
  PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);
```

#### P0-3 · Đường dẫn lạ phải để lại dấu vết

- **Chỗ sửa:** `src/index.ts` (nhánh cuối), `src/gateway.ts` (nhánh cuối)
- **Việc:** đổi `200 {}` → `404 {"error":"not found: <METHOD> <path>"}`, khớp **nguyên văn** host
  gốc. Ghi vào `unknownPaths` kèm method + 200 ký tự đầu của body.
- **Bối cảnh:** 3 URL bịa hoàn toàn (`/gw/khong-ton-tai-abc`, `/gw/subscribe`, `/hoan-toan-la`)
  đều nhận `200 {}` và **không để lại dấu vết nào**
- **Chấp nhận:** 3 URL đó → 404, và có mặt trong `__coverage.unknownPaths`

```ts
// gateway.ts — thêm vào đầu module
const unknownPaths = new Map<string, { n: number; lastMs: number; sample: string }>();
export const recordUnknown = (method: string, url: string, body: Buffer): void => {
  const key = `${method} ${url.split("?")[0]}`;
  const prev = unknownPaths.get(key);
  unknownPaths.set(key, {
    n: (prev?.n ?? 0) + 1,
    lastMs: Date.now(),
    sample: prev?.sample ?? body.toString("utf8").slice(0, 200),
  });
};
export const notFound = (res: ServerResponse, method: string, path: string): void => {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: `not found: ${method} ${path}` }));
};
```

> **Cẩn thận:** đây là thay đổi hành vi có rủi ro. Nếu app đang dựa vào một `200 {}` nào đó mà
> ta chưa biết, nó sẽ bắt đầu thấy 404. Chính vì thế Cửa B của P0 phải chạy đủ một phiên.

#### P0-4 · Số đếm phải sống qua restart

- **Chỗ sửa:** `src/gateway.ts`
- **Việc:** `__coverage` ghi xuống `.data/coverage.json` (gộp 2 giây), nạp lại lúc khởi động.
  Thêm `unknownPaths` vào báo cáo.
- **Bối cảnh:** `tsx watch` khởi động lại backend mỗi lần sửa file — đã thấy bộ đếm **mất 3 lần
  trong một giờ**, tức bằng chứng biến mất đúng lúc cần nó nhất
- **Chấp nhận:** restart backend rồi `GET /gw/__coverage` → số đếm còn nguyên

#### P0-5 · Cửa gateway phải kiểm vé

- **Chỗ sửa:** `src/gateway.ts`
- **Việc:** kiểm `authorization: Bearer <token>` so với token phát trong `ensureSandBox`
  (`packages/grokbot-proto/src/bootstrap.ts`, field 11 = `"gw-token"`), đúng **3 nhánh 401** của
  host gốc (xem [§14.2](#142-ba-nhánh-xác-thực-của-host-gốc)).
- **Bối cảnh:** đã chứng minh: không cần khoá nào, bằng PowerShell trần, tạo được bot, gửi chat,
  **chạy được công cụ đọc thư mục trên box**, và xoá bot. Host gốc **có** kiểm — đây là chỗ
  backend này **lệch** khỏi bản gốc, không phải "bản gốc cũng thế".
- **Làm hai pha — bắt buộc:**

  | Pha | `GROKBOT2_AUTH` | Hành vi |
  |---|---|---|
  | 1 | `warn` | Chỉ **log** token nhận được (đã che), không chặn. Chạy ít nhất một phiên đầy đủ. |
  | 2 | `enforce` | Chặn thật, trả 401 theo 3 nhánh. |

- **Chấp nhận:** pha 1 cho thấy app gửi token đúng như dự đoán → pha 2 bật mà app vẫn sống
- **Lùi lại:** nếu Cửa B đỏ → về `warn`, đọc token thật app gửi (có thể là header khác hoặc
  `?token=`), sửa, thử lại

#### P0-6 · Trần nhắn giữa bot không bao giờ reset

- **Chỗ sửa:** `src/chat.ts` trong `sendPrompt`
- **Việc:** thêm `hops.delete(agentId)` khi tin đến từ **người dùng** (không có `args.fromAgent`)
- **Bối cảnh:** `hops` chỉ tăng, không có `hops.delete`/`.clear` ở bất kỳ đâu. Một bot đã nhận tin
  ở độ sâu 3 sẽ **vĩnh viễn** không nhắn được cho bot khác nữa. Đối chiếu: `toolSteps` ngay cạnh
  **có** `resetToolSteps()` gọi trong `sendPrompt`.
- **Chấp nhận:** test: A→B→C→A 4 lần liên tiếp, mỗi lần bằng một tin mới từ người dùng → không
  lần nào trả "đã đạt trần"

```ts
// chat.ts, trong sendPrompt, cạnh resetToolSteps(agentId):
resetToolSteps(agentId);
if (!args.fromAgent) hops.delete(agentId);   // tin từ NGƯỜI DÙNG mở lại ngân sách chuyển tiếp
```

#### P0-7 · Sao lưu xoay vòng

- **Chỗ sửa:** `src/store.ts`
- **Việc:** trước khi ghi, dồn `state.json` → `state.1.json` → … → `state.10.json`
- **Bối cảnh:** có một `state.json` 214 KB (45 bot) đã mất, không lấy lại được
- **Chấp nhận:** sau 3 lần lưu, `.data/` có `state.json` + `state.1.json` + `state.2.json`

### 4.2 Cửa kiểm P0

| Cửa | Chạy | Xanh khi |
|---|---|---|
| **A** | `node scripts/contract-test.mjs --only routing,auth` | 3 URL bịa → **404** và có trong `unknownPaths` · `/gw/api/listAgents` không token → **401** · có token → **200** · restart rồi đọc `__coverage` → số đếm **còn nguyên** |
| **B** | `node scripts/e2e-ui.mjs --cdp http://127.0.0.1:9222` | **App vẫn sống với `GROKBOT2_AUTH=enforce`**: gõ 1 câu, nhận trả lời < 15 s, sidebar vẫn vẽ, ô Computer vẫn mở. *Đây là cửa quan trọng nhất của P0.* |
| **C** | — | bỏ qua có lý do: P0 không thêm bề mặt UI nào |

### 4.3 Rủi ro cao nhất của cả kế hoạch

Bật kiểm token có thể **làm app chết hoàn toàn** nếu client gửi vé theo cách khác dự đoán. Vì thế
P0-5 chia hai pha, và pha `warn` phải chạy ít nhất một phiên đầy đủ trước khi enforce.

### 4.4 Chốt P0 khi

- [ ] Cửa A xanh
- [ ] Cửa B xanh với `GROKBOT2_AUTH=enforce`
- [ ] `git status` không còn tệp nào chứa `hal_`
- [ ] `grep password` trong log mới ra rỗng
- [ ] 7/7 task có commit riêng, conventional commit

---

## 5. P1 — Dựng người phán xử (hợp đồng trích từ asar)

> **Chặn:** P2, P3, P4 · **Công:** ≈1,5 ngày · **4 task**

**Mục tiêu.** Biến "so với bản gốc" từ việc ngắm màn hình thành **một bài test có đúng/sai**. Sau
plan này, không plan nào còn phải đoán hình dạng dữ liệu.

### 5.1 Task

| Task | Việc |
|---|---|
| **P1-1** | Viết `extract-contract.mjs` → `docs/extracted/box-host-contract.json` theo hình dạng [§3.1](#31-hình-dạng-hợp-đồng). Neo bằng chuỗi literal, fail loudly khi mất neo. |
| **P1-2** | Viết `contract-test.mjs`: với mỗi route trong hợp đồng, gọi thật và so status + trường bắt buộc + thông điệp 401/404. Xuất JSON theo [§2.4](#24-mẫu-tệp-ghi-điểm-chưa-khớp). |
| **P1-3** | Viết `parity-gate.mjs` (Cửa C có ngưỡng) và `e2e-run.mjs` (điều phối + đánh số vòng + gộp hồi quy). |
| **P1-4** | Sửa đường dẫn tương đối trong `tool-coverage.mjs` để chạy được từ mọi thư mục (dùng `fileURLToPath(import.meta.url)` thay vì `"../../docs/…"`). |

### 5.2 Cửa kiểm P1 — plan này tự kiểm chính nó

| Cửa | Xanh khi |
|---|---|
| **A** | **Bộ trích tất định:** chạy 2 lần ra tệp giống nhau từng byte · hợp đồng có đúng **9 route** + **120 lệnh** + **3 nhánh 401** · đổi tên neo thành chuỗi giả → script **báo lỗi** chứ không trả tệp thiếu |
| **B** | **Tái lập được số đã đo:** chạy `contract-test` trên backend hiện tại phải báo đúng **4 route thiếu** (`/avatars`, `/local-exec/responses`, `/webauthn/responses`, `/prepare-upgrade`) và **27 lệnh thiếu**. Ra số khác → **bộ trích sai, không phải backend sai.** |
| **C** | bỏ qua |

> Đây là điểm tinh tế nhất của cả kế hoạch: **bài test đầu tiên của người phán xử là tái lập lại
> đúng những con số đã đo bằng tay.** Nếu nó ra số khác, ta biết ngay là không tin được nó.

### 5.3 Chốt P1 khi

- [ ] Cửa A và B xanh
- [ ] `node scripts/e2e-run.mjs --plan P0` chạy lại được toàn bộ cửa của P0 (bộ hồi quy hoạt động)
- [ ] `box-host-contract.json` được commit

---

## 6. P2 — Bốn endpoint còn thiếu + sáu trường của `/health`

> **Công:** ≈2 ngày · **5 task**

**Mục tiêu.** Đóng loại 1 (giao thức) ở mức đường dẫn. Chọn `/avatars` làm task đầu vì nó có kết
quả **thấy được ngay**: ảnh đại diện bot hiện lên.

### 6.1 Task

#### P2-1 · `GET /gw/avatars/<agentId>?v=<version>`

Lấy byte từ `getAgentAvatar`, tách data-URL. Handler gốc là `E3s`; hình dạng phải khớp:

| Điều kiện | Kết quả |
|---|---|
| có avatar, không `?v=` | `200` · `cache-control: no-store` · `etag: "<version>"` |
| có avatar, có `?v=` khớp version | `200` · `cache-control: private, max-age=31536000, immutable` |
| `if-none-match` khớp etag | **`304`** (không thân) |
| `?v=` lệch version | **`404`** `"no such avatar version"` |
| không có avatar / thiếu id | **`404`** `"agent has no avatar"` / `"missing agent id"` |
| header `sec-fetch-site: cross-site` | **`403`** `"cross-site avatar loads are not allowed"` |

Header luôn kèm khi 200: `content-type` (từ data-URL), `content-length`,
`content-disposition: attachment`, `x-content-type-options: nosniff`,
`content-security-policy: default-src 'none'; sandbox`

#### P2-2 · `POST /gw/prepare-upgrade`

Trả `{ "quiescing": false, "runningTurns": <số> }`. Dùng `inflight.size` **thật**, không hardcode
`0` — app đọc số này để quyết định có chờ trước khi cập nhật.

#### P2-3 · `POST /gw/local-exec/responses`

Nhận mảng phản hồi, ghép theo id với request đang treo ở kênh long-poll, trả `{"ok":true}`.
Không có kênh → `404 "local-exec channel not enabled"`.

> **✅ Đã xác nhận bằng phép đo** (Đợt 2, 17:17:34): app **thật sự gọi** endpoint này, n=2, và
> ta đang trả `200 {}` — nên kênh local-exec im lặng không làm gì. Không còn là giả thuyết từ
> asar nữa.

#### P2-4 · `POST /gw/webauthn/responses`

Cùng dạng, trả `{"ok":true}`, `404 "webauthn channel not enabled"` khi tắt.

> **✅ Đã xác nhận bằng phép đo** (Đợt 2, 17:17:06), **kèm hình dạng payload thật** — thứ đoán
> không ra từ asar:
>
> ```json
> {"frames":[{"kind":"ping"}]}
> ```
>
> Nghĩa là `frames` là một mảng các frame có `kind`. Cài theo hình dạng này, không theo suy đoán.

#### P2-6 · `GET /health` ở **gốc** — phát hiện mới, không có trong hợp đồng

> **App gọi `GET /health` ở gốc**, không phải `/gw/health` (Đợt 2, 17:16:56). Backend chỉ cài
> `/gw/health`, nên lời gọi này rơi vào fallback.
>
> **Vì sao hợp đồng không bắt được:** bảng route trích từ `x3s` là **tương đối theo `baseUrl`
> của gateway**. Nếu app dựng URL health từ một base khác (hoặc một caller khác — tiến trình
> main, hoặc luồng exec-daemon-credential), nó sẽ ra `/health` trần.
>
> **Chưa xác định** ai gọi. Việc cần làm: bật `GROKBOT2_LOG=1` một phiên, đọc header
> `user-agent` của lời gọi đó — đúng cách đã dùng để xác định ai mở `/gw/events`.
>
> Đây là ví dụ sống của §13: **hợp đồng là giả thuyết tốt nhất, phép đo mới là trọng tài.**

#### P2-5 · `GET /gw/health` — thêm 6 trường

```ts
{
  ok: true,
  pid: process.pid,
  isBusy: inflight.size > 0,
  busyOnlyAwaitingApproval: /* chỉ có khi mọi lượt đang chờ duyệt */,
  activeAgentId: /* bot đang chạy, hoặc null */,
  startedAt: /* mốc khởi động backend */,
  lastBusyAtMs: /* lần cuối inflight rỗng → có việc */,
}
```

### 6.2 Cửa kiểm P2

| Cửa | Chạy | Xanh khi |
|---|---|---|
| **A** | `contract-test.mjs --plan P2` | Cả 9 route trả đúng status · `/health` có đủ 6 trường đúng kiểu · 4 nhánh status của `/avatars` đều đúng (200 · 304 · 404 · 403) |
| **B** | `e2e-avatar.mjs` *(mới)* | Đặt avatar qua `setAgentAvatarBytes` → `GET /gw/avatars/<id>` trả `content-type: image/png`, `content-length > 0` · gọi lại kèm `if-none-match` → 304 · **và trong app, ảnh bot hiện đúng** (không phải chữ cái viết tắt) |
| **C** | `parity-gate.mjs --local 9222 --goc 9333` | Số `img` đếm được trong sidebar local **> 0** (hiện là 0) và **không kém gốc**. *Đây là lần đầu Cửa C có việc thật.* |

### 6.3 Chốt P2 khi

- [ ] 3 cửa xanh
- [ ] `unknownPaths` sau một phiên 10 phút **không còn** 4 đường dẫn này
- [ ] Hồi quy P0 + P1 vẫn xanh

---

## 7. P3 — 27 lệnh gateway còn thiếu

> **Công:** ≈2–3 ngày · **3 đợt**

**Mục tiêu.** Từ 95/120 lên **111/120**, và **ghi rõ 9 lệnh cố tình không làm** — một lệnh bị bỏ
có lý do khác hoàn toàn với một lệnh bị quên.

### 7.1 Đợt P3-1 — làm trước (7 lệnh)

```
deleteAgent · openAgent · openAgentWindowed · getTranscript
getAgentTranscriptWindow · refreshMcp · uploadAttachment · appendConnectorCard
```

- **`deleteAgent` số ít** — ta chỉ có `deleteAgents`. Đây đúng loại lỗi "sai tên" đã xảy ra 6 lần.
- **`getTranscript` không nhận body** (theo bảng lệnh `takesBody: false`) — khác `getAgentTranscript`.

### 7.2 Đợt P3-2 — trả hình dạng đúng, hành vi tối thiểu (11 lệnh)

```
autoUpdateBoxNow · snapshotBoxStoreNow · getBoxStoreStatus · clearBoxStoreNow
updateHostNow · setBoxMigrating · prepareBoxForRecreate · resumeBoxAfterRecreate
completeMcpOAuth · requestWebAuthnCeremony
```

Mục tiêu là app không lỗi và không hiện trạng thái sai, chưa cần tính năng đầy đủ.

### 7.3 Đợt P3-3 — **CỐ TÌNH KHÔNG LÀM** (9 lệnh)

```
createSharedRoom · joinSharedRoom · createRoomInvite · leaveSharedRoom
setSharedRoomTyping · createRoomFromAgent · respondToRoomJoinRequest
addOwnAgentToSharedRoom · removeOwnAgentFromSharedRoom
```

Cần một relay thật; tạo phòng không ai vào được thì tệ hơn không có phòng. Ghi vào
`intentionallySkipped` của hợp đồng để Cửa A không báo đỏ vì lý do sai. **Mỗi lệnh một dòng lý do.**

### 7.4 Cửa kiểm P3

| Cửa | Xanh khi |
|---|---|
| **A** | 120 lệnh: **111 xử lý được** + **9 trong danh sách cố tình bỏ** · **0 lệnh không rõ** · mỗi lệnh mới trả kiểu đúng (mảng ra mảng, `null` ra `null`) — không lệnh nào rơi về `{}` |
| **B** | `e2e-live-app.mjs`: xoá 1 bot bằng `deleteAgent` **số ít** → sidebar mất đúng bot đó · mở lại một bot bằng `openAgent` → hội thoại hiện đủ |
| **C** | `parity-gate`: không bề mặt nào **tụt so với vòng trước** (kiểm hồi quy, vì P3 sửa nhiều đường một lúc) |

### 7.5 Chốt P3 khi

- [ ] 3 cửa xanh
- [ ] `parity-report.mjs` in `111/120`
- [ ] 9 lệnh bỏ có **một dòng lý do mỗi lệnh** trong hợp đồng

---

## 8. P4 — Lỗi presence — ✅ **ĐÃ XONG** (không còn là plan)

> **Trạng thái:** giải quyết xong, ghi tại [`parity.md §2w`](../parity.md) · commit `549b4db`
> **Công còn lại:** 0 — phần dư đã hạ xuống hàng chờ

**Nguyên nhân gốc: ta phát trên `channel: "roster"`, mà không có kênh nào tên như vậy.**

Coordinator (không phải renderer) giải mã luồng SSE, tra tên kênh trong bảng của chính nó, và
**bỏ im lặng** mọi thứ không có trong bảng:

```js
const family = coordinatorEventFamilyForSseChannel(event.channel);
if (family == null) return;          // im lặng: không log, không lỗi, không throw
```

`SSE_CHANNEL_BY_FAMILY` liệt kê đúng 16 tên: `transcript` · `agents` · `agent-upserted` · `tray` ·
`workflows` · `subagents` · `async-tasks` · `automations` · `mcp-servers` · `forever-box` ·
`teach-recording` · `box-disk-pressure` · `computer-action` · `outline` · `sharing` ·
`host-settings`. **`roster` không nằm trong đó.** Thay đổi sidebar đi bằng `agent-upserted`
(một bot đổi) hoặc `agents` (cả danh sách).

**Đo ngay sau khi đổi tên kênh:**

- bot tạo qua gateway hiện trong sidebar sau **~1,5 s, không cần reload** (trước: sau 12 s vẫn
  chưa có);
- avatar animate suốt lượt chạy — **mười hash ảnh khác nhau**, trước đó mọi mẫu giống nhau
  từng byte.

### Bài học — vì sao mất sáu lần sửa sai trước đó

Cả sáu giả thuyết đều **bị loại đúng**, và không cái nào quan trọng, vì **payload chưa bao giờ
được đọc tới**. Mỗi "bản sửa" là một cái phong bì đẹp hơn gửi tới một địa chỉ không tồn tại:
lấy sai phần tử · cửa sổ bị throttle · thiếu `snapshotEpoch` · thiếu 11/16 trường roster ·
thiếu `isRunningTurn` · sai hình dạng sự kiện.

**Điều này xác nhận luận điểm trung tâm của cả roadmap:** bảng tên kênh nằm sẵn trong
`app.asar`. Sáu vòng đoán đã có thể thay bằng một lần đọc. Đó chính là việc P1 tồn tại để làm.

> **Ghi nhận hai lần đính chính trên đường đi.** Bản X-quang đầu kết luận "app chưa bao giờ mở
> `/gw/events`" — **sai**; app có mở và giữ kênh (>9 phút, `closed:0`, chỉ tiến trình Grok Bot
> giữ socket). Bản đính chính sau đó lại đoán nguyên nhân còn lại là epoch / `isHostReachable` —
> **cũng không đúng**; nguyên nhân là **tên kênh**. Cả hai lần đều sai vì cùng một lý do: suy
> luận từ phía client thay vì đọc bảng của client.

### Phần dư → hàng chờ (không còn chặn gì)

| Việc | Vì sao vẫn nên làm | Vì sao không còn cấp thiết |
|---|---|---|
| Gửi dòng `id:` + hỗ trợ `Last-Event-ID` | Sau mỗi lần đứt kết nối, client không có mốc để nối lại | Presence đã chạy; đây là độ bền, không phải lỗi |
| Tôn trọng bộ lọc kênh theo query string | Host gốc lọc server-side; ta gửi tất cả | Gửi nhiều hơn thì client tự bỏ — vô hại |
| Phép biến đổi `x-sand-slim-avatars` | Khớp bản gốc | Chưa có bằng chứng nó ảnh hưởng gì |

### Cửa kiểm — giữ lại làm **hồi quy**

Ba cửa dưới đây chuyển từ "cửa nghiệm thu P4" thành **bài hồi quy thường trực**, vì presence là
thứ đã hỏng âm thầm sáu lần và có thể hỏng lại:

| Cửa | Chạy | Xanh khi |
|---|---|---|
| **A** | `contract-test --only events` | Tên kênh phát ra **nằm trong 16 tên hợp lệ** — bài test này là thứ đáng lẽ đã chặn được cả sáu vòng sửa sai |
| **B** | `probe-indicator.cjs --cdp :9222` | Hash ảnh vùng avatar **khác nhau** ở ≥3 mốc trong một lượt |
| **C** | `probe-indicator.cjs --cdp :9333` | Cùng phép đo trên app gốc cũng đổi hash — nếu **gốc cũng không đổi** thì phép đo sai, không phải backend sai |

> **Không được** đổi phép đo này thành "tìm chữ Thinking/Working" — đã cho **kết quả âm tính
> giả**: indicator của bản gốc là **avatar động**, không nhãn chữ, không class `spinner`.

<details>
<summary>Kế hoạch P4 cũ (giữ lại để đối chiếu)</summary>

Bốn task đã dự kiến: gỡ tên tham số query lọc kênh · gửi `id:` · slim-avatars transform · đo
`isHostReachable`. **Không task nào là nguyên nhân.** Giữ lại vì nó cho thấy một kế hoạch có
thể hợp lý toàn bộ mà vẫn nhắm sai chỗ — và vì sao luật dừng cần tồn tại.

</details>

---

## 9. P6 — Cầu kênh, bê nguyên từ `hermes-agent`

> **Công:** ≈2–3 ngày · **chen lên trước P5** vì không cần port dòng nào

**Mục tiêu.** Đóng bề mặt **duy nhất** còn thiếu trong bảng đo song song: routine kích theo sự
kiện. Và thay `getAgentChannels` hằng số bằng kênh chạy thật.

### 9.1 Vì sao bê được mà không port

`hermes-agent-main/` đã có trong repo. Kiểm chứng:

| Điểm | Kết quả |
|---|---|
| Giấy phép | **MIT** (Nous Research) — dùng lại hợp pháp, giữ ghi công |
| Chạy được ở máy này? | `requires-python >=3.11,<3.14` · máy có **Python 3.12.10** → **tương thích**. Chưa có `uv`, cần cài. |
| Có cổng MCP? | **Có** — `hermes mcp serve` (stdio, `mcp_serve.py` 897 dòng) |
| Backend ta nói MCP chưa? | **Rồi** — `src/mcp.ts`, `.mcp.json`, `get_mcp_tools`/`call_mcp_tool` |
| Khớp hệ nào? | `mcp_serve.py` ghi *"Matches OpenClaw's 9-tool MCP channel bridge surface"* — và hồ AI của bạn **chính là** `openclaw-router` |
| Có code TS bê thẳng? | **Không.** 1.575 tệp `.ts` nằm hết trong `apps/`, `ui-tui/`, `web/` — đều là UI. Logic agent là Python. |

### 9.2 Mười tool có ngay, 0 dòng port

```jsonc
// .mcp.json
{ "mcpServers": {
    "hermes": { "command": "hermes", "args": ["mcp", "serve"] } } }
```

| Tool | Đóng khoảng trống nào |
|---|---|
| `channels_list` | `getAgentChannels` đang trả **hằng số cứng** |
| `messages_send` | gửi Slack/Discord/Telegram **thật** |
| `conversations_list` · `conversation_get` · `messages_read` | hội thoại xuyên nền tảng |
| `attachments_fetch` | đính kèm từ kênh |
| **`events_poll` · `events_wait`** | **routine kích theo sự kiện** ("khi bị @ trên Slack") |
| `permissions_list_open` · `permissions_respond` | duyệt quyền xuyên kênh |

Đằng sau 10 tool này là adapter thật, không phải stub:

```
plugins/platforms/slack/adapter.py      8.742 dòng
plugins/platforms/discord/adapter.py    9.463 dòng
plugins/platforms/telegram/adapter.py   9.974 dòng
```

### 9.2b ⚠️ Hai điều đo được khi bắt tay vào P6

**1. Cần `mcp==2.0.0`, và nó xung đột với gói đã cài.** `mcp_serve.py` import
`mcp.server.MCPServer` — API đó **không có** trong bản `mcp` đang cài trên máy (bản đó có
`Server`). hermes khai báo nó trong extra riêng: `mcp = ["mcp==2.0.0", "httpx2==2.7.0",
"starlette==1.3.1"]`. Cài đè toàn cục sẽ **thay gói `mcp` mà công cụ khác đang dùng**.

→ **Phải cài vào venv riêng** (`hermes-agent-main/.venv`), và `.mcp.json` trỏ vào python của venv
đó. Không đụng gì global; muốn bỏ thì xoá thư mục venv.

Tin tốt: hermes chỉ có **5 dependency core** (`openai`, `certifi`, `python-dotenv`, `fire`,
`httpx[socks]`), và Python 3.12.10 trên máy nằm trong khoảng `>=3.11,<3.14` nó yêu cầu.

**2. P6-2 chặn bởi token của người dùng, không phải bởi code.** Cầu kênh chỉ có giá trị khi có
Slack/Discord/Telegram thật để nối. Không token thì `channels_list` trả rỗng và `events_poll`
không có gì để poll — **cài xong chỉ mua được phần đấu dây, chưa mua được tính năng.**

→ Thứ tự thực tế: P6-1 và P6-3 làm được ngay và kiểm được (đếm đúng 10 tool). P6-2, P6-4, P6-5
chờ token.

### 9.3 Task

| Task | Việc |
|---|---|
| **P6-1** | Cài hermes **vào venv riêng**: `python -m venv hermes-agent-main/.venv` rồi cài 5 dep core + extra `mcp`. Xác nhận `create_mcp_server()` dựng được. |
| **P6-2** | Cấu hình ít nhất một nền tảng (Slack hoặc Discord hoặc Telegram) theo `hermes-agent-main/.env.example`. **Token đi qua env/tệp gitignored, không vào repo.** |
| **P6-3** | Thêm `hermes` vào `.mcp.json`. Xác nhận `get_mcp_tools("hermes")` liệt kê đủ 10 tool. |
| **P6-4** | Nối `events_poll`/`events_wait` vào `src/automations.ts`: thêm loại trigger `event` cạnh cron. Khi có sự kiện khớp → `sendPrompt` cho bot chủ. |
| **P6-5** | Thay `getAgentChannels` hằng số bằng `channels_list` thật. **Giữ nguyên hình dạng `{manifests, connections}`** mà client mong đợi. |

### 9.4 Cửa kiểm P6 — và vì sao Cửa C mất hiệu lực

**Đây là chỗ dễ sai nhất của cả kế hoạch.** Về kênh chat, **bản gốc cũng chưa làm được**:
manifest của chính nó ghi `availability: "coming-soon"` cho cả Slack và Discord, với
`connectGuide` rỗng. Nên:

- Nối hermes vào là **local vượt bản gốc** — lần đầu tiên, ở một bề mặt thật.
- Nhưng **Cửa C mất hiệu lực** ở đó: không thể so với một tính năng bản gốc không có. So sẽ luôn
  ra "local nhiều hơn gốc", và con số đó không nói lên đúng hay sai.

| Cửa | Xanh khi |
|---|---|
| **A** | `get_mcp_tools("hermes")` thấy đủ 10 tool · `getAgentChannels` vẫn trả đúng hình dạng `{manifests, connections}` |
| **B** | Tạo routine "khi bị @" → nhắn thử vào kênh → bot chạy và trả lời trong app |
| **C** | **bỏ qua có lý do** — ghi rõ vào tệp run: *"bản gốc ships coming-soon, không có gì để so"* |
| **D** | Gửi một tin thật qua `messages_send` → **xác nhận nó tới nơi** (mở Slack/Discord lên xem) |

### 9.5 Chốt P6 khi

- [ ] Cửa A, B, D xanh; Cửa C có ghi lý do bỏ qua
- [ ] Không token nào của nền tảng bị commit (`git status` sạch)
- [ ] Ghi công MIT của Nous Research vào `docs/legal.md`

---

## 10. P5 — Nhiều công cụ trong một lượt

> **Công:** ≈1 tuần · **loại 3 (năng lực)**

**Mục tiêu.** Đóng khoảng cách kiến trúc lớn nhất với bản gốc. **Đây là loại 3 — đọc hết asar
cũng không giải quyết được**, nên nó nằm sau và có cửa kiểm khác hẳn: đo **hành vi**, không đo
hình dạng.

### 10.1 Khoảng cách thật

| Bản gốc | Bản của bạn |
|---|---|
| AI gọi công cụ bằng **cơ chế riêng của nhà cung cấp** (native tool) | AI gọi bằng **cách viết chữ** `TOOL_CALL: tên(đối số)` → backend phải dò regex. *Hồ AI không hỗ trợ native, nên đây là lựa chọn **bắt buộc**, không phải lười.* |
| Gọi **nhiều** công cụ **cùng lúc** | **Một** công cụ/lượt, nối tối đa 8 bước → chậm hơn N lần vì mỗi bước là một vòng đi-về |
| Đối số là **đối tượng có cấu trúc** | Đối số là **một chuỗi**, tự tách tay → sinh ~10 đoạn code chữa cháy |
| Kết quả công cụ trả về được **ảnh** | Kết quả chỉ là **chữ** |
| Subagent chạy **song song**, hỏi được tiến độ | Subagent **tuần tự**, xong mới trả → không có `await_task` |

### 10.2 Task

| Task | Việc |
|---|---|
| **P5-1** | Parse **nhiều** dòng `TOOL_CALL` trong một câu trả lời. Hiện regex neo `$` nên chỉ lấy dòng cuối: `/TOOL_CALL:\s*([A-Za-z_][\w-]*)\s*\((.*?)\)\s*$/s` |
| **P5-2** | Chạy song song những lời gọi **không phụ thuộc nhau**; giữ tuần tự khi kết quả cái trước là đầu vào cái sau |
| **P5-3** | Đối số **JSON cho mọi công cụ**; bỏ dần `parts()` / `unquote()` / `unescapeText()` trong `src/tools.ts` |
| **P5-4** | Kênh kết quả công cụ **mang được ảnh**, để screenshot về thẳng lượt chính thay vì đi đường attachments |
| **P5-5** | Lúc khởi động, thử một `TOOL_CALL` với model đang chọn; model từ chối → **in cảnh báo to**. Hiện `sonnet`/`haiku` tắt hết công cụ mà không báo gì (đo được: gemini-2.5-flash ✅ · grok-4.5 ✅ · gemini-3.7-flash ✗ · sonnet ✗ · haiku ✗) |

### 10.3 Cửa kiểm P5

| Cửa | Xanh khi |
|---|---|
| **A** | Không áp dụng — hợp đồng không nói gì về cách gọi công cụ. **Ghi rõ "bỏ qua có lý do"**, không để trống. |
| **B** | `e2e-multitool.mjs` *(mới)*: một câu yêu cầu 3 việc độc lập → **≥2 thẻ tool-call trong CÙNG một lượt** · tổng thời gian **< 70%** so với chạy tuần tự · đặt `GROKBOT2_MODEL=sonnet` → thấy cảnh báo, không im lặng |
| **C** | So **số vòng đi-về hồ AI** cho cùng một nhiệm vụ 3 bước, local vs gốc. Không cần bằng nhau — cần **giảm so với chính mình trước P5**. |

> **Bắt buộc trước khi sửa:** chạy `measure-latency.cjs` lấy mốc. Không có mốc thì không chứng
> minh được đã nhanh hơn. Mốc hiện tại: đề bài ngắn 2.840 ms · đề bài đầy đủ 3.401 ms ·
> giá của đề bài dài **+561 ms/câu**.

### 10.4 Chốt P5 khi

- [ ] Cửa B xanh
- [ ] Số vòng đi-về giảm **đo được** so với mốc
- [ ] `tool-coverage.mjs` không tụt (không công cụ nào biến mất vì đổi cách parse)

---

## 11. P7 — Port thuật toán từ hermes

> **Công:** ≈1–2 tuần · làm **sau P5** vì P5 dựng lại vòng lặp công cụ mà mấy cái này cắm vào

**Mục tiêu.** Bê **thuật toán**, không bê code. Python → TypeScript. Thứ có giá trị là thiết kế.
Tiền lệ đã có: `src/prompt.ts` **đã** mượn cách xếp 3 tầng của hermes và ghi rõ trong comment.

### 11.1 Bảng port, theo thứ tự giá trị

| Module hermes | Dòng | Đóng khoảng trống nào | Của ta hiện tại |
|---|---:|---|---|
| `agent/context_compressor.py` | 7.164 | Nén ngữ cảnh nghiêm túc | `compaction.ts` — **127 dòng** |
| `tools/image_generation_tool.py` | 1.827 | `generate_image` | không có |
| `tools/delegate_tool.py` + `async_delegation.py` | 4.279 + 1.447 | `await_task` · subagent song song, hỏi được tiến độ | subagent tuần tự |
| `tools/mcp_tool.py` | 7.122 | `list_mcp_resources` · `read_mcp_resource` · `completeMcpOAuth` · `refreshMcp` | chỉ có tool, không có resource |
| `tools/terminal_tool.py` | 3.466 | `write_shell_stdin` — shell tương tác | exec một phát |
| `tools/vision_tools.py` | 1.979 | Kết quả công cụ mang ảnh (bổ trợ P5-4) | kết quả chỉ là chữ |
| `tools/session_search_tool.py` | 1.176 | Tìm trong hội thoại cũ | không có |
| `tools/skills_hub.py` | 3.962 | Skills — `skillsCatalog` đang trả `[]` | stub |
| `cron/scheduler.py` | 6.187 | Kích theo **sự kiện**, không chỉ theo giờ (bổ trợ P6-4) | `automations.ts` chỉ cron |
| `agent/conversation_loop.py` | 7.842 | Tham khảo cho P5 | 1 công cụ/lượt |

### 11.2 ⚠️ Đừng cho rằng mọi thứ trong hermes đều sâu

Đã **đếm dòng thật** vì tên tệp gây nhầm:

- `tools/computer_use_tool.py` — **35 dòng**
- `tools/read_terminal_tool.py` — **75 dòng**

Chúng là **lớp vỏ mỏng**, không phải bản cài đặt. **Đếm dòng trước khi lên kế hoạch bê.**

### 11.3 Cửa kiểm P7

| Cửa | Xanh khi |
|---|---|
| **B** | E2E riêng cho mỗi công cụ mới port |
| **D** | Ca test tương ứng của hermes phải xanh (hermes có **3.055 tệp test** — đủ làm người phán xử) |
| hồi quy | `tool-coverage.mjs` không tụt |

---

## 12. Bảng tổng

| Plan | Chặn plan nào | Đo được gì khi xong | Công |
|---|---|---|---|
| **P0** Vá & mở mắt | **toàn bộ** | URL lạ → 404 có ghi vết · không secret trong log · không khoá chờ lộ · cửa gateway kiểm vé | 1 ngày |
| **P1** Hợp đồng | P2 · P3 · P4 | Tái lập đúng "4 route thiếu, 27 lệnh thiếu" → map không còn là đoán | 1,5 ngày |
| **P2** Endpoint | — | Ảnh đại diện bot hiện lên · `/health` đủ trường · 2 kênh phản hồi hoạt động | 2 ngày |
| **P3** Lệnh | — | 111/120 lệnh · 9 lệnh bỏ có lý do ghi rõ | 2–3 ngày |
| ~~**P4** Presence~~ | — | ✅ **XONG** — sai tên kênh (`roster` không tồn tại). Bot hiện sau ~1,5 s · avatar animate, 10 hash khác nhau. Ba cửa giữ lại làm **hồi quy**. | ~~2 ngày~~ **0** |
| **P6** Cầu kênh | — | Slack/Discord/Telegram thật · routine kích theo sự kiện | 2–3 ngày |
| **P5** Đa công cụ | — | ≥2 công cụ/lượt · số vòng đi-về giảm đo được | 1 tuần |
| **P7** Port hermes | — | Nén ngữ cảnh · `generate_image` · `await_task` · MCP resources · shell tương tác | 1–2 tuần |

### Còn lại trong hàng chờ (không chặn gì)

- Chẻ `chat.ts` **1.773 dòng / 103 KB** thành `entries.ts` · `roster.ts` · `tool-registry.ts` ·
  `turn.ts` · `approvals.ts` — quy ước của chính dự án là "module nhỏ", giới hạn 800 dòng
- Chuyển `state.json` sang SQLite khi vượt ~500 KB (hiện mỗi lần lưu là **ghi lại toàn bộ**)
- Thay `console.log` bằng logger có mức độ và tự che secret
- Đường hầm SSH tới Chrome là điểm chết đơn lẻ — cần tự dial lại
- Viết test cho các hàm thuần: `parseCron` · `matches` · `describe` · `parts` · `unquote` ·
  `fileArgs` · `htmlToMarkdown` · `migrate` · đề bài 3 tầng. **Hiện coverage 0%, chuẩn là 80%.**

---

## 13. ⚠️ Một điều phải nói rõ về hợp đồng

Router `x3s` trích từ `app.asar` có dấu hiệu là bản host cho **box chạy local/dev** — trong cùng
vùng code có `/proc/`, `ps`, `host-main`, container dev-box. Rất có thể box trên cloud của hãng
dùng đúng bản này, nhưng **điều đó chưa được chứng minh**.

Vì vậy:

- Hợp đồng là **giả thuyết tốt nhất hiện có**, không phải sự thật tuyệt đối.
- **Cửa C là nơi xác nhận nó.**
- Khi Cửa A xanh mà Cửa C đỏ → **tin Cửa C**, và sửa hợp đồng.

---

## 14. Phụ lục — dữ liệu đã trích

### 14.1 Bảng route thật của box host

Trích từ `app.asar`, hàm `x3s`. `✅` = đã có · `❌` = chưa có.

| METHOD | Đường dẫn | Handler | Backend của bạn |
|---|---|---|---|
| GET | `/health` | `getHealth` | ✅ nhưng **thiếu 6 trường**: `pid` `isBusy` `activeAgentId` `startedAt` `lastBusyAtMs` `busyOnlyAwaitingApproval` |
| GET | `/events` | `w3s` | ✅ app **đang** nghe · ❌ bỏ qua bộ lọc kênh (query) · ❌ không gửi `id:` · ❌ không xử lý slim-avatars |
| POST | `/api/<tên lệnh>` | `g3s` | ✅ **95 / 120** lệnh |
| GET | `/local-exec/requests` | `T3s` | ✅ long-poll 25 s |
| POST | `/local-exec/responses` | `b3s` | ❌ **CHƯA CÓ** |
| GET | `/webauthn/requests` | `_3s` | ✅ long-poll 25 s |
| POST | `/webauthn/responses` | `I3s` | ❌ **CHƯA CÓ** |
| POST | `/prepare-upgrade` | → `{quiescing, runningTurns}` | ❌ **CHƯA CÓ** |
| GET | `/avatars/<agentId>?v=` | `E3s` | ❌ **CHƯA CÓ** — đây là lý do ảnh đại diện bot không hiện |
| *(không khớp)* | — | → `404 "not found: <METHOD> <path>"` | ❌ **bạn trả `200 {}`** |

### 14.2 Ba nhánh xác thực của host gốc

```
if ((local-exec) && authToken == null)
     → 401 "local-exec requires gateway authentication"

if ((webauthn)  && authToken == null)
     → 401 "webauthn requires gateway authentication"

if (authToken != null && !kiemTraVe(request, authToken))
     → 401 "unauthorized"
```

**Nghĩa là:** cửa không kiểm vé **không phải** "bản gốc cũng thế". Đó là chỗ backend này **lệch**
khỏi bản gốc. Sửa nó là bám sát bản gốc hơn, không phải thêm rào cản mới.

### 14.3 Bảng hằng số của client

```js
f5n = "/api"        gAi = "/events"     AAi = "/health"
lAi = "/prepare-upgrade"                h5n = "/avatars"
EAi = "/local-exec/requests"            TAi = "/local-exec/responses"
LAi = "/webauthn/requests"              UAi = "/webauthn/responses"
yAi = "Bearer"      wAi = "x-sand-slim-avatars"
p5n = "x-sand-mint-dedupe"              SAi = "traceparent"
```

### 14.4 Handler `/events` nguyên văn

```js
function w3s(t, e, n, r) {
  let o = iyi(e);                                   // biến thể (slim avatars?)
  n.on("close", () => t.onEventStreamClosed?.());
  T5n(e, n, s => t.subscribe(a => {
    if (r !== undefined && !r.has(a.channel)) return;   // r = Set kênh, từ query string
    s(JSON.stringify(o ? dAi(a) : a));
  }));
}
```

### 14.5 27 lệnh gateway còn thiếu

```
getTranscript                 openAgentWindowed             getAgentTranscriptWindow
appendConnectorCard           deleteAgent                   openAgent
createRoomFromAgent           createRoomInvite              joinSharedRoom
respondToRoomJoinRequest      createSharedRoom              addOwnAgentToSharedRoom
removeOwnAgentFromSharedRoom  setSharedRoomTyping           leaveSharedRoom
autoUpdateBoxNow              snapshotBoxStoreNow           getBoxStoreStatus
clearBoxStoreNow              updateHostNow                 setBoxMigrating
prepareBoxForRecreate         resumeBoxAfterRecreate        uploadAttachment
completeMcpOAuth              requestWebAuthnCeremony       refreshMcp
```

### 14.6 Công cụ: 24 / 54

- **Có (24):** bộ file + shell, `web_search`/`web_fetch`, `task_v2`, `call_mcp_tool`/`get_mcp_tools`,
  `ask_question`, `todo_read`/`todo_write`/`create_plan`, `knowledge_base`,
  `edit_file`/`edit_file_v2`/`delete_file`
- **Thiếu 30**, trong đó **chỉ 6 đáng làm:** `generate_image` · `await`/`await_task` ·
  `write_shell_stdin` · `list_mcp_resources` · `read_mcp_resource`
- 14 cái là di sản Cursor IDE (không áp dụng) · 10 cái là bề mặt backend này không có
- **Ta có thêm 29** bản gốc không gọi tên vậy: 16 `browser_*`, `message_agent`, `create_agent`,
  `rename_agent`, `attach_file`, `request_box_help`, `email_draft`, `slack_draft`, + 6 công cụ nháp

### 14.7 Mốc đo runtime (17/08/2026, 15:43–16:20)

| Hạng mục | Giá trị |
|---|---|
| Backend | `tsx watch src/index.ts`, listen `127.0.0.1:8788` |
| Bộ não | `gemini-3.7-flash` qua `admin.halcion.vn/v1/claude` |
| Hồ AI | `openclaw-router` · 2 tài khoản · 38 khoá |
| Box | Ubuntu · `/home/box/workspace` · display `:77` · ổ 100 GB dùng 75% |
| Chrome trong box | `Chrome/149.0.7827.53` qua đường hầm SSH `:9223` |
| Lệnh gateway đã cài | **95** · chưa map: 0 |
| Câu hỏi ngắn, trọn vẹn | **3.330 ms** ("2+2" → "4.") |
| Đề bài ngắn / đầy đủ | 2.840 ms / 3.401 ms → **+561 ms/câu** |
| Poll trong 11 phút | `getAgentChannels` **154** · `getAgentTranscript` **60** |
| Kênh đẩy `/gw/events` | mở 1 lần, giữ **>9 phút**, do tiến trình Grok Bot giữ |

---

## 15. Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-08-17 | Trích hợp đồng từ `app.asar` thay vì suy ra từ phía client | `app.asar` chứa sẵn router của chính server ta đang giả lập |
| 2026-08-17 | Đổi nhánh cuối thành 404 | Host gốc trả `404 "not found: …"`; `200 {}` làm endpoint thiếu trở nên vô hình |
| 2026-08-17 | **Đính chính:** app **CÓ** nghe `/gw/events` | Kênh mở >9 phút, `closed:0`, chỉ tiến trình Grok Bot giữ socket; `app.asar` có `streamEvents()`. Kết luận "app không nghe" trong bản X-quang đầu là **sai**. |
| 2026-08-17 | P6 (hermes) chen trước P5 | Tầng 1 không cần port dòng nào, và đóng bề mặt cuối cùng còn thiếu |
| 2026-08-17 | 9 lệnh shared-room **cố tình không làm** | Cần relay thật; phòng không ai vào được thì tệ hơn không có phòng |
| 2026-08-17 | Thêm Cửa D cho phần lấy từ hermes | Bản gốc ships Slack/Discord `coming-soon` → Cửa C không có gì để so |
| 2026-08-17 | **P4 rút khỏi kế hoạch — đã xong** | Nguyên nhân: phát trên `channel: "roster"`, tên không có trong `SSE_CHANNEL_BY_FAMILY` (16 tên hợp lệ). Đổi sang `agents`/`agent-upserted`: bot hiện sau ~1,5 s, avatar animate. **Không task nào trong P4 dự kiến là nguyên nhân** — bài học nằm ở *chỗ đọc*, không ở độ cẩn thận. |
| 2026-08-17 | P0 Đợt 1 xong, Đợt 3 vẫn chờ quan sát | 4 task rủi ro 0 đã commit (`41c3239`). Hai task đổi hành vi mạng (404, kiểm token) **phải có pha quan sát trước** — P0-3 nay cũng hai pha như P0-5. |
| 2026-08-17 | `hermes-agent-main/` gitignore, không vendor | 144 MB / 9.521 file / MIT third-party — commit vào đây sẽ lấn cả repo và trộn history của người khác |
| 2026-08-17 | **Đợt 3 chuyển xuống sau P2** | Pha quan sát tìm ra 3 endpoint app đang gọi thật (`/gw/webauthn/responses`, `/gw/local-exec/responses`, `/health` gốc). Bật 404 lúc này sẽ 404 cả ba → hỏng app. Hai pha vừa chặn được một lần làm hỏng. |
| 2026-08-17 | Hợp đồng asar **đúng 2/3, thiếu 1** | Hai endpoint dự đoán từ `x3s` đã được xác nhận bằng phép đo, kèm payload thật (`{"frames":[{"kind":"ping"}]}`). Nhưng `GET /health` ở gốc thì hợp đồng không có — bảng route là tương đối theo `baseUrl`. Xác nhận §13: tin phép đo hơn hợp đồng. |
| 2026-08-17 | **Cửa C thu hẹp về build-level** | Bản đầu assert trên bề mặt đã render → đỏ 6 chỗ, cả 6 là **dữ liệu** (app gốc chạy workspace thật, app local gần rỗng). Thu về nhãn control cũng đỏ oan (`Bot settings` chỉ có khi mở panel). Phạm vi đúng: dấu hiệu render lỗi + trạng thái chặn + tập chrome cố định. Mọi thứ phụ thuộc dữ liệu → Cửa B. |
| 2026-08-17 | **Vé gateway không xoay được** | Sau restart app, `stale-literal: 34` — app vẫn gửi `"gw-token"` cũ. Nó **cache box descriptor và không gọi lại `EnsureSandBox`**. Cố ý **không** ghim vé về literal cũ để "làm cho xanh": đèn xanh cho lớp bảo vệ hình thức tệ hơn đèn đỏ cho lỗ thật. P0-5 chặn bởi câu hỏi cụ thể: cái gì làm app bỏ descriptor. |
| 2026-08-17 | **P3 xong — 111/120** | 18 lệnh cài xong, 9 shared-room ghi là quyết định. Đọc hợp đồng trước đã cứu `getTranscript` (không nhận body, một mình trong nhóm) và `deleteAgent` số ít. 10 lệnh vòng đời box trả `{ok:false, reason}` thay vì `{}` — `{}` không phân biệt được với "chạy rồi, không có gì báo". |
| 2026-08-17 | **P6 cần venv riêng** | hermes cần `mcp==2.0.0`; bản `mcp` đang cài không có `MCPServer`. Cài đè global sẽ thay gói công cụ khác đang dùng → venv riêng trong `hermes-agent-main/.venv`. Và P6-2 chặn bởi **token nền tảng của người dùng**, không phải code. |
