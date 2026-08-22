# Multi-tenant roadmap — grokbot2

**Ngày:** 2026-08-22
**Trạng thái:** Phase 1 đang triển khai (owner_id + backfill). Phần còn lại: kế hoạch.
**Mục tiêu:** biến grokbot2 từ "một kho dùng chung, một user giả" thành **đa người dùng thật** —
mỗi người một tài khoản, dữ liệu riêng, login riêng, billing riêng.
**Nền tái dùng:** billing infra (commit `59ee062`) + `userFromToken` + `withDb` dùng lại nguyên.

> Ràng buộc cứng đã đo trong phiên 2026-08-22: **app desktop hãng không có form login gửi user về
> backend** — nó chỉ "bấm login → nhận token". Vì vậy login-nhập-tay đa user **chỉ đạt được qua
> `apps/grokbot-web`**. Desktop chỉ tham gia được như client một-danh-tính-cấu-hình.

---

## 0. Hiện trạng (đo được, không đoán)

| Sự thật | Bằng chứng |
|---|---|
| Một kho dữ liệu duy nhất | `services/grokbot-backend/.data/grokbot.sqlite` |
| Bot/transcript KHÔNG thuộc về ai | bảng `agents(id,name,created_at_ms,unread,hidden,body)` — không có owner |
| Chỉ 1 user giả được cấp | `auth.ts` `DEFAULT_USER = auth0\|grokbot2-user`, `GetMe` cứng |
| SSE đẩy tới MỌI client | `sse.ts` `const clients = new Set<ServerResponse>()`, `broadcast` loop toàn bộ |
| ~26 chỗ đọc/ghi agents+transcript | grep `listAgents\|createAgent\|transcript\|getAgent` |
| MCP + box là global | `mcp.ts` một `.mcp.json`; `forever-box.ts` một box |
| Billing đã có khóa user | `usage.auth_id`, `accessVerdict(user)`, paywall lock (đã verify live) |

**Kết luận:** cắm nhiều máy vào backend này = **dùng chung tất cả như một user**. Không có phân vùng.

---

## Phase 0 — Quyết định nền (chặn trước khi code)

- [ ] Chốt backend **trung tâm** (VPS) — đa-tenant cần MỘT backend chung, không mỗi máy một cái
- [ ] Chốt storage: SQLite (`node:sqlite`) là **single-writer** → ổn cho vài user; lên kế hoạch
      migrate Postgres khi concurrency tăng. `withDb` là ranh giới đổi lớp dưới không đổi caller
- [ ] Chốt provider auth cho web: tự quản (hash mật khẩu) vs Auth0/Clerk
- [ ] Chốt mô hình cô lập tài nguyên: per-user box/MCP vs chia sẻ có luật (ảnh hưởng Phase 6)

**DoD:** một tài liệu quyết định ngắn (ADR) chốt 4 điểm trên.

---

## Phase 1 — Chủ sở hữu dữ liệu (`owner_id`)  ← ĐANG LÀM

Thêm `owner_id` vào các bảng user-scoped; backfill row cũ về `DEFAULT_USER`. **Inert**: cột tồn tại
nhưng chưa ai lọc theo nó → app chạy y hệt.

**Tasks**
- [ ] SCHEMA (`store.ts`): thêm `owner_id TEXT NOT NULL DEFAULT 'auth0|grokbot2-user'` vào
      `agents, entries, parked, automations, todos, handoffs, compaction, attachments_meta, acceptance`
- [ ] Migration `migrateOwnerId(db)`: với DB cũ, `ALTER TABLE … ADD COLUMN owner_id` nếu thiếu
      (idempotent qua `PRAGMA table_info`)
- [ ] Gọi migration trong `getDb()` sau `db.exec(SCHEMA)`
- [ ] Backfill: `ALTER … DEFAULT` tự điền row cũ; thêm `UPDATE … WHERE owner_id IS NULL` phòng hờ
- [ ] KHÔNG đổi đường đọc/ghi (giữ inert) — write mới nhận DEFAULT qua cột default

