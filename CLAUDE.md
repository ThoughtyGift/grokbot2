# Grok Bot 2 — Claude Code project instructions

Self-hosted backend for the **Grok Bot** desktop agent: point the stock frontend at a local
backend + your Claude pool (`admin.halcion.vn`). User-facing quickstart in [README.md](README.md).

> Personal / research use only. Grok Bot is a rebranded Cursor (Anysphere) desktop agent; this
> backend emulates the contract its client speaks. See [docs/legal.md](docs/legal.md).

## Đang ở đâu, còn gì

@docs/state/bang-theo-doi.md

*Dòng trên là một **import**, không phải link: Claude Code nạp nội dung file đó ngay lúc khởi động
phiên. Nó ở đây vì một chuyện đo được ngày 31/08 — hai ngày làm việc năng suất nhất (28 commit) để
lại **0 dòng ký ức**, và tài liệu trạng thái tốt nhất của dự án thì **không cơ chế nào nạp tự
động**. Sửa bảng đó là sửa thứ mọi phiên sau đọc; đừng thêm tài liệu trạng thái thứ hai.*

## Structure — BE / FE / API map

| Concern | Folder | What |
|---------|--------|------|
| **FE** (frontend) | `apps/grokbot-desktop/` + patched `Grok Bot.exe` | production UI. Fallback: `apps/grokbot-web/` |
| **BE** (backend) | `services/grokbot-backend/` | glue server: auth + bootstrap RPC + box gateway + chat bridge |
| **API** (contract) | `packages/grokbot-proto/`, `packages/pool-client/` | protobuf encoder/responses + Claude-pool HTTP client |
| infra | `infra/` | Windows launcher + systemd unit for a future VPS box |
| docs | `docs/` | architecture · protocol-reference · spike-findings · roadmap · legal |

Monorepo: **pnpm workspaces + Turborepo**. Node ≥20, TypeScript (ESM, strict).

## Commands

