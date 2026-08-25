# docs — mục lục

Kiểm bằng máy: `pnpm docs:check` (link chết · file mồ côi · file thiếu ở đây).
Soi cả hệ thống: `pnpm self-xray` — sáu mục, docs là một trong sáu.
140 file, nên **mục lục là hợp đồng**: file nào không có tên ở đây thì coi như không tồn tại.

Ba loại tài liệu, đừng lẫn:

| Loại | Ai viết | Sửa được không |
|---|---|---|
| **Sống** | người | có — đây là nguồn sự thật đang dùng |
| **Số đo** | máy (script) | không sửa tay; chạy lại script để cập nhật |
| **Lịch sử** | người, đã đóng | không sửa; giữ để biết vì sao từng quyết định như vậy |

---

## Bắt đầu từ đâu

| Bạn đang muốn | Đọc |
|---|---|
| **Ngày đầu làm việc trên repo** | [onboarding.md](onboarding.md) |
| Hiểu hệ thống trong 10 phút | [architecture.md](architecture.md) |
| Biết đang làm tới đâu | [../ROADMAP.md](../ROADMAP.md) → [roadmap.md](../ROADMAP.md) |
| Clone FE app gốc | [plan/fe-xray-roadmap.md](plan/fe-xray-roadmap.md) |
| Sửa/thêm một lệnh của client | [protocol-reference.md](protocol-reference.md) |
| Biết được phép làm gì, không được làm gì | [legal.md](legal.md) |
| Hiểu vì sao hệ thống như hiện tại | [adr/README.md](adr/README.md) |
| Làm cho hệ thống chuyên nghiệp, scale được | [system-pipeline.md](plan/system-pipeline.md) |
| Mở cho nhiều người dùng | [multi-tenant-roadmap.md](plan/multi-tenant-roadmap.md) |
| Gộp grokbot2 với cinAPI thành một sản phẩm | [cinapi-merge.md](plan/cinapi-merge.md) |

## plan/ — ĐANG LÀM

Mở thư mục này là biết việc gì đang chạy. Bốn file, hai trục:

| File | Trục | Trạng thái |
|---|---|---|
| [plan/fe-xray-roadmap.md](plan/fe-xray-roadmap.md) | **X-series** — *cái* làm: bóc tách app gốc rồi clone FE từng chi tiết | X0–X6; A1/A4/A5/A6 xong |
| [plan/system-pipeline.md](plan/system-pipeline.md) | **T-series** — *cách* làm: quy trình, ADR, sơ đồ, tự soi mình | T1.1 + T2.1 xong |
| [plan/multi-tenant-roadmap.md](plan/multi-tenant-roadmap.md) | đa người dùng: `owner_id`, login, billing | Phase 1 đang chạy |
| [plan/fe-clone-plan.md](plan/fe-clone-plan.md) | bản trước của X-series, chia việc theo API | vẫn đúng, hẹp hơn |

X-series và T-series **không đổi chỗ nhau**: một cái làm sản phẩm, một cái làm cách làm sản phẩm.

## Sống — nguồn sự thật

| File | Nói về |
|---|---|
| [architecture.md](architecture.md) | kiến trúc tổng: BFF · runtime · computer · ops · ACL |
| [protocol-reference.md](protocol-reference.md) | hợp đồng client hãng: 120 lệnh `/gw`, 16 kênh SSE, bootstrap protobuf |
| [parity.md](parity.md) | đối chiếu với app gốc: cái gì khớp, cái gì cố ý không khớp |
| [roadmap.md](../ROADMAP.md) | lộ trình theo phase (bản chi tiết; bản ngắn ở gốc repo) |
| [onboarding.md](onboarding.md) | từ `git clone` tới sửa được code và chứng minh không hỏng gì |
| [runbooks/README.md](runbooks/README.md) | 5 sự cố **đã thật sự xảy ra**: triệu chứng → xác nhận → sửa |
| [legal.md](legal.md) | ranh giới: không copy bundle/CSS/asset của hãng, không phân phối |
| [adr/README.md](adr/README.md) | sổ quyết định kiến trúc — *vì sao*, đánh số, không sửa quá khứ |
| [system-pipeline.md](plan/system-pipeline.md) | chấm điểm từng chặng quy trình, chỗ hổng, việc T1–T6 |
| [multi-tenant-roadmap.md](plan/multi-tenant-roadmap.md) | đường đi từ một-user-giả sang đa người dùng thật: `owner_id`, login, billing |

### architecture/ — chi tiết từng mảng

| File | Nói về |
|---|---|
| [architecture/box-architecture.md](architecture/box-architecture.md) | máy ảo (box) của bot: exec, VNC, handoff |
| [architecture/architecture-decisions.md](architecture/architecture-decisions.md) | ADR — quyết định kiến trúc và lý do |
| [architecture/transcript-replica.md](architecture/transcript-replica.md) | client giữ bản sao có thứ tự; vì sao phải bắn event |
| [architecture/sqlite-rollback.md](architecture/sqlite-rollback.md) | đường lùi nếu SQLite hỏng |
| [architecture/coupling-inventory.md](architecture/coupling-inventory.md) | chỗ nào còn dính vào client hãng |
| [architecture/mcp-box-bridge.md](architecture/mcp-box-bridge.md) | cầu MCP ↔ box |

