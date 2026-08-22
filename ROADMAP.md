# ROADMAP — grokbot2 phục vụ FE gốc đã patch (`Grok Bot.exe`)

**Ngày:** 2026-08-20
**Pointer:** **F2** (launcher verified 2026-08-21; F3 implemented 2026-08-21, **not** `--advance`d) — [`docs/phase-state.json`](docs/phase-state.json) / [`docs/parity-runs/phase-current.json`](docs/parity-runs/phase-current.json).
**Trạng thái:** **ĐỔI HƯỚNG 2026-08-20.** Mục tiêu không còn là "FE native riêng rồi cắt ACL". Mục tiêu mới: **FE gốc đã patch là UI production**, grokbot2 là backend duy nhất nó nói chuyện.
**Roadmap hướng cũ:** [docs/ROADMAP-native-fe.archived.md](docs/ROADMAP-native-fe.archived.md) — archive, không xoá, vì P0–P6 là nền dùng lại nguyên vẹn.
**Phạm vi:** hai bề mặt — **Grok Bot gốc** (Electron Anysphere `sand` v0.20.0, bản cài local đã patch) và **grokbot2** (backend self-host).
**Mục tiêu:** UI của hãng chạy hoàn toàn trên hạ tầng của mình; patch client **tái tạo được từ repo**; e2e đi qua app thật.
**Không nằm trong mục tiêu:** **phân phối** client đã sửa cho bất kỳ ai; giả danh sản phẩm Cursor/Anysphere/xAI. Xem [docs/legal.md](docs/legal.md).

---

## 0. Quyết định đổi hướng (đọc trước tiên)

### 0.1 Quyết định

**Dùng FE gốc đã patch làm UI production. Không tiếp tục xây FE native để thay thế.**

### 0.2 Cái giá phải trả — ghi rõ để sau này không tranh luận lại

Hướng cũ có Definition of Done gồm 4 mệnh đề. Đổi hướng làm **3 trong 4 mệnh đề đó vĩnh viễn không đạt được**:

| DoD hướng cũ | Trạng thái sau khi đổi hướng |
|---|---|
| `Grok Bot.exe` không còn trong đường chạy production | ❌ **đảo ngược** — nó *là* production UI |
| Không `CURSOR_API_BASE_URL` | ❌ **giữ vĩnh viễn** — đây là cơ chế trỏ app về backend mình |
| Không protobuf trên đường nóng | ❌ **giữ vĩnh viễn** — bootstrap RPC là điều kiện app vào được workspace |
| e2e đi qua FE/API của chính grokbot2 | ✅ **vẫn đạt** — nhưng nghĩa đổi: e2e qua app thật trên CDP :9222 |

**Hệ quả kiến trúc lớn nhất:** `packages/cursor-acl` (1.328 dòng cùng `grokbot-proto`) từ **lớp tạm sẽ xoá** trở thành **lõi vĩnh viễn**. Mọi lý lẽ "ACL rồi sẽ gỡ" trong code comment và ADR đều hết hiệu lực.

### 0.3 Cái được

| Được | Cụ thể |
|---|---|
| UI đầy đủ ngay | Roster, transcript windows, routines, skills, computer pane, widget — FE native mới có 620 dòng, không thể sánh |
| Không phải tự bảo trì UI | Không lo scope UI nổ (risk R3 hướng cũ biến mất) |
| P0–P6 dùng lại 100% | Modular monolith, ACL, SQLite, tách runtime/computer/ops — không phụ thuộc FE nào |
| Patch đã chứng minh khả thi | Fuse cho phép; bug drive-path Windows đã fix bằng patch 1 hàm, verify A/B trong app thật |

### 0.4 Cái mất — rủi ro mới phải quản

| Mất | Vì sao |
|---|---|
| **Không sở hữu artifact** | App update ghi đè patch. Đây là rủi ro số 1, xem R1 §7 |
| Bundle minify | Sửa gì cũng phải tìm hàm trong code đã minify. Bug `cOt` mất cả phiên điều tra để tìm 1 hàm |
| Bị khoá vào contract hãng | Hãng đổi tên lệnh / kênh SSE / field protobuf là mình gãy, không kiểm soát được lịch |
| Không phân phối được | Sản phẩm chỉ chạy trên máy đã cài client hãng. Vĩnh viễn personal/research |

### 0.5 Bảng quyết định gốc — phần nào còn hiệu lực

| Quyết định | Chọn | Còn hiệu lực? |
|---|---|---|
| Pattern | Strangler Fig | **Đổi nghĩa** — không còn "bóp cổ để cắt". Giờ là "bọc contract cũ **vĩnh viễn**", tức Adapter/ACL thuần |
| Bước 1 | Modular monolith trong cùng process | ✅ đã xong (P1) |
| Bước 2 | Service theo business capability | ✅ đã xong (P4–P6) |
| Bước 3 | FE riêng nói API native | ❌ **huỷ** — thay bằng: FE gốc nói Cursor dialect, ACL dịch |
| Không làm | 12 microservice ngày 1 | ✅ vẫn đúng |

**Definition of Done mới (toàn chương trình):**

1. `pnpm dev:app` mở backend stack + `Grok Bot.exe` đã patch, chat được, **không** cần bước tay nào.
2. Patch client **dựng lại được từ repo bằng một lệnh** sau khi app update hoặc cài lại máy.
3. Gate B (e2e qua app thật trên CDP :9222) là **bắt buộc**, không còn "skipped with a reason".
4. Các bề mặt UI mà FE gốc mở ra đều trả lời thật hoặc **degrade trung thực** — không `{}` im lặng.
5. Không có bản client đã sửa nào rời khỏi máy này.

---

## 1. Architecture hiện tại

### 1.1 Project gốc — Grok Bot (Anysphere)

Electron đã ký, viewer mỏng lên cloud box. Không có source trong git grokbot2.

| Thành phần | Vị trí trên máy | Vai trò |
|---|---|---|
| Shell | `%LOCALAPPDATA%\Programs\Grok Bot\Grok Bot.exe` | Cửa sổ, single-instance theo profile |
| **Bundle đang chạy** | `resources/app/` ← **patch của mình** | Electron search order: `app.asar` → `app` → `default_app.asar` |
| Bundle hãng (đã gạt) | `resources/app.asar.disabled-by-grokbot2` | Phải rename đi, nếu không nó thắng load order |
| Native deps | `resources/app.asar.unpacked` | `@electron/asar extract` tự kéo vào |
| Main | `dist/electron-main/main.cjs` (không minify) | Bảng `SAND_GATEWAY_COMMANDS` = 120 lệnh |
| Renderer | `dist/renderer` (minify) | UI roster / chat / computer / routines |
| Box host (tham chiếu) | `dist/host/host-main.cjs` | Router `x3s` — server mà grokbot2 giả lập |
| Backend hãng (đã thay) | `api2.cursor.sh` + pod `*.cursorvm.com` | Bị `CURSOR_API_BASE_URL` trỏ về `:8788` |

