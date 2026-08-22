> **ARCHIVED 2026-08-20.** Đây là roadmap hướng "FE native riêng" (P0→P8 cutover, bỏ protobuf/`/gw`).
> Chủ project đã đổi hướng sang **dùng FE gốc (`Grok Bot.exe`) đã patch** làm UI production.
> Roadmap đang hiệu lực: [../ROADMAP.md](../ROADMAP.md). Giữ file này vì P0–P6 vẫn là nền dùng lại được.

# ROADMAP — Tách grokbot2 khỏi Grok Bot gốc (Strangler Fig → microservices)

**Ngày:** 2026-08-20  
**Pointer:** **P7** — [`docs/state/phase-state.json`](../state/phase-state.json) / [`docs/parity-runs/phase-current.json`](../parity-runs/phase-current.json).  
**Trạng thái:** Phase 7 **đang soak** — code FE + native `/v1` xong; happy path đã chứng trên FE. **Không** `--advance` P7. **Không** mở P8. **Không** `GROKBOT2_CURSOR_ACL=0`.  
**Phạm vi:** hai bề mặt trong workspace — **Grok Bot gốc** (binary Anysphere `sand` v0.20.0) và **grokbot2** (clone/self-host backend).  
**Mục tiêu:** grokbot2 trở thành hệ độc lập, kiến trúc theo **năng lực nghiệp vụ**, không còn phụ thuộc binary / protobuf / gateway contract của app gốc.  
**Không nằm trong mục tiêu:** fork hay phân phối lại client đã ký; xem [docs/legal.md](../legal.md).

Tài liệu liên quan (parity, không thay thế roadmap này): [docs/architecture.md](../architecture.md) · [docs/history/execution-roadmap.md](execution-roadmap.md) · [docs/parity.md](../parity.md) · [docs/architecture/box-architecture.md](../architecture/box-architecture.md).

---

## 0. Quyết định kiến trúc (đọc trước khi tách process)


| Quyết định | Chọn                                                            | Lý do                                                                                                                |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pattern    | **Strangler Fig**                                               | App gốc đang là UI duy nhất; cắt đứt ngay sẽ mất workspace. Bọc contract cũ, thay từng capability từ trong ra.       |
| Bước 1     | **Modular monolith** trong cùng process                         | `chat.ts` + `gateway.ts` + `state.json` chưa đủ ranh giới để chia mạng. Chia process sớm = latency SSE + dual-write. |
| Bước 2     | **Service theo business capability**, không theo layer kỹ thuật | Auth / roster / turn / box / automation là bounded context khác nhau; “HTTP handler vs domain” không phải service.   |
| Bước 3     | **FE riêng** nói API grokbot2 native                            | Chỉ khi đó mới xóa ConnectRPC + 120 lệnh Cursor host. Giữ FE gốc mãi = mãi phụ thuộc project gốc.                    |
| Không làm  | 12 microservice ngày 1                                          | Một kỹ sư, một Node server, persistence JSON. Overhead vượt giá trị.                                                 |


**Definition of Done (toàn chương trình):** process `Grok Bot.exe` không còn trong đường chạy production của grokbot2; không `CURSOR_API_BASE_URL`; không import `@grokbot2/proto` trên đường nóng; không đọc `app.asar` lúc runtime; e2e đi qua FE/API của chính grokbot2.

---

## 1. Architecture hiện tại

### 1.1 Project gốc — Grok Bot (Anysphere)

Không có source trong git grokbot2. Đây là **Electron đã ký**, viewer mỏng lên cloud box.


| Thành phần            | Vị trí trên máy                                 | Vai trò                                                             |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Shell                 | `%LOCALAPPDATA%\Programs\Grok Bot\Grok Bot.exe` | Cửa sổ, single-instance theo profile                                |
| Renderer              | `resources/app/dist/renderer` (bundle minify)   | UI roster / chat / computer / routines                              |
| Main                  | `dist/electron-main/main.cjs` (không minify)    | Bảng `SAND_GATEWAY_COMMANDS` = 120 lệnh                             |
| Box host (tham chiếu) | `dist/host/host-main.cjs` trong asar            | Router `x3s` — server mà grokbot2 đang giả lập                      |
| Bản trích FE          | `C:\Users\admin\Desktop\grokbot-fe-extracted`   | Copy renderer để đọc contract, **không phải app chạy được độc lập** |
| Backend hãng          | `api2.cursor.sh` + pod `*.cursorvm.com`         | Auth, ConnectRPC, gateway, VNC, model                               |