| | |
|---|---|
| `pnpm install` | install workspace |
| `pnpm backend` | four processes: computer `:8790` + runtime `:8789` + ops `:8791` + BFF `:8788` |
| `pnpm dev:app` | F2 launcher: that stack + patched `Grok Bot.exe` on CDP `:9222` |
| `pnpm web` | fallback Vite UI on `localhost:5173` (proxies `/v1`) |
| `pnpm phase:gate` | current phase from `docs/parity-runs/phase-current.json`. From **F3**, CDP `:9222` is required (RED if missing). `--phase F3` measures without moving the pointer. |
| `node services/grokbot-backend/scripts/build-setup.mjs --with-app` | dựng bộ cài **chở cả ứng dụng** (~118 MB, mất vài phút). Máy nhận **không cần** client cài trước, **không cần** Node — đúng hình dạng bộ cài của hãng. Gói này chứa client của nhà phát hành: dùng cho máy của chính bạn. |
| `node services/grokbot-backend/scripts/build-setup.mjs` | dựng **hai** gói cài mà trang tải phát ra → `.data/dist/bot-noi-bo-setup-{win,mac}-<ngày>.zip`. Gói KHÔNG chứa app: nó vá client người dùng đã tự cài, tạo lối mở mang 4 biến, và ghi địa chỉ backend. Bản Mac **chưa chạy thử trên máy Mac thật**. |
| `node services/grokbot-backend/scripts/serve-site.mjs` | máy chủ **chỉ phát trang tải + file cài** (0.0.0.0:8080), để máy khác cùng LAN tải app về — không phơi backend. Đưa lên VPS: [docs/plan/publish-download-site.md](docs/plan/publish-download-site.md) |
| `http://localhost:8788/` | trang tải (`apps/grokbot-site/index.html` qua `src/site.ts`) — công khai, không qua `checkAuth`, vì cửa này dành cho người chưa có token lẫn app |
| `pnpm typecheck` / `pnpm build` | turbo across workspace |
| `pnpm --filter @grokbot2/backend test` | **cách chạy test backend an toàn**: `scripts/run-tests.mjs` trỏ `GROKBOT2_DATA_DIR`/`GROKBOT2_STATE_FILE`/`GROKBOT2_SQLITE_FILE` vào thư mục tạm. `npx tsx --test` trần từng xoá `.data/bot-templates`, `.data/box-secrets`, `.data/mcp-prefs` THẬT (05/09, bảng theo dõi §7) — nay ba bài đó tự cách ly, nhưng runner vẫn là đường chính |
| `node services/grokbot-backend/scripts/kiem-reply-0-43.mjs [lệnh:{json}…]` | chạy validator schema của coordinator **0.43** lên reply thật của backend: 29 lệnh đọc mặc định (có argv thì CHỈ chạy argv), `AGENT=<id>` chọn bot. Đổi shape reply ⇒ chạy lại; **đỏ ở đây là banner "mất kết nối" trên client 0.43** dù HTTP 200. Trên VPS (`GROKBOT2_AUTH=enforce`): `GW_TOKEN=$(cat /opt/grokbot2/shared/data/gateway-token.txt) AGENT=agent-11 node …` — thiếu token là 401, không phải reply sai |
| `node services/grokbot-backend/scripts/e2e-marketplace.mjs` | Marketplace bot trọn vòng qua `/gw/api` + RPC proto + blob (26 mốc, tự dọn). Cặp với `e2e-mau-bot.mjs` (mẫu bot, 20 mốc) |
| `http://localhost:8788/admin?token=<.data/gateway-token.txt>` | box capacity board — how many more bots fit, whether RAM or disk binds, and (từ 06/09) thẻ **Tài khoản box** `còn trống / tổng` từ `GET /pool` của router — dải `gb2u*` là trần chặn sớm hơn RAM. Read-only on purpose: six of the Chromes on that box are **not ours** (see [docs/plan/one-display-per-bot.md](docs/plan/one-display-per-bot.md)). |
| `infra\scripts\start-app.cmd` | double-click launcher (Desktop shortcut "Grok Bot (local)"). **Never double-click the installed `Grok Bot.exe`** — it starts with none of the four env vars, so it talks to the vendor's servers *and* can auto-update over the patch set. |
| `infra\scripts\start-app-043.cmd` | mở bản **0.43** song song (ưu tiên `Programs\Bot Noi Bo 043`, rồi `C:\cai043`), CDP **:9225**, hồ sơ `Grok Bot (local 043)`; không đụng bản 0.29 lẫn app hãng |
| `node services/grokbot-backend/scripts/e2e-routine-nhac.mjs` | E2E **bảng Routine → bot lên tiếng** qua `/gw/api`: bot thử riêng, 4 nhịp (tạo · tắt · bật+sửa · xoá) → 4 hàng sự kiện + 4 câu của bot, 0 tin người dùng, tự xoá bot. Gửi 4 lượt model — không chạy khi `/gw/health` báo `isBusy` |
| `node services/grokbot-backend/scripts/e2e-hai-tai-khoan.mjs` | E2E **tài khoản thứ hai** qua `/gw/api`: người B (JWT web thật, tạo bằng `nguoi-b-ngoai.mts`) thấy listing của A, import ra bot của mình, không đọc/xoá được mẫu của A; 20 mốc, tự dọn, không tốn lượt model (lời chào của bot mới chạy nền). Để lại người `e2e-b@vi-du.vn` trong kho dev |
| `node services/grokbot-backend/scripts/e2e-trang-chia-se.mjs` | E2E **trang `/bot/<shareId>`** đi đường người dùng: bot thử → câu share → publish → mở trang (title · og · deep link · CSP · 301 gạch chéo cuối) → dọn. Trên VPS: `GW=http://127.0.0.1:8788/gw/api GW_TOKEN_FILE=/opt/grokbot2/shared/data/gateway-token.txt SITE=https://cinai.app/agent node …`. Một lượt model. **Nếu bot không stage được mẫu, đọc §5 mục 18 bảng theo dõi (tên miền `halcion.vn`) trước khi nghi code** |
| `http://localhost:8788/bot/<shareId>` | trang đích của nút **Copy link** (mẫu bot): công khai như trang tải, chỉ hiện mẫu đã publish + public, nút *Thêm vào Grok Bot* mở `grokbot://app/v1/bot-template?id=…`. Link client chép lấy gốc từ `GROKBOT2_PUBLIC_SITE` (VPS: `https://cinai.app/agent`) |
| `node services/grokbot-backend/scripts/e2e-chia-se-mau.mjs` | E2E **Share as template** trên client 0.43 local (CDP :9225), bấm THẬT qua `Input.dispatchMouseEvent`: share → Publish → Update → Publish 2 → View Details → Delete, 7 mốc, tự dọn. Gửi 2 lượt model vào bot đang mở — không chạy khi người dùng đang chat. **Đỏ giữa chừng thì dọn bằng menu Delete Template CỦA CLIENT** rồi chạy lại — xoá qua `deleteBotTemplate` + tải lại renderer không đủ, client suy "đã phát" từ thẻ trong bản ghi (bảng theo dõi §7); mốc 4 đỏ mà `getAgentTranscriptTail` có thẻ = bản ghi sống đứng (§5 mục 19), không phải backend |
| `CDP_APP=http://127.0.0.1:9225 CDP_BOX=http://127.0.0.1:9224 node services/grokbot-backend/scripts/e2e-teach.mjs` | E2E **Teach a task** bấm thật trên client (mặc định `CDP_APP` :9222 = bản 0.29, `CDP_BOX` :9223; bản 0.43 và Chrome box của ta là :9225/:9224): `+` → Teach → Start → demo → Stop. Có box ⇒ đường **video** (tin `teach-recording` → bot học → skill + link `sand-workflow:<id>`, chờ tới `TEACH_WAIT_MS`=5 phút, **một lượt model**); không box ⇒ đường CDP cũ. Để lại skill thử — xoá qua `deleteAgentWorkflow{workflowId}`. Skill `learn-from-demonstration` của bot là bản chép quy trình 0→6 của hãng, `source:"managed"` (panel hiện *Managed by Cursor*, không vào menu `/`) — bài đo loại nó khỏi phép đếm; **box cần `jq`** (kịch bản nhận phiếu `flock` của hãng), thiếu là bước 0 `exit 1` |
| `node --test infra/vps/exec-router.test.mjs` | dải tài khoản box của router (đọc `/etc/passwd`, hết dải → `code:"pool-exhausted"`, `GET /pool` = `{used,size,free,owners}` cho `/admin`). Router chạy TRÊN BOX (`/opt/exec-router.mjs`, unit `grok-exec`, cùng máy VPS): đưa lên bằng `scp` rồi `systemctl restart grok-exec` — thêm tài khoản chỉ cần `useradd -m -g gb2users -s /bin/bash gb2uNNN && chmod 700 /home/gb2uNNN`, không cần sửa env |
| `GROKBOT2_CLIENT_DIR=C:\cai043 GROKBOT2_SETUP_VARIANT=043 node services/grokbot-backend/scripts/build-setup.mjs --with-app` | bộ cài chở-app **cài song song** (`dist/043/…-0.43.exe`, AppId/thư mục/kho hồ sơ riêng). Ghi vào thư mục con nên KHÔNG lọt vào đường phát hành — muốn đổi bản cho mọi máy là quyết định riêng |
| `infra\scripts\check-app.cmd` | which backend is the app talking to? Counts real RPC traffic for 6s. |
| `infra\scripts\run-web.ps1` | Vite FE only — does not spawn `Grok Bot.exe` |
| `python -m venv services/grokbot-backend/.venv-stt` then `.venv-stt\Scripts\pip install faster-whisper` | the composer's microphone. Runs offline; the model downloads on first use. Without it `TranscribeAudio` answers empty text and the mic silently does nothing. |

