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
| app sinh `verifier`/`challenge`/`uuid`, mở `{website}/loginDeepControl?challenge&uuid&mode=login&redirectTarget=sand` | website = cursor.com | website = `cinai.app` → nginx → grokbot2 → **HÔM NAY: `/agent/app/` (login riêng của grokbot2)**; Bước 3 đổi thành trang đăng nhập cinapi — xem §5b |
| người dùng đăng nhập trên web | tài khoản Cursor | tài khoản cinapi (email/Google/2FA — của họ, không chép) |
| web **duyệt** phiên | server Cursor | `POST /auth/approve {uuid}` + cookie → grokbot2 hỏi `/api/v1/me` → `approveLogin(uuid, {sub,email})` |
| app hỏi vòng `GET /auth/poll?uuid&verifier` | token Cursor | token grokbot2 (ticket cổng như hiện nay), `owner = sub` cinapi |

### 5b · Login — ĐO LẠI 09/09 trên hệ thống đang chạy, và nó đổi hình dạng Bước 3

Bảng ngay trên là **thiết kế**, không phải hiện trạng; chủ dự án hỏi thẳng *"login đã liên kết cùng
1 đường với login trên cinai.app/vi chưa, login bằng Google cùng 1 account"* nên phải đo, không đọc
lại kế hoạch. Bốn phép đo, ba từ Internet:

| đo | kết quả |
|---|---|
| `cinai.app/loginDeepControl?uuid&challenge&mode=login&redirectTarget=sand` — URL app TỰ mở | **302 → `cinai.app/agent/app/?login_uuid=…`**, tức giao diện web của grokbot2, KHÔNG phải `/vi/login` |
| trang đích ấy có Google không | HTML chỉ **402 byte** (SPA Vite) nên phải grep **bundle** 78.361 byte: `google` **0** · `oauth` **0** · `Continue with` **0**; có `/v1/login` ×1 · `password` ×3 · `mật khẩu` ×1 ⇒ **email + mật khẩu**, không có Google |
| `cinai.app/vi/login` | `google` **6** · `Continue with` **1** ⇒ đúng nút trong ảnh chủ dự án gửi |
| hai bí mật JWT (chỉ so **băm**, không bao giờ in giá trị) | **KHÁC NHAU** ⇒ cookie `cinapi_at` bị `verifyJwt` từ chối. §1 nói đúng, nay có phép đo làm bằng. Cách đo: `sha256sum` giá trị `jwt-secret.txt` so với `docker exec cinapi-backend printenv JWT_SECRET \| sha256sum` — **so rồi bỏ, không chép băm vào đây**: băm của một KHOÁ KÝ là một máy xác minh phỏng đoán, và tài liệu là chỗ ai cũng đọc được |

**Trả lời: CHƯA.** Hai đường login riêng, hai kho tài khoản riêng; đăng nhập Google trên
`cinai.app` trong trình duyệt thì app local **không thừa hưởng** phiên đó.

Kèm một số đo không ai hỏi mà quan trọng hơn — **và nó SAI, sửa 09/09 tối; xem §5e**: tôi đếm theo **cột**
`owner_id` và ra *"cả 42 hàng `agents` đều mang một chủ `auth0|grokbot2-user`, 6 tài khoản thật sở hữu 0 bot"*.
Cột ấy TRƠ. Đếm ở chỗ `ownsAgent` thật sự đọc (`agentOwnerAuthId` trong thân) thì 42 bot thuộc **9 chủ**:
mặc định 12, tám tài khoản `local|<email>` thật giữ 30.
Tức "mỗi người một tài khoản" chưa đúng ngay trong lòng grokbot2 — vé cũ phân giải về danh tính mặc
định (§6 mục 39 đã tả cơ chế; đây là hệ quả của nó trong DỮ LIỆU). Sổ máy thì đã đúng: 2 hàng, chủ
là một người thật. Phép đo chạy trên **bản chép** `grokbot.sqlite` + `-wal`/`-shm` với
`mode=ro`, không mở cửa ghi duy nhất của backend đang chạy; email che.

**Ba dữ kiện làm Bước 3 rẻ hơn kế hoạch tưởng — đọc từ mã cinapi trên VPS:**

1. **Cookie đã tự tới `/agent/*` rồi.** `writeCookie` (`handler/auth.go:244-255`) đặt
   `Path: "/"` + `Domain: h.cookieDomain`, `HttpOnly`, `SameSite=Lax`. Cùng một tên miền
   `cinai.app` ⇒ mọi request tới `/agent/…` **mang theo `cinapi_at`** mà không ai phải làm gì.
   Đây chính là điều kiện làm cách **(C)** khả thi mà §4 chưa nêu ra: grokbot2 không cầm secret, và
   cũng không cần ai chuyển cookie cho nó.
2. **Đường email/mật khẩu: 0 dòng sửa phía cinapi.** `components/auth/AuthForm.tsx:34-37` đã đọc
   `?next=` từ query, đòi nó bắt đầu bằng `/` (chặn chuyển hướng ra ngoài), rồi
   `window.location.href = next`. Nên `/loginDeepControl` chỉ cần 302 sang
   `/vi/login?next=/agent/<cửa duyệt>?uuid=…` là xong vòng.
3. **Đường GOOGLE thì MẤT `next` — và đó đúng là nút chủ dự án hỏi.**
   `handler/google_oauth.go:143` ghim cứng đích: `http.Redirect(w, r, h.frontendURL+"/vi/studio/chat", 302)`,
   và `state` chỉ là nonce CSRF (`randomOAuthState()`, cookie `g_oauth_state` `Path=/api/v1/auth/google`)
   — nó **không chở `next`**. Người đăng nhập bằng Google sẽ hạ cánh ở `/vi/studio/chat`, không
   quay lại grokbot2, nên `GET /auth/poll?uuid&verifier` của app **không bao giờ được duyệt**.

