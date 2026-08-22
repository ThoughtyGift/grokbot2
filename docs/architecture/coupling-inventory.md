# Coupling inventory — grokbot2 ↔ Grok Bot gốc

**Ngày đo:** 2026-08-19  
**Phase:** 0 (freeze). Không sửa runtime.  
**Gốc:** Electron Anysphere `sand` 0.20.0. **Clone:** repo `grokbot2`.

Bốn loại phụ thuộc:

| Loại | Ý nghĩa | Cắt được khi |
|---|---|---|
| **C1 Runtime UI** | Không có `Grok Bot.exe` thì không có giao diện | **Không cắt** — FE gốc đã patch là production (ADR-F0-1). `apps/grokbot-web` chỉ fallback R2 |
| **C2 Protocol** | Domain nói tiếng Cursor (`/gw`, protobuf, 16 kênh SSE) | Phase 2 ACL — **giữ vĩnh viễn**, không có Phase 8 tắt ACL |
| **C3 Artifact** | Đọc asar / bundle ngoài repo để trích hợp đồng và e2e | Extractor nhận `--asar`; e2e CDP; patch as code = F1 |
| **C4 Prompt/UX** | `prompt-base.ts` port từ host bundle | Giữ; không đuổi FE native |

**Không phải coupling gốc:** `admin.halcion.vn` (pool của chủ máy), `hermes-agent-main/` (MIT, gitignore, P6).

---

## 1. Grok Bot.exe (C1)

| File | Vai trò |
|---|---|
| `infra/scripts/run.ps1` | **F2:** `pnpm dev:app` — 4 process + patched exe, CDP 9222 |
| `infra/scripts/run-web.ps1` | **P7:** Vite FE, never `Grok Bot.exe`. |
| `apps/grokbot-web/` | Independent UI. `/v1` only. |
| `apps/grokbot-desktop/package.json` | `pnpm start` → `run.ps1`. Không có source UI. |
| `apps/grokbot-desktop/README.md` | Mô tả exe là FE. |
| `.claude/commands/run.md` | Lệnh agent: mở exe. |
| `docs/session/HANDOFF.md`, `docs/history/execution-roadmap.md` | Hướng dẫn local :9222 + gốc :9333 `--user-data-dir=.data/profile-real`. |

**Trên máy (2026-08-19):** exe cài đặt **có**. `app.asar` tại đường cài **không có** (app unpacked: `resources/app/dist/renderer/index.html` **có**). Bản asar local **có** tại `grokbot2/Grok Bot/resources/app.asar` (~48.7 MB, gitignore `Grok Bot/`).

---

## 2. `CURSOR_API_BASE_URL` / `SAND_BACKEND_URL` (C1+C2)

Chỉ **launcher + docs**, không đọc trong `src/` backend (backend lắng nghe `:8788`; app gốc mới đọc env này).

| File | Ghi chú |
|---|---|
| `infra/scripts/run.ps1` | Set cả hai = `http://localhost:8788`; `CURSOR_WEBSITE_URL=https://cursor.com` (tránh login `localhost:4443`). Unset `ELECTRON_RUN_AS_NODE`. |
| `services/grokbot-backend/src/index.ts` | Comment + log hướng dẫn set env. |
| `README.md`, `docs/architecture.md`, `docs/reverse/spike-findings.md`, `docs/session/HANDOFF.md` | Mô tả seam. |
| `.env.example` | Comment: frontend trỏ `PORT`. |

`.env` **không** chứa `CURSOR_*` (đúng: env thuộc process Electron, không thuộc Node backend).

---

## 3. `app.asar` (C3)

| File | Runtime? | Ghi chú |
|---|---|---|
| `services/grokbot-backend/scripts/extract-contract.mjs` | **Không** (CLI) | Packed asar only. Order: env, repo copy, `Desktop/Grok Bot/resources/app.asar`, install `app.asar`, then `app.asar.disabled-by-grokbot2`. `--check` **PASS** (2026-08-19 close). |
| `services/grokbot-backend/scripts/e2e-run.mjs` P1 | CLI | Extract không `--asar`; xanh sau fallback asar. |
| `services/grokbot-backend/src/**` | **Không** | Zero `readFileSync` asar trong runtime. |
| `.gitignore` | — | `Grok Bot/` (bản app giữ local). |