## Where to change things

- Add/adjust a **bootstrap RPC** response → `packages/grokbot-proto/src/bootstrap.ts`
- Add a **gateway method** → `services/grokbot-backend/src/gateway.ts` (the `methods` map)
- Add/adjust a **native `/v1` route** → `services/grokbot-backend/src/native.ts`
- **Independent UI** → `apps/grokbot-web/`
- **Chat** behavior / transcript shape → `services/grokbot-backend/src/chat.ts`
- Point the **brain** elsewhere → `services/grokbot-backend/src/config.ts` (+ `pool-key.txt`)

## Conventions

- TypeScript ESM, strict; small focused modules; match surrounding style.
- **Never commit secrets** — `pool-key.txt`, `.env`, `*-key.txt` are gitignored. Keys via file/env only.
- The backend must stay a faithful emulation of the client contract — verify against
  [docs/protocol-reference.md](docs/protocol-reference.md) before changing response shapes.
- Conventional commits (`feat:`/`fix:`/`docs:`/`refactor:`/`chore:`). Attribution disabled.

## Reverse-engineering context

The Grok Bot client is Cursor's `sand` build. **Ba số phiên bản, đừng hợp nhất** (06/09/2026): client PHÁT HÀNH
là **0.43.20260906** (kênh `stable` từ 06/09, dựng từ `C:\cai043`; máy còn `0.29.20260903` ở `%LOCALAPPDATA%\Programs\Bot Noi Bo` tự lên qua launcher ở lần mở kế; bản dev `C:\cai029`; bản dev **0.43 đã vá** chạy song song ở `C:\cai043`, hồ sơ `Grok Bot (local 043)`, CDP `:9225` — xem bảng theo dõi §6 mục 20 và 27); hợp đồng lệnh
đã trích là của **0.30** (`docs/extracted/gateway-commands.json`, 147 lệnh) và **0.43** (`docs/extracted/gateway-commands-0-43.json`, 150 lệnh — 19 chưa handler, 0 client từng gọi); app GỐC của hãng đang cài là
**0.43.0** (`C:\Program Files\Grok Bot`, tự cập nhật 05/09) — so 0.43 với local:
[docs/extracted/0-43-so-voi-local.md](docs/extracted/0-43-so-voi-local.md). Dòng này từng ghi *v0.20.0* cho tới 31/08/2026, tức nó nói sai
suốt nhiều ngày trong khi chính file này dặn phải đối chiếu hợp đồng trước khi đổi shape.

Findings + protocol: [docs/reverse/spike-findings.md](docs/reverse/spike-findings.md) và
[docs/protocol-reference.md](docs/protocol-reference.md).
The decompiled bundle (reference only, **not in this repo** — `.gitignore` chặn
`docs/extracted/_latest-asar/`) lives under the session scratchpad hoặc bản cài.
