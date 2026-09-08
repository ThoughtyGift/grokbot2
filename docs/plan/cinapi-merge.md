# Hợp nhất grokbot2 × cinAPI — một repo, một deploy, một danh tính, một ví

> **Bản viết lại 09/09/2026.** Bản 23/08 nằm trong lịch sử git. Nó sai ở ba tiền đề, cả ba đo được:
> (1) nó tưởng cinAPI chỉ có *ví* — nay cinAPI có trọn **hệ gói thuê bao** (Free 100 · Starter 6.000 ·
> Pro 18.000 · Max 40.000 · Ultra 96.000 credit/tháng, trần cửa sổ 5 giờ, trần tuần, RPM theo bậc,
> Extra Usage) ở `cinai.app/vi/subscription`; (2) nó viết *"`billing.ts` giữ inert vĩnh viễn"* — trong
> khi grokbot2 đã tự dựng billing `enforce` (02/09), login riêng, kênh phát hành riêng; (3) nó ghi P1
> **✅ xong** — mà trên VPS P1 **không chạy**, vì hai bên đang dùng hai secret khác nhau (§1).
>
> Mục tiêu chủ dự án nêu 09/09, nguyên văn: *"chuyển login account sang cinai.app và billing về cùng
> một đường với cinapi subscription"*, và *"chung BE hai phần này cùng một project grokbot2, cùng một
> con đường"*.

---

## 0. Một lần gộp đã thử và đã chết — bài học trước khi đi tiếp

Ngày 23/08 có một lần gộp **theo chiều ngược**: chép trọn grokbot2 (4.522 tệp, kể cả `node_modules`)
vào `cinapi/agent/`, nhánh `feat/agent-merge`. Nhánh ấy đứng 17 ngày; `main` của cinapi đi tiếp không
cần nó; bản Desktop của kho cinapi hoá thạch ở đúng commit đó.

Bài học không phải "chiều sai" mà là: **chép mã không gộp được gì — chuyển QUYỀN SỞ HỮU mới gộp.**
Ai giữ danh tính, ai giữ tiền, ai giữ hội thoại. Tài liệu này đi theo câu hỏi đó.

---

## 1. Hiện trạng — đo trên máy thật 09/09, không đọc kế hoạch cũ

**Cả ba dự án chạy trên MỘT máy** (`hostname cs-linux-20251216104610892`, up 11 tuần; địa chỉ và cổng
SSH ở `docs/runbooks/trien-khai.md` — không chép lại đây):

| | cinapi | grokbot2 | Quản lý manager (OpenClaw) |
|---|---|---|---|
| là gì | **cinai.app** — Go + Chi BE, Next.js FE, Postgres, Redis, Stripe, hệ gói | động cơ agent + client Grok Local | pool `admin.halcion.vn`, router `/v1/claude`, admin-dashboard, account IP |
| chạy bằng | **Docker**: `cinapi-frontend :3002` · `cinapi-backend :8080` · `cinapi-worker` · pg `:5433` · redis `:16379` | **systemd**: `grokbot2-be :8788` · `grok-exec` · 8 unit màn hình `:77` | **PM2**, 24 tiến trình |
| mã nằm đâu | `/opt/cinapi` — **kho git `main`, sửa THẲNG trên VPS**, commit mới nhất 09/09 03:01, **7 commit chưa push**; remote `ThoughtyGift/cinapi` | `/opt/grokbot2/releases/<stamp>` + symlink `current`, deploy từ máy local qua `infra/vps/deploy.sh` | máy local → `scp` từng tệp → `pm2 restart` |
| deploy | `docker build` ×2 → `./deploy.sh` (`docker rm -f` + `run`) — **không có lùi bản**; CI `.github/workflows/deploy.yml` (push `main` → ssh → build → deploy.sh) **đang bị đi vòng** | `git archive HEAD` → release mới → `pnpm install` → build web → đổi `current` → restart → health; `rollback.sh` | không có |
| cấu hình | `/etc/cinapi/app.env` — 42 biến | `/opt/grokbot2/shared/.env` — 19 biến | PM2 ecosystem |
| kích cỡ | Go **124 tệp / 20.7k dòng** · TS/TSX 346 tệp / 58k dòng · `.git` 70 MB · 920 tệp theo dõi | — | — |