Hợp đồng đã commit: `docs/extracted/box-host-contract.json` (`extractedFrom: app.asar`, router `x3s`, 9 route, 16 kênh, 120 lệnh, 9 skip rooms).

---

## 4. `grokbot-fe-extracted` / `grokbot-fe-current` (C3)

**Không** nằm trong git workspace grokbot2. Đường tuyệt đối ngoài repo:

| File | Default path |
|---|---|
| `docs/extracted/gateway-commands.json` `source` | `C:/Users/admin/Desktop/grokbot-fe-current/dist/electron-main/main.cjs` |
| `docs/extracted/tool-catalog.json` | `.../renderer/assets/index-lA9cgT4O.js` |
| `docs/extracted/subagent-prompts.json` | `.../host/host-main.cjs` |
| `scripts/grep-fe.mjs` | `FE_BUNDLE` hoặc cùng `index-lA9cgT4O.js` |
| `scripts/grep-host.mjs` | `HOST_BUNDLE` hoặc `host-main.cjs` |
| `docs/parity.md` | nhắc `grokbot-fe-running` (bundle đang chạy khác hash `index-DNC736IO.js`) |

`C:\Users\admin\Desktop\grokbot-fe-extracted` và `grokbot-fe-current` **tồn tại trên disk**. Runtime `src/` không import chúng.

---

## 5. `@grokbot2/proto` (C2)

| File | Dùng |
|---|---|
| `packages/grokbot-proto/src/encode.ts` | Encoder protobuf tối thiểu |
| `packages/grokbot-proto/src/bootstrap.ts` | `GetMe`, `GetSandAccessStatus`, `GetUserPrivacyMode`, `GetSandUsageStatus`, `GetSandTrialClaimStatus`, `EnsureSandBox`, `EnsureSandBoxWindow` |
| `packages/grokbot-proto/src/index.ts` | re-export |
| `services/grokbot-backend/src/index.ts` | **import runtime duy nhất:** `bootstrapResponses`, `connectStreamEnd` |
| `services/grokbot-backend/package.json` | `workspace:*`; `dev` luôn `pnpm --filter @grokbot2/proto build` trước |

Mọi RPC `aiserver.v1.*` / `agent.v1.*` khác: `index.ts` trả proto rỗng hoặc JSON `{}`. Client gốc gọi ~90 RPC; grokbot2 chỉ **cố ý** trả ~7 gate.

`EnsureSandBox` gắn `GROKBOT2_GATEWAY_URL` mặc định `http://localhost:8788/gw` — tự trỏ app gốc về chính backend này.

---

## 6. Route `/gw` (C2)

Mount: mọi path dưới `/gw/` trong `gateway.ts` (`handleGateway`). Prefix gốc host là `/health` không `/gw`; ACL của ta thêm `/gw`.

**Trong hợp đồng asar (9):**

| Method | Path gốc | Path grokbot2 |
|---|---|---|
| POST | `/api/<cmd>` | `/gw/api/<cmd>` |
| GET | `/avatars/<id>` | `/gw/avatars/<id>` |
| GET | `/events` | `/gw/events` |
| GET | `/health` | `/gw/health` (+ thêm `/health` root) |
| GET | `/local-exec/requests` | `/gw/local-exec/requests` |
| POST | `/local-exec/responses` | `/gw/local-exec/responses` |
| POST | `/prepare-upgrade` | `/gw/prepare-upgrade` |
| GET | `/webauthn/requests` | `/gw/webauthn/requests` |
| POST | `/webauthn/responses` | `/gw/webauthn/responses` |

**Thêm của grokbot2 (không có trong asar):** `/gw/__coverage`, `/gw/__dropsse`, `/gw/slack/events`, `/gw/github/events`. Telemetry gốc `/v1/traces|metrics|logs` được nuốt `200 {}` ở `index.ts`.

**120 lệnh** `POST /gw/api/<name>`: 111 handler trong `methods` map `gateway.ts`; 9 shared-room trong `intentionallySkipped` của contract.

**Stub (handler có, năng lực rỗng):** `skillsCatalog` `[]`, workflows `[]`, `getCloudAgentInfo` `null`, teach recording `ok: false`, `getListenerConnectUrl` `{url:""}`, flags search/egress/network `false`, skill publish `ok: false`, groups `null`.