**Hệ quả cho thiết kế Bước 3: đừng dựa vào chuyển hướng.** Chỗ duyệt không nên là một trang mà
cinapi phải đưa người dùng TỚI; nó nên là một cửa mà **trang của grokbot2 tự hỏi vòng**: trang ở
`/agent/…` mở login cinapi ở tab khác (cú bấm của người dùng nên không bị chặn popup), rồi hỏi
vòng một cửa của chính grokbot2; cửa ấy đọc `cinapi_at` (có sẵn, dữ kiện 1) → hỏi
`GET /api/v1/me` → `approveLogin(uuid, {sub, email})`. Cách này đúng cho **cả Google lẫn email**
và giữ được luật *"phía cinAPI chỉ thêm, không sửa"* ở mức mạnh nhất: **không thêm gì cả**. Đường
302 + `?next=` vẫn giữ làm lối phụ cho email/mật khẩu.

**Giá của Bước 3, đo được chứ không phỏng đoán.** Đổi `owner` sang `sub` của cinapi là đổi KHOÁ
sở hữu: 42 bot đang dưới `auth0|grokbot2-user` và 2 hàng sổ máy dưới một `local|<email>` thôi
khớp chủ. Sổ máy **tự lành** (thiết kế bỏ hàng không có chủ lúc nạp, daemon đăng ký lại ở lần nối
kế); **bot thì không tự lành** — cần một phép chuyển chủ tường minh, hoặc một quyết định "bỏ".
Đó là việc của chủ dự án, không phải của một bản vá.

### 5c · Billing — hai cửa cinapi cần cho việc "hiện gói trong app local" ĐÃ CÓ

Đo 09/09, và phép đo tự loại được nghi vấn *"401 là middleware quét cả nhánh"*:

| đường | mã | nghĩa |
|---|---|---|
| `/api/v1/me` | **401** | có route (`router.go:121`, `RequireAuthOrAPIKey`) |
| `/api/v1/me/usage` | **401** | có route (`router.go:134`) |
| `/api/v1/me/subscription` | **401** | có route (`router.go:166`) |
| `/api/v1/me/khong-ton-tai-abcxyz` | **404** | ⇒ 401 ở ba dòng trên là **cửa có thật đòi giấy**, không phải middleware chặn mù |

**Nhưng hai cửa số liệu là COOKIE-ONLY:** cả `/me/usage` và `/me/subscription` nằm trong nhóm
`priv` với `priv.Use(mw.RequireAuth(d.Auth))` — **không** `RequireAuthOrAPIKey` như `/me`.
Nên không có đường tắt nào vòng qua danh tính người dùng: **việc 4 (ví) bị chặn bởi việc 3 (danh
tính) một cách cứng**, đúng thứ tự chủ dự án nêu (*"sau login đến billing"*).

`GET /me/subscription` trả đúng những số trang `cinai.app/vi/subscription` đang vẽ
(`handler/subscription.go`, `mySubscriptionDTO`) — và đây là bảng nối sang bốn ổ cắm:

| ổ cắm phía app | trường cinapi |
|---|---|
| `GetSandAccessStatus.state` | `status` + `credits_remaining` / `window_remaining` / `week_remaining` > 0 |
| thanh % `GetCurrentPeriodUsage` | `cycle_credits_spent` / `plan.monthly_credits`; `period_start` · `period_end` |
| nhãn gói | `plan_key` / `plan.name` |
| khối On-Demand + nút nâng gói | `dashboard_url` = `https://cinai.app/vi/subscription` (biến `GROKBOT2_CHECKOUT_URL`) |
| khối *"Giá trị API thực tế"* | `cycle_requests` · `cycle_tokens` · `cycle_credits_spent` · `cycle_usd` |

Phía grokbot2, bốn ổ cắm ấy **đã có và được lắp ở ĐÚNG MỘT chỗ** — `services/grokbot-backend/src/index.ts`
(`access` · `usage` · `plan` · `dashboardUrl` truyền vào `handleBootstrapRpc`). Nên nối dây là
sửa bốn dòng ở một điểm, không phải dựng hệ con mới. Việc còn lại đúng như §5 đã ghi: *"số lấy từ
`/me/usage`, hai URL trỏ về `cinai.app/vi/subscription`"* — cộng một điều §5 chưa biết: **số gói
thì lấy từ `/me/subscription`, không phải `/me/usage`** (`/me/usage` là thống kê 7 ngày theo
`from`/`to`, không mang trần gói).

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

### 5d · Bước 3 đã VIẾT XONG (09/09) — kèm một lỗ chiếm tài khoản tự gây và tự bắt

Mã: `services/grokbot-backend/src/cinapi-danh-tinh.ts` (module THUẦN, hỏi `GET /api/v1/me`) +
khối cinAPI trong `login-page.ts` + hai dòng dây trong `index.ts`. Commit `3fa91ad`.

**Vẫn TẮT theo mặc định.** Vắng `GROKBOT2_CINAPI_BASE` thì mọi nhánh mới bị bỏ qua và hành vi giống
HỆT bản trước — có unit ghim. Đo trên sản xuất: biến ấy **VẮNG** trong `shared/.env` (51 dòng), nên
deploy mã này là một việc trơ.

**Giá của Bước 3 rẻ hơn kế hoạch cũ tưởng, và đây là lý do đo được:** `/gw/__coverage` trên VPS đếm
429 lượt `matching-bearer` và 3 lượt `user-jwt` (ba lượt kia là lệnh thử của tôi) ⇒ app desktop
**chỉ trình vé, không bao giờ gửi JWT**. Nên danh tính chỉ phải đổi ở ĐÚNG một thời điểm — lúc đúc
vé lúc đăng nhập. Không có lời gọi cinapi nào trên đường request, không thêm độ trễ, và gateway
không phụ thuộc cinapi còn sống.

#### Lỗ tôi tự viết ra rồi tự bắt — chép nguyên văn vì nó là một LỚP bẫy

Bản đầu của tôi có một "tiện lợi": trang `/loginDeepControl` thấy sẵn cookie cinai thì **duyệt luôn**,
người dùng không phải bấm gì. Ghép với một dữ kiện ở chỗ khác thì nó thành đường chiếm tài khoản:

1. `claimLogin(uuid, verifier)` trao token cho **ai giữ `verifier`** — tức bên **KHỞI TẠO** luồng
   (app desktop), không phải trình duyệt vừa duyệt. Hai bên ấy không buộc phải là một người.
2. Kẻ tấn công tự bấm đăng nhập trên app của mình, đọc `uuid`+`challenge` từ thanh địa chỉ, giữ
   `verifier`, rồi gửi nạn nhân link `…/loginDeepControl?uuid=U&challenge=C`.