**Nối nhau ở đúng hai chỗ:**

1. **Một tên miền, một file nginx** (`/etc/nginx/sites-enabled/cinai-app`) quyết ai phục vụ đường nào:

```
/api/v1/events/  · /api/                      →  :8080   cinapi backend
/api/map-tiles/  · /api/geocode               →  :3002   cinapi frontend
/agent/                                       →  :8788   grokbot2   (cắt /agent/ trước khi chuyển)
/oauth/token · /auth/poll · /loginDeepControl
  · /auth/cursor_dev_session_token · /sand/feedback   →  :8788   grokbot2  (đường client desktop ghim cứng)
/aiserver.v1.*                                →  :8788   grokbot2
/                                             →  :3002   cinapi frontend  ← catch-all
```

   Tức **cinai.app LÀ cinAPI**; grokbot2 được ghép vào ở `/agent/` cộng vài đường tuyệt đối.
   P5 của bản cũ ("một domain") **đã xong từ trước** mà không ai ghi.

2. **Một bộ não.** `config.ts` của grokbot2 mặc định `admin.halcion.vn/v1/claude` = router `:19100`
   của OpenClaw; cinAPI cũng bọc đúng pool ấy (provider `halcion`, gọi host qua
   `--add-host=host.docker.internal`). OpenClaw là **nhà cung cấp cho cả hai**.

**Bốn số quyết định hình dạng kế hoạch:**

- **P1 chưa sống trên VPS.** grokbot2 lấy secret JWT từ `shared/data/jwt-secret.txt` (một tệp, cùng
  băm xuyên cả 5 release đang giữ — `.data` là symlink, **không** có bẫy "mỗi deploy đúc secret mới");
  biến `GROKBOT2_JWT_SECRET` **vắng** trong `.env`. Secret ấy **khác** `JWT_SECRET` của cinapi ⇒ cookie
  `cinapi_at` ngoài đó bị `verifyJwt` từ chối. Mã P1 đúng; dây thì chưa nối — và §4 nói vì sao **không
  nên nối bằng cách chép secret**.
- **Biến môi trường 0 trùng tên** giữa hai bên ⇒ để riêng, không gộp file cấu hình.
- **pnpm workspace `services/*` không vơ nhầm** một thư mục `services/cinapi` (gốc cinapi không có
  `package.json`) — đã kiểm.
- **cinapi có sẵn `GET /api/v1/me`** nhận cookie (`RequireAuthOrAPIKey`, `router.go:121`), và
  **quyết định nguồn tiền** nằm ở `internal/service/call/service.go:184`:
  lệnh **không mang API key** mặc định `funding=plan` (tiêu hạn mức gói); có API key ⇒ ép `payg`; web tự
  hạ xuống `payg` được, chiều ngược lại không bao giờ. **Grok Local có người dùng đăng nhập thật, nên nó
  gọi bằng cookie và tiêu đúng gói** — luật *"không dùng được từ API key"* không cản nó.

---

## 2. "Chung BE" có ba nghĩa — chỉ hai nghĩa làm được

| "chung BE" nghĩa là… | làm được? | vì sao |
|---|---|---|
| **một process / một ngôn ngữ** | ❌ | Go 20.7k dòng (chính là hệ gói vừa xong, trong CRITICAL ZONE) so với Node. "Gộp" là viết lại một bên — tức vứt việc vừa làm |
| **một repo · một lệnh deploy · một chỗ lùi bản** | ✅ | `git subtree` + nới `deploy.sh` của grokbot2 |
| **một danh tính · một ví — người dùng thấy MỘT hệ** | ✅, và là thứ **duy nhất người dùng cảm nhận được** | nginx đã chung; thiếu login + billing đi chung |

Hình dạng đích (giữ từ bản cũ, vẫn đúng):