### fe/ — giao diện

| File | Nói về |
|---|---|
| [fe/fe-xray-roadmap.md](plan/fe-xray-roadmap.md) | **bản đang dùng**: bóc tách app gốc rồi clone từng chi tiết + checklist X0–X6 |
| [fe/fe-clone-plan.md](plan/fe-clone-plan.md) | bản trước, chia việc theo API — vẫn đúng, hẹp hơn |

### reverse/ — dịch ngược client hãng

| File | Nói về |
|---|---|
| [reverse/spike-findings.md](reverse/spike-findings.md) | phát hiện khi mổ bundle: fuse, asar, load order |
| [reverse/agent-brain.md](reverse/agent-brain.md) | prompt hệ thống, tool, subagent của app gốc |

## Số đo — máy ghi, không sửa tay

| Chỗ | Ai ghi | Đọc bằng |
|---|---|---|
| `extracted/` | `extract-*.mjs`, `x-ray.mjs`, `ui-diff.mjs` | số đo từ app gốc: [ui-design-spec.md](extracted/ui-design-spec.md), `ui-xray.json`, `gateway-commands.json`, `proto-*.json`, `tool-catalog.json` |
| `parity-runs/` | `phase-gate.mjs`, `e2e-*`, `soak-day.mjs` | kết quả từng lượt gate; `e2e-history.jsonl` + `gateB-history.jsonl` là nhật ký nối thêm (`pnpm e2e:history`) |
| `api/` | **máy sinh** từ `packages/api-contract` (`pnpm api:gen`) | [api/grokbot2-v1.yaml](api/grokbot2-v1.yaml) — OpenAPI `/v1`. Lý do thiết kế: [api/README.md](api/README.md) |
| `state/` | `phase-gate.mjs`, `patch-client.mjs`, `self-xray.mjs` | `phase-state.json` (con trỏ phase, bản người đọc) · `client-patch-state.json` (version + sha `app.asar` gốc do `--apply` ghi) · [`bang-theo-doi.md`](state/bang-theo-doi.md) — **BẢNG THEO DÕI: trạng thái + việc còn lại + E2E, đọc cái này trước** · [`system-xray.md`](state/system-xray.md) — x-quang toàn hệ cho người không rành kỹ thuật |

## Lịch sử — đã đóng, giữ để tra

| File | Vì sao còn |
|---|---|
| [history/ROADMAP-measured.archived.md](history/ROADMAP-measured.archived.md) | roadmap trước lần đổi hướng 2026-08-20. Giữ vì mệnh đề *"status is measured, not remembered"* là nguồn của kỷ luật đo hiện tại |
| [history/ROADMAP-native-fe.archived.md](history/ROADMAP-native-fe.archived.md) | lộ trình P0–P8 (hướng FE tự viết). Là **đường lùi cho rủi ro R2** nên không xoá |
| [history/execution-roadmap.md](history/execution-roadmap.md) | sổ thi công chi tiết của giai đoạn P |
| [history/parity-thuky.md](history/parity-thuky.md) | biên bản đối chiếu dài, theo từng lượt |
| [history/audit.md](history/audit.md) | soát toàn hệ thống một lần |
| [history/migration-baseline.md](history/migration-baseline.md) | mốc trước khi tách service |
| [history/dual-run.md](history/dual-run.md) | giai đoạn chạy song song hai đường |
| [history/grokbot2-v0.yaml](history/grokbot2-v0.yaml) | OpenAPI viết tay của `/v1` — 95% là schema, đã lệch; nay máy sinh |

## session/ — bàn giao giữa các phiên

| File | Nói về |
|---|---|
| [session/HANDOFF.md](session/HANDOFF.md) | trạng thái cuối phiên, việc đang dở |
| [session/NEXT-SESSION-PROMPT.md](session/NEXT-SESSION-PROMPT.md) | câu mở đầu cho phiên sau |

---

## Luật cho docs

- Thêm file mới thì **thêm tên vào đây**, hoặc vào README của thư mục chứa nó, trong cùng lần sửa.
  `pnpm docs:check` sẽ bắt nếu quên.
- Vừa sửa sơ đồ thì chạy `pnpm docs:check --mermaid` — sơ đồ không parse được thì tệ hơn không có.
- Không sửa tay file trong `extracted/`, `parity-runs/`. Muốn số khác thì chạy lại script.
- Tài liệu đã đóng thì chuyển vào `history/`, đừng xoá — mất lý do của một quyết định đắt hơn giữ
  một file cũ.
- Số đo phải kèm **cách đo lại**. Một con số không nói được nó từ đâu ra thì lần sau không ai tin.