Hầu hết `services/grokbot-backend/scripts/e2e-*.mjs` gọi `http://127.0.0.1:8788/gw/api/...`.

---

## 7. Kênh SSE (C2)

Hợp đồng 16 tên coordinator chấp nhận:

`agent-upserted` · `agents` · `async-tasks` · `automations` · `box-disk-pressure` · `computer-action` · `forever-box` · `host-settings` · `mcp-servers` · `outline` · `sharing` · `subagents` · `teach-recording` · `transcript` · `tray` · `workflows`

Alias (gửi **family** thì bị drop): `agents-automation` → phải ra `automations`; `agents-workflow` → `workflows`; `mcp-servers-updated` → `mcp-servers`.

**Runtime đang `broadcast()`:**

| Kênh | File | Ghi chú |
|---|---|---|
| `transcript` | `gateway.ts` | ordered replica per agent |
| `forever-box` | `gateway.ts` ← sink `forever-box.ts` | |
| `agent-upserted` | `gateway.ts` | |
| `agents` | `gateway.ts` | snapshot lúc connect + upsert |
| **`agents-automation`** | `gateway.ts:283` | **SAI TÊN** — coordinator drop. Phải là `automations`. |

**Không đẩy (client poll):** `outline`, `subagents`, `host-settings`, `tray`, `workflows`, `mcp-servers`, `teach-recording`, `sharing`, `async-tasks`, `computer-action`, `box-disk-pressure`.

Cấm lịch sử: kênh `roster` không tồn tại (parity §2w).

---

## 8. Workspace / package / infra / Docker

| Artifact | Coupling gốc? |
|---|---|
| `pnpm-workspace.yaml` | `apps/*`, `services/*`, `packages/*` — không trỏ ngoài repo |
| Root `package.json` | `pnpm backend` → `@grokbot2/computer` (`:8790`) + `@grokbot2/runtime` (`:8789`) + `@grokbot2/backend` (`:8788`); `GROKBOT2_RUNTIME_URL` / `GROKBOT2_COMPUTER_URL` do `scripts/dev-bff.mjs` set |
| `turbo.json` | build/dev/typecheck thuần monorepo |
| **Docker** | **Không có** Dockerfile / compose trong repo |
| `infra/systemd/grok-box@.service` | Mô tả `host-main.cjs` (binary gốc) + Xvfb — **chưa dùng cho chat** |
| `infra/vps/grok-box-up.sh`, `exec-daemon.mjs` | Box Linux tự host; không phải Cursor cloud, nhưng pane FE gốc mới xem VNC |
| `infra/scripts/box-tunnel.ps1` | SSH CDP box |
| `.env.example` | `PORT`, pool URL, VNC/exec/CDP; comment CURSOR_API_BASE_URL |
| `.env` (gitignore) | `GROKBOT2_AUTH=enforce`, `GROKBOT2_STRICT_404=1` đã bật |
| `.mcp.json` | gitignore; MCP local, không phải Cursor |

---

## 9. Prompt và dữ liệu trích (C4)

| File | Nguồn gốc |
|---|---|
| `src/prompt-base.ts` | Port chương từ `host-main.cjs` |
| `docs/extracted/*.json` | Catalog tool 54, proto messages/enums, commands 120 |
| `.data/profile-real/` | User-data-dir **app gốc** khi chạy song song (gitignore) |

---

## 10. Bảng file runtime × contract (tóm tắt)

| Module runtime | Protocol gốc nó giả |
|---|---|
| `auth.ts` | `POST /oauth/token` |
| `index.ts` + proto | ConnectRPC gates + EnsureSandBox |
| `gateway.ts` | `/gw/*` + 111 lệnh + SSE |
| `chat.ts` | `sendPrompt`, transcript, roster, park |
| `forever-box.ts` | status VNC / handoff |
| `channels.ts` | local-exec / webauthn long-poll |
| `observe.ts` | unknown path; 404 khi `STRICT_404=1` |
| `auth-gate.ts` | Bearer `gateway_token` từ EnsureSandBox |

**Cấm mới (Phase 0):** không thêm import path asar / `grokbot-fe-*` vào `src/`.