```
       ┌──────────────── một domain, nginx định tuyến ────────────────┐
  Next.js cinAPI FE  ──cookie cinapi_at──▶  cinAPI Go BE  ──▶ pool + provider khác
  (login · gói · Studio)                        │  (auth · gói/ví · calls · SSE)
       │                                        ▲
  Grok Local (desktop) ──cookie cinapi_at──▶ grokbot2 Node BE ──┘ brain qua /api/v1/calls
                                     (roster · transcript · tool · MCP · box · routine)
```

Một nguồn sự thật cho **danh tính** (cinAPI users), cho **tiền** (cinAPI gói + ví); grokbot2 giữ nguồn
sự thật cho **hội thoại/agent** (SQLite). Kho chứa: **grokbot2** — vì nó có kỷ luật release/lùi bản,
bảng theo dõi nạp mỗi phiên, runner test cách ly; cinapi hôm nay không có lùi bản và đang sửa tại chỗ.

---

## 3. Năm bước — mỗi bước một cổng đo, và thứ tự không đảo

### Bước 0 · Chốt LUẬT, chưa gõ code — *quyết định của chủ dự án, chưa duyệt*

- `/opt/cinapi` **thôi là chỗ sửa mã**. Mọi thay đổi đi `máy local → repo grokbot2 → deploy.sh`.
- Push 7 commit đang kẹt trên VPS (VPS đã xác thực được với GitHub — đo `ssh -T`).
- **Tắt hoặc trỏ lại** `.github/workflows/deploy.yml` của cinapi. Hai đường deploy cùng sống là bản cũ
  mọc lại trong im lặng — đúng bẫy *"một danh sách sống ở HAI nơi"* của bảng theo dõi §7.
- Đây là bước đổi **thói quen** của phiên làm việc song song trên cinapi, không phải bước kỹ thuật.
  Merge sống hay mục quyết ở đây.

**Cổng:** `git -C /opt/cinapi log origin/main..main` = 0; CI của cinapi không còn kích khi push.

### Bước 1 · Một repo

`git subtree add --prefix=services/cinapi <remote cinapi> main`. Giữ nguyên Go module + Next FE,
**không sắp xếp lại thư mục**. `cinapi/CLAUDE.md` và CRITICAL ZONE đi theo và **vẫn có hiệu lực**
(`billing/lifecycle.go` · `call/service.go` · `auth/jwt.go` · `middleware/{auth,apikey}.go` là vùng
dừng-hỏi). Giá: +70 MB lịch sử, hoặc `--squash` để bỏ lịch sử — *chủ dự án chọn*.

**Cổng:** `pnpm install` ở gốc không đổi lockfile; `services/cinapi/backend` `go build ./...` xanh;
`git archive HEAD` chở đủ 920 tệp.

### Bước 2 · Một con đường deploy

Nới `infra/vps/deploy.sh`: sau bước build web, `docker build` hai image từ
`$NEW/services/cinapi/{backend,frontend}` **gắn tag `$STAMP`**, rồi gọi chính
`services/cinapi/deploy.sh` với tag ấy — nó đã là nguồn sự thật cho cờ container (`--add-host`,
`--entrypoint /worker`, mount uploads, chỉ bind loopback). `rollback.sh` lùi = tag của bản trước +
chạy lại `deploy.sh`. Cổng health thêm `:8080` và `:3002`. `/etc/cinapi/app.env` giữ nguyên chỗ.

**Cổng:** một lần deploy từ máy local đổi được chữ trên `cinai.app/` **và** `cinai.app/agent/`; một
lần `rollback.sh` đưa cả hai về bản trước; `docker ps` đúng 3 container `cinapi-*` với tag `$STAMP`.

### Bước 3 · Một danh tính (login) — cách (C), xem §4

Đường của app gốc **không quan tâm website là ai** (§5): app mở `{website}/loginDeepControl`, người
dùng đăng nhập **trên web**, web bấm duyệt, app hỏi vòng `/auth/poll` lấy token. grokbot2 đã dựng đủ
ba bước (`noteLoginOpened` → `POST /auth/approve {uuid, token}` → `claimLogin`, PKCE S256). Việc cần
làm đúng hai chỗ:

1. `/loginDeepControl` **đưa người dùng tới trang đăng nhập của cinapi** thay cho `/app/` của grokbot2.
   Cùng domain `cinai.app` ⇒ cookie `cinapi_at` tự có mặt, không OAuth chéo, không CORS.
2. `POST /auth/approve` **xác minh bằng cách hỏi cinapi `GET /api/v1/me`** với cookie ấy, thay cho
   `verifyJwt` cục bộ; `owner` của grokbot2 = `sub` của cinapi. `auth-gate.checkAuth` và
   `ownerFromRequest` dùng **cùng một hàm hỏi** (bài học P1: hai lớp, sửa một là hở một).

**Cổng:** máy mới đăng nhập bằng tài khoản cinai.app → bảng Settings → Computer hiện đúng máy (chính
`e2e-may-lan-dau` đổi danh tính đầu vào sang cookie cinapi); tài khoản B không thấy bot/máy của A.

### Bước 4 · Một ví (billing)

Cửa billing trong `startTurn` (`billing.ts`) đổi thành gọi cinapi `POST /api/v1/calls` **với cookie
người dùng — không bao giờ bằng API key** ⇒ `funding=plan`, tiêu đúng Starter/Pro/Max/Ultra. Streaming
qua SSE `call_delta {call_id, text, seq}`. **Không đi `/api/v1/messages`** — `compat.go` ghi rõ nó
*chạy xong mới phát*, giết streaming token-level đang có. Sau đó `GROKBOT2_BILLING=off`, gỡ kho plan +
webhook + `/v1/register` của grokbot2. `pool-key.txt` dùng chung hết vai trò — **tiền đi theo người**.

**Cổng:** một lượt chat trên Grok Local làm `cycle_credits_spent` của đúng người ấy tăng trong
`/me/usage`; gói cạn ⇒ app khoá đúng cách app gốc khoá (§5); không có lượt nào trừ hai lần.

### Bước 5 · Dọn

Gỡ trang login `/app/`, `web-auth.ts` register/login riêng, kho `cinapi` trên Desktop (hoá thạch),
`_archive-quanly`. nginx gần như không đổi — nó đã đúng hình từ đầu. "Trang Agent trong FE cinAPI" (P3
bản cũ) **hạ ưu tiên**: từ 20/08 giao diện sản xuất là client desktop, `apps/grokbot-web` chỉ là
fallback — không có gì để chép sang Next.js.

---

## 4. Quyết định danh tính: chọn (C) "hỏi cinapi", không dùng chung secret

Token HS256 là **một con dấu cao su**: ai cầm con dấu thì vừa **kiểm** được dấu thật, vừa **đóng**
được dấu mới — hai việc không tách ra được.

| | (A) dùng chung `JWT_SECRET` | (B) chìa riêng, grokbot2 chỉ cầm bản đối chiếu | **(C) không cầm gì — hỏi cinapi `/api/v1/me`** |
|---|---|---|---|
| kiểm được cookie cinapi | ✅ | ✅ | ✅ (một HTTP loopback, cùng máy, < 1 ms; nhớ vài phút) |
| grokbot2 đúc được token cinapi | **✅ — đó là lỗ**: một lỗi/rò ở grokbot2 = mất trọn tài khoản cinapi. `purpose` chỉ chặn *nhận nhầm* loại token, không chặn *đúc* | ❌ | ❌ |
| cinapi phải sửa gì | 0 | **`auth/jwt.go` — CRITICAL ZONE**, đổi thuật toán ký + phát khoá công khai | **0** |
| đổi secret | hai bên cùng lúc | cinapi tự | cinapi tự |
| logout-all xuyên biên | ❌ | ❌ | ✅ tự nhiên (hết cache là hỏi lại) |

