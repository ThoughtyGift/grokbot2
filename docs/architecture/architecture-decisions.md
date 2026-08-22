# Architecture decisions — grokbot2 (Phase 0 freeze)

**Ngày:** 2026-08-19  
**Status:** accepted cho phạm vi Phase 0. Không tách process, không sửa nghiệp vụ.

Đây không phải thư mục `docs/adr/` (chưa tạo). Quyết định lớn hơn nằm [ROADMAP.md](../ROADMAP.md). File này **đóng băng** những gì Phase 0 đã chọn.

---

## ADR-P0-1: Strangler Fig, không rewrite tuần 1

**Status:** accepted  
**Context:** UI duy nhất là `Grok Bot.exe`. Cắt proto/`/gw` ngay thì mất workspace.  
**Decision:** Giữ app gốc làm facade. Tách capability phía sau. FE riêng = Phase 7.  
**Alternatives:** Big-bang microservice; fork renderer minify — loại vì legal + rủi ro SSE.  
**Consequence:** Mọi feature mới phải đi qua `gateway.ts` cho đến ACL (Phase 2).

---

## ADR-P0-2: Modular monolith trước khi chia process

**Status:** accepted  
**Context:** `chat.ts` + `state.json` là god object. Chia mạng sớm = dual-write + lệch sequence.  
**Decision:** Phase 1 = package/module trong **một** process. Process 2 = Phase 4 sau SQLite.  
**Consequence:** Không mở service HTTP mới trong Phase 0–3.

---

## ADR-P0-3: Ranh giới theo business capability

**Status:** accepted  
**Decision:** S0–S13 trong ROADMAP §2. Không chia “layer” (controller vs service) thành process.  
**Consequence:** Roster ≠ transcript ≠ turn ≠ box.

---

## ADR-P0-4: FE gốc là adapter tạm (legal wall)