**Fuse state** (parse từ `Grok Bot.exe`, sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`) — điều kiện tiên quyết của cả hướng này:

```
RunAsNode                             ENABLED    ELECTRON_RUN_AS_NODE=1 chạy Node của app
EnableEmbeddedAsarIntegrityValidation DISABLED   asar không bị hash-check
OnlyLoadAppFromAsar                   DISABLED   resources/app/ được phép làm fallback
EnableNodeCliInspectArguments         ENABLED
```

Nếu một bản update nào bật `OnlyLoadAppFromAsar` hoặc integrity validation → **cả hướng này chết**. Xem R2 §7.

### 1.2 Project clone — grokbot2

```
services/grokbot-backend    BFF :8788 — ACL + auth + bootstrap + SSE
services/grokbot-runtime    :8789 — S5 brain + model step
services/grokbot-computer   :8790 — forever-box status / exec / handoff
services/grokbot-ops        :8791 — cron scheduler + webhook
packages/cursor-acl         LÕI VĨNH VIỄN — 113 entry, bảng lệnh Cursor duy nhất
packages/grokbot-proto      LÕI VĨNH VIỄN — encoder protobuf + bootstrapResponses
packages/pool-client        HTTP → admin.halcion.vn
apps/grokbot-web            FE native 620 dòng — GIÁNG CẤP xuống fallback/debug (§2 S13)
infra/                      launcher + patch pipeline (F1/F2 dựng lại)
docs/extracted/             hợp đồng trích từ app gốc
```

Não: `pool-client` → `admin.halcion.vn` — hạ tầng của chủ máy, không phải project gốc.

### 1.3 Coupling — giờ là **cố ý**, không còn là nợ

Hướng cũ gọi đây là 4 loại coupling phải cắt. Hướng mới: **3 loại đầu là thiết kế**, chỉ loại 4 còn là ràng buộc.

| Loại | Nội dung | Hướng cũ | Hướng mới |
|---|---|---|---|
| 1 — runtime | Không có `Grok Bot.exe` thì không có UI | phải cắt | **chấp nhận, đây là thiết kế** |
| 2 — protocol | Mọi thay đổi domain phải dịch ra 120 lệnh + replica SSE | phải cắt | **chấp nhận** — đó là việc của ACL |
| 3 — dữ liệu | Một `state.json` | đã cắt (P3 → SQLite) | ✅ xong |
| 4 — pháp lý | FE gốc là proprietary | cần UI riêng | **giữ ràng buộc**: personal use, không phân phối |

```
                  ┌──────────────────────────────────────┐
                  │  Grok Bot.exe  +  resources/app/     │
                  │  (patch của mình, tái tạo từ repo)   │
                  └──────────────┬───────────────────────┘
                                 │ CURSOR_API_BASE_URL=http://localhost:8788
                                 │ SAND_BACKEND_URL, --remote-debugging-port=9222
                                 ▼
                  ┌──────────────────────────────────────┐
                  │  BFF :8788                           │
                  │   cursor-acl  111/120 lệnh + 16 SSE  │
                  │   grokbot-proto  bootstrap RPC       │
                  └──┬─────────┬──────────┬──────────────┘
                     │         │          │
              :8789 runtime  :8790     :8791 ops
                     │      computer       │
                     ▼                     ▼
              admin.halcion.vn        cron / webhook
```

### 1.4 Độ phủ hợp đồng — đo lại 2026-08-20

| Bề mặt | Số thật | Nguồn |
|---|---|---|
| Gateway commands | **111/120 (93%)** | `Object.keys(buildCommands())` trên dist ACL. Thiếu đúng 9 lệnh shared rooms |
| Tool catalog | **28/54 (52%)** | Live map `src/runtime/tools.ts` (53 tool) đối chiếu catalog + bảng alias |
| SSE channels | **5/16** | `PUSHED_CHANNELS` / `WIRE_CHANNELS` — push: transcript, agents, agent-upserted, forever-box, automations |
| Bootstrap RPC | **9/10** | `bootstrapResponses` / `BOOTSTRAP_GATE_METHODS`. Thiếu `WatchSandBoxMigration` (empty proto 200) |
| Tool ngoài catalog | 31 | `browser_*`, drafts, routines — bề mặt riêng, không tính vào 54 |
| Skills / workflows / channels | stub | `skillsCatalog` trả `[]`; channels `coming-soon` (đúng như app hãng) |

Baseline: [`docs/parity-runs/fe-goc-baseline.json`](docs/parity-runs/fe-goc-baseline.json). `parity-report.mjs` **exit ≠ 0** nếu tụt dưới mức này.

⚠️ **SSE 5/16 là con số quan trọng nhất mới lộ ra — nó phải lên đầu backlog F4, xếp trên tool catalog.** Hướng cũ không cần quan tâm vì FE native tự định nghĩa event của nó. Hướng mới thì **UI hãng lắng nghe cả 16 kênh**: 11 kênh không push = 11 chỗ trên UI không tự cập nhật, phải reload mới thấy. Đây chính là gốc của gap "live transcript updates: late, not lost". Chưa push: `tray`, `workflows`, `subagents`, `async-tasks`, `mcp-servers`, `teach-recording`, `box-disk-pressure`, `computer-action`, `outline`, `sharing`, `host-settings`.

⚠️ **Thước đo đã từng nói dối, đã sửa 2026-08-20 (F0).** Ba con số cùng tồn tại trong repo, cả ba đều đo thật nhưng đo ba thứ khác nhau:

| Con số | Nguồn | Vấn đề |
|---|---|---|
| **0/120** | `parity-report` grep `src/gateway.ts` | P2 đã chuyển bảng lệnh sang `packages/cursor-acl` → grep khớp 0. **False red**, và một gate đã chạy trên số này |
| 9/54 | list tên hardcode trong `parity-report` | Phải sync tay, đã lệch |
| 12/54 | `Object.keys(TOOLS)` của `src/tools.ts` | Registry nhỏ, **không phải** map mà chat dispatch |
| **28/54** | live map `src/runtime/tools.ts` | ✅ đúng về sản phẩm — tool nào không register được thì tính là thiếu |

`tool-coverage.mjs` **không hỏng** — nó luôn đúng, chỉ cần chạy bằng `npx tsx` (nó import `.ts`). Sau F0 cả hai công cụ đọc chung `scripts/tool-registry.mts` nên **không thể lệch nhau nữa**.

---

## 2. Service boundaries

S0–S12 **không đổi** so với hướng cũ — chúng độc lập với việc FE nào gọi. Chỉ S13 đổi nghĩa.

| ID | Service | Việc nó sở hữu | Trạng thái |
|---|---|---|---|
| **S0** | `edge-bff` | Một cửa: auth session, route, SSE fan-in | ✅ `:8788` |
| **S1** | `identity` | User local, JWT, gateway ticket, host settings | ✅ |
| **S2** | `directory` | Bot, avatar, ẩn/unread, searchAgents | ✅ |
| **S3** | `conversation` | Entries, ordered log, interrupt, reactions, widgets | ✅ — **cấp seq, không ai khác** |
| **S4** | `runtime` | Turn, parse tool, approval/park, subagent | ✅ tool exec ở BFF (ADR-P4-1) |
| **S5** | `brain` | Gọi pool, model id, stream token, compaction | ✅ `:8789` |
| **S6** | `computer` | Forever-box status, VNC URL, handoff, exec | ✅ `:8790` |
| **S7** | `browser` | CDP tab per bot | ⏳ còn ở BFF, cố ý |
| **S8** | `media` | Upload, virtual path, bytes, width/height | ✅ |
| **S9** | `memory` | knowledge_base, memories CRUD | ⚠️ UI memory của app gốc chưa trả lời — F4 |
| **S10** | `automations` | Cron + event trigger | ✅ `:8791` |
| **S11** | `connectors` | Slack/Discord/GitHub/Telegram | ✅ webhook ở ops |
| **S12** | `extensions` | MCP servers, skills catalog | ⚠️ `skillsCatalog` = `[]` — F4 |
| **S13** | ~~`web-desktop`~~ → **`client-patch`** | **Bộ patch cho FE gốc + launcher + pipeline dựng lại** | ❌ **chưa có pipeline** — F1/F2 |

**S13 định nghĩa lại:** không còn là "viết FE mới". Giờ là **sở hữu bộ patch của client hãng**: patch set dưới dạng code, script apply/verify/undo, phát hiện app update, ghim version.

**ACL không còn là lớp tạm.** S0 nói Cursor dialect ra ngoài **vĩnh viễn**. Bên trong vẫn chỉ nói grokbot2 dialect — ranh giới này giữ nguyên vì nó là thứ giúp domain test được không cần Electron, không phải vì sẽ gỡ ACL.

**`apps/grokbot-web` giữ hay xoá?** → **Giữ, giáng cấp.** Nó là bề mặt duy nhất không vướng pháp lý và là cách debug backend khi app gốc gãy. Nhưng **không** đuổi theo feature parity nữa, và **không** phải điều kiện của phase nào.

---

## 3. Lộ trình mới

P0–P6 đã xong và **không phải làm lại** — chúng là backend, độc lập FE. P7 (FE native) **dừng ở trạng thái hiện có**. P8 (cutover khỏi Cursor dialect) **bị xoá**.

```
P0..P6   ĐÃ XONG — modular monolith, ACL, SQLite, tách runtime/computer/ops     (giữ nguyên)
P7       DỪNG    — apps/grokbot-web giữ làm fallback/debug, không đuổi parity
P8       XOÁ     — mục tiêu "tắt protobuf + /gw" trái hướng mới

F0   Re-baseline: sửa thước đo (parity-report, tool-coverage), chốt lại pointer
F1   Patch pipeline as code: apply / verify / undo, dựng lại patch bằng 1 lệnh
F2   Launcher: pnpm dev:app mở backend stack + app đã patch, CDP 9222
F3   Gate B bắt buộc: e2e qua app thật; sửa ~11 script /gw còn 401
F4   Đóng các bề mặt UI mà FE gốc mở ra: skills, memory UI, transcript windows, tools
F5   Shared rooms: quyết định relay thật hay degrade trung thực (9 lệnh cuối)
F6   Update resilience: phát hiện app update, ghim version, tự re-apply patch
F7   Soak: dùng app đã patch hằng ngày, patch dựng lại được từ máy sạch
```

**Luật mới thay cho "luật strangler":**

- **Luật thước đo:** không sửa parity trước khi thước đo parity đúng. Hướng mới lấy parity làm chỉ số sản phẩm chính; đo bằng thước hỏng là tự lừa. (Đây là bài học `measure-before-claiming-fixed` áp vào cấp chương trình.)
- **Luật patch:** mọi patch client phải **là code trong repo**, không sửa tay. Sửa tay = mất sau app update và không ai dựng lại được.
- **Luật degrade trung thực:** không trả `{}` cho lệnh chưa làm. Trả `{ok:false, reason}` — đúng như `commands.ts` đã ghi.
- **Luật không phân phối:** không bao giờ đóng gói / commit / upload bundle client đã sửa.

---

## 4. Plan từng phase

Giả định **1 software engineer**. Cột tuần đã gộp buffer 20%.

### F0 — Re-baseline thước đo (tuần 1)

**Mục tiêu:** biết chính xác backend phục vụ FE gốc được bao nhiêu phần trăm. Không sửa tính năng nào trong phase này.

**Việc**

- [x] `parity-report.mjs`: đọc bảng lệnh từ `packages/cursor-acl` (runtime `buildCommands()`, không grep file). In **111/120**.
- [x] `scripts/tool-registry.mts`: một nguồn duy nhất cho con số tool — live map + bảng alias, in JSON. `parity-report` và `tool-coverage` dùng chung nên không lệch được.
- [x] Chốt con số tool: **28/54** (live map 53 tool). Ba con số cũ (9/12/28) đã giải thích ở §1.4.
- [x] Assert ngưỡng: tụt dưới baseline → **exit code ≠ 0** (đã thử giả lập tụt, exit 1).
- [x] `docs/parity-runs/fe-goc-baseline.json` — gateway 111/120, tools 28/54, SSE 5/16, bootstrap 9/10.
- [x] Đo thêm SSE channel + bootstrap RPC vào baseline (hiện `PUSHED_CHANNELS` + `BOOTSTRAP_GATE_METHODS`; `WatchSandBoxMigration` chưa có body).
- [x] Cập nhật `docs/architecture-decisions.md`: ADR-F0-1 đổi hướng + ACL là lõi vĩnh viễn.
- [x] Sửa comment/ADR nào nói "ACL sẽ gỡ ở Phase 8" (ADR-P7-1 cutover, ADR-P0-4, `cursor-acl` header, dual-run, coupling-inventory). Archive `docs/ROADMAP-native-fe.archived.md` giữ nguyên.
- [x] Dọn 3 con số cũ trong `docs/roadmap.md` (24), `docs/migration-baseline.md` (28/9), `docs/parity.md` — trỏ hết về baseline mới.

**Dependencies:** không.
**Risks:** con số parity thật có thể xấu hơn khi đo cả SSE + protobuf field, không chỉ tên lệnh → đó là thông tin cần biết, không phải lý do hoãn.
**Exit:** §5.F0.

### F1 — Patch pipeline as code (tuần 2–3)

**Mục tiêu:** patch client dựng lại được bằng **một lệnh**, từ máy sạch. Đây là phase quan trọng nhất của cả hướng mới.

Hiện trạng: `resources/app/` **đang có patch active** (patch `cOt` fix drive-path), nhưng **không có script nào trong repo dựng lại được nó**. App update một lần là mất.

**Việc**

- [x] `infra/patches/` — mỗi patch là module khai báo `{id, file, find, replace, expected, marker}`. [`win-drive-path.mjs`](infra/patches/win-drive-path.mjs) là patch đầu tiên (`cOt`, `dist/electron-main/main.cjs`, 1 occurrence).
- [x] [`infra/scripts/patch-client.mjs`](infra/scripts/patch-client.mjs) — `--status` / `--verify` / `--dry-run` / `--apply` / `--undo`.
- [x] Đọc fuse thật từ `Grok Bot.exe`; `OnlyLoadAppFromAsar=ENABLED` hoặc integrity validation bật → **exit 3, dừng, chỉ sang R2**.
- [x] `--dry-run` extract + patch + `node --check` **không chạm** `resources/app` — pipeline test được mà không cược bản đang dùng hằng ngày.
- [x] Occurrence assert: giả lập lệch (`expected: 2` vs thực tế 1) → **exit 1**, in tên patch, không ghi file.
- [x] Giữ `package.json` verbatim (`name: "sand"`) — `--verify` assert điều này.
- [x] `docs/client-patch-state.json` ghi version + sha `app.asar` gốc (do `--apply` viết).
- [x] **Chạy `--apply` thật trên install** rồi boot app. Đã chạy hai lần: lần đầu 2026-08-20, và lần rebuild sạch 2026-08-21 (`docs/client-patch-state.json` → `appliedAt 2026-08-21T02:13:26Z`). Boot xác nhận renderer từ `resources/app`.
- [x] Kiểm `--undo` trên install thật — đã chạy trong chu trình rebuild: `resources/` về đúng layout bản cài mới và **app hãng boot được** từ `app.asar`. Đường lùi là thật.

**Đã chứng minh (2026-08-20):** `--dry-run` extract từ `app.asar` hãng → patch → file dựng lại **byte-identical** với file đang chạy. `--verify` trên install thật (cùng ngày, sau khi nhét `cOt` vào `infra/patches/`): **OK** — `win-drive-path` 1× marker, `package.json` `name: "sand"`, fuse vẫn cho `resources/app`.

**Bẫy đã trả giá — ghi lại:** `@electron/asar` suy ra thư mục sidecar **từ tên file archive**. Sau khi rename thành `app.asar.disabled-by-grokbot2`, nó đi tìm `app.asar.disabled-by-grokbot2.unpacked` và chết ở native đầu tiên (`@anysphere/tree-chunk-napi/index.js`). Nghĩa là recipe "extract app.asar, nó tự kéo unpacked vào" **chỉ đúng TRƯỚC** cái rename mà chính recipe đó yêu cầu — mọi lần extract lại sau khi apply thành công đều gặp lỗi này. Pipeline xử lý bằng cách copy archive thành tên `app.asar` kèm sidecar vào staging trước khi extract.

**Dependencies:** không.
**Risks:** occurrence không khớp sau app update → pipeline **fail đỏ** (đã kiểm). `ELECTRON_RUN_AS_NODE=1` dính lại trong shell làm launch sau đó parse cờ Electron thành cờ Node.
**Exit:** §5.F1.

### F2 — Launcher (tuần 3)

**Mục tiêu:** một lệnh mở cả hệ. `infra/scripts/run.ps1` đã bị **xoá** trong lúc đẩy P7/P8 — dựng lại và nâng cấp.

**Việc**

- [x] Khôi phục `infra/scripts/run.ps1` từ git (`git show HEAD:infra/scripts/run.ps1`) làm điểm bắt đầu.
- [x] Nâng: khởi động **cả 4 process** (BFF + runtime + computer + ops), không chỉ BFF như bản cũ. (`pnpm backend`; reuse nếu `:8788` đã sống.)
- [x] Nâng: kiểm patch state trước khi launch — chưa patch thì exit 2 và chỉ `node infra/scripts/patch-client.mjs --apply`.
- [x] `Remove-Item Env:ELECTRON_RUN_AS_NODE` (bản cũ đã có — giữ, đây là bug đã trả giá).
- [x] Launch với `CURSOR_API_BASE_URL` + `SAND_BACKEND_URL` = `http://localhost:8788`, `--remote-debugging-port=9222`.
- [x] `pnpm dev:app` trong `package.json` gọi script này.
- [x] Dọn port zombie: listener `node`/`tsx` trên **8792–8817** khi khởi động; không đụng `:8788–:8791`.

**Dependencies:** F1.
**Risks:** `Start-Process` từ PowerShell im lặng không tạo process — dùng `cmd /c start ""` hoặc `nohup ... &`.
**Exit:** §5.F2.

### F3 — Gate B bắt buộc (tuần 4)

**Mục tiêu:** e2e chứng minh trên app thật. Hết thời "skipped with a reason" tính là xanh.

**Việc**

- [x] `phase-gate.mjs`: thêm series `F0..F7` vào `ORDER` + `GATES`; với F3 trở đi, **app không lên CDP 9222 = gate ĐỎ**, không phải skip.
- [x] Sửa 11 script `/gw` legacy còn 401 sau khi P0 bật auth enforce: `e2e-tool`, `e2e-compaction`, `e2e-coverage`, `e2e-debug`, `e2e-live-app`, `e2e-live-check`, `e2e-live-update`, `e2e-presence`, `e2e-prompt`, `e2e-vnc` (+ `e2e-box-push` chỉ pass vì tự spawn backend riêng). Dùng chung helper `gwHeaders()`.
- [x] Sửa rò rỉ process: mọi script spawn backend phải dọn con khi thoát bất thường; **bỏ `taskkill /T` mù** — dọn theo **port** (`kill-port.mjs`), từ chối 8788–8791. 8 script `killTree`+`finally` còn thiếu `process.on("exit")` (F3 gate `e2e-pool-failure` và 7 companion): thêm `onExitKill()` vì `process.exit(1)` trong `try` **bỏ `finally`**.
- [x] `e2e-memory`: assert phụ thuộc model tách khỏi assert xác định — tách assert "dữ liệu có persist" (xác định) khỏi "model có gọi tool / có recall" (không xác định).
- [x] Chuẩn hoá cwd: `e2e-memory` dùng `cwd: "services/grokbot-backend"` tương đối nên **chỉ chạy được từ repo root** — làm rõ hoặc resolve tuyệt đối.

**Đã làm 2026-08-21 — và một regress mình tự tạo rồi tự sửa:**

`killTree` trong 16 script dùng `child.pid` của **shell** (`shell: true`), và pid đó sai theo **cả hai chiều**:

1. Taskkill thẳng → khi shell đã thoát và Windows tái dùng số pid, nó giết **process lạ**. Trong phiên này process lạ đó là **BFF :8788, hai lần**.
2. Thêm guard `exitCode !== null` để tránh (1) → thì node cháu sống sót, **rò rỉ orphan**. Một sweep để lại **10 backend** listening trên 8794–8807, và run kế tiếp đỏ vì "port already in use".

Lời giải là bỏ pid, dùng **port mà script sở hữu** (`scripts/kill-port.mjs`): không thể chạm :8788/:8789/:8790/:8791. 8 script được nối vào `killTree`; 7 script còn lại có `killTree` shape khác nên dùng `process.on("exit")` — phủ cả đường thoát mà killTree không phủ (assert throw, timeout, Ctrl-C).

Đo sau khi sửa: 20 script chạy liên tiếp → **0 listener rò rỉ 8792–8830**, **core 4/4 còn sống**, **0 lần 401**.

**Dependencies:** F2 (app launch được thì Gate B mới bắt buộc được).
**Risks:** bắt buộc Gate B làm gate chậm ~90s/lần và cần GUI — chấp nhận, vì đó là bề mặt production duy nhất.
**Exit:** §5.F3.

### F4 — Đóng các bề mặt UI mà FE gốc mở ra (tuần 5–8)

**Mục tiêu:** không còn màn hình nào trong app gốc im lặng.

Hướng cũ **cố ý bỏ** những mục này ("không coi 14 tool IDE là backlog sản phẩm"). Hướng mới **không còn quyền bỏ**: FE gốc mở màn hình nào thì màn hình đó phải trả lời, vì mình không sửa được UI để ẩn nó (mà sửa được cũng là patch minify — đắt).

**Việc** — thứ tự theo mức người dùng nhìn thấy

- [x] **SSE: 5/16 → 9/16 (2026-08-20).** Thêm `subagents`, `outline`, `host-settings`, `mcp-servers`. Xác minh trên wire thật, xem khối bên dưới.
- [x] `getConversationOutline` trả item theo shape của client: `{id, kind, …}` với `kind ∈ user|tool-call|send-message`, gồm cả tool-call kèm `status`. Trước đây trả `{entryId, text, timestampMs}` của riêng user message — key `entryId` UI **không đọc**, và hẹp hơn cái component được xây cho.
- [x] `getAsyncTasks` trả row thật (`{id, kind:"subagent", startedAtMs, detail}`) thay vì `[]`, và push kênh `async-tasks`. SSE 9/16 → **10/16**.
- [x] **Tray `sand-async-task` — đã trả lời, và "0 node" là hành vi ĐÚNG.** Nó là panel opt-in `h5n({agentId, agentName, onClose})`, parent mount có điều kiện: `s != null ? jsx(h5n, {agentId: s, …}, "async-tasks:"+s) : null`. Không có gì tự mở nó khi có async task — phải có hành động người dùng đặt `s`. Nên việc panel vắng mặt **không** nói gì về dữ liệu của mình. Việc còn lại (giá trị thấp): tìm affordance mở panel.
- [x] ~~`skillsCatalog` trả `[]` là gap~~ → **KHÔNG phải gap.** Contract khai `skillsCatalog:{args:"none", reply:"array"}`, và client tự map `[] → null` (`const t = C => C.length === 0 ? null : C`). Trả `{ok:false, reason}` sẽ **vi phạm** reply đã khai là array. `[]` là câu trả lời trung thực cho "không có skill". Có nên làm tính năng skills hay không là quyết định sản phẩm, không phải lỗi parity.
- [x] ~~Màn hình memory của app chưa được trả lời~~ → **KHÔNG tồn tại.** `getAgentMemories` / `deleteAgentMemory` / `clearAgentMemories` xuất hiện **0 lần** trong toàn bộ `dist/renderer`, và không có trong bảng khai contract của renderer; chúng chỉ có trong bảng 120 lệnh của **host** (`main.cjs`, 2 lần mỗi cái). Bài học chung: bảng 120 lệnh là năng lực của HOST, không phải thứ renderer gọi — đừng suy ra backlog UI từ nó.
- [x] **Transcript windows — đo xong 2026-08-21, và phần lớn mục này không tồn tại.** Chi tiết ở khối dưới.
- [x] **Tool catalog — đo xong, và câu hỏi đặt sai.** UI **không gọi tool bao giờ**; tool do model gọi trong lượt. Đo 25 agent / 484 entry / **155 tool-call, tất cả `done`**, và **0** kết quả `(unknown tool)` trên cả hai đường dispatch → **chưa một lần nào model cần tool mình không có.** Phân bố thật: `run_terminal_command_v2` 69, `web_search` 15, `web_fetch` 9, `attach_image` 9, `send_to_user` 8, `glob_file_search`/`read_file_v2` 7, `create_routine`/`message_agent`/`list_dir_v2`/`browser_navigate` 5. 26 tool còn thiếu trong 54 đều thuộc nhóm chưa từng được gọi → **không có bằng chứng tác động**. Đóng tool khi có một lần miss thật, không đóng cho đủ số.
- [x] **Past-conversation search — đã làm.** (Tên trong danh sách gap cũ sai: `PAST_CONVERSATION_EXPLORER` **không tồn tại ở đâu** trong app — renderer 0, electron-main 0, host 0. Tên thật `pastConversationExplorer`, một `subagent_type` trong `dist/host/host-main.cjs`.)
- [x] **Workflows: xoá dòng giả.** `getAgentWorkflows` được app gọi thật (5 lần) và mình trả một row **bịa** (`"Local test skill"`, `"Stub from grokbot2 so Yours → Private has a row"`) — hữu ích khi kiểm màn hình render, nhưng trong client dùng hằng ngày là **một dòng dối trên màn hình**: workflow không mở được, không chạy được, không xoá được. Giờ trả `[]`, vừa trung thực vừa đúng contract (`reply:"array"`, và client tự map rỗng thành không có gì như `skillsCatalog`).

#### Past-conversation search — đã làm (2026-08-21)

Không dịch được qua ACL: không có gateway command, không có kênh SSE. Nó là **năng lực runtime**, và runtime của grokbot2 sở hữu agent loop. Nên làm hai phần:

**1. Tool `search_conversations`** (`src/runtime/tools.ts`). **Cố ý KHÔNG** lấy tên nào trong catalog 54: bản của host tra `_index.json` trên box (`status="FINISHED"`, `source="team"`) — cấu trúc mình không có — nên mượn tên là nhận một contract mình không thực thi. Tên này là của grokbot2 và nói rõ vậy.

- Tra chính `transcripts` mà `getAgentTranscriptTail` phục vụ → kết quả luôn là chỗ user cuộn tới được.
- **Bỏ qua agent hiện tại**: model đã có lịch sử đó trong context, gộp vào thì mọi lần tìm đều vọng lại câu hỏi.
- Snippet lấy **cửa sổ quanh vị trí khớp**, không phải đầu entry — một match ở ký tự thứ 3000 của kết quả shell sẽ vô hình nếu luôn cắt từ 0.
- Cap 20 kết quả mới nhất: output đi vào prompt, 400 hit sẽ đè mất câu trả lời.

Đo thật: `"Hà Nội"` → 4 kết quả · `"workspace"` → 56, hiện 20 mới nhất · từ vô nghĩa → "Không thấy…" · alias `q` + `days:1` → báo đúng phạm vi · thiếu `query` → chỉ dẫn cách dùng, không throw.

**2. Subagent type `pastConversationExplorer`** (`src/subagents.ts`), `allow: ["search_conversations"]`. Prompt nhấn đúng ba điều dễ sai: thử nhiều cách diễn đạt trước khi kết luận không có; chỉ báo cái transcript **thật sự nói**, kèm tên bot và ngày; rỗng thì nói rỗng — một pattern bịa còn tệ hơn "không có gì trong lịch sử".

**Đã xác minh end-to-end (2026-08-21)** — và cái 502 kia **không phải pool sập**, mà là hai bug thật:

**Bug 1 — model của subagent hardcode một model pool không route được.** `SUBAGENT_TYPES` mặc định `"gemini-2.5-flash"`. Đo trên pool của install này:

| model | kết quả |
|---|---|
| `gemini-3.7-flash` | abort sau **45s** (đây là default trong `config.ts` — cũng chết) |
| `gemini-2.5-flash` | **502** sau 38s (trang gateway-timeout của Cloudflare) |
| `claude-opus-5` | **ok trong 6.6s** (chính là `config.model` thật) |

Nên **mọi** subagent fail ở mọi lần gọi pool trong khi lượt chính chạy tốt, và lỗi hiện ra là "pool bad response (502)" — đọc như outage mà không phải. Sửa: default theo `config.model` (model mà install đã chứng minh gọi được), `GROKBOT2_SUBAGENT_MODEL` vẫn override được.

Đối chứng ban đầu của mình (`explore` cũng 502 → "lỗi pool") **đúng dữ kiện nhưng sai kết luận**: cả hai cùng fail vì cùng dùng model hardcode đó, không phải vì pool chết.

**Bug 2 — báo cáo cuối lộ protocol.** Lần chạy được đầu tiên trả về:

```
TOOL_CALL: search_conversations({"query": "…"})
Human: Kết quả search_conversations:
2 kết quả cho "…"
```

Model viết cả dòng tool lẫn phần `Human:` tự bịa trong **một** completion; regex `TOOL_CALL` không khớp shape đó nên vòng lặp coi cả khối là báo cáo và đưa protocol cho user — cùng lớp defect với bubble abort còn dòng `TOOL_CALL`. Thêm `asReport()`: cắt ở marker máy đầu tiên, giữ phần trước nó; nếu không còn gì đọc được thì nói thẳng là không có báo cáo, thay vì in transcript.

**Kết quả sau khi sửa:** `explore` trả prose sạch; `pastConversationExplorer` gọi `search_conversations` thật, lấy 2 kết quả, rồi tổng hợp thành báo cáo có **tên bot + ngày + entry id** (`SeqA — 19/08/2026, e3465` · `agent-256 — 17/08/2026, e2513`). `leaks protocol? no`.

#### Transcript windows — 8 lệnh, chỉ 3 được gọi thật, phân trang đã đúng

**Cái mình tưởng là việc, hoá ra đã xong.** Mình từng ghi "8 lệnh hiện đều trả `transcriptTail`" như một gap. Đọc `transcriptTail` thì nó **đã** tôn trọng `limit` / `beforeSeq` / `before` / `cursor` và **đã** trả `nextBeforeSeq`. Kết luận cũ là suy từ bảng ACL map 8 lệnh về một hàm, không đọc hàm đó.

**Contract thật** (validator trong renderer, không phải đoán):

```js
"transcript-page": n => !Am(n) || !Array.isArray(n.entries)
                        || (n.nextBeforeSeq != null && typeof n.nextBeforeSeq != "number")
                        ? REJECT : n
```

Cursor phân trang là **`nextBeforeSeq`**. `hasMore` mình cũng trả nhưng client **không đọc** — vô hại, giữ lại.

**Lệnh nào thật sự được gọi** (đo bằng `lastArgs` trong `/gw/__coverage`, tức app thật đã gửi):

| Lệnh | args client gửi | số lần | renderer decl |
|---|---|---|---|
| `getAgentTranscriptTail` | `{agentId}` — không limit | **339** | có |
| `openAgentTail` | `{id, limit: 500}` | ghi nhận | có |
| `getAgentTranscript` | `{id, limit: 40}` | 7 | **không** có trong decl, nhưng **vẫn được gọi** |
| `getAgentTranscriptPage` · `getAgentTranscriptWindow` · `openAgentWindowed` · `getAgentThread` · `getTranscript` | — | **0** | không |

Năm lệnh cuối: **0 lần gọi**, 0 lần xuất hiện trong renderer. Chúng ở trong bảng 120 lệnh của **host** — cùng loại nhầm lẫn với "màn hình memory". Giữ chúng alias về `transcriptTail` là đúng (trả đúng shape đã khai), nhưng **không** phải backlog.

⚠️ `getAgentTranscript` là ví dụ ngược lại: **vắng trong decl của renderer mà vẫn được gọi 7 lần.** Nên "grep renderer" là điều kiện cần, không đủ — `lastArgs` của coverage mới là bằng chứng cuối cùng.

**Phân trang đo thật** (`getAgentTranscript {limit:40}` rồi đi lùi bằng cursor nó trả):

```
page 1: 40 entries, seq 3275..3398, overlap=0, next=3275
page 2: 40 entries, seq 3214..3274, overlap=0, next=3214
page 3: 40 entries, seq 3055..3213, overlap=0, next=3055
page 4: 40 entries, seq 3009..3054, overlap=0, next=null
→ 200/200 entry, 0 overlap, cursor tiến, mọi page ACCEPT bởi validator của client
```

**Hot path không phình theo lịch sử:** `getAgentTranscriptTail` không gửi `limit`, nhưng `PAGE = 200` chặn — 200 entry / 245.6 KB / 7 ms, ổn định bất kể transcript dài bao nhiêu.

**Sửa lại một exit criterion sai của §5.3:** nó viết "seq per agent **liên tục**". Không đúng và không nên đúng — `ensureSeq` suy seq từ id entry (`e<N>`), một counter **toàn cục**, nên transcript một agent có lỗ ở chỗ agent khác chen vào. Đo 23 agent: **strictly increasing per agent = YES**, 131 bước không liên tục. Invariant thật là **đơn điệu tăng, không trùng** — và đó là đủ, vì `sse.ts` cố ý **không** gửi envelope `ordered` cho transcript (gửi là đóng băng pane, đã trả giá). Đổi seq sang liên tục per-agent sẽ phá liên kết id↔seq giúp seq bền qua restart, không được gì.

#### SSE — đã làm, và một nhận định cũ bị bác bỏ

**"11 kênh còn thiếu" là cách đọc sai con số 5/16.** Đo từng kênh (2026-08-20) thì chỉ **4** kênh có nguồn dữ liệu thật; 7 kênh còn lại thiếu vì **không có gì để gửi** — đó là gap *tính năng*, không phải gap SSE. Push frame rỗng cho chúng chỉ làm con số parity đẹp lên mà không đổi một pixel nào — đúng loại false-green mà repo này đã trả giá ở 0/120.

| Kênh | Nguồn | Đã làm |
|---|---|---|
| `subagents` | registry `subagentRuns`, đổi `running → done\|aborted\|error` giữa turn | ✅ push `{agentId, subagents}` |
| `outline` | user message trong transcript | ✅ push `{agentId, outline}` |
| `host-settings` | `identity.patchHostSettings` — chính command là writer duy nhất | ✅ push object nguyên vẹn |
| `mcp-servers` | `extensions.mcpServers()` | ✅ push `{servers}` khi `refreshMcp` |
| `async-tasks` | `getAsyncTasks() => []` hardcode | ❌ không có gì để gửi |
| `tray` | mảng `trays` chỉ được đọc/xoá, **chưa bao giờ được ghi** | ❌ luôn rỗng |
| `workflows` | `LOCAL_WORKFLOWS` hằng số | ❌ |
| `sharing` | `{rooms: []}` — không có relay | ❌ F5 quyết |
| `teach-recording` | `{isRecording:false}` | ❌ chưa có tính năng |
| `box-disk-pressure` · `computer-action` | **không có producer nào trong repo** | ❌ chưa tồn tại |

Danh sách 7 kênh này là hằng `NO_DATA_CHANNELS` trong `sse.ts`, và `parity-report` giờ báo **"with a producer: 9/9"** thay vì để 16 trông như đích đến. Mỗi kênh thành push được đúng ngày tính năng của nó làm được việc gì.

**Xác minh trên wire thật** (không phải đọc code): mở `/gw/events`, chạy một turn, đếm frame →
`transcript×78, agents×7, agent-upserted×6, subagents×1, outline×1, host-settings×1, mcp-servers×1`.
`outline` trả về `[{entryId, text, timestampMs}]` thật; `mcp-servers` trả `{servers:["memory","CinAI","toolbox"]}` thật. `contract-test --only channels` **13/13 PASS**. `e2e-console.mjs` trong lúc turn chạy: **0 lỗi renderer**, không cảnh báo parse/schema/reject.

`subagents` và `outline` **bám vào `transcript.append`** (kênh fire mỗi token) nên phải đi qua `broadcastIfChanged` — dedup theo `channel:agentId`. Bằng chứng nó cần thiết: transcript 78 frame nhưng hai kênh kia chỉ 1 frame mỗi cái. Không dedup thì mỗi kênh cũng 78 frame và renderer diff list y nguyên suốt cả reply.

#### Payload shape: 3/4 sai vì suy ra thay vì đọc — đã sửa (2026-08-21)

Lần đầu mình đặt tên key payload bằng cách **suy ra từ reply của command tương ứng**, theo tiền lệ `automations` gửi `{agentId, automations}`. Chạy subagent thật rồi soi DOM: đúng **một** text node chứa `explore`, và nó nằm trong `p.sand-message-content` — tức chính tin nhắn user được echo. Không có occurrence thứ hai ở 3s/6s/12s/20s. Kênh được gửi, không lỗi, và **không render gì**.

Nguyên nhân tìm được bằng cách **đọc ingest map của renderer** (`dist/renderer/assets/index-*.js`), không đoán tiếp:

```js
Se = { agents: e=>ingestAgentsEvent(e), "agent-upserted": …, transcript: …,
       outline: e=>te.ingest(e), tray: …, "agents-workflow": …,
       subagents: e=>se.ingestSubagentsEvent(e), "async-tasks": …,
       "mcp-servers-updated": e=>ae.ingestServersUpdated(e), "agents-automation": …,
       "forever-box": …, "teach-recording": …, "box-disk-pressure": …,
       "computer-action": …, sharing: …,
       "host-settings": e=>{ e.fields.includes("pinnedAgentIds") && loadPinnedAgentsFromBox(),
                             e.fields.includes("sidebarSections") && loadFromBox() } }
```

**Convention KHÔNG thống nhất** — đó chính là cái bẫy:

| ingest | envelope thật |
|---|---|
| `ingestSubagentsEvent` | `t => store.replace(t.parentAgentId, t.subagents)` → **`parentAgentId`** |
| `ingestAsyncTasksEvent` | `t => store.replace(t.parentAgentId, t.tasks)` → **`parentAgentId`** |
| `ingestAutomationsEvent` | `j => apply(j.agentId, j.automations)` → `agentId` |
| `ingestWorkflowsEvent` | `C => store.replace(C.agentId, C.workflows)` → `agentId` |
| `ingestForeverBox` | `C => get(C.agentId)…` → `agentId` |
| outline `te.ingest` | `m => get(m.agentId).snapshots.set(merge(prev, m))` → `agentId`, merge cả frame |

Ba payload sai, đã sửa và verify lại trên app thật:

| Kênh | Sai | Đúng (đã ship) |
|---|---|---|
| `subagents` | `{agentId, subagents}` → `t.parentAgentId` = undefined, rows bị xếp dưới khoá `undefined`: **giao thành công, không lỗi, vô hình** | `{parentAgentId, subagents}` |
| `host-settings` | object settings → `e.fields.includes` **throw** trong handler | `{fields:["pinnedAgentIds"]}` — payload là *change notice*, không phải dữ liệu |
| `mcp-servers` | `{servers:["memory",…]}` string → `se.serverIdentifier` undefined | `{servers:[{id,name,serverIdentifier,transport,…}]}` — dùng chung builder `mcpServerRows()` với `listBoxMcpServers` |

Verify sau khi sửa (cùng một run, wire + DOM + console): `subagents` `{"parentAgentId":"agent-389","subagents":[{…"status":"running"}]}` → `"status":"done"`; `host-settings` `{"fields":["pinnedAgentIds"]}`; `mcp-servers` rows có `serverIdentifier`. **0 lỗi renderer.**

**Vẫn chưa chứng minh:** không có bề mặt UI nào trên màn hình hội thoại hiện danh sách subagent (DOM vẫn 1 node sau khi sửa). Nhưng giờ đảm bảo mạnh hơn một lần soi DOM: payload **khớp đúng code ingest của renderer**, nên store nhận được rows. Panel subagent có thể ở view khác hoặc app build này không có — đó là câu hỏi UI, không phải gap backend. `outline` dùng `agentId` là **đúng**, nhưng UI outline item đọc `t.kind`/`t.status` (`sand-outline-item`) mà `getConversationOutline` chỉ trả `{entryId,text,timestampMs}` của user message → **việc còn lại của F4**, xem checklist.

**Thước đo cũng vừa được vá:** `contract-test` trước đây tìm kênh bằng regex `broadcast("…")` trên source text, nên 4 kênh mới (đi qua `broadcastIfChanged` và helper `push`) **vô hình** với nó và check vẫn xanh trên danh sách ngắn hơn. Giờ nó đọc `PUSHED_CHANNELS` từ ACL đã build — cùng bài học F0.

**Dependencies:** F0 (số đúng), F3 (gate bắt được regress).
**Risks:** danh sách này dài và do UI hãng quyết định, không do mình → phải sắp theo tần suất dùng thật, không theo thứ tự trong file.
**Exit:** §5.F4.

### F5 — Shared rooms: quyết định (tuần 8)

9 lệnh cuối (`createSharedRoom`, `joinSharedRoom`, `setSharedRoomTyping`…) — hướng cũ bỏ vì "không có relay, giả thì tạo room không ai vào được".

Hướng mới vẫn giữ được lựa chọn đó, nhưng phải **quyết định rõ** thay vì để lửng:

- [x] **Chọn (b): từ chối trung thực.** Chi tiết bên dưới.

**Đã chọn (b) và làm xong 2026-08-21.**

Không phải "bỏ 9 lệnh cho đủ 111" như trước, mà là sửa một vi phạm **luật của chính roadmap**: 9 lệnh không có trong bảng ACL, nên router rơi vào nhánh fallthrough và trả **`{}` với HTTP 200** — đúng cái shape file `commands.ts` tự cấm, vì client không phân biệt được "không hỗ trợ" với "chạy rồi, không có gì báo". Log có `[gateway] UNMAPPED …` mỗi lần UI gọi.

Cả 9 **đều có decl trong renderer** (`reply:"record"`, riêng `setSharedRoomTyping` là `"void"`), tức UI gọi được thật. Giờ chúng trả `{ok:false, reason}` — plain object nên **thoả validator `record`**, mà nói thẳng câu trả lời là không.

Vì sao không giả thành công: `createSharedRoom` trả về một id sẽ tạo room **không ai vào được bao giờ**, và UI sẽ hiện danh sách thành viên vĩnh viễn không đầy. Share cần relay mà hai máy đều tới được; đây là một backend local.

**Con số không được nói dối.** Thêm 9 lệnh vào bảng làm gateway nhảy 111 → 120, đọc như "share đã chạy". Nên `parity-report` giờ tách:

```
we answer       : 120/120 (100%)
  of which real  : 111
  explicit refusal: 9  (shared rooms — no relay; ROADMAP F5)
```

Đo trên wire: 4 lệnh `record` → `{"ok":false,"reason":"Sharing needs a relay…"}` **ACCEPT** bởi validator; `setSharedRoomTyping` → `{}` (void). **0** dòng `UNMAPPED` trong log sau khi UI gọi.

**Exit:** §5.F5.

### F6 — Update resilience (tuần 9–10)

**Mục tiêu:** app hãng update không làm chết hệ.

**Việc**

- [x] **Chặn auto-update bằng công tắc của chính app**, không phải hack: `SAND_DISABLE_UPDATES=1` trong `infra/scripts/run.ps1`. Đọc từ `main.cjs`: `hzn(t) { return t.envDisabled ? "disabled-by-env" : t.isLabBuild ? … }` với `envDisabled = process.env.SAND_DISABLE_UPDATES === "1"` — **nhánh đầu tiên**, thắng mọi điều kiện khác. App còn có sẵn chuỗi UI cho đúng trạng thái này: *"Updates are disabled by SAND_DISABLE_UPDATES"*.
- [x] `patch-client.mjs --verify` là health check: phát hiện `resources/app` mất, `app.asar` quay lại, `package.json` đổi tên, patch bị gỡ, **và version drift**.
- [x] Re-apply: pipeline extract asar **mới**, áp patch set, occurrence lệch → fail đỏ kèm tên patch (đã kiểm ở F1 bằng `expected: 2` giả lập).
- [x] Fuse của bản mới: `--apply` parse 4 fuse; bất lợi → **exit 3** kèm chỉ dẫn sang R2, không cố patch.

**Exit:** §5.F6.

### F7 — Soak (tuần 10–12)

- [ ] **Dùng app đã patch làm UI hằng ngày ≥ 5 ngày** — việc của chủ máy, không script nào thay được.

  Nhưng điều kiện này trước đây **không có gì ghi lại**, nên F7 chỉ đóng được bằng trí nhớ. Giờ có `pnpm soak` (`scripts/soak-day.mjs`) ghi vào [`docs/parity-runs/soak-log.json`](docs/parity-runs/soak-log.json), một entry mỗi ngày, idempotent.

  **Nó đo việc DÙNG, không đo điểm danh.** Một ngày chỉ được tính khi **cả hai**: patch verify sạch **và** gateway phục vụ ≥ 50 lệnh kể từ ngày ghi trước. Script chỉ đóng dấu ngày tháng sẽ cho phép đóng phase bằng 5 ngày app nằm im — tệ hơn không có gì. Ngày không tính cũng được ghi kèm lý do (`patch not intact`, `only +N gateway calls`), vì "5 ngày mà 3 ngày patch hỏng" không phải một cuộc soak.

  `pnpm soak:status` xem tiến độ, không ghi gì.
- [x] **Rebuild từ trạng thái hãng sạch — xong 2026-08-21, và nó tìm ra một bug thật.**

  Chu trình đầy đủ trên install thật: `--undo` → `resources/` trở về **đúng layout bản cài mới** (`app.asar`, `app.asar.unpacked`, `elevate.exe`), app hãng **boot được** từ `app.asar` (đường lùi là thật, không phải lý thuyết) → `--apply` → `--verify` 6/6 → boot từ cây đã patch → **Gate B 15/16**.

  **Bug tìm được:** `--apply` copy `resources/app` **trước**, rename `app.asar` **sau**. Lần rebuild sạch dính `EBUSY` ở bước rename — Windows chưa nhả xong mmap của archive vài giây sau khi kill process — và install còn lại **cả hai**: `resources/app` (patch) lẫn `app.asar` (hãng). Asar thắng load order → app boot bản hãng với bộ patch nằm im bên cạnh: *chạy được, sai, và im lặng*. Đúng cái mà script này sinh ra để ngăn.

  Đã sửa ba lớp:
  1. **Pre-flight**: app đang chạy → exit 4, không chạm gì (đã kiểm: mở app rồi `--apply` → chặn đúng).
  2. **Đảo thứ tự**: copy sang `resources/app.new` (install nguyên vẹn) → rename asar **có retry** → mới swap. Rename fail giờ chỉ để lại `app.new` thừa, install vẫn boot bản hãng.
  3. **Rollback**: swap fail → trả `app.asar` về chỗ cũ, không để install không boot được.
- [x] Không có bản client đã sửa nào rời khỏi máy — kiểm 2026-08-21: **0** file client trong git (`git ls-files` không có `app.asar` / `resources/app` / `.exe`), **0** file > 10 MB, và `.gitignore` chặn tường minh (xem dưới).

**Exit:** §5.F7 = Definition of Done §0.

---

## 5. Exit criteria

Checklist là việc; Exit là đo được. Không sang phase sau nếu Exit đỏ.

### 5.F0

| Metric | Pass |
|---|---|
| `parity-report.mjs` | in **111/120**, đọc từ ACL, không grep `gateway.ts` |
| `tool-coverage.mjs` | chạy không crash, in một con số duy nhất, có nguồn |
| Ngưỡng | parity tụt dưới baseline → exit code ≠ 0 |
| ADR | quyết định đổi hướng đã ghi; không còn chỗ nào nói "Phase 8 gỡ ACL" |

### 5.F1

| Metric | Pass | 2026-08-20 |
|---|---|---|
| Dựng lại patch | từ `app.asar` sạch → file dựng lại đúng bản đang chạy | **xong** — `--dry-run` byte-identical, sha256 `3f5f4f51…` |
| Fail đúng | occurrence ≠ kỳ vọng → exit ≠ 0, in tên patch, **không** ghi file | **xong** — giả lập `expected: 2`, exit 1 |
| Fuse guard | fuse bất lợi → dừng, chỉ sang R2 | **xong** — `--apply` exit 3 |
| Apply thật | `--apply` trên install → app boot, `cOt` có mặt | **xong** — chạy trên install thật; app boot, renderer URL là `…/resources/app/dist/renderer/index` (tức cây đã patch, không phải asar); `--verify` 6/6 ok |
| Undo | `--undo` trả về bản hãng, `--verify` phát hiện được | **xong** — thử trên fixture `GROKBOT2_CLIENT_DIR`: undo xoá `resources/app` + trả `app.asar` về; `--verify` sau đó **đỏ 6 lỗi, exit 1**. Install thật không bị chạm |
| State | userData không dời (roster/state còn nguyên sau apply) | **xong** — sau khi xây lại, app vẫn thấy **7 bot cũ** (Gate B: "sees one of 7 existing bots") |
| Gate B trên app đã patch | app thật chạy được end-to-end | **14/16** — roster, tạo/xoá bot, gửi tin, reply render, `list_dir_v2` chạy thật trên box, avatar, computer pane. 2 fail là gap sản phẩm (xem dưới), **không** do patch |

**Gate B — chạy hai lần, kết quả khác nhau; nhận định "gap sản phẩm thật" của mình là SAI.**

| Check | 2026-08-20 | 2026-08-21 (gate F2) |
|---|---|---|
| `the turn ends with a prose answer, not raw TOOL_CALL` | FAIL — *none* | **PASS** — "Thư mục gốc có 27 mục: 4 thư mục…" |
| `that answer is visible on screen` | FAIL — *in transcript but not rendered* | **PASS** — rendered |
| `presence animates during the turn` | PASS (39/40 frame) | PASS — vẫn trong `KNOWN_OPEN` |
| `deleted bot leaves the sidebar` | PASS | **KNOWN** fail — flaky đúng như ghi nhận |

Mình đã ghi hai dòng đầu là "gap sản phẩm, việc của F4". Chúng **không** persistent. Không quy được nguyên nhân một cách chắc chắn:

- "no prose answer" là hành vi model trên **một** sample — cùng loại với các assert đã bị hạ xuống `observe()` trong `e2e-memory`.
- "in transcript but not rendered" **có thể** đã được sửa bởi payload `outline`: frame cũ `{agentId, outline}` thiếu `type` làm reducer trả về chính frame, tức store outline giữ object ở chỗ đáng ra là array — một store hỏng có thể kéo theo component khác trong cùng đường render. Nhưng đây là **giả thuyết**, không phải điều đã chứng minh.

Bài học ghi lại: một lần chạy Gate B **không** đủ để gọi cái gì là gap sản phẩm. `deleted bot leaves the sidebar` minh hoạt ngược lại — pass hôm qua, fail hôm nay, và `KNOWN_OPEN` giữ nó đúng chỗ.

**Không** gỡ `presence animates during the turn` khỏi `KNOWN_OPEN` dù script tự nhắc: lý do ghi trong danh sách là "cửa sổ Electron bị đưa xuống background chỉ trả một frame composited". Nó pass vì các run này cửa sổ đang foreground, không phải vì đã được sửa. Gỡ ra là gate sẽ đỏ ngay lần chạy có cửa sổ nền.

### 5.F2

| Metric | Pass | 2026-08-21 |
|---|---|---|
| Một lệnh | `pnpm dev:app` → 4 process + app đã patch, chat được | **xong** — `infra/scripts/run.ps1`; reuse stack nếu `:8788` sống; CDP `:9222` |
| Chưa patch | launcher cảnh báo và chỉ sang `--apply`, không launch app chưa patch rồi để nó lỗi mờ | **xong** — exit 2 + `node infra/scripts/patch-client.mjs --apply` |
| CDP | :9222 lên, `e2e-app-full.mjs` chạy được | **xong** — 2026-08-21 `pnpm dev:app` reuse `:8788`, `/json/version` 200 (GrokBot/0.20.0), Playwright `connectOverCDP` sees patched renderer `resources/app/dist/renderer/index.html`. Full Gate B suite not re-run this session (F1 was 14/16; 2 product gaps stay F4). |
| Port | không còn zombie dải 8792–8817 sau một vòng e2e đầy đủ | **xong** — launcher dọn `node`/`tsx` 8792–8817; không đụng 8788–8791 |

### 5.F3

| Metric | Pass | 2026-08-21 |
|---|---|---|
| Gate B | **bắt buộc** — app không lên :9222 thì gate ĐỎ | **xong** — `requireLocalApp` trong `phase-gate.mjs`; gate F3 2026-08-21 GREEN **7/7**, Gate B **15/16** (1 `KNOWN`: deleted-bot sidebar). Pointer **vẫn F2** (không `--advance`). |
| Script `/gw` | 0 script fail vì 401 | **xong** — 11 script thêm `gwHeaders()`; đo `listAgents` with-auth **200** / no-auth **401** |
| Rò rỉ process | 0 process treo sau full e2e; BFF/runtime **còn sống** | **xong** — sau gate F3: **0 listener 8792–8817**, core **4/4** sống, CDP 9222 sống. `kill-port` từ chối 8788. `onExitKill` trên 8 spawners còn thiếu exit hook. |
| `e2e-memory` | assert xác định pass; assert phụ thuộc model tách riêng | **xong** — `observe()` báo riêng, exit 0; cwd resolve tuyệt đối |
| `e2e-ordered-sequence` | không đỏ vì SSE của bot khác trên BFF sống | **xong** — lọc frame theo 2 agent test tạo; 4/4 |

**Gate F3 GREEN — 7/7 bước** (đo lại 2026-08-21, pointer **không** `--advance`): `parity-report` · `verify-client-patch` · `e2e-ordered-sequence` · `e2e-standing-permission` · `e2e-abort-swallows-tool` · `e2e-pool-failure` · `e2e-app-full`.

`presence animates during the turn` pass lần này (27/27 frame) nhưng **giữ** trong `KNOWN_OPEN` — cửa sổ đang foreground, không phải đã sửa gap nền. `deleted bot leaves the sidebar` vẫn `KNOWN`.

### 5.F4

| Metric | Pass |
|---|---|
| Màn hình im lặng | 0 — mỗi màn hình app gốc mở ra đều có nội dung hoặc lý do |
| `{}` trả về | 0 cho lệnh chưa làm (phải là `{ok:false, reason}`) |
| Parity | ≥ baseline F0, không tụt |

### 5.F5

| Metric | Pass |
|---|---|
| Quyết định | đã ghi vào ADR, (a) hoặc (b) |
| UI | màn hình shared-room không spinner vô tận trên app thật |

### 5.F6

| Metric | Pass | 2026-08-21 |
|---|---|---|
| Update | sau khi app update, 1 lệnh dựng lại patch, hoặc fail đỏ có tên patch | **xong** — `--apply` extract asar mới; occurrence lệch → exit 1 kèm tên patch |
| Fuse | script kiểm 4 fuse; đổi bất lợi → dừng có thông báo | **xong** — `--apply` exit 3 |
| Auto-update | đã chặn hoặc ghim, có doc | **xong** — `SAND_DISABLE_UPDATES=1` trong launcher |
| Phát hiện đã update | `--verify` đỏ khi version lệch bản đã patch | **xong** — fixture 0.21.0 vs ghi nhận 0.20.0 → `FAIL client version drifted … re-run --apply`, exit 1; install thật không bị chạm |

**Bằng chứng của công tắc update là code + boot, KHÔNG phải màn hình.** `hzn()` là nhánh đầu tiên nên không mơ hồ, và app boot bình thường với biến đã set (CDP 200). Nhưng chuỗi *"Updates are disabled by SAND_DISABLE_UPDATES"* **không tìm thấy trong DOM** — chip update nằm sau panel chưa mount, đúng như tray `sand-async-task`. Muốn xác nhận trên màn hình thì phải mở panel đó.

### 5.F7 — Definition of Done

| Metric | Pass |
|---|---|
| Daily use | ≥ 5 ngày trên app đã patch, không bước tay |
| Máy sạch | dựng patch từ repo bằng 1 lệnh → chat được |
| Phân phối | 0 bản client đã sửa rời khỏi máy |
| Backend | `pnpm dev:app` là đường chạy duy nhất; `apps/grokbot-web` chỉ debug |

---

## 6. Timeline

```
T1     T2   T3   T4        T5 ─── T8        T8   T9 ── T10 ── T12
├─F0─┤
     ├── F1 ──┤
              ├F2┤
                 ├─F3─┤
                      ├───── F4 ─────┤
                                     ├F5┤
                                        ├── F6 ──┤
                                                 ├─── F7 ───┤
```

| Phase | Tuần | Phải xong trước | Song song được |
|---|---|---|---|
| F0 | 1 | — | đọc bundle cho F1 |
| F1 | 2–3 | — | F0 |
| F2 | 3 | F1 | — |
| F3 | 4 | F2 | F4 slice mỏng |
| F4 | 5–8 | F0, F3 | F5 |
| F5 | 8 | F4 (một phần) | — |
| F6 | 9–10 | F1, F2 | F4 đuôi |
| F7 | 10–12 | tất cả | — |

---

## 7. Risks

| # | Risk | Phase | Mức | Mitigation |
|---|---|---|---|---|
| **R1** | **App update ghi đè patch, không dựng lại được** | F1, F6 | **Cao nhất** | Patch as code + `-Verify` như health check + ghim version. Đây là lý do F1 là phase quan trọng nhất |
| **R2** | Bản update bật `OnlyLoadAppFromAsar` / asar integrity | F6 | **Cao, không mitigate được** | Ghim version. Nếu xảy ra: hướng này **chết**, phải quay lại FE native — đó là lý do **không xoá** `apps/grokbot-web` và archive roadmap cũ |
| R3 | Hãng đổi tên lệnh / kênh SSE / field protobuf | F4 | Cao | Ghim version; `extract-contract.mjs --check` phát hiện lệch |
| R4 | Sửa bundle minify tốn kém bất định | F4 | Cao | Chỉ patch khi không có đường qua backend. Ưu tiên sửa ở backend |
| R5 | Pháp lý nếu bản đã sửa bị phân phối | mọi | Cao | Luật không phân phối §3; không commit bundle; `.gitignore` |
| R6 | Thước đo sai làm tưởng xong | F0 | Cao (đã xảy ra: 0/120) | F0 là phase đầu, có ngưỡng exit code |
| R7 | Gate B cần GUI → khó tự động hoá | F3 | Trung | Chấp nhận chậm; đây là bề mặt production duy nhất |
| R8 | Danh sách F4 do UI hãng quyết định, có thể phình | F4 | Trung | Sắp theo tần suất dùng thật, không theo thứ tự file |
| R9 | e2e rò rỉ process, hạ cả BFF | F3 | Trung (đã xảy ra) | Bỏ `taskkill /T`; dọn con khi thoát |
| R10 | Pool không có native tool | mọi | Thấp (đã biết) | Giữ `TOOL_CALL` trong runtime |

**Ghi chú R2:** đây là rủi ro duy nhất không có mitigation kỹ thuật. Vì nó, **archive roadmap hướng cũ và `apps/grokbot-web` phải được giữ** — chúng là đường lùi.

---

## 8. Việc không làm (cố ý)

- Không xoá `apps/grokbot-web` — là đường lùi cho R2, và là bề mặt debug không vướng pháp lý.
- Không xoá `docs/ROADMAP-native-fe.archived.md`.
- Không đuổi feature parity cho FE native nữa.
- Không sửa patch bằng tay ngoài pipeline F1.
- Không đóng tool cho đủ 54 — chỉ đóng cái UI thật sự dùng.
- Không implement shared rooms để "cho đủ 120" trừ khi F5 chọn (a).
- Không phân phối bản client đã sửa, dưới mọi hình thức.
- Không k8s / service mesh.

---

## 9. Việc làm ngay (tuần này)

Pointer **F7** (chuyển ngày 2026-08-22 sau khi F6 xanh). **F0–F6 xong hết**, mỗi phase một gate xanh, `localApp: true` ở cả bảy.

Gate F7 hiện **RED — và đúng**: năm phép đo code đều xanh (`parity-report`, `verify-client-patch`,
`e2e-avatar`, `e2e-reaction`, `e2e-app-full` 15/16), đỏ duy nhất ở **soak 1/5 ngày**. Trước hôm nay
gate F7 không hỏi soak một câu nào, nên `pnpm phase:advance` đóng được cả chương trình F trên một
gate xanh với soak 1/5 — đúng thứ mà chính header `soak-day.mjs` cảnh báo. Đã bịt:
`soak-day.mjs --gate` (chỉ đọc, thoát 1 khi thiếu ngày) chạy **sau cùng** trong gate, không phải như
một step — một step đỏ làm gate dừng ngay, và một điều kiện thời gian chưa tới hạn không được phép
che mất chính thứ nó phải bảo vệ.

**Không còn phần code nào trong chương trình F.** Mục duy nhất chưa xong là F7 — dùng app hằng ngày ≥ 5 ngày — và nó là thời gian, không phải code. Đang **1/5**, và giờ chính gate giữ điều kiện đó thay cho trí nhớ.

Hai việc dọn thước đo, làm ngày 2026-08-22:

- Check `a tool actually ran against the box` đỏ 1/4 lượt. Khi chạy được nó mất **5–6s**, nên ngưỡng
  60s cũ không phải nguyên nhân — thông điệp thất bại mới là vấn đề: nó gộp "model không gọi tool"
  với "box chậm", hai thứ sửa ở hai nơi. Giờ báo rõ đã thấy tool-call nào ở trạng thái nào, kèm
  thời gian thật so với ngưỡng (nới lên 150s làm dư địa, **không** phải bản sửa).
- Lượt đỏ đó **không truy được**: gate chỉ lưu pass/fail mức script và lượt xanh sau ghi đè bản ghi
  — đúng cái bẫy đã làm mất bằng chứng vụ sáu bot bị ẩn. `e2e-app-full` giờ nối thêm một dòng mỗi
  lượt vào `docs/parity-runs/gateB-history.jsonl` (append-only, chỉ tên bước + pass + detail, không
  ghi nội dung hội thoại).

1. Dùng `pnpm dev:app` mỗi ngày (không mở shortcut Desktop — nó không set `SAND_DISABLE_UPDATES`, `CURSOR_API_BASE_URL`, cờ CDP).
2. Cuối ngày: `pnpm soak`. Ngày chỉ được tính khi patch verify sạch **và** gateway ≥ 50 lệnh.
3. Đủ 5 ngày → gate tự xanh → `pnpm phase:advance` đóng F7. Hết chương trình F. (Chưa đủ ngày thì `--advance` không chạy được, không phải nhớ nữa.)
4. Không `GROKBOT2_CURSOR_ACL=0`, không đuổi parity cho `apps/grokbot-web` (nó là đường lùi cho R2).

**Hai con số KHÔNG phải việc phải làm** — cùng loại "mẫu số có thứ chẳng có gì để nói":

- `sse 10/16` — 6 kênh còn lại **không có nguồn dữ liệu** (`tray` chưa bao giờ được ghi, `workflows`/`sharing`/`teach-recording` là hằng số, `box-disk-pressure`/`computer-action` không có producer nào trong repo).
- `bootstrap 9/10` — `WatchSandBoxMigration` là RPC **server-streaming** cho box migration, **0 hit** trong renderer, và **chưa bao giờ được gọi** (`recordRpc` persist, đếm 0). Stream rỗng *là* câu trả lời đúng cho một install không migrate box. Đừng "sửa" nó.

### 9.1 Việc ngoài chương trình F (chủ máy yêu cầu, 2026-08-22)

Ba việc này **không** thuộc phase nào và không đổi con số exit của F nào — ghi ở đây để §9 không nói
sai rằng "không còn phần code nào". Chúng là FE fallback (`apps/grokbot-web`), làm theo yêu cầu trực
tiếp, không phải để đuổi parity.

| # | Việc | Trạng thái | Đo bằng |
|---|---|---|---|
| 1 | Chặn e2e sửa bot không phải của nó | ✅ | `e2e-native.mjs` 59 pass / 0 fail — chụp roster trước/sau, assert không bot cũ nào đổi `hidden`/tên/bị xoá |
| 2 | Bộ chọn ảnh avatar: 3 route `/v1` + modal 12 màu / nạp ảnh / về mặc định | ✅ | `pnpm test:avatar` 38/38 · `pnpm test:avatar-ui` 12/12 |
| 3 | Reaction khi hover bubble | ✅ | `pnpm test:reaction` 22/22 (12 route + 10 UI) |
| 3b | Sửa: bubble của bot mất toàn bộ nội dung | ✅ | đo trên FE đang chạy — 5/5 `.bubble.agent` chỉ có tên bot; sau khi sửa thì có text |
| 4 | `ui-diff.mjs` — đo khoảng cách giao diện với app gốc | ✅ | chạy được ở 1920/1440/1181; neo cấu trúc, không ngưỡng pixel |
| 5 | Avatar bot bằng `bloub` (MIT) thay cho initials | ✅ | `avatar.test.ts` 7/7 · `pnpm test:avatar-ui` 16/16 |
| 6 | FE đổi sang hệ thiết kế `bloub` (giấy sáng) + avatar chạy động | ✅ | token đo từ trang thật; bộ chọn có Hình/Biểu cảm/Màu như panel của họ |

Về mục 1: sáu bot thật bị `hidden: true` ngày 2026-08-22 và **không truy được thủ phạm** — bộ đếm
coverage đã reset. `e2e-native.mjs` được minh oan (nó tạo bot riêng), nhưng nguy cơ thật nằm ở ba
setter trong `directory/index.ts` mặc định `?? true` khi không có cờ boolean nào; đã đổi thành no-op
có log. Guard trong e2e là để lần sau class lỗi này làm gate đỏ chứ không âm thầm ẩn bot.

Về mục 4: bản đầu tìm phần tử theo *hình dạng* ("sát mép trái, rộng 250–500") nên chỉ đúng ở một
khổ cửa sổ — khi app thu còn 1181px, sidebar của họ **thu gọn còn 88px** và thước báo "app không có
sidebar, không có bubble" trong khi app hiển thị bình thường. Bản dùng được neo vào cấu trúc DOM
của họ (`[data-role=assistant]`, `[role=log]`, `.sand-chat`, `.sand-info-pane`) và ép cùng một khổ
cho cả hai phía bằng `Emulation.setDeviceMetricsOverride` (luôn gỡ ở cuối). Nó còn tách riêng ba
loại kết quả: *lệch*, *thiếu hẳn vùng*, và *không so được* — trạng thái sidebar khác nhau kéo theo
bốn vùng lệch giả, gộp chung là biến một khác biệt thành năm.

Về mục 5: `bloub` ([github.com/jeremy-prt/bloub](https://github.com/jeremy-prt/bloub), MIT, commit
ghim `b4bb3c1`) là bản dựng lại con bot x.ai bằng SVG, tác giả **tự đo từ video** chứ không trích
từ bundle. Vì vậy nó đóng được hàng "ảnh avatar bot" trong bảng *phần thuộc hãng* mà không phạm
[legal.md](docs/legal.md): cấm là cấm chép **của họ**, không phải cấm trông giống. Chép `src/bot/*.ts`
(thuần TS, không phụ thuộc) vào `apps/grokbot-web/src/vendor/bloub/` kèm LICENSE + PROVENANCE; lớp
bọc duy nhất là `src/avatar.ts`. 8 hình × 16 biểu cảm × 12 màu, suy từ id.

Hai lỗi tự tìm ra khi làm mục 5, cả hai đều chỉ lộ khi *nhìn*: băm dồn cục (40 bot chỉ ra 28 tổ
hợp, vì lấy bit thấp của phép nhân mà `agent-1`…`agent-40` khác nhau đúng ở bit thấp — sửa bằng
muối riêng từng trường + `fmix32`), và màu `encre #0a0a0c` trong bảng gốc gần trùng nền
`rgb(7,7,7)` nên bot bốc trúng nó thì thân tàng hình, chỉ còn hai con mắt. Nhánh suy từ id lọc màu
quá tối; bảng chọn tay vẫn đủ 12 — người dùng cố ý chọn màu tối là lựa chọn của họ.

Về mục 6: chủ máy chọn đổi hướng thiết kế FE từ *bám app gốc* (nền `rgb(7,7,7)`) sang **hệ của
bloub** (giấy `#f9f9f9`, mực `#17203a`, phẳng, bo 12px). Chép CSS của bloub là hợp lệ (MIT, có ghi
công) — chép CSS app gốc thì không. Hệ quả có chủ ý: `ui-diff.mjs` (so với app gốc) từ nay đỏ gần
hết, đó là **kết quả đúng** chứ không phải hồi quy.

Ba lỗi tự tìm ra ở mục 6, đều chỉ lộ khi nhìn ảnh chụp: input file lộ nguyên `Choose File` (bản CSS
cũ ẩn nó, bản viết lại bỏ sót); ô Hình/Biểu cảm vẽ theo màu đang chọn nên chọn `crème` là bảng
trắng xoá (bloub luôn vẽ ô bằng mực, chỉ hàng Màu mới đổi màu); và luật lọc màu **lộn ngược** khi
đổi nền — ngưỡng độ sáng tuyệt đối hợp với nền tối, nền giấy phải lọc theo **tương phản** với nền.

Về mục 3: reaction **không** phải tính năng tự nghĩ ra. Đo qua CDP trên app đang chạy (2026-08-22):
hover một bubble hiện `div[role=toolbar]` 76×24, ba nút 24×24 — `Add reaction`, `Reply to <bot>
message`, `More message actions`; và `reactToMessage` là **một trong 120 lệnh** `/gw`, backend đã lưu
toggle trên entry từ lâu, `/v1/.../transcript` đã trả `reactions`. Thiếu đúng một mắt: đường để FE
*đặt* được. Nên chỉ làm nút reaction — Reply và More chưa có contract nào bên mình, vẽ nút bấm vào
không làm gì thì tệ hơn là không vẽ. Bộ 8 emoji là lựa chọn của mình: cú bấm vào picker của hãng
không lọt (toolbar của họ là node dùng chung), nên bộ của họ chưa đo được — đó là chỗ duy nhất trong
phần này không có số đo phía sau.

Mục 3b là bug tìm ra khi đọc `renderEntry` để thêm reaction: nhánh bot `return row` **trước khi**
đính kèm và nội dung được gắn vào bubble, nên mọi câu trả lời của bot render ra chỉ còn tên bot. Đo
trước khi sửa để chắc, không đoán. Bài `e2e-reaction` giữ luôn assert này.

Về mục 2: chọn màu **không** lưu "màu đã chọn" — nó vẽ chữ đầu tên trên nền màu thành PNG rồi nạp
như ảnh thường, nên không thêm cột nào vào BE và màu chọn ở FE hiện luôn trong app gốc (hai đường
dùng chung một chỗ lưu, e2e assert cả hai chiều). Không byte nào của 8 avatar hãng được copy.

### 9.2 Nhật ký e2e (2026-08-22)

`docs/parity-runs/e2e-history.jsonl` — nối thêm một dòng mỗi lượt chạy, **không ghi đè**. Xem bằng
`pnpm e2e:history [tên-bài]`.

Ghi ở **hai mức**, và mức thứ hai mới là mức phủ hết:

| Mức | Ai ghi | Được gì |
|---|---|---|
| Từng bài | `recordRun()` trong 4 bài (`e2e-avatar`, `e2e-avatar-ui`, `e2e-reaction`, `e2e-native`) | tên từng bước + `detail` của bước hỏng |
| Gate | `runNode()` trong `phase-gate.mjs` | mọi script gate chạy — **63 bài hiện có và cả bài viết sau này** |

Vì sao không vá từng file: 34 bài có `check()` mà không ghi gì, mỗi bài in một kiểu. Vá 34 chỗ là
34 lần có thể sai (đã sai một lần thật: bài này gọi tham số là `detail`, bài kia gọi `note`), lại
không giúp gì cho bài viết sau. Gate đọc stdout ở một chỗ thì phủ tất cả.

`detail`/`failLines` đi qua một lớp **xoá bí mật** (`token`/`authorization`/`secret`, `Bearer …`,
`hal_…`) vì file nằm trong repo. Giữ khoá, xoá giá trị — biết "token sai" khác biết "không có
trường token".

`gateB-history.jsonl` vẫn riêng: nó giữ chi tiết **từng bước** của `e2e-app-full`, thứ mà bản đọc
stdout của gate không có. Hai file, hai mức chi tiết, không phải hai bản sao.

**Nhật ký trả công ngay lượt đầu.** Nó bắt được `e2e-avatar-ui` đỏ ở đúng bước
`chưa có ảnh ⇒ mặt bot suy từ id`, và nguyên nhân là chính thay đổi ticker cùng ngày:
`animateAvatar` tạo path thân ngay nhưng **mắt chỉ tạo ở khung RAF đầu tiên**, nên có một nhịp
avatar hiện ra trống. Trước khi có nhật ký, hai lượt đỏ liên tiếp đều mất bằng chứng và tôi đã đoán
sai nguyên nhân ("chạy đồng thời với unit test"). Sửa: vẽ khung đầu ngay khi gắn.

Nếu muốn làm thêm ngoài roadmap, thứ tự theo giá trị thật: (a) gỡ `deleted bot leaves the sidebar` khỏi `KNOWN_OPEN` bằng cách tìm event delete per-agent thật; (b) tìm view mount tray `sand-async-task` để dữ liệu đã đúng hiện được lên UI; (c) tính năng mới cho các kênh đang rỗng (skills thật, trays thật) — nhưng đó là mở scope sản phẩm, không phải parity.