Bản 23/08 đề xuất (A) *"nhanh và offline"*. Đo hôm nay: (A) đang **không chạy** (hai secret khác nhau),
và cách chữa nó — chép secret — là cách duy nhất trong ba cách tạo ra một chỗ rò mới. **(C)** là ý
"riêng" đúng nghĩa mà không đụng CRITICAL ZONE: grokbot2 không giữ gì để mà rò. Cửa `/me` đã có sẵn,
đúng cái §4.2 bản cũ định để tới P5.

---

## 5. Đường của app gốc ↔ cinapi — bảng mapping

Đã trích từ bundle hãng (22/08–03/09; `packages/grokbot-proto/src/bootstrap.ts`, `device-login.ts`,
trí nhớ `grokbot-vendor-monetization`). Triết lý của họ: **app không có giá, không có trang thanh
toán, không có Stripe** — chỉ bốn "ổ cắm" server điền, mọi thứ tiền nong ở website
(`cursor.com/dashboard/spending#included-in-pro` chính là đích của `dashboard_url`).

### Login

| bước của app gốc | Cursor | cinai.app |
|---|---|---|
| app sinh `verifier`/`challenge`/`uuid`, mở `{website}/loginDeepControl?challenge&uuid&mode=login&redirectTarget=sand` | website = cursor.com | website = `cinai.app` → nginx → grokbot2 → **chuyển tới trang đăng nhập cinapi** |
| người dùng đăng nhập trên web | tài khoản Cursor | tài khoản cinapi (email/Google/2FA — của họ, không chép) |
| web **duyệt** phiên | server Cursor | `POST /auth/approve {uuid}` + cookie → grokbot2 hỏi `/api/v1/me` → `approveLogin(uuid, {sub,email})` |
| app hỏi vòng `GET /auth/poll?uuid&verifier` | token Cursor | token grokbot2 (ticket cổng như hiện nay), `owner = sub` cinapi |

### Billing — bốn ổ cắm

| app gốc gửi gì cho client | Cursor điền bằng | cinai.app điền bằng (`GET /api/v1/me/usage` + DTO gói) |
|---|---|---|
| **Khoá / mở** — `GetSandAccessStatus.state` ∈ {`GRANTED`, `PAYMENT_REQUIRED`}; `purchase_channel` | trạng thái sub; channel *manage on web* | gói `status` + còn `credits_remaining` / `window_remaining` / `week_remaining` > 0; channel **luôn `MANAGE_ON_WEB`** (3) — đúng cách cinai làm |
| **Thanh "included usage"** — `usage_percent` · `current_period_start` · `next_reset_timestamp_utc` · `grok_plan_label` · `has_available_usage` | *Included in Pro* | `cycle_credits_spent / monthly_credits` · `period_start` / `period_end` · `plan.name` (Free · Starter · Pro · Max · Ultra) · ba số còn > 0 |
| **Khối On-Demand** — `on_demand_settings {visible, eligible, enabled, dashboard_url}` | *Extra usage* + link `dashboard/spending` | Extra Usage / trả-theo-dùng của cinai; `dashboard_url` = **`https://cinai.app/vi/subscription`**; `enabled` = người dùng đã bật payg |
| **Nút khi bị chặn** — `ErrorButton{url}` · `SandUpgradeRecommendation{cta, supporting_text, kind}` | *Upgrade* → cursor.com | *Lấy gói Starter* → `cinai.app/vi/subscription`; `supporting_text` = *"hết N credit cửa sổ 5 giờ, mở lại lúc …"* (`window_reset_at`) |

Ba điều cần nhớ khi nối:

- **App chỉ có MỘT thanh %**, còn cinai có ba trần (tháng · cửa sổ 5 giờ · tuần). Hiện **trần đang bó
  nhất** (gần cạn nhất), hai trần kia nói bằng `supporting_text`. Phạt vẫn đúng ở server.
- **Trả thiếu tốt hơn trả bịa** (chú thích `bootstrap.ts`): FE tự ẩn khối khi trường vắng — không có
  `on_demand_settings` thì khối On-Demand biến mất, không lỗi. Chỉ phát khi có số thật từ `/me/usage`.