Luồng gốc:

```
Renderer ──coordinator──► Electron main
                              │
                              ├─ CURSOR_API_BASE_URL (mặc định api2.cursor.sh)
                              │     /oauth/token
                              │     aiserver.v1.*  (protobuf, ~15 gate + ~90 RPC dùng)
                              │
                              └─ gateway_url từ EnsureSandBox
                                    GET  /gw/health
                                    GET  /gw/events          SSE 16 kênh
                                    POST /gw/api/<command>   120 lệnh JSON
                                    VNC  vnc_url (noVNC)
                                    exec exec_daemon_url
```

Agent loop **không** nằm trong renderer: `sendPrompt` → box host chạy model + tool. Renderer chỉ replica transcript (epoch + sequence liên tục).

Phụ thuộc cứng của UI gốc: hình dạng protobuf, tên lệnh gateway, 16 tên kênh SSE (`transcript`, `agents`, `agent-upserted`, `forever-box`, …). Sai một literal thì FE im lặng (đã xảy ra với kênh `roster`).

### 1.2 Project clone — grokbot2

Monorepo pnpm + Turborepo. **Một process HTTP** đóng vai cả bốn lớp của hãng.

```
apps/grokbot-desktop     chỉ launcher (run.ps1) — không có source UI
services/grokbot-backend  monolith :8788
packages/grokbot-proto    encoder protobuf + bootstrapResponses
packages/pool-client      HTTP → admin.halcion.vn
infra/                    Windows launch + đơn vị VPS box (tương lai)
docs/extracted/           hợp đồng trích từ app gốc (120 lệnh, 54 tool, 9 route)
```

Process backend hiện tại (`src/index.ts`):


