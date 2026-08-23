# Hợp nhất grokbot2 × cinAPI — một sản phẩm, một tài khoản, một ví

Mục tiêu của chủ máy: **gộp hai project làm một**, tận dụng những gì cinAPI đã có — **thanh toán,
đăng nhập, giao diện** — và giữ phần grokbot2 giỏi: động cơ agent (bot roster, transcript, tool
calling, MCP, máy ảo/box, routine).

Tài liệu này ghi **số đo và hợp đồng đọc được từ code hai bên** trước khi đề xuất, vì đây là quyết
định kiến trúc: sai chỗ này thì mọi phase sau đều sai.

---

## 1. Hai bên đang có gì (đo, không đoán)

| | grokbot2 | cinAPI |
|---|---|---|
| Stack | Node 20 + TS (ESM), pnpm workspaces | **Go 1.23 + Chi** (BE) · **Next.js 15 App Router** (FE) |
| Kích thước | ~4 service Node (`:8788` BFF · `:8789` runtime · `:8790` computer · `:8791` ops) | **124 file `.go`** · **52 migration** · **~95 route** `/api/v1` · FE **349 file TS/TSX**, **67 page**, **230 component** |
| Lưu trữ | SQLite (`grokbot.sqlite`) | PostgreSQL 16 + pgx · Redis 7 + asynq |
| Auth | HS256 tự mint (`web-auth.ts`), `sub = local\|email` | HS256, cookie httpOnly **`cinapi_at`** (+ nhận `Bearer`), claims `sub` · `purpose` · `token_version`; có 2FA, Google OAuth, step-up |
| Thanh toán | `billing.ts` 7.8KB — self-hosted, **đang inert** (`GROKBOT2_BILLING=off`) | Ví 3-phase reserve/confirm/refund · Stripe · gói credit · auto-topup · hoá đơn · affiliate + referral |
| Giao diện | `apps/grokbot-web` — **vanilla TS + Vite**, một hàm `paint()` | Next.js 15 RSC + Tailwind, i18n `[locale]`, **Studio** (`useStudio.ts` 33KB · `ChatColumn.tsx` 36KB · `StudioShell.tsx` 27KB · `StudioVideo.tsx` 30KB) + admin CMS |
| Brain | gọi TRỰC TIẾP `admin.halcion.vn/v1/claude` | provider **`halcion`** → `admin.halcion.vn/v1/messages`, provider **`openclaw`** → `/v1/jobs/createTask`, + 8 provider khác |

**Điểm giao quyết định:** hai project đã dùng **chung một pool**. cinAPI đã bọc đúng cái pool
grokbot2 đang gọi trực tiếp, và bọc kèm ví, quota, rate limit, usage log, catalog model. Nên "gộp
hạ tầng" không phải trộn code Go với Node — mà là **cho grokbot2 lấy brain qua cinAPI**.

---

## 2. "Gộp làm một" nghĩa là gì — và không nghĩa là gì

Người dùng phải thấy **một web, một lần đăng nhập, một ví tiền**. Đó là đích.

**KHÔNG** nên gộp thành một repo/một binary. Hai lý do đọc được từ chính code:

- Go và Node không gộp được ở mức process; mọi "gộp" chỉ là HTTP. Mà cinAPI **đã là** một API
  platform và grokbot2 **đã là** một client của pool — ghép qua HTTP là đi đúng thớ, không phải
  workaround.
- `cinapi/CLAUDE.md` khai một **CRITICAL ZONE** (billing/wallet · provider orchestration · auth ·
  SSE bus) cấm sửa tự động. Di chuyển file grokbot2 vào cinapi sẽ đụng vùng đó. Mọi thay đổi nên
  nằm **phía grokbot2**, cinAPI chỉ thêm route/trang mới ở EDITABLE ZONE.

Hình dạng đích:

```
       ┌──────────────── một domain, nginx định tuyến ────────────────┐
       │                                                             │
  Next.js cinAPI FE  ──cookie cinapi_at──▶  cinAPI Go BE  ──▶ pool + 9 provider khác
  (login · ví · Studio · trang Agent mới)        │  (auth · wallet · calls · SSE)
       │                                         ▲
       └──cookie cinapi_at──▶ grokbot2 Node BE ──┘ brain qua /api/v1/calls
                              (roster · transcript · tool · MCP · box · routine)
```

Một nguồn sự thật cho **danh tính** (cinAPI users) và cho **tiền** (cinAPI wallet). grokbot2 giữ
nguyên nguồn sự thật cho **hội thoại/agent** (SQLite).