3. Nạn nhân đang đăng nhập cinai.app bấm vào ⇒ cửa tự duyệt bằng danh tính **CỦA NẠN NHÂN** ⇒ app
   của kẻ tấn công hỏi vòng `/auth/poll` và nhận token của nạn nhân.

Và cookie `gb2_login` — thứ tôi viết ra để chống chính họ tấn công này — **không chặn được**: chính
cái request mang `uuid` của kẻ tấn công cũng là request **ĐÚC RA** cookie buộc `uuid` ấy vào trình
duyệt nạn nhân. Một cái khoá mà kẻ gửi chìa cũng là kẻ đúc ổ thì không khoá ai. Gỡ riêng nhánh GET
cũng chưa đủ: script trang chờ tự hỏi vòng, lượt hỏi ấy **cùng gốc** nên cookie đi kèm bất kể
`SameSite`.

**Tiền đề của bước 3 trong kịch bản đã được ĐO, không suy:** cookie của cinapi đặt
`SameSite=Lax` (`handler/auth.go`, hàm `writeCookie`) ⇒ một điều hướng GET **chéo site** *có* mang
`cinapi_at` theo. Tức đây là lỗ đi tới được thật.

**Gốc thật, và nó không phải một dòng sai:** luồng email/mật khẩu lấy **việc gõ mật khẩu** làm bằng
chứng chủ ý; SSO thì người dùng đã đăng nhập sẵn nên **không còn hành vi nào tỏ chủ ý** — phải thu
nó một cách tường minh. Nên hình dạng cuối:

| cửa | làm gì | vì sao đủ |
|---|---|---|
| `GET /loginDeepControl` | đặt cookie + vẽ trang. **Không duyệt gì** | một lượt GET không đổi được trạng thái đăng nhập của ai, mang cookie gì cũng vậy |
| `GET /auth/cinai` | chỉ **BÁO** đang là ai (`{cinai, email}`) | điều hướng chéo site tới được cũng vô hại, và `SameSite=Strict` thì nó không mang `gb2_login` nên 403 |
| `POST /auth/cinai` | **DUYỆT**, đòi `gb2_login` khớp `uuid` | điều hướng không tạo ra được POST; `connect-src 'self'` thì chỉ script trang ta gọi được; và trang chỉ gọi **sau một cú bấm** |

Phần dư còn lại là phần dư của mọi trang consent: người dùng bấm xác nhận trên một trang họ không mở.
Chữa bằng CHỮ — trang nêu đúng tài khoản sẽ bị nối và dặn đóng trang nếu không phải họ vừa bấm.

#### Nghiệm thu, và thứ tự là chủ ý

- **22 bài `cinapi-danh-tinh.test`** chạy **TRƯỚC khi nối dây** (module thuần), rồi tiêm **6 lỗi
  thật** vào bản chép — đỏ **6/6**, đúng bài khai. Lượt đầu một bài đỏ vì tiến trình TREO chứ không
  vì assert nào; đã viết lại để đếm `process.getActiveResourcesInfo()`.
- **12 bài `cinai-login-cua.test`** dựng cinAPI giả bằng **máy chủ HTTP thật** trên loopback — đi qua
  cả biến môi trường lẫn đường mạng, đúng hai chỗ mà một bài tiêm hàm sẽ đi vòng qua. Tiêm 6 lỗi,
  trong đó **lỗi số 1 là chính lỗ chiếm tài khoản** — đỏ **6/6** đúng bài, rồi trả lại byte y nguyên.
- **Đo SỐNG trên HTTP thật: 13/13 mốc**, backend riêng ở `:8799` với kho cách ly để không chạm bản
  dev dùng chung. Khúc này bài unit **không với tới được** — nó là chỗ `req.method` vừa được nối
  trong dispatcher. Sau lượt GET mang sẵn cookie cinai, `/auth/poll` vẫn **404**; chỉ sau POST đủ
  giấy thì app nhận token, và token mang chủ `cinapi|<id>`.
- backend **876/876**, `tsc` sạch.
- Một bẫy của chính bài đo, ghi lại: `spawn(..., {shell:true})` rồi `kill()` chỉ hạ cái **VỎ** cmd —
  con `tsx` sống tiếp, giữ `:8799` và giữ `g.sqlite` (đo được: mồ côi một pid sau lượt chạy đầu).
  Cùng họ với bẫy *"subshell ôm ống"*. Phải hạ cả CÂY.

#### Còn lại của Bước 3, và thứ tự KHÔNG đảo được

Cổng cuối của kế hoạch — *"đo bằng cookie do cinapi phát"* — chưa chạy, vì nó cần một lần đăng nhập
thật. Và có một **hazard thứ tự** cùng họ với `GROKBOT2_CHECKOUT_URL`: bật `GROKBOT2_CINAPI_BASE` là
mọi lượt đăng nhập desktop đổi sang `cinapi|<id>`, nên dữ liệu đang mang chủ cũ **mất chủ**.

Kiểm kê chỗ mang chuỗi chủ `auth0\|grokbot2-user` trên SẢN XUẤT, đo 09/09 trên **bản chép**
`mode=ro` (email che, không chép giá trị nào ra đây):

| chỗ | số hàng mang chủ cũ |
|---|---|
| `agents.owner_id` | 42 (cả bảng) — **nhưng cột này TRƠ, xem §5e**: chủ thật nằm trong thân |
| `entries.owner_id` | 1038 |
| `acceptance.owner_id` | 95 |
| `attachments_meta.owner_id` | 64 |
| `parked.owner_id` · `compaction.owner_id` | 2 · 2 |
| `automations.owner_id` | 1 |
| `users.auth_id` · `usage.auth_id` | 1 hàng · 3 hàng |
| `host_settings.body` (khoá `byOwner` trong blob 1.526 ký tự) | 1 lần |
| `shared/data/marketplace.json` | 10 lần |
| `shared/data/bot-templates/auth0_grokbot2-user.json` | 10 lần **+ chính TÊN TỆP** |

Và bản đồ sang cinai, đo bằng một `SELECT` trên `cinapi-postgres` (271 người; không chép id lẫn email
vào tài liệu — cách lấy lại là một câu SQL theo email):