| Prefix            | Module                                                                                                          | Năng lực dồn vào                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/oauth`, `/auth` | `auth.ts`                                                                                                       | JWT tự ký                                                               |
| `/aiserver.v1.*`  | `@grokbot2/proto`                                                                                               | Gate GRANTED / GetMe / EnsureSandBox                                    |
| `/gw/*`           | `gateway.ts`                                                                                                    | 111/120 lệnh + SSE + avatars + local-exec + health                      |
| `sendPrompt`      | `chat.ts` (rất lớn)                                                                                             | roster, transcript, turn, tool, park, presence                          |
| disk              | `store.ts` → `.data/state.json`                                                                                 | god-object: agents, transcripts, parked, automations, todos, compaction |
| box               | `forever-box.ts`, `box-exec.ts`, `browser.ts`                                                                   | VNC status, exec, CDP                                                   |
| khác              | `automations.ts`, `mcp.ts`, `attachments.ts`, `memory.ts`, `channels.ts`, `slack-events.ts`, `github-events.ts` | đã tách file, **vẫn cùng process + cùng state**                         |


Não: `pool-client` → `admin.halcion.vn` (hạ tầng của chủ máy, **không** phải project Grok Bot gốc — được giữ).

### 1.3 Bản đồ phụ thuộc hiện tại (điểm strangler phải cắt)

```
                    ┌─────────────────────────┐
                    │  Grok Bot.exe (gốc)     │
                    │  signed, không build    │
                    └───────────┬─────────────┘
                                │ CURSOR_API_BASE_URL
                                ▼
                    ┌─────────────────────────┐
                    │  grokbot2 :8788         │
                    │  giả lập 100% contract  │
                    │  gốc (proto + /gw)      │
                    └─────┬───────────┬───────┘
                          │           │
              EnsureSandBox        sendPrompt
              trỏ gateway về mình     │
                          │           ▼
                          │     admin.halcion.vn
                          ▼
                    VPS box (VNC/exec)  ← tùy .env, không bắt buộc cho chat
```

**Coupling loại 1 — runtime:** không có `Grok Bot.exe` thì không có UI.  
**Coupling loại 2 — protocol:** mọi thay đổi domain phải dịch ra 120 lệnh + replica SSE.  
**Coupling loại 3 — dữ liệu:** một `state.json` khiến không tách service được mà không dual-write.  
**Coupling loại 4 — pháp lý:** FE gốc là proprietary; product độc lập phải có UI riêng.

Độ phủ hợp đồng (đo 2026-08-19): gateway **111/120** (9 shared rooms cố ý bỏ); tool catalog **28/54** khớp tên; skills/workflows/channels còn stub.

---

## 2. Service boundaries (theo business capability)

Cắt theo **việc user/agent làm**, không theo file hiện có. Mỗi ô là ứng viên process **sau** khi modular monolith ổn.


| ID      | Service        | Việc nó sở hữu                                               | Không sở hữu         | API đề xuất (native, sau Phase 7)              | Nguồn code hiện tại                                  |
| ------- | -------------- | ------------------------------------------------------------ | -------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| **S0**  | `edge-bff`     | Một cửa cho client: auth session, route, SSE fan-in, version | Domain               | HTTPS + WS/SSE                                 | `index.ts` + `gateway.ts` (mỏng)                     |
| **S1**  | `identity`     | User local, JWT, gateway ticket, host settings               | Roster               | `/v1/session`                                  | `auth.ts`, `auth-gate.ts`                            |
| **S2**  | `directory`    | Bot, avatar, ẩn/unread, searchAgents                         | Transcript           | `/v1/agents`                                   | phần roster trong `chat.ts`                          |
| **S3**  | `conversation` | Entries, ordered log, interrupt, reactions, widgets          | Gọi model            | `/v1/agents/:id/transcript` + SSE `transcript` | transcript trong `chat.ts`                           |
| **S4**  | `runtime`      | Turn, parse tool, approval/park, subagent                    | Exec thật, pool HTTP | nội bộ từ S3                                   | `chat.ts` loop, `tool-calls.ts`, `subagents.ts`      |
| **S5**  | `brain`        | Gọi pool, model id, stream token, compaction prompt          | Tool side-effect     | gRPC/HTTP nội bộ                               | `pool-client`, `compaction.ts`, `prompt*.ts`         |
| **S6**  | `computer`     | Forever-box status, VNC URL, handoff, exec                   | Chat text            | `/v1/computer/:agentId`                        | `forever-box.ts`, `box-exec.ts`, `infra/vps`         |
| **S7**  | `browser`      | CDP tab per bot                                              | Desktop VNC          | nội bộ từ S4                                   | `browser.ts`                                         |
| **S8**  | `media`        | Upload, virtual path, bytes, width/height                    | Transcript shape     | `/v1/attachments`                              | `attachments.ts`                                     |
| **S9**  | `memory`       | knowledge_base, memories CRUD                                | Chat                 | `/v1/agents/:id/memory`                        | `memory.ts`                                          |
| **S10** | `automations`  | Cron + (sau) event trigger                                   | Gửi prompt (gọi S3)  | `/v1/routines`                                 | `automations.ts`                                     |
| **S11** | `connectors`   | Slack/Discord/GitHub/Telegram                                | Agent loop           | webhooks + `/v1/channels`                      | `slack-events.ts`, `github-events.ts`, `channels.ts` |
| **S12** | `extensions`   | MCP servers, skills catalog                                  | Core chat            | `/v1/mcp`, `/v1/skills`                        | `mcp.ts` + stub skills                               |
| **S13** | `web-desktop`  | FE grokbot2                                                  | Protocol Cursor      | —                                              | **chưa có** (`apps/grokbot-desktop` chỉ launch)      |


**Anti-corruption layer (ACL):** S0 thời Strangler vẫn nói **Cursor dialect** ra ngoài (`/gw/api`, protobuf). Bên trong chỉ nói **grokbot2 dialect**. Khi S13 sống, gỡ ACL.

Sự kiện nội bộ (sau Phase 4, không bắt buộc ngày 1): `AgentCreated`, `TurnCompleted`, `ToolRequested`, `BoxHandoff`, `RoutineFired`. Trước đó: function call in-process.

```
                    ┌──────── S13 web-desktop (mới) ────────┐
                    │                                       │
 Client gốc  ──ACL──┤  S0 edge-bff                          │
                    │    S1 identity  S2 directory          │
                    │    S3 conversation ◄── S4 runtime     │
                    │         ▲                │            │
                    │         │           S5 brain          │
                    │    S8 media  S9 memory                │
                    │    S6 computer  S7 browser            │
                    │    S10 automations  S11 connectors    │
                    │    S12 extensions                     │
                    └───────────────────────────────────────┘
```

---

## 3. Lộ trình Strangler Fig

Nguyên tắc Fowler: **facade cũ giữ nguyên**, cây mới lớn phía sau, đến khi cành cũ cắt được.

```
Phase 0    Inventory + freeze contract + legal wall
Phase 1    Modular monolith (package boundaries, no new ports)
Phase 2    S0 BFF + ACL: gateway.ts chỉ dịch, domain không import protobuf
Phase 3    Persistence: state.json → SQLite (một DB, nhiều schema) — điều kiện tách process
Phase 4    Extract S5 brain + S4 runtime (process 2) — turn vẫn đúng sequence
Phase 5    Extract S6 computer + S7 browser (process 3, sát VPS)
Phase 6    Extract S10 + S11 (process 4)
Phase 7    S13 FE độc lập (song song app gốc — dual UI)  ← đang soak, 2026-08-20
Phase 8    Cutover: tắt protobuf + /gw; Grok Bot.exe chỉ còn máy đối chứng  ← chưa mở
Phase 9    Optional scale: bus, multi-tenant, k8s — chỉ khi Phase 8 xanh 2 tuần
```

**Luật strangler:** mỗi phase, app gốc **vẫn chạy**. Feature mới chỉ viết vào module/service mới; `gateway.ts` thêm adapter, không thêm logic nghiệp vụ.

**Luật cấm:** không “rewrite FE tuần 1”; không split process trước SQLite; không giả shared rooms để cho giống gốc.

---

## 4. Plan từng phase

Giả định **1 software engineer**, calendar **~14 tuần** Phase 0–8 (không tính P9). Buffer 20% đã gộp vào cột tuần.

### Phase 0 — Freeze & tường (tuần 1)

**Mục tiêu:** biết chính xác grokbot2 đang dính gốc ở đâu; không tăng coupling.

**Việc**

- [ ] Bảng coupling: file grokbot2 × giả định contract gốc (lệnh, kênh SSE, RPC, tool enum).
- [ ] `GROKBOT2_STRICT_404=1` trên môi trường dev sau khi quan sát 1 phiên đầy đủ.
- [ ] Cấm import mới từ đường dẫn asar / `grokbot-fe-extracted` trong `src/` runtime.
- [ ] Ghi rõ: pool `admin.halcion.vn` là **dependency hạ tầng**, không phải project gốc.
- [ ] Baseline: `parity-report.mjs`, `tool-coverage.mjs`, `e2e-run.mjs --regression`.

**Dependencies:** app gốc cài được, `:8788` chạy.  
**Risks:** strict 404 làm gãy RPC chưa ghi nhận → mitigation: observe 48h trước khi bật.  
**Exit criteria:** xem §5.0.

### Phase 1 — Modular monolith (tuần 2–4)

**Mục tiêu:** ranh giới S1–S12 **trong process**, `chat.ts` không còn god-file.

**Việc**

- [ ] Tách `services/grokbot-backend/src/{directory,conversation,runtime,identity}/` hoặc packages `@grokbot2/{directory,conversation,…}` export API TypeScript.
- [ ] `gateway.ts` chỉ: parse lệnh Cursor → gọi port domain → map response.
- [ ] Roster không đọc transcript internals; conversation không tạo agent.
- [ ] Giữ một `store.ts` nhưng **repository per context** (agents vs entries vs parked).
- [ ] Test đơn vị cho parse cron, tool-calls, transcript sequence — không cần FE gốc.

**Dependencies:** Phase 0 baseline xanh.  
**Risks:** regress SSE sequence (đã từng freeze bubble) → e2e-ordered-sequence bắt buộc.  
**Exit criteria:** §5.1.

### Phase 2 — BFF + Anti-corruption (tuần 4–5)

**Mục tiêu:** domain **không biết** protobuf hay tên lệnh `getAgentTranscriptTail`.

**Việc**

- [x] ~~Package~~ `@grokbot2/cursor-acl`~~: map 134 lệnh + bootstrap → port S1–S12 (~~`packages/cursor-acl`~~).~~
- [x] ~~Domain events in-process:~~ `src/events.ts`~~, 4 event; ACL subscribe rồi đẩy SSE~~ `transcript` ~~+~~ `agent-upserted`.
- [x] Proto chỉ còn trong ACL + `packages/grokbot-proto` (`boundaries.test.ts` cưỡng chế).
- [x] OpenAPI cho API native — `docs/api/grokbot2-v0.yaml`, spec only, FE chưa đổi.

**Dependencies:** Phase 1 packages.  
**Risks:** map thiếu field → FE gốc im. Mitigation: contract-test.mjs + Cửa C khi có hai app.  
**Exit criteria:** §5.2.

### Phase 3 — Persistence tách schema (tuần 5–6)

**Mục tiêu:** hết god-file JSON; sẵn sàng dual-process.

**Việc**

- [x] SQLite (`node:sqlite`) — bảng `agents`, `entries`, `parked`, `automations`, `attachments_meta`.
- [x] Migration từ `state.json`; backup rolling giữ nguyên (JSON đóng băng + `grokbot.sqlite.N.bak`).
- [x] Transaction: một persist = append entries + seq per agent (`BEGIN IMMEDIATE`).
- [x] Chưa chia database per service.

**Dependencies:** Phase 1 repos.  
**Risks:** mất data → snapshot + dry-run restore.  
**Exit criteria:** §5.3.

### Phase 4 — Extract brain + runtime (tuần 7–8)

**Mục tiêu:** process **runtime** riêng; BFF giữ SSE về client gốc.

**Việc**

- [x] Incremental sqlite: UPSERT + keyed prune (không `DELETE FROM` cả bảng). ADR-P4-2.
- [x] `services/grokbot-runtime`: **S5 + S4 model step** (`POST /internal/turns` trên `:8789`, parse `TOOL_CALL`; `/internal/complete` = pool-only). Tool execution / park / seq vẫn ở BFF (ADR-P4-1).
- [x] BFF (`:8788`) `sendPrompt` → `completeTurn` → runtime → một delta → conversation write → SSE.
- [x] Sequence transcript **vẫn do S3/BFF cấp**, không do runtime (tránh gap như §2ac parity).
- [x] Timeout / abort: BFF hủy fetch khi `interruptAgentRun`; runtime abort pool khi `req` close.
- [x] Health: runtime down → bubble lỗi, presence clear (`e2e-runtime-down`).

**Dependencies:** Phase 3 DB.  
**Risks:** abort mid-tool, dual-write. Mitigation: e2e-abort-swallows-tool, e2e-pool-failure.  
**Exit criteria:** §5.4. **Do not `--advance` past P4 until those e2e (and p50) are green with the runtime process up.** Chunked internal deltas ship as NDJSON on `/internal/turns`. Tool execution stays on the BFF.

### Phase 5 — Extract computer (tuần 8–9)

**Mục tiêu:** box/VNC/exec không sống trong process chat.

**Việc**

- [x] `services/grokbot-computer` (`:8790`): forever-box status, exec proxy, handoff *data*. Park/Promises/SSE/seq stay on the BFF (ADR-P5-1).
- [ ] Browser CDP (S7) stays on the BFF this cut — ride with computer later, next to the SSH tunnel.
- [x] BFF `getForeverBoxStatus` → HTTP computer when `GROKBOT2_COMPUTER_URL` is set; unset = in-process; set-but-down = pane `off` with `agentId` (not 500 `sendPrompt`).
- [x] Exec daemon URL is owned by the computer process; BFF does not call the box when the computer URL is set. `infra/vps` is box-host deploy, not the chat BFF.

**Dependencies:** `.env` VNC/exec hiện có.  
**Risks:** pane “Booting forever” nếu status thiếu `agentId`.  
**Exit criteria:** §5.5.

### Phase 6 — Automations + connectors (tuần 9–10)

**Mục tiêu:** cron/event không block event-loop chat.

**Việc**

- [x] `services/grokbot-ops`: scheduler; khi fire → `POST` conversation `sendPrompt` nội bộ.
- [x] Webhook Slack/GitHub terminate tại ops, không tại BFF công khai rộng.
- [x] Skills/MCP (S12) stay on the BFF until the catalog is not `[]` — không split sớm.

**Dependencies:** token kênh (P6 execution-roadmap) nếu muốn event-trigger.  
**Risks:** không token → phase vẫn xong nếu cron process-separate, event để backlog.  
**Exit criteria:** §5.6.

### Phase 7 — FE độc lập S13 (tuần 10–13) — **đang soak** (không cắt ACL)

**Trạng thái (2026-08-20):** code xong. Pointer vẫn **P7**. `pnpm phase:gate` GREEN, `advanced: false` ([`docs/parity-runs/phase-gate-P7.json`](../parity-runs/phase-gate-P7.json)). Gate B stock app skipped (CDP :9222 down) — OK, không phải lý do `--advance`.

**Mục tiêu:** UI grokbot2 không dùng `Grok Bot.exe`. Việc implement FE **không** còn là next action.

**Việc**

- [x] App Electron hoặc web (Vite) **viết mới**: roster, composer, transcript, approval, computer iframe noVNC. (`apps/grokbot-web`, BFF `native.ts` phục vụ `/v1/*` cạnh `/gw`)
- [x] Chỉ gọi API native (OpenAPI Phase 2), không `/gw/api`, không ConnectRPC.
- [x] Dual-run: gốc :9222 và FE mới cùng BFF — so hành vi chat/box. ([docs/history/dual-run.md](dual-run.md))
- [x] Không copy bundle minify Anysphere vào product (legal). Có thể **tham khảo** UX từ extracted FE.
- [x] Image attachments (`POST /v1/attachments`), write-tool approval cards, interrupt (`DELETE …/turns/current`), roster rename/hide, chat thường (không chỉ `/tool`).
- [x] Native `ask_question` widget: transcript `kind: widget` + nút trên grokbot-web; `POST /v1/agents/{id}/widgets`. (handoff vẫn backlog P8)
- [x] Happy path trên FE 2026-08-20: `http://localhost:5173` New Bot — tin tự nhiên → `web_search` → “Thủ đô của Việt Nam là Hà Nội.” Network: chỉ `/v1/*`, **0 `/gw`**, 0 ConnectRPC.
- [ ] Dùng FE hằng ngày ≥ 5 ngày (điều kiện P8). **Không** `--advance` P7. **Không** `GROKBOT2_CURSOR_ACL=0`.

**Dependencies:** API native ổn; S3 SSE native. Soak daily-use còn mở.  
**Risks:** scope UI lớn. Mitigation: vertical slice đã ship; routines/channels vẫn backlog, không chặn soak.  
**Exit criteria:** §5.7. Phase 7 **chưa** complete.

### Phase 8 — Cutover (tuần 13–14)

**Mục tiêu:** production path không còn project gốc.

**Việc**

- [ ] Launcher `infra/scripts/run.ps1` mở FE grokbot2, không `Grok Bot.exe`.
- [ ] Flag `GROKBOT2_CURSOR_ACL=0` tắt proto + `/gw`.
- [ ] Gốc giữ trên máy **chỉ** để Cửa C nghiên cứu, không phải runtime.
- [ ] Xóa / archive `apps/grokbot-desktop` launch-only; README đổi mô hình.

**Dependencies:** Phase 7 dùng hằng ngày ≥ 5 ngày.  
**Risks:** handoff widget trên FE native còn backlog; `ask_question` đã có nút trên grokbot-web. Checklist §5.8.  
**Exit criteria:** §5.8.

### Phase 9 — Scale (backlog, không hẹn tuần)

Bus (NATS), DB per service, multi-user, k8s. **Chỉ mở** khi Phase 8 xanh và có user thứ hai hoặc CPU BFF > 70% bền vững.

---

## 5. Migration checklist & exit criteria

Cách dùng: không sang phase sau nếu **Exit** đỏ. Checklist là việc; Exit là đo được.

### 5.0 Phase 0

**Checklist**

- [x] Inventory coupling committed (bảng §1.3 + lệnh stub).
- [x] Baseline JSON: `docs/parity-runs/strangler-baseline.json` (111/120, tool 28/54, regression PASS).
- [x] Runtime không đọc asar.
- [x] Legal wall trong README: FE gốc = adapter tạm.

**Exit**


| Metric                    | Pass                               |
| ------------------------- | ---------------------------------- |
| Regression e2e            | PASS (cùng bộ hiện tại)            |
| Import asar trong `src/`  | 0                                  |
| Unknown `/gw` sau 1 phiên | danh sách đóng, không tăng im lặng |


### 5.1 Phase 1

**Checklist**

- [ ] `chat.ts` tách: directory / conversation / runtime (hoặc nhỏ hơn 800 dòng/file theo convention repo).
- [ ] Gateway không `new` transcript; chỉ gọi port.
- [ ] Unit test tool-calls + ordered seq không cần Electron.

**Exit**


| Metric                    | Pass                                          |
| ------------------------- | --------------------------------------------- |
| `e2e-ordered-sequence`    | pass                                          |
| `e2e-standing-permission` | pass                                          |
| Typecheck                 | `pnpm typecheck` xanh                         |
| Cross-import domain       | directory ↛ runtime internals (lint/boundary) |


### 5.2 Phase 2

**Checklist**

- [x] Zero `from "@grokbot2/proto"` trong domain packages.
- [x] `cursor-acl` là nơi duy nhất biết `getAgentTranscriptTail`.
- [x] OpenAPI native v0 (agents, send, transcript, health).

**Exit**


| Metric                      | Pass                      |
| --------------------------- | ------------------------- |
| App gốc vẫn vào workspace   | screenshot / e2e-app-full |
| `contract-test.mjs` (Cửa A) | xanh                      |
| Proto import ngoài ACL      | 0                         |


### 5.3 Phase 3

**Checklist**

- [x] Migrate `state.json` → SQLite, rollback doc.
- [x] Restart backend: roster + parked cards + automations còn.

**Exit**


| Metric                | Pass                                                |
| --------------------- | --------------------------------------------------- |
| Restart giữa approval | card vẫn resolve (parity parked)                    |
| File `state.json`     | chỉ backup, không ghi đường nóng                    |
| Integrity             | seq per agent liên tục sau 100 message xen kẽ 2 bot |


### 5.4 Phase 4

**Checklist**

- [x] Hai process: BFF + runtime (`pnpm backend`).
- [x] Kill runtime: UI không spin presence (`e2e-runtime-down`).
- [x] Interrupt hủy HTTP turn (`brain.test.ts` abort + runtime `req` close).

**Exit**


| Metric                    | Pass                        |
| ------------------------- | --------------------------- |
| Latency chat p50          | ≤ 1.3× baseline cùng model  |
| `e2e-abort-swallows-tool` | pass                        |
| `e2e-pool-failure`        | pass                        |
| SSE gap                   | 0 trên e2e-ordered-sequence |


### 5.5 Phase 5

**Checklist**

- [x] Computer service health độc lập.
- [x] BFF không shell ra box.

**Exit**


| Metric                 | Pass                                         |
| ---------------------- | -------------------------------------------- |
| `e2e-box-push`         | pass                                         |
| Handoff skip/continue  | pass                                         |
| Chat khi computer down | vẫn trả lời (pane off, không 500 sendPrompt) |


### 5.6 Phase 6

**Checklist**

- [x] Cron fire khi BFF restart (lock DB).
- [x] Webhook không đi vào `index.ts` monolith.

**Exit**


| Metric       | Pass                                 |
| ------------ | ------------------------------------ |
| Routine cron | chạy đúng giờ ± 1 phút, có history   |
| Chat p50     | không xấu hơn Phase 4 khi 10 routine |


### 5.7 Phase 7

**Trạng thái:** đang soak — **không** đóng Phase 7, **không** `--advance`. Gate HTTP GREEN 2026-08-20 (`lastGatePass: true`, `advanced: false`). `e2e-native.mjs` pass; Gate B (`local-e2e`) skipped vì CDP :9222 down.

**Checklist**

- [x] FE grokbot2: login local, roster, chat, tool card, VNC iframe.
- [x] Không spawn `Grok Bot.exe` trong `run-web.ps1` (profile dev-new). (`infra/scripts/run-web.ps1`)
- [x] Dual-run doc: gốc chỉ để so.
- [x] Attachment ảnh, write-tool approval, interrupt, roster rename/hide, chat thường.
- [x] Native `ask_question` widget (không còn text-only trên grokbot-web).
- [ ] Soak: dùng FE ≥ 5 ngày trước khi mở P8.

**Exit**


| Metric              | Pass                                                                     | 2026-08-20 |
| ------------------- | ------------------------------------------------------------------------ | ---------- |
| Happy path          | gửi tin → tool → reply trên FE mới, 0 Cursor ACL trên network tab FE mới | **xong** — FE :5173 New Bot, tin tự nhiên → `web_search` → reply Hà Nội; network chỉ `/v1/*` |
| Parity chức năng P0 | chat, roster CRUD, interrupt, approval, attachment ảnh                   | **xong** — native `/v1` + FE; `e2e-native.mjs` pass trong gate P7 |
| Soak / daily-use    | FE dùng hằng ngày ≥ 5 ngày                                               | **mở** — điều kiện P8; không `--advance` vì dòng này |
| Legal               | không ship `app.asar` / renderer minify hãng                             | **xong** |


### 5.8 Phase 8

**Checklist**

- [ ] `GROKBOT2_CURSOR_ACL=0` default trên `pnpm backend`.
- [ ] README / CLAUDE.md: “standalone agent”, không “point stock app”.
- [ ] Package proto chuyển `dev`/archive.

**Exit — Definition of Done chương trình**


| Metric              | Pass                                                     |
| ------------------- | -------------------------------------------------------- |
| Production launcher | không tham chiếu `Grok Bot.exe`                          |
| Listen ports        | không phục vụ `/aiserver.v1` trừ test flag               |
| Phụ thuộc git       | không submodule/path tới grokbot-fe-extracted            |
| On-call             | một người chạy `pnpm backend` + FE grokbot2 ra chat được |


---

## 6. Timeline tổng & dependencies

```
T1     T2        T4   T5    T6     T8     T9    T10        T13  T14
├─0─┤
    ├──── 1 ────┤
            ├─2─┤
                ├─3─┤
                    ├── 4 ──┤
                            ├─5─┤
                                ├─6─┤
                                    ├──── 7 ────┤
                                                ├─8─┤
```


| Phase | Tuần  | Phải xong trước       | Có thể song song           |
| ----- | ----- | --------------------- | -------------------------- |
| 0     | 1     | —                     | —                          |
| 1     | 2–4   | 0                     | viết OpenAPI nháp          |
| 2     | 4–5   | 1                     | —                          |
| 3     | 5–6   | 1                     | 2 nếu ACL chưa đụng schema |
| 4     | 7–8   | 3, 2                  | —                          |
| 5     | 8–9   | 3                     | 4 (khác process)           |
| 6     | 9–10  | 3                     | 5                          |
| 7     | 10–13 | 2 (spec), 4 (chat ổn) | 5–6 slice mỏng             |
| 8     | 13–14 | 7                     | —                          |


---

## 7. Risks (toàn chương trình)


| #   | Risk                             | Phase | Mức            | Mitigation                                                   |
| --- | -------------------------------- | ----- | -------------- | ------------------------------------------------------------ |
| R1  | Tách process làm gãy ordered SSE | 4     | Cao            | Seq chỉ ở conversation; e2e sequence bắt buộc                |
| R2  | Dual-write state.json + SQLite   | 3     | Cao            | Cờ một writer; cấm hai format cùng lúc                       |
| R3  | FE mới scope nổ                  | 7     | Cao            | Vertical slice; gốc giữ đến 8                                |
| R4  | Legal nếu nhúng bundle hãng      | 7     | Cao            | UI viết lại; extracted chỉ reference                         |
| R5  | Computer down kéo chat           | 5     | Trung          | Circuit: computer optional                                   |
| R6  | Strict 404 sớm                   | 0     | Trung          | Observe rồi mới bật                                          |
| R7  | Microservices premature          | 4–6   | Trung          | Phase 1–3 bắt buộc; 4+ chỉ khi boundary sạch                 |
| R8  | Pool không native tool           | mọi   | Thấp (đã biết) | Giữ TOOL_CALL trong runtime, không copy protobuf tools ra FE |


---

## 8. Việc không làm (cố ý)

- Không implement 9 lệnh shared rooms để “cho đủ 120” — không có relay.
- Không coi 14 tool IDE (lints, SCM, semsearch) là backlog sản phẩm grokbot2.
- Không k8s / service mesh trước Phase 8.
- Không yêu cầu Notion/Jira để phase xanh — checklist trong file này là nguồn; tracker ngoài là bản sao.

---

## 9. Việc làm ngay (tuần này)

Pointer **P7**, đang soak — **không** implement FE từ đầu, **không** `--advance`, **không** `GROKBOT2_CURSOR_ACL=0`, **không** mở P8.

1. Dùng `apps/grokbot-web` (`pnpm web` → `http://localhost:5173`) làm UI hằng ngày ≥ 5 ngày.
2. Giữ dual-run: stock `Grok Bot.exe` chỉ để so / Gate B khi CDP :9222 lên — không phải runtime production.
3. Khi soak đủ ngày: mới tính P8 cutover (`GROKBOT2_CURSOR_ACL=0`, ngừng launch `Grok Bot.exe`).
)