**E2E / verify**
- [ ] `MT-E2E-01` DB cũ: mở backend trên `.data` thật → mọi bảng có cột `owner_id`, mọi row cũ =
      `auth0|grokbot2-user`, app hiển thị bot cũ bình thường
- [ ] `MT-E2E-02` DB mới: tạo bot mới → row có `owner_id = auth0|grokbot2-user`
- [ ] `MT-E2E-03` Idempotent: khởi động lại 2 lần → không lỗi "duplicate column", không nhân đôi
- [ ] `MT-E2E-04` Regression: 127 unit test vẫn xanh; app thật tạo bot + chat bình thường

**DoD:** cột có mặt + backfill đúng + inert (app không đổi hành vi) + test xanh.

---

## Phase 2 — Lọc theo user (~26 chỗ)

**Tasks**
- [ ] Luồn user tới `/gw`: `handleGateway(url, body, res, headers)` decode `userFromToken(headers.authorization)`
      → truyền `ownerId` xuống command handlers (giống ③ đã làm cho bootstrap)
- [ ] `directory/index.ts`: `listAgents` → `WHERE owner_id = ?`; `createAgent` set `owner_id`
- [ ] `chat/state.ts` + `conversation/`: đọc/ghi transcript scope theo owner
- [ ] `commands.ts` (ACL): mọi command đọc agent/transcript nhận + áp `ownerId`
- [ ] `automations`, `todos`, `handoffs`, `parked`: scope theo owner
- [ ] Chặn cross-tenant: một request user A không đọc/sửa được agent của user B (404, không 403 rò tồn tại)

**E2E**
- [ ] `MT-E2E-10` User A tạo bot X; user B `listAgents` → KHÔNG thấy X
- [ ] `MT-E2E-11` User B gọi `getAgentTranscriptTail(X)` → 404, không rò nội dung
- [ ] `MT-E2E-12` User A `sendPrompt(X)` → chỉ transcript của A đổi
- [ ] `MT-E2E-13` Không token → DEFAULT_USER (tương thích ngược desktop hiện tại)

**DoD:** hai user tách hoàn toàn ở tầng đọc/ghi; desktop cũ (không token riêng) vẫn chạy.

---

## Phase 3 — SSE per-user (CHỖ KHÓ NHẤT)

Hiện `broadcast()` đẩy tới mọi client → rò dữ liệu chéo. Phải định tuyến theo user.

**Tasks**
- [ ] `sse.ts`: `Set<ServerResponse>` → `Map<ownerId, Set<ServerResponse>>`
- [ ] Gắn user cho mỗi kết nối `/gw/events` (từ token lúc mở SSE)
- [ ] `broadcast(channel, payload)` → `broadcastTo(ownerId, channel, payload)`
- [ ] Mọi nơi push (transcript, presence, subagents…) truyền ownerId của agent liên quan
- [ ] Kết nối không user → không nhận gì (hoặc chỉ kênh global an toàn)

**E2E**
- [ ] `MT-E2E-20` User A + B mở SSE đồng thời; A chat → chỉ client A nhận `transcript` push
- [ ] `MT-E2E-21` Presence của bot user A không lọt sang B
- [ ] `MT-E2E-22` Tải: 5 user song song, 0 event chéo (kiểm log)

**DoD:** không một event nào của user này tới client user khác. **Test rò-chéo là bắt buộc.**

---

## Phase 4 — grokbot-web làm cổng login (user thật)