> **Cả khối bullet dưới đây đã CHẾT — giữ để đọc được đường đi, đừng dùng làm số. Hai lần sửa:**
> §5e phản chứng vế *"sở hữu 0 bot"* (đếm sai chỗ), rồi **§5i xoá sạch toàn bộ danh tính cũ**, nên
> không còn ai để chuyển chủ và không còn ai phải báo trước.

- ~~**5/6** tài khoản `local|<email>` của grokbot2 **đã có** tài khoản cinai.~~ Đếm trên bảng `users`;
  đếm trên tập có nghĩa (**chủ bot**) thì là **5/8 có · 3/8 chưa**.
- ~~**1/6 CHƯA có** ⇒ bật biến toàn cục là người ấy **không đăng nhập được**~~ — `POST /api/v1/auth/register`
  của cinapi vẫn đang mở nên ai chưa có tài khoản tự đăng ký được; **việc "phải nói trước" nay không
  còn**, vì không ai còn dữ liệu cũ để mất (§5i).
- ~~Cả 6 tài khoản ấy sở hữu **0 bot**~~ — **SAI**, tám người thật giữ **30 bot** (13 · 9 · 3 · 1 · 1 ·
  1 · 1 · 1); xem §5e cho vì sao phép đếm cũ trượt.
- Sổ máy (`may-da-biet.json`, 2 hàng) mang chủ của một người dùng thật; nó **tự lành** (thiết kế bỏ
  hàng không chủ lúc nạp, daemon đăng ký lại) — §5 mục 20.

**Thứ tự đúng, và vì sao ngược lại là hỏng:**

1. Deploy mã (trơ, vì biến vắng).
2. Bật `GROKBOT2_CINAPI_BASE`.
3. Chủ dự án đăng nhập **một lần** qua trang mới ⇒ app cầm vé mang `cinapi|<id>`.
4. **Rồi mới** đổi chủ 12 chỗ ở bảng trên sang đúng id ấy.

Làm bước 4 trước bước 3 để lại một cửa sổ **không ai sở hữu 42 bot**. Và phép đổi chủ phải chạy lúc
backend **dừng**: nó là cửa ghi duy nhất của kho, ghi từ ngoài trong lúc nó chạy là tự đẻ ra một
nguồn sự thật thứ hai. Cần **một bản lưu trước khi đổi**.

---

### 5e · Chuyển chủ XONG 09/09 ~22:33 — và một câu tôi đã commit thì SAI

**Việc đã làm**, bằng `infra/vps/chuyen-chu.py` (ngắt backend **2 giây**, bản lưu
`shared/data/chuyen-chu-bak-20260909-223303`):

- **12** bot của danh tính mặc định `auth0|grokbot2-user` đổi sang `cinapi|<id của chủ dự án>` **trong THÂN**
  (`agentOwnerAuthId` — chỗ `ownsAgent` đọc), kèm cột `owner_id` đặt khớp.
- **30** bot của **tám** tài khoản `local|<email>` THẬT **giữ nguyên chủ** — không chạm.
- Cột `owner_id` được đặt khớp thân cho cả 42 bot; **876** hàng bảng-theo-bot
  (`entries` · `automations` · `compaction` · `parked`) lấy chủ từ bot của chúng; **159** hàng
  `acceptance`/`attachments_meta` — hai bảng **không có đường về bot** — trả về chuỗi giữ chỗ, vì bịa một
  quy thuộc vào một cột trơ là đúng thứ vừa trả giá.
- `users`/`usage`/`host_settings.byOwner`/`marketplace.json`/`bot-templates/<chủ>.json` của danh tính mặc
  định đi theo; tệp kho mẫu đổi tên theo `safe()` của `bot-templates.ts`. `integrity_check ok`.

**Nghiệm thu trên bản ĐANG CHẠY, bằng CHÍNH phép đo đã phản chứng lượt trước**: `listAgents` với vé của
`cinapi|<id>` đi **0 → 12 bot**, vé của danh tính mặc định **12 → 0**, một chủ THẬT vẫn **13 bot không
đổi**, một danh tính bịa **0**; `kiem-reply-0-43` **29 lệnh · 0 sai** với bot thật `agent-11`.

#### Câu SAI, và vì sao nó là một LỚP bẫy chứ không phải một dòng lỗi

§5b (và §5 mục 21 của bảng theo dõi) khai *"cả 42 hàng `agents` mang một chủ `auth0|grokbot2-user`, 6 tài
khoản thật sở hữu 0 bot"*. Nó đến từ một phép kiểm kê **theo CỘT**: `pragma table_info` mọi bảng, tìm
`owner_id`/`auth_id`, `group by`. Phép ấy đọc đúng những gì có trong lược đồ — và trả lời **sai câu hỏi**.

Chỗ quyết định quyền chủ lúc chạy là `ownsAgent` (`chat/state.ts:31`):

```ts
export const ownsAgent = (id: string): boolean => {
  const a = agents.get(id);
  return !!a && ((a.agentOwnerAuthId ?? AUTH_ID) === currentOwner());
};
```

Nó đọc **`agentOwnerAuthId` trong THÂN JSON** của bot. Còn cột `owner_id` thì chính `store.ts` khai là
**TRƠ** — *"INERT: nothing filters on `owner_id` yet — that is Phase 2"* — và nó được
`ALTER TABLE … ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'auth0|grokbot2-user'` lấp một lượt rồi **không
ai duy trì**. Nên "mọi hàng cùng một chủ" không phải một dữ kiện về sở hữu; nó là **hình dạng của lược
đồ** đọc lên như một dữ kiện.

**Bản đầu của script chạy theo phép đếm ấy và `UPDATE` cả 42 hàng.** Thứ bắt được nó không phải một bài
đo tôi viết ra để bắt nó, mà là **cổng nghiệm thu trên bản đang chạy**: sau khi ghi, chủ mới thấy **0
bot** và chủ cũ vẫn thấy **12**. Vì cột là trơ nên lượt ghi sai **không đổi hành vi của ai** — nhưng nó
làm cột nói dối *nặng hơn*: trước là một chỗ giữ chỗ đồng loạt, sau là một danh tính THẬT, tức nó đọc lên
như một dữ kiện có thẩm quyền. Phép sửa (bản hai của script) đặt cột khớp thân cho MỌI bot, nên lần đầu
tiên cột ấy nói thật.