---

## 3. Phase — mỗi phase phải tự nghiệm được

### P1 — grokbot2 chấp nhận danh tính của cinAPI (nền của mọi phase sau)

Đo được: **cả hai đều HS256 và cùng dùng claim `sub`**. Chia sẻ một secret là `verifyJwt` của
grokbot2 nhận token cinAPI ngay, không cần lớp dịch nào.

Nhưng có **ba lỗ phải bịt**, phát hiện khi đọc code chứ không phải khi chạy:

1. **`purpose` không được kiểm.** cinAPI phát 5 loại token cùng secret, cùng `sub`:
   `access` · `email_verify` · `password_reset` · `2fa_pending` · `step_up`. `verifyJwt` hiện chỉ
   kiểm chữ ký + `exp` ⇒ một token *reset mật khẩu* hoặc *2FA chưa hoàn tất* sẽ mở được agent.
   Luật phải là: **có `purpose` thì bắt buộc `= "access"`**; không có `purpose` ⇒ token nội bộ
   grokbot2 (giữ tương thích ngược cho desktop + e2e).
2. **Cookie chưa được đọc.** FE cinAPI gửi danh tính bằng cookie httpOnly `cinapi_at`, không phải
   header. grokbot2 chỉ đọc `Authorization`. Phải đọc thêm cookie đó.
3. **`token_version` / logout-all không xuyên biên.** cinAPI vô hiệu hoá token cũ bằng cách tăng
   `users.token_version`; grokbot2 không thấy bảng `users` nên **không** đẩy phiên ra được. Chấp
   nhận có ý thức ở P1 (TTL access token là chặn tự nhiên) và ghi lại; P5 nâng lên introspect
   `GET /api/v1/me` có cache ngắn nếu cần cắt phiên tức thì.

**✅ ĐÃ XONG (2026-08-23).** `verifyJwt` kiểm `purpose`; thêm `cinapiCookieUser` + `ownerFromRequest`;
`/v1` lấy danh tính từ header HOẶC cookie. Test hợp đồng `auth-cinapi.test.ts` **10/10**.

Nghiệm trên STACK THẬT (token HS256 dựng bằng chính `jwt-secret.txt` của backend đang chạy) — **5/5**:

| ca | kết quả |
|---|---|
| cookie `cinapi_at`, `purpose=access`, user mới | HTTP 200 · roster **rỗng** (scoping đúng, không thấy bot người khác) |
| cùng token đó ở header `Bearer` | HTTP 200 · cùng owner |
| cookie mang `purpose=password_reset` | **HTTP 401** — chặn ngay ở cổng |
| không credential nào | HTTP 401 (`enforce` còn nguyên hiệu lực) |
| ticket cổng của desktop | HTTP 200 · **8 bot** — đường cũ không vỡ |

> **Sửa một lớp là chưa xong, và chỉ phép đo nói ra điều đó.** Bản đầu tôi chỉ sửa chỗ suy ra owner
> (`ownerFromRequest`) và tưởng là hết; nghiệm thật cho cookie **401** trong khi cùng token đó ở
> header cho **200**. Có HAI lớp riêng biệt: cổng vào (`auth-gate.checkAuth`) và suy ra owner. Cả hai
> giờ dùng chung một hàm `cinapiCookieUser`, để luật `purpose` không thể đúng ở lớp này mà hở ở lớp kia.
>
> **Và một bài kiểm kỳ vọng sai thì vô nghĩa.** Ca cuối lúc đầu viết là "không auth ⇒ phải 200 như
> desktop" và báo FAIL, trong khi code đúng: desktop không gửi rỗng, nó gửi *ticket cổng*. Đổi ca đó
> sang ticket thật thì ra 8 bot.

### P2 — brain đi qua cinAPI, tiền tự trừ đúng chỗ

Hai đường, và một đường sẽ phá UX vừa dựng:

| | đường compat | đường call (chọn) |
|---|---|---|
| endpoint | `POST /api/v1/messages` (drop-in Anthropic) | `POST /api/v1/calls` → SSE `/api/v1/calls/{id}/stream` |
| công sức | đổi `CLAUDE_POOL_URL`, ~1 dòng | adapter mới trong `packages/pool-client`, ~150–250 dòng |
| streaming | **buffered** — `compat.go` ghi rõ "the call runs to completion, then the result is emitted"; token-level là *future enhancement* | **token thật**: event `call_delta {call_id, text, seq}`, kèm kênh riêng `call_reasoning_delta` |
| kết luận | giết ba chấm + chữ chạy dần vừa đo ở X4/X7 | giữ nguyên UX, `onDelta` sẵn có của grokbot2 map 1-1 |