**Status:** superseded by [ADR-F0-1](#adr-f0-1-fe-gốc-đã-patch-là-ui-production-acl-là-lõi-vĩnh-viễn) (2026-08-20)
**Decision (historical):** Binary Anysphere is a rented viewer; an independent product needed a grokbot2 UI. Do not redistribute the signed client. See [legal.md](legal.md).
**What still holds:** no redistribution; `src/` still does not read `app.asar`.
**What does not:** FE gốc is no longer “temporary”. The patched stock app is production UI; ACL stays.

---

## ADR-P0-5: Pool `admin.halcion.vn` không phải project gốc

**Status:** accepted  
**Decision:** Dependency hạ tầng của chủ máy. Giữ qua mọi phase. Không thay Cursor model cloud.

---

## ADR-P0-6: STRICT_404 và AUTH đã bật — không tắt trong Phase 0

**Status:** accepted (quan sát: `.env` đã `GROKBOT2_STRICT_404=1`, `GROKBOT2_AUTH=enforce`)  
**Context:** Roadmap bảo bật 404 sau một phiên quan sát. Máy này **đã** bật. Coverage unknown chủ yếu là probe 404.  
**Decision:** Không đổi flag. Không nới `200 {}` cho path lạ.  
**Risk:** RPC/gateway mới chưa ghi nhận sẽ 404 — theo dõi `services/grokbot-backend/.data/coverage.json`.

---

## ADR-P0-7: 9 shared-room không implement

**Status:** accepted  
**Decision:** `intentionallySkipped` trong `box-host-contract.json`. Relay giả tạo room không ai vào.  
**Consequence:** Cửa A commands 111/120 là đủ, không phải 120/120.

---

## ADR-P0-8: Hợp đồng asar commit trong git; đường cài đặt có thể unpacked

**Status:** accepted (default path closed 2026-08-19)  
**Context:** Installer unpacks `resources/app/` and may rename the archive to `app.asar.disabled-by-grokbot2`. A packed copy also lives at `Desktop/Grok Bot/resources/app.asar` (sibling of the repo), not always under `grokbot2/Grok Bot/`.  
**Decision:** `extract-contract.mjs` resolves **files only** (never `host-main.cjs`, never unpacked dirs), in order: `GROKBOT2_ASAR`, repo copy, Desktop sibling copy, install `app.asar`, then `app.asar.disabled-by-grokbot2`.  
**Consequence:** `extract-contract --check` and `e2e-run --regression` P1 Gate A are green without `--asar` on this machine.

---

## ADR-P0-9: `agents-automation` is not a wire channel

**Status:** accepted (fixed to close Cửa A)  
**Context:** `broadcast("agents-automation")` was dropped by the coordinator; the wire name is `automations` (same class as the old `roster` bug).  
**Decision:** `gateway.ts` broadcasts `automations`. Inventory originally froze this; leaving Cửa A red blocked every later phase, so the one-line remap is in Phase 0.

---

## ADR-P2-1: ACL là package, không phải folder trong service

**Status:** accepted (2026-08-19)
**Context:** Toàn bộ từ vựng Cursor (134 lệnh `/gw/api/*`, 16 tên channel SSE, bootstrap protobuf) nằm trong `services/grokbot-backend/src/gateway.ts` — cùng process, cùng module graph với domain. Một folder `src/acl/` sẽ vẫn cho phép domain import ngược vào đó mà không ai thấy.
**Decision:** `packages/cursor-acl` là một package riêng, phụ thuộc **duy nhất** vào `@grokbot2/proto`. Nó không import gì từ `services/`; service truyền vào các port (`AclPorts`, một nhóm cho mỗi S-service theo §4). `gateway.ts` chỉ còn là adapter khai báo hàm nào trả lời port nào.
**Consequence:** Chiều phụ thuộc bị cưỡng chế bởi ranh giới package chứ không bởi kỷ luật con người. Khi S4/S5 rời process ở Phase 4, đúng một nhóm port được trỏ sang HTTP client và bảng lệnh không đổi. Giá phải trả: port nhận `(args: any)` — đây là chủ ý, xem chú thích trong `ports.ts`.

---

## ADR-P2-2: Domain publish event, không giữ sink của transport

**Status:** accepted (2026-08-19)
**Context:** Bốn sink một-chỗ (`setUpdateSink`, `setRosterSink`, `setBoxStatusSink`, `setAutomationsSink`) để transport nhét callback vào domain. Chỉ một listener tồn tại được, và domain giữ tham chiếu tới thứ sẽ biến mất khi FE native ra đời.
**Decision:** `src/events.ts` là bus in-process với 4 event grokbot2: `transcript.append`, `agent.upserted`, `computer.status`, `automations.changed`. Domain gọi `publish`; ACL `subscribe` một lần và dịch sang channel + envelope.
**Consequence:** Quyết định "channel nào, có `ordered` hay không, `appended` hay `updated`" nằm hết ở ACL — nơi duy nhất biết client. Phase 7 thêm listener cho API native mà domain không cần biết. Subscriber throw không làm chết turn đang publish (`events.test.ts`).

---

## ADR-P2-3: OpenAPI native v0 viết trước khi có server

**Status:** accepted (2026-08-19)
**Context:** ROADMAP §5.2 yêu cầu spec native (agents, send, transcript, health) nhưng chưa bắt FE dùng.
**Decision:** `docs/api/grokbot2-v0.yaml`, viết **ngay sau** khi định nghĩa port ACL, vì port được thiết kế theo đúng các shape đó. Tên event SSE native trùng nguyên văn tên event của bus.
**Consequence:** Spec và port không âm thầm lệch nhau. Các surface chưa tách (S6/S8/S9/S10/S11/S12) được ghi rõ path dành trước ở cuối file, để v0.x sau không cắt lại namespace.

---

## ADR-P3-1: `node:sqlite` là đường nóng; `state.json` đóng băng sau migrate

**Status:** accepted (2026-08-20)
**Context:** `store.ts` ghi cả thế giới ra JSON mỗi 400 ms. 811 KB, 18 bot, 490 entry, 16 parked — một write hỏng mất hết. P4 cần hai process cùng đọc state; file JSON không có transaction.
**Decision:** SQLite qua `node:sqlite` (đã có trên Node 22.16, không native compile). Một `saveNow`/`scheduleSave` = một `BEGIN IMMEDIATE` gồm agents + entries (seq per agent) + parked + automations + attachments_meta + các bảng phụ. `state.json` import một lần rồi không ghi nữa — rollback source, xem `docs/sqlite-rollback.md`. Backup rolling chuyển sang `grokbot.sqlite.N.bak`; vòng JSON `.bak` giữ nguyên tại thời điểm migrate. Test `NODE_TEST_CONTEXT` không được mở `.data` của user.
**Consequence:** Domain không đổi API (`loadState`/`scheduleSave`). Persist is UPSERT + keyed prune (ADR-P4-2), not DELETE+rewrite — so a second process INSERT is not wiped on the next BFF save.

---

## ADR-P4-1: S5 + S4 model step are a separate process; tool execution stays on the BFF

**Status:** accepted (2026-08-20), updated (2026-08-20)
**Context:** ROADMAP P4 wants `services/grokbot-runtime` to carry S4 + S5 and `POST /internal/turns`. The full tool loop (approval, park, seq, SSE) cannot move in one cut — runtime must never assign `seq` (parity.md §2ac), and tools mutate BFF sqlite/roster/widgets.
**Decision:** Runtime (`:8789`) owns **one model step**: pool + `parseToolCalls`. Canonical path `POST /internal/turns` (NDJSON `delta`/`done` when `stream: true`). `POST /internal/complete` is pool-only JSON (no parse). BFF `brain.ts` fetches `/internal/turns` when `GROKBOT2_RUNTIME_URL` is set. Seq, SSE, transcript write, tool execution, park, interrupt (`AbortController` → fetch abort → runtime `req` close) stay on the BFF. URL **unset** = in-process pool + parse for e2e that spawn one process (`e2e-pool-failure`). URL **set but down** = `runtime down`, no silent fallback (`e2e-runtime-down`). `planBatches` stays on the BFF because `isParallelSafe` is the host tool registry.
**Consequence:** Two processes when `pnpm backend`. The S4 *loop* (while tools remain) is still BFF-driven: each iteration is one `/internal/turns` round. Do not `--advance` P4 while abort / pool-failure / ordered-sequence are red on dual-process. HTTP e2e in the P4 gate run even if CDP 9222 is down.

---

## ADR-P4-2: SQLite persist is UPSERT + keyed prune, not DELETE FROM + rewrite

**Status:** accepted (2026-08-20)
**Context:** ADR-P3-1 left incremental INSERT-only for P4 so two processes can share `grokbot.sqlite`. `DELETE FROM agents` inside `BEGIN IMMEDIATE` is invisible to WAL readers, but a second writer that INSERTed a row loses it when the first process commits a stale full rewrite.
**Decision:** `store.ts` keeps `loadState` / `scheduleSave` / `saveNow`. Each persist UPSERTs rows present in the snapshot (`ON CONFLICT DO UPDATE`) and prunes only keys the snapshot no longer holds, via a TEMP keep-table (not `NOT IN (?,?,…)` — SQLite binds C-strings, so a `\0` separator would truncate, and a long transcript would blow the variable cap). Snapshot is still authority for this process: an extra row another writer added for an agent this snapshot lists is pruned. Live `.data` is only touched by the running backend.
**Consequence:** Unchanged rows keep their `rowid`. `deleteAgents` still drops that agent's entries. Tests pin `GROKBOT2_STATE_FILE` / `GROKBOT2_SQLITE_FILE` and `NODE_TEST_CONTEXT`.

---

## ADR-P5-1: S6 computer is a separate process; browser CDP and seq stay on the BFF

**Status:** accepted (2026-08-20)
**Context:** ROADMAP P5 wants `services/grokbot-computer` to carry forever-box status, exec, and (optionally) browser CDP. The pane hangs on "Booting forever" if status omits `agentId`. Seq/SSE/transcript cards cannot move with the box (parity.md §2ac, same cut as ADR-P4-1). Chat must still answer when the computer process is down — unlike runtime, computer is not on the model hot path.
**Decision:** Computer (`:8790`) owns who is using the screen, the VNC URL, handoff *data*, and the HTTP hop to the exec daemon. Canonical routes: `GET /health` (`role: "computer"`), `POST /internal/status|begin|release`, `POST /internal/handoff/start|back`, `POST /internal/exec`. BFF `forever-box.ts` / `box-exec.ts` fetch those when `GROKBOT2_COMPUTER_URL` is set. Release timer, in-flight handoff Promises, transcript sinks, SSE `forever-box` publish, and seq stay on the BFF. URL **unset** = in-process maps for e2e that spawn one BFF. URL **set but down** = `{ agentId, state: "off" }`, never omit `agentId`, never 500 `sendPrompt` (`e2e-computer-down`). Browser CDP (`browser.ts`, `GROKBOT2_BROWSER_CDP`) stays on the BFF this cut — moving 16 CDP tools is a later hop next to the SSH tunnel, not required to close §5.5.
**Consequence:** Three processes when `pnpm backend`. Do not `--advance` P5 while `e2e-box-push` / handoff skip-continue / computer-down chat are red. HTTP e2e in the P5 gate run even if CDP 9222 is down.

---

## ADR-P6-1: S10 scheduler clock + S11 public webhooks are a separate process; CRUD/history/seq stay on the BFF

**Status:** accepted (2026-08-20)
**Context:** ROADMAP P6 wants `services/grokbot-ops` so cron/event do not occupy the BFF event-loop. ADR-P4-2 forbids a second sqlite writer. Seq/SSE/transcript stay on the BFF (parity.md §2ac, same cut as ADR-P4-1 / ADR-P5-1). Skills/MCP catalog is still `[]` — do not split S12. Browser CDP stays on the BFF (ADR-P5-1). Chat must still answer when ops is down; cron must not silently fall back in-process (that would hide a dead ops).
**Decision:** Ops (`:8791`) owns the 10s tick loop and public Slack/GitHub HTTP (`POST /slack/events`, `POST /github/events`). Canonical health: `GET /health` (`role: "ops"`). Tests may `POST /internal/tick`. When a routine should fire, ops POSTs BFF loopback `/internal/ops/tick` (or `/fire` / `/fire-listeners`); `fire()` still calls `sendPrompt` on the BFF so history + seq stay correct. BFF keeps automation CRUD, `toClientAutomation`, gateway commands, sqlite persist. URL **unset** = in-process `startScheduler()` + ACL `/gw/slack/events` + `/gw/github/events` for e2e that spawn one BFF. URL **set but down** = chat still 200, no in-process cron (`e2e-ops-down`). Explicit empty `GROKBOT2_OPS_URL=` keeps in-process. When the URL is set, ACL `connectors.publicWebhooks` is false and `/gw/slack|github/events` 404. Signature verification stays a TODO behind `GROKBOT2_SLACK_SIGNING_SECRET` / `GROKBOT2_GITHUB_WEBHOOK_SECRET`.
**Consequence:** Four processes when `pnpm backend`. Do not `--advance` P6 while `e2e-cron` / `e2e-ops-down` / chat p50 vs P4 are red. HTTP e2e in the P6 gate run even if CDP 9222 is down. Event-trigger without Slack/GitHub tokens is backlog, not a gate fail.

---

## ADR-P7-1: Native `/v1` on the BFF + Vite FE (fallback, not cutover)

**Status:** accepted (2026-08-20); **cutover clause superseded by [ADR-F0-1](#adr-f0-1-fe-gốc-đã-patch-là-ui-production-acl-là-lõi-vĩnh-viễn)**
**Context:** ROADMAP P7 wanted an independent UI that does not speak `/gw` or ConnectRPC. The OpenAPI was written in P2 (ADR-P2-3) with nothing serving it.
**Decision:** `services/grokbot-backend/src/native.ts` serves `/v1/*` beside `/gw/*`. It calls directory / conversation / runtime / events directly — no `@grokbot2/cursor-acl`, no protobuf. `GET /v1/session` (unauthenticated, loopback) is the local login. `apps/grokbot-web` is a Vite UI. `infra/scripts/run-web.ps1` never spawns `Grok Bot.exe`.
**Consequence:** Happy path on `apps/grokbot-web` is green (2026-08-20): send → `web_search` → reply, network only `/v1/*`. The UI stays as **fallback/debug** (risk R2 if a vendor update enables `OnlyLoadAppFromAsar`). There is **no Phase 8** that turns ACL off. Dual-run: [docs/dual-run.md](dual-run.md).

---

## ADR-F0-1: FE gốc đã patch là UI production; ACL là lõi vĩnh viễn

**Status:** accepted (2026-08-20)
**Context:** P0–P6 shipped the backend. P7 built `apps/grokbot-web` (~620 lines) as a vertical slice. The old Definition of Done required deleting `Grok Bot.exe` from the production path and setting `GROKBOT2_CURSOR_ACL=0`. That would throw away roster windows, routines, skills, computer pane, and widgets the stock app already has — and the fuse state on this machine already allows a patched `resources/app/`.
**Decision:** The **patched stock client** is the production UI. `packages/cursor-acl` + `packages/grokbot-proto` are a **permanent** adapter, not a layer to delete. P7 stops where it stands (`apps/grokbot-web` kept for R2 + debug). P8 (cut ACL / protobuf / `/gw`) is **deleted**. Programme continues as F0–F7 in [ROADMAP.md](../ROADMAP.md).
**Supersedes:** ADR-P0-4 (stock FE as a temporary adapter); the P8 cutover sentence in ADR-P7-1; any comment that “ACL comes off when S13 lives”.
**Does not supersede:** ADR-P0-2 / P0-3 (modular monolith, capability boundaries); legal wall against distributing a patched client.
**Consequence:** Every “ACL rồi sẽ gỡ” rationale in comments and ADRs is void. Patch the client **as code** (`infra/patches/`, F1). Do not `--advance` into a deleted P8. Do not set `GROKBOT2_CURSOR_ACL=0`. Baseline: [`docs/parity-runs/fe-goc-baseline.json`](parity-runs/fe-goc-baseline.json) (gateway + tools + SSE + bootstrap).

---