- Mọi trường trên là của **hãng** — bản cập nhật client có thể dời chúng (ROADMAP R1/R2). Đo lại bằng
  `kiem-reply-0-43` sau mỗi lần lên bản client.

Trạng thái thật trong grokbot2: ổ cắm nào cũng **đã có**. `GetSandAccessStatus` trả *GRANTED*; thanh
usage có ba nhánh (billing tắt · plan không trần · plan có trần); `dashboard_url` **biết chỗ đặt mà
chưa đặt** — chú thích ghi *"chưa có trang thanh toán để trỏ tới"*. Giờ có rồi. Việc còn lại là nối
dây: số lấy từ `/me/usage`, hai URL trỏ về `cinai.app/vi/subscription`.

---

## 6. Còn của chủ dự án quyết

1. **Bước 0** — thôi sửa `/opt/cinapi` tại chỗ, push 7 commit, tắt CI cinapi. Chưa duyệt; bản viết
   lại này **không** thay cho lời duyệt đó.
2. **Subtree giữ lịch sử (+70 MB) hay `--squash`.**
3. **Thứ tự** login (bước 3) trước billing (bước 4) — hay ngược.
4. (từ bản cũ, vẫn mở) Bot/agent của grokbot2 có thành "model" trong catalog cinAPI không — không cần
   cho bước 1–4, đổi hình bước 5.

---

## 7. P1 — lịch sử đo 23/08 (giữ nguyên, kèm một dòng sửa)

`verifyJwt` kiểm `purpose` (cinAPI phát 5 loại token cùng secret: `access` · `email_verify` ·
`password_reset` · `2fa_pending` · `step_up` — chỉ `access` được vào); `cinapiCookieUser` đọc cookie
`cinapi_at` ở **cả hai lớp** (`auth-gate.checkAuth` và `ownerFromRequest`); `auth-cinapi.test.ts`
10/10. Nghiệm trên stack dev với token dựng bằng chính `jwt-secret.txt` của backend — 5/5: cookie
`purpose=access` → 200 roster rỗng · cùng token ở `Bearer` → 200 · `purpose=password_reset` → **401** ·
không credential → 401 · ticket cổng desktop → 200, 8 bot.

> **Dòng sửa 09/09:** phép nghiệm ấy dựng token bằng **secret của grokbot2**, nên nó chứng minh *mã*
> nhận cookie đúng hình — không chứng minh cookie **thật của cinapi** đi qua. Trên VPS thì không đi qua
> (hai secret khác nhau, §1). Bước 3 thay `verifyJwt` bằng hỏi `/me`, và cổng đo phải dùng cookie do
> **cinapi** phát.

Hai bài học của lượt 23/08 vẫn đúng: *sửa một lớp là chưa xong, chỉ phép đo nói ra* (cookie 401 trong
khi cùng token ở header 200 — hai lớp riêng); *một bài kiểm kỳ vọng sai thì vô nghĩa* (desktop không
gửi rỗng, nó gửi ticket cổng).

---

## 8. Luật cho việc hợp nhất

- **Không sửa CRITICAL ZONE của cinAPI** (billing/wallet · provider orchestration · auth · SSE bus).
  Mọi thay đổi nằm phía grokbot2; phía cinAPI chỉ thêm trang/route mới. Subtree không nới luật này.
- **Không chép secret của cinAPI sang grokbot2** — dùng (C). Một bí mật ở hai nơi là hai chỗ rò.
- **Không sửa `/opt/cinapi` tại chỗ** sau bước 0; **không sửa migration đã áp** — chỉ thêm file mới.
- Mỗi bước có **một phép nghiệm chạy trên stack thật**, không phải "đã viết xong"; bước 3 và 4 đo bằng
  **cookie do cinapi phát**, không phải token tự dựng.
- Grok Local gọi cinapi **bằng cookie người dùng, không bằng API key** — đó là điều kiện để tiền rơi
  vào túi gói (`funding=plan`).
- Hợp đồng `/v1` của grokbot2 là ranh giới: bên ngoài chỉ nói với nó qua `packages/api-contract`.