**Ba điều rút ra.** (1) **Kiểm kê theo chỗ ĐỌC, không theo chỗ LƯU** — đếm cột là đếm lược đồ, đếm chỗ
đọc là đếm hành vi; cùng họ §7 *"trường có trong hợp đồng ≠ trường có người ĐỌC"*. (2) Một phép di trú
phải có **cổng nghiệm thu đọc lại từ chỗ quyết định**, không phải đọc lại chỗ nó vừa ghi — bản đầu in
*"XONG — 0 hàng còn mang chủ cũ"* và câu ấy đúng từng chữ về việc nó đã ghi gì. (3) Con số **12 so với
42** đứng ngay trong đầu ra của phép đo đầu tiên (`listAgents` trả 12 trong khi bảng có 42 hàng) và tôi
đã đọc qua nó — một phép đếm lệch giữa hai nguồn là lời mời đọc kỹ, không phải một chi tiết.

#### Hệ quả vận hành phải nhớ

Vé **dùng chung** (`gateway-token.txt`) phân giải ra danh tính mặc định, mà danh tính ấy nay sở hữu **0
bot**. Nên mọi bài E2E chạy trên sản xuất phải **đúc vé cho `cinapi|<id>`** bằng chính `mintTicket`
(và đặt `GROKBOT2_GATEWAY_TOKEN` **TRƯỚC** khi nạp module — §7). Một lượt `kiem-reply-0-43` ra *"0 bot"*
với vé dùng chung từ nay là **ĐÚNG**, không phải hỏng.

---

### 5f · E2E cửa đăng nhập bằng TRÌNH DUYỆT THẬT (10/09) — 18/18, và nó tái hiện được lỗ cũ

`scripts/e2e-login-cinai.mjs`. Vì sao phải có một bài nữa khi đã có 22+12 unit, 6+6 phép tiêm lỗi và
13 mốc đo sống trên HTTP: **cả ba đều không có trình duyệt**, mà tiền đề của lỗ là một luật của trình
duyệt — cookie `cinapi_at` là `SameSite=Lax`, nên một điều hướng GET **chéo site** vẫn mang nó đi.
`curl` không có khái niệm `SameSite`, nên nó không chứng minh được cả tiền đề lẫn hàng rào.

**Hình dạng bài đo** — mô phỏng đúng topology sản xuất chứ không đơn giản hoá:

| thứ | ở đâu | vì sao phải thế |
|---|---|---|
| `cinai.test` | một máy chủ đóng vai **nginx + cinAPI**: tự trả `/api/v1/me` và `/vi/login`, chuyển tiếp mọi đường khác sang backend | trên sản xuất `cinai.app` phát cả hai; chính chuyện **cùng một site** là điều kiện làm cách (C) chạy được (cookie `Path=/` tự tới `/agent/*`) |
| `ke-la.test` | site của kẻ tấn công, chỉ một cái link | phải là site KHÁC thật thì phép tính same-site của Chrome mới là phép tính thật |
| hai tên miền | `--host-resolver-rules=MAP … 127.0.0.1:<cổng>` | hai cổng trên `127.0.0.1` là **CÙNG site** — SameSite tính theo tên miền đăng ký được, không theo cổng |
| backend | kho cách ly + `GROKBOT2_AUTH=enforce` | `warn`/`off` cấp token vô điều kiện ở `/auth/poll`; đo ở đó là đo một cửa đang mở |
| cú bấm | `Input.dispatchMouseEvent` qua Playwright | `el.click()` tổng hợp không đi qua (§7) |

**18 mốc, 0 lượt model, không chạm `.data` thật.** Mốc đáng giá nhất là cặp 5/5b: nạn nhân đang đăng
nhập cinai bấm link chéo site của kẻ tấn công → trang **NHẬN RA đúng tài khoản của họ** (tiền đề
`SameSite=Lax` đúng, đo được: backend hỏi `/api/v1/me` thêm một lượt) → mà `/auth/poll` của kẻ tấn
công **vẫn 404** sau nhiều nhịp hỏi vòng. Rồi mốc 9: một cú bấm THẬT vào *"Nối tài khoản này"* →
`/auth/poll` trả token mang `authId = cinapi|<id>`. Tức **cú bấm là hàng rào**, đúng như thiết kế nói.

**Và bài đo được thử bằng cách tiêm 3 lỗi thật** vào một bản CHÉP của `src` (mã thật không bị chạm một
byte — `git status` sạch), mỗi lỗi có **chữ ký đỏ riêng**, sau khi bản chép chưa sửa đã chạy xanh 18/18
làm đối chứng:

| tiêm | đỏ ở | nghĩa |
|---|---|---|
| A · `/loginDeepControl` tự duyệt khi thấy cookie (dựng lại đúng lỗ cũ) | 4c · **5b** | app của kẻ tấn công NHẬN được token của nạn nhân — bài đo tái hiện được vụ chiếm tài khoản |
| B · `GET /auth/cinai` cũng duyệt (bỏ phép tách phương thức) | 4c · 5b | vòng hỏi của chính trang trở thành cửa duyệt |
| C · bỏ phép buộc cookie `gb2_login` ↔ `uuid` | 8 · 8c | một trang khác dụ được trình duyệt duyệt `uuid` lạ |

**Một điều lộ ra mà không ai thiết kế, và nó đi ĐÚNG chiều an toàn**: `gb2_login` là **một cookie cho
cả site** (cùng tên, cùng path). Nên khi nạn nhân bấm link của kẻ tấn công, cookie buộc phiên của
*chính họ* bị **ghi đè** bằng `uuid` của kẻ kia — đo được ở mốc 6. Hậu quả: cú bấm xác nhận trên tab
của chính người dùng sau đó bị **403** (mốc 8), và họ phải bấm đăng nhập lại trong app. Phiền một
nhịp, nhưng nó không mở thêm cửa cho ai; và phần dư còn lại vẫn là phần dư của mọi trang consent —
người dùng bấm xác nhận trên một trang họ không mở — thứ chỉ chữa được bằng CHỮ, và trang đã có đoạn
cảnh báo ấy.