Đổi lại được: ví/quota, idempotency, rate limit theo key, usage theo model, và **10 provider** thay
vì một pool.

**Per-user hay dùng chung ví** — phải chốt: một API key cinAPI dùng chung ⇒ mọi người dùng grokbot2
tiêu vào một ví, mất per-user billing đã dựng ở multi-tenant Phase 5. Muốn tách thì mỗi owner cần
một key riêng (cinAPI đã có `POST /api/v1/keys`) — hoặc grokbot2 gọi `/calls` **kèm cookie của
chính người dùng** thay vì key máy chủ, để cinAPI tự trừ đúng ví. Đường cookie sạch hơn và không
sinh thêm bí mật để quản.

### P3 — giao diện: trang Agent trong FE cinAPI

FE cinAPI là Next.js 15 RSC + Tailwind; `apps/grokbot-web` là vanilla TS + `paint()`. **Không có
đường copy component** giữa hai bên. Nên P3 là *viết trang mới trong cinAPI FE* nói với `/v1` của
grokbot2 (hợp đồng đã có sẵn: **29 route · 32 schema** trong `packages/api-contract`), tái dùng
layout · i18n · design token · lớp `lib/api/client.ts` của họ.

Thứ tự trong P3: roster + transcript + composer (đủ dùng) → panel Details/routine → settings bot.
`apps/grokbot-web` **không xoá**: nó thành bàn thử nghiệm/debug và là đường lùi — nó đang là chỗ
duy nhất đo parity với app gốc (`ui-diff` 165/165).

Cần đo trước khi viết: bản `.next` trong cinapi build ngày **28/06** còn source sửa tới **27/07** —
build đã lỗi thời gần một tháng, phải `pnpm build` lại rồi mới nói được "giao diện đã có".

### P4 — tắt phần trùng ở grokbot2

- `billing.ts` giữ **inert vĩnh viễn** (`GROKBOT2_BILLING=off`) — một hệ trừ tiền là đủ; hai hệ là
  cách chắc chắn để tính tiền hai lần.
- `web-auth.ts` (register/login riêng) thành **legacy**: chỉ còn phục vụ `grokbot-web` khi chạy
  độc lập; đường chính là danh tính cinAPI.
- Không xoá gì trong lượt này. Xoá là việc của phase sau khi trang Agent đã thay thế được thật.

### P5 — một domain, một deploy

nginx: `/` → Next.js cinAPI · `/api/` → Go `:8080` · `/agent/` → grokbot2 BFF `:8788` (SSE cần
`proxy_buffering off`). Cookie `cinapi_at` cùng site ⇒ không cần CORS, không cần token trong URL.
grokbot2 vẫn giữ 4 process của nó; compose gộp thêm 4 service đó cạnh `api`/`worker`/`postgres`/
`redis` của cinAPI.

---

## 4. Những gì phải chốt trước khi code P2/P3

1. **Ví per-user hay ví chung** (xem P2). Đề xuất: gọi `/calls` kèm cookie người dùng ⇒ per-user,
   không sinh thêm secret.
2. **JWT secret dùng chung, hay grokbot2 introspect qua `/api/v1/me`?** Dùng chung = nhanh và
   offline, nhưng hai service cùng biết một bí mật và logout-all không xuyên biên. Introspect =
   sạch hơn, đổi lại một HTTP call (cache 30–60s). Đề xuất: **dùng chung ở P1**, mở đường
   introspect ở P5.
3. **Bot/agent của grokbot2 có trở thành "model" trong catalog cinAPI không?** Nếu có, người dùng
   thấy agent nằm cùng chỗ với các model khác (và ăn theo pricing/quote/monitor của họ). Việc này
   không cần cho P1–P3 nhưng đổi hình dạng P5.

---

## 5. Luật cho việc hợp nhất

- **Không sửa CRITICAL ZONE của cinAPI** (billing/wallet · provider orchestration · auth · SSE bus).
  Mọi thay đổi nằm phía grokbot2; phía cinAPI chỉ thêm trang/route mới.
- **Không sửa migration đã áp** của cinAPI — chỉ thêm file mới.
- Mỗi phase phải có **một phép nghiệm chạy trên stack thật**, không phải "đã viết xong".
- Hợp đồng `/v1` của grokbot2 là ranh giới: FE cinAPI chỉ được nói với nó qua
  `packages/api-contract`, không tự khai lại kiểu.