**Tasks**
- [ ] `apps/grokbot-web`: form login (email/mật khẩu hoặc OAuth)
- [ ] BE: kho user thật + mật khẩu **hash** (argon2/bcrypt) hoặc uỷ quyền provider
- [ ] `POST /auth/login` → xác thực → `mintJwt(user)` (đã nhận user) → trả token
- [ ] `POST /auth/logout` → vô hiệu token (blacklist/expiry ngắn + refresh)
- [ ] grokbot-web gọi cùng `/gw` + bootstrap với token user → nhờ P1–P3, mỗi người không gian riêng
- [ ] (Tuỳ chọn) desktop: client một-danh-tính-cấu-hình qua `GROKBOT2_USER`

**E2E**
- [ ] `MT-E2E-30` Đăng ký → login → thấy workspace rỗng của riêng mình
- [ ] `MT-E2E-31` Hai tài khoản khác nhau → hai workspace tách biệt
- [ ] `MT-E2E-32` Logout → token cũ bị từ chối
- [ ] `MT-E2E-33` Sai mật khẩu → từ chối, không rò tài khoản tồn tại

**DoD:** hai người thật login riêng trên hai trình duyệt/máy, dữ liệu tách hoàn toàn.

---

## Phase 5 — Billing per-user (gần xong — tái dùng `59ee062`)

**Tasks**
- [ ] Webhook checkout → `setPlan(user, 'pro', expiry)` sau thanh toán
- [ ] `GROKBOT2_CHECKOUT_URL` thật + re-apply patch `get-ultra-redirect`
- [ ] Bật `GROKBOT2_BILLING=enforce` trên backend trung tâm
- [ ] Quota per-user (đã có `accessVerdict` + `usage.auth_id`)

**E2E**
- [ ] `MT-E2E-40` User A vượt quota → app A khóa (paywall); user B dưới quota → vẫn chạy
- [ ] `MT-E2E-41` A bấm Get Ultra → mở checkout của mình → trả tiền → webhook → A mở khóa
- [ ] `MT-E2E-42` Usage A và B đếm độc lập (bảng `usage` theo auth_id)

**DoD:** khóa/mở + tính tiền độc lập từng user, verify live như phiên billing.

---

## Phase 6 — Cô lập tài nguyên (lớn — có thể hoãn)

**Tasks**
- [ ] MCP per-user: `.mcp.json` theo user (token của ai người nấy) thay vì một file chung
- [ ] Box/computer: per-user box hoặc luật chia sẻ
- [ ] Pool: một key nhưng quota per-user kiểm soát chi tiêu; cân nhắc tách cost theo user
- [ ] Cô lập turn/inflight theo user (tránh một user chiếm tài nguyên của người khác)

**E2E**
- [ ] `MT-E2E-50` MCP của A không lộ token/tool sang B
- [ ] `MT-E2E-51` Box action của A không chạm phiên của B

**DoD:** không rò tài nguyên/bí mật chéo user.

---

## Thứ tự + rủi ro

| Phase | Công sức | Rủi ro | Có thể inert? |
|---|---|---|---|
| 1 owner_id | Nhỏ | Thấp | ✅ (đang làm) |
| 2 lọc user | Vừa (~26 chỗ) | Vừa | một phần |
| 3 SSE per-user | **Lớn** | **Cao** (rò chéo) | ❌ |
| 4 login web | Lớn | Vừa | ❌ |
| 5 billing | Nhỏ | Thấp | ✅ đã có 90% |
| 6 cô lập MCP/box | **Lớn** | Cao | ❌ (hoãn được) |

## Tái dùng ngay
- Billing infra (`billing.ts`, `usage/plans`, `accessVerdict`, paywall, Get Ultra redirect)
- `userFromToken` (auth.ts) — danh tính từ token
- `withDb` (store.ts) — ranh giới đổi Postgres sau này
- Pattern off/warn/enforce (auth-gate/billing) cho rollout an toàn

## Ràng buộc bất biến
- Desktop hãng **không** login-nhập-tay đa user → web là bắt buộc cho user thật
- Không phân phối client đã patch (legal.md) → sản phẩm đa user công khai = grokbot-web
- Personal/research; backend trung tâm phải tự bảo mật (rate-limit, HTTPS, secret management)