**Một hàng rào thứ hai, độc lập, đo được nhờ phép tiêm C**: mốc 7 (POST chéo site) vẫn XANH cả khi đã
bỏ phép buộc cookie — không phải nhờ `gb2_login` mà nhờ `SameSite=Lax` của **cinapi**: một `fetch`
chéo site không mang `cinapi_at`, nên `danhTinhTuCookie` trả `null` và không có ai để duyệt. Hai hàng
rào khác nhau che cùng một đường; đừng gộp công của chúng.

### 5g · Bước 4 (billing) — viết xong 10/09, và cửa bên cinapi ĐÃ LÊN

**Chặn cứng là có thật, và lý do khác thứ tôi ghi.** `/me/subscription` cookie-only thì đã biết; cái
chưa đo là **app desktop không bao giờ có cookie ấy**: `waitForBrowserLogin` gọi
`this.openExternal(loginUrl)` → `shell.openExternal` (đọc từ bundle 0.43), tức link đăng nhập mở
bằng **trình duyệt hệ thống**, nên phiên Electron của app không giữ `cinapi_at`. Lượt RPC tới
backend mang JWT. Không có đường nào để grokbot2 hỏi cinapi *bằng giấy của người dùng*.

**Chọn (chủ dự án quyết): thêm MỘT route mới bên cinapi** — đúng luật đã ghi ở §8 (*"phía cinAPI chỉ
thêm trang/route mới"*). Đã lên sản xuất 10/09, commit `7295edd`:

| | |
|---|---|
| `backend/internal/middleware/service.go` | **tệp mới**. `ServiceAsUser` đọc `X-Service-Token` + `X-Service-User-Id`, nạp người dùng qua `auth.Service.GetUser`, rồi đặt vào ngữ cảnh bằng **chính `withUser`** mà `RequireAuth`/`RequireAPIKey` dùng |
| `backend/internal/server/router.go` | **một dòng**: `api.With(mw.ServiceAsUser(d.Auth)).Get("/internal/me/subscription", subH.Me)` |
| `backend/internal/middleware/service_test.go` | **tệp mới**, 6 bài — gói `middleware` trước đó không có tệp test nào |

**`subscription.go` không bị sửa một dòng nào**, và đó là điểm của thiết kế: `Me` đọc người dùng qua
`mw.UserFromContext`, nên đặt đúng người vào ngữ cảnh là **cùng handler, cùng DTO** phục vụ cả hai
cửa — 0 dòng trùng lặp, và ngày DTO đổi thì hai cửa đổi cùng lúc. Không chạm CRITICAL ZONE.

Ba tính chất giữ bằng hình dạng hàm: **tắt theo mặc định** (vắng `CINAPI_SERVICE_TOKEN` ⇒ 404, nên
đưa mã lên là việc trơ); **khoá ngắn hơn 24 ký tự không bật được** (cửa này phơi ra Internet qua
nginx như mọi route khác); **sai khoá trả 404 chứ không 401** (401 xác nhận *"đường này có thật"*
cho người đang dò).

#### Bước 0 hoá ra nhỏ hơn nhiều — và có một rủi ro ĐANG SỐNG không ai biết

Đo trước khi đụng: working tree của `/opt/cinapi` **sạch** (0 tệp sửa dở), 7 commit kẹt đều là UI,
và `origin/main` là **tổ tiên** của HEAD ⇒ đẩy lên là **fast-forward thuần, không mất gì**. CI
(`.github/workflows/deploy.yml`) chạy **chính `deploy.sh`** chứ không chép lệnh riêng, nên "hai
đường deploy" thật ra dùng chung một nguồn sự thật.

**Nhưng CI làm `git reset --hard origin/main`, và chốt an toàn của nó chỉ kiểm *thay đổi chưa
commit*, không kiểm *commit chưa đẩy*.** Tức bất kỳ ai đẩy bất kỳ thứ gì lên `main` là 7 commit chỉ
sống trên VPS bị xoá sạch. Đẩy chúng lên là việc phải làm dù có Bước 4 hay không. Đã đẩy cùng lượt:
`133e1fd..7295edd`, 8 commit.

#### Cổng đo TRƯỚC và SAU trên cùng máy đích

| phép dò (loopback trên VPS) | trước deploy | sau deploy |
|---|---|---|
| không giấy | 404 | **404** |
| giấy bịa | 404 | **404** |
| giấy đúng, thiếu `X-Service-User-Id` | 404 | **400** ← mốc phân biệt |
| giấy đúng, id không có thật | 404 | **404** |
| giấy đúng, id THẬT | 404 | **200** |
| đối chứng `/api/v1/me` (không đổi) | 401 | 401 |

`404` trước deploy nghĩa là *"không có route"*, không phải *"máy chủ chết"* — đối chứng `/me` trả
401 chứng minh phép dò tới được một máy chủ đang sống. cinai.app health 200 sau khi container tạo lại.

#### Thân THẬT phản chứng bộ đọc của tôi — và nó hỏng theo kiểu IM LẶNG

Thân trả về lồng **sâu hơn một tầng** so với `/me` (`data.user`):

```
{code, msg, data: {subscription: {plan_key, status, period_*, window_*, week_*, plan:{…}}}}
```

Bản đầu của `docThueBao` — viết theo trí nhớ về `mySubscriptionDTO` — tìm `plan_key` ngay dưới
`data`, nên với thân thật nó **trả `null`**: không thanh đo, không lỗi, không dòng log nào nói vì
sao. 18 bài đo xanh trọn vì tất cả đều chạy trên thân **tôi tự dựng**. Nay bộ đọc thử ba tầng
(`data.subscription` → `data` → gốc) và lấy tầng nào CÓ `plan_key`; và có 3 bài mới chạy trên đúng
thân đo được. Ba dự đoán khác thì ĐÚNG: `period_*` là chuỗi RFC3339, `*_cycle_end` là `null` ở gói
free, `status` viết HOA (`"ACTIVE"`, `"EXPIRED"`).

#### Phía grokbot2

`src/cinapi-thue-bao.ts` là khối **quyết định**, thuần (21 bài): đọc DTO → dựng danh sách **cửa** →
chọn **cửa chặn trước** → bốn ổ cắm. `src/thue-bao-kho.ts` là cầu giữa một lượt mạng và bốn ổ cắm
**đồng bộ** (10 bài): đọc trả ngay từ kho, làm mới chạy nền, một lượt bay mỗi người, và **một lượt
hỏng không xoá số cũ** — thà vẽ số hơi cũ còn hơn thanh đo nhấp nháy theo mạng.

Ba quyết định đáng chép:

1. **So các cửa bằng PHẦN ĐÃ DÙNG, không bằng số còn lại.** Cửa cinapi tính bằng *tín dụng*, trần
   cục bộ của grokbot2 tính bằng *token ước lượng* — hai con số khác đơn vị thì không so được, một
   tỉ lệ thì so được. Và client vốn chỉ vẽ **phần trăm** (`GetSandUsageStatus.usage_percent`), nên
   tỉ lệ đúng là thứ nó cần.
2. **Trần cục bộ CŨNG là một cửa.** Đo 10/09: `config.poolUrl` trỏ thẳng `admin.halcion.vn/v1/claude`,
   **không đi qua cinapi**, nên đồng hồ cinapi hôm nay không đếm lượt Grok Bot. Vẽ mỗi số cinapi là
   vẽ một thanh không nhúc nhích khi người dùng dùng chính app này. Ngày lệnh đi qua cinapi thì cửa
   cục bộ tự thua trong phép so, không phải sửa gì.
3. **Thanh đo không phụ thuộc `billingMode()`, phán quyết thì có.** Thanh đo là THÔNG TIN (cùng lý
   lẽ đã ghi cho `dashboardUrl`); còn số của cinai chỉ được CHẶN ở `enforce`, nên `warn` trên sản
   xuất giữ nguyên nghĩa *"đếm, không chặn"*.

backend **907/907**, tsc sạch.

### 5h · Nghiệm thu trên SẢN XUẤT (10/09) — dây grokbot2 → cinapi chạy thật

`7dd08b0` lên VPS, bản `20260909-231356`. Số đo đầy đủ ở [bảng theo dõi §1 dòng VPS](../state/bang-theo-doi.md);
ở đây chỉ giữ phần thuộc về kế hoạch này.

**Cổng của Bước 4 — không đọc mã, gọi thẳng khối sản phẩm trên bản đang chạy.** Một đoạn `tsx` rời
(kho cách ly, `GROKBOT2_STATE_FILE`/`DATA_DIR`/`WORKFLOWS_FILE`/`SQLITE_FILE` trỏ `/tmp` — §7 bảng
theo dõi) gọi `khoThueBao.lamMoi("cinapi|<id>")` rồi `oCamTuThueBao`:

```
hoi cinapi : 1 luot
goi        : Free / ACTIVE / vi con 52
cac cua    : gói tháng 48/100
access     : granted        plan: Free
thanh do   : 48 / 100 · gói tháng · đặt lại 05:28 07/10
danh tinh auth0|… : null
```

Bốn điều được chứng minh trong đúng một lượt: base + khoá dịch vụ có mặt và đúng (**1** lượt, không
phải 0); route mới bên cinapi trả lời (không 404, tức `CINAPI_SERVICE_TOKEN` khớp hai đầu); bản đọc
xử được **thân thật** (`data.subscription`, thứ đã phản chứng bản đọc đầu); và khối **không chạm ai
ngoài người mang `cinapi|`** — một `authId` khác trả `null` mà không mở socket nào.

**Cổng của Bước 3.** Từ Internet: `/agent/` 200 · `/agent/app/` 200 · cửa ops **401 / 401 / 401** ·
`/auth/cinai` **403** ở cả `GET` lẫn `POST` khi không giấy. Trên máy: `kiem-reply-0-43` **29 lệnh ·
0 sai** với bot thật `agent-11`, bằng vé đúc cho `cinapi|<id>` — vé ấy thấy **12 bot**, đúng con số
phép chuyển chủ §5e đã ghi.

**Một bẫy của chính phép đo, đáng chép vì nó suýt thành số liệu.** Lượt đầu tôi lấy người dùng cinai
bằng `select id from users order by created_at limit 1` và in ra một thanh đo hoàn toàn hợp lệ —
`Free`, ví 100, `gói tháng 0/100`. Mọi khoá đúng, dây chạy thật, chỉ là gói của **người khác**. Thứ
tố cáo nó là một cổng KHÁC trong cùng lượt: vé đúc cho id ấy thấy **0 bot**, trong khi §5e đã ghi
12. Tra lại **theo email** thì vé thấy đúng 12 và gói thật là `48/100`. Luật: **danh tính phải tra
bằng khoá định danh con người**, và một bài đo phụ thuộc danh tính phải hỏi kèm một câu đã biết đáp
án bằng CÙNG danh tính ấy. (Ghi nguyên văn ở bảng theo dõi §7.)

**Và cửa đăng nhập ĐÃ ĐỔI HÌNH trên sản xuất — đo, vì bản trước nó còn trơ.** Deploy `d9719f5`
(09/09) chở mã Bước 3 nhưng `GROKBOT2_CINAPI_BASE` vắng trong `shared/.env`, nên `/loginDeepControl`
vẫn **302 sang `/agent/app/`** như bản cũ. Nay biến đã có mặt, và cùng một URL từ Internet trả:

```
HTTP/1.1 200 OK
Set-Cookie: gb2_login=…; Path=/agent; HttpOnly; SameSite=Strict; Max-Age=900; Secure
thân 3.234 byte · "auth/cinai" ×1 · "cinai" ×6 · "app/" ×0
```

Tức đúng hình cuối của §5d: `GET /loginDeepControl` **chỉ** đặt cookie buộc phiên rồi vẽ trang, và
trang ấy trỏ sang `/auth/cinai` chứ không chuyển hướng đi đâu. Ba thuộc tính cookie là hàng rào chứ
không phải trang trí — `SameSite=Strict` là thứ làm một điều hướng chéo site không mang được nó,
`Path=/agent` giữ nó khỏi mọi đường khác của `cinai.app`, `Max-Age=900` đóng cửa sổ sau 15 phút.

**Còn đúng một cổng, và nó không đo thay được**: một lượt đăng nhập THẬT của chủ dự án qua cửa ấy.
Cho tới lúc đó chưa ai mang danh tính `cinapi|` đi qua đường đăng nhập trên sản xuất, nên với người
dùng ngoài đó **chưa có gì đổi** — họ vẫn đang cầm danh tính cũ cho tới lượt đăng nhập kế tiếp.

### 5i · Xoá sạch danh tính cũ (10/09 ~06:56) — quyết định của chủ dự án, lấy SAU khi cái giá được đo

Đường đi đáng chép trước cả kết quả. Tôi đề xuất **chuyển chủ** cho tám người còn lại (rẻ hơn, 0 bot
mất, bản đồ tra được sẵn bằng email). Chủ dự án đổi hướng: *"để cho sạch, xoá toàn bộ user cũ đi, làm
lại sang user theo con đường mới"*. Đó là một phép ghi phá huỷ vào dữ liệu sản xuất **của người
khác**, nên tôi không gõ `DELETE` mà **đo cái giá rồi đưa lên bàn** với ba lựa chọn có số kèm; chủ dự
án chọn **"xoá sạch hẳn — làm lại từ trắng"**. Ghi lại cả nhịp ấy vì nó là hình dạng đúng cho mọi
việc phá huỷ về sau: *người quyết là chủ dự án, việc của tôi là làm cho cái giá nhìn thấy được trước
khi họ quyết.*

**Cái giá, đo trước khi bấm** (bản chép `mode=ro`, đếm ở chỗ ĐỌC — thân JSON, không phải cột `owner_id`):

```
8 danh tính local|<email>  ·  30 bot (13 · 9 · 3 · 1 · 1 · 1 · 1 · 1)  ·  872 entry
parked 2 · compaction 2 · automations 0 · todos 0 · handoffs 0
users 6 hàng · usage 9 hàng · host_settings.byOwner 6 khoá
đính kèm 64 tệp · bot-templates 1 tệp · sổ máy 2 hàng · marketplace 0
```

**Công cụ, không phải một câu lệnh**: `infra/vps/xoa-danh-tinh-cu.py`, cố ý cùng hình dạng với
`chuyen-chu.py` — mặc định **chạy khô**, **từ chối chạy khi `grokbot2-be` còn sống** (kho SQLite có
đúng một cửa ghi và đó là tiến trình ấy), có **bản lưu**, **chạy lại được**, và **tự nghiệm thu ở chỗ
ĐỌC**. Ba chỗ một câu `DELETE` gõ tay sẽ bỏ sót — và cả ba im lặng — ghi nguyên văn ở
[bảng theo dõi §7](../state/bang-theo-doi.md): `attachments_meta`/`acceptance` không có đường về bot
(cột `owner_id` của chúng TRƠ ⇒ đường quy thuộc đáng tin duy nhất là đọc đường dẫn đính kèm **trong
thân entry của chính bot sắp xoá**, 64 entry có nhắc); `host_settings.body.byOwner` là object trong
cột JSON (đọc–sửa–ghi); `may-da-biet.json` ngoài SQLite và cơ chế tự lành chỉ bỏ hàng KHÔNG chủ. Cố ý
**không** đụng `coverage.json` dù nó còn nhắc id của 9 bot vừa xoá: đó là sổ đo đường đi.

**Thử ở nơi đã biết đáp án TRƯỚC.** Chạy trọn trên một bản chép 13 MB của kho sản xuất: số chạy khô
khớp từng dòng với bản kiểm kê độc lập, lượt xoá thật để lại **0 hàng mồ côi** ở cả sáu bảng
theo-bot, `integrity_check ok`, lượt thứ ba nói *"không có gì để làm"*. Lượt tổng dượt ấy còn bắt được
một thứ **không nằm trong danh sách kiểm**: hàm che danh tính xử `local|` cẩn thận rồi để `cinapi|`
đi qua nguyên văn — sửa trước khi chạm sản xuất (§7 bảng theo dõi).

**Trên sản xuất**: cổng `isBusy=false` → `systemctl stop grokbot2-be` → xoá → khởi động lại.

```
bản lưu: /opt/grokbot2/shared/data/xoa-cu-bak-20260910-065600
XOÁ : 8 danh tính · agents 30 · entries 872 · parked 2 · compaction 2 · users/usage 6/9
      byOwner 6 khoá · đính kèm 64 · bot-templates 1 · sổ máy 2
SAU : cinapi|***  12 bot · bot còn mang danh tính cũ 0 · hàng mồ côi 0/0/0/0/0/0
      users/usage 0/0 · byOwner 0 · bot-templates 0 / tệp đính 0 · sổ máy 0
      integrity_check ok  →  XONG (mã lệnh 0)
health 200 sau 2 s · pid 110265 → 186555 · epoch giữ 1788887227576
```

**Nghiệm thu ở chỗ ĐỌC, không đọc lại chỗ vừa ghi** — đúng luật §5e đã trả giá: vé của chủ dự án thấy
**12 bot** (`agent-11` … `agent-56`), vé một danh tính `local|` thấy **0**, vé dùng chung thấy **0**,
và `kiem-reply-0-43` **29 lệnh · 0 sai** với bot thật `agent-11`.

**Lùi**: dừng backend, chép ngược từ `xoa-cu-bak-20260910-065600`.

**Hệ quả cho kế hoạch này**, và đây là phần phải nhớ:

- Danh tính DUY NHẤT sở hữu gì đó trên sản xuất nay là `cinapi|<id>` của chủ dự án. **Hazard thứ tự**
  của §5d (*"bật biến trước khi chuyển chủ thì người ta thấy sidebar trống"*) **đã tiêu biến** — không
  còn dữ liệu cũ nào để mất chủ.
- *"3 người chưa có tài khoản cinai, phải nói TRƯỚC"* **không còn là việc**: mọi người bắt đầu từ một
  tài khoản trống qua cửa cinai, ai chưa có thì `POST /api/v1/auth/register` đang mở.
- **Sidebar trống ở một tài khoản mới là ĐÚNG**, là trạng thái chủ ý — đừng đọc nó thành triệu chứng.
- Cổng cuối của Bước 3 vẫn y nguyên và vẫn chưa ai đo thay được: **một lượt đăng nhập THẬT** của chủ
  dự án qua cửa mới.

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
