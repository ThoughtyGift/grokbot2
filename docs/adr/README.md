# ADR — quyết định kiến trúc

Sổ này trả lời câu *vì sao*; [architecture.md](../architecture.md) trả lời câu *cái gì*.

**Hai chỗ ở, một mục lục.** Mười chín ADR đầu sống trong
[architecture/architecture-decisions.md](../architecture/architecture-decisions.md) — một file gộp,
đánh số theo phase. ADR mới thì một quyết định một file trong thư mục này. Bảng dưới là mục lục
**duy nhất** cho cả hai chỗ.

> **Một điều tôi đã nói sai và phải sửa.** Bản trước của file này viết rằng file gộp *"không nói được
> quyết định nào còn hiệu lực, quyết định nào đã bị thay"*, và đề xuất tách nó ra 19 file. Đọc kỹ thì
> nó nói được: mỗi ADR có `Status`, có liên kết `superseded by`, và ADR-P0-4 còn có hẳn hai mục
> *"What still holds"* / *"What does not"*. Tách ra chỉ là dời chữ, lại làm chết mọi anchor đang được
> trỏ tới. Nên **không tách** — việc cần làm chỉ là một mục lục có trạng thái, và đó là bảng này.

## Bảng trạng thái

✅ còn hiệu lực · ⚠️ còn hiệu lực nhưng một phần đã bị thay · ⛔ đã bị thay

| # | Quyết định | Trạng thái |
|---|---|---|
| [ADR-P0-1](../architecture/architecture-decisions.md#adr-p0-1-strangler-fig-không-rewrite-tuần-1) | Strangler Fig, không rewrite tuần 1 | ✅ accepted |
| [ADR-P0-2](../architecture/architecture-decisions.md#adr-p0-2-modular-monolith-trước-khi-chia-process) | Modular monolith trước khi chia process | ✅ accepted |
| [ADR-P0-3](../architecture/architecture-decisions.md#adr-p0-3-ranh-giới-theo-business-capability) | Ranh giới theo business capability | ✅ accepted |
| [ADR-P0-4](../architecture/architecture-decisions.md#adr-p0-4-fe-gốc-là-adapter-tạm-legal-wall) | FE gốc là adapter tạm (legal wall) | ⛔ superseded by ADR-F0-1 (2026-08-20) |
| [ADR-P0-5](../architecture/architecture-decisions.md#adr-p0-5-pool-adminhalcionvn-không-phải-project-gốc) | Pool `admin.halcion.vn` không phải project gốc | ✅ accepted |
| [ADR-P0-6](../architecture/architecture-decisions.md#adr-p0-6-strict_404-và-auth-đã-bật-không-tắt-trong-phase-0) | STRICT_404 và AUTH đã bật — không tắt trong Phase 0 | ✅ accepted (quan sát: `.env` đã `GROKBOT2_STRICT_404=1`, `GROKBOT2_AUTH=enforce`) |
| [ADR-P0-7](../architecture/architecture-decisions.md#adr-p0-7-9-shared-room-không-implement) | 9 shared-room không implement | ✅ accepted |
| [ADR-P0-8](../architecture/architecture-decisions.md#adr-p0-8-hợp-đồng-asar-commit-trong-git-đường-cài-đặt-có-thể-unpacked) | Hợp đồng asar commit trong git; đường cài đặt có thể unpacked | ✅ accepted (default path closed 2026-08-19) |
| [ADR-P0-9](../architecture/architecture-decisions.md#adr-p0-9-agents-automation-is-not-a-wire-channel) | `agents-automation` is not a wire channel | ✅ accepted (fixed to close Cửa A) |
| [ADR-P2-1](../architecture/architecture-decisions.md#adr-p2-1-acl-là-package-không-phải-folder-trong-service) | ACL là package, không phải folder trong service | ✅ accepted (2026-08-19) |
| [ADR-P2-2](../architecture/architecture-decisions.md#adr-p2-2-domain-publish-event-không-giữ-sink-của-transport) | Domain publish event, không giữ sink của transport | ✅ accepted (2026-08-19) |
| [ADR-P2-3](../architecture/architecture-decisions.md#adr-p2-3-openapi-native-v0-viết-trước-khi-có-server) | OpenAPI native v0 viết trước khi có server | ✅ accepted (2026-08-19) |
| [ADR-P3-1](../architecture/architecture-decisions.md#adr-p3-1-nodesqlite-là-đường-nóng-statejson-đóng-băng-sau-migrate) | `node:sqlite` là đường nóng; `state.json` đóng băng sau migrate | ✅ accepted (2026-08-20) |
| [ADR-P4-1](../architecture/architecture-decisions.md#adr-p4-1-s5-s4-model-step-are-a-separate-process-tool-execution-stays-on-the-bff) | S5 + S4 model step are a separate process; tool execution stays on the BFF | ✅ accepted (2026-08-20), updated (2026-08-20) |
| [ADR-P4-2](../architecture/architecture-decisions.md#adr-p4-2-sqlite-persist-is-upsert-keyed-prune-not-delete-from-rewrite) | SQLite persist is UPSERT + keyed prune, not DELETE FROM + rewrite | ✅ accepted (2026-08-20) |
| [ADR-P5-1](../architecture/architecture-decisions.md#adr-p5-1-s6-computer-is-a-separate-process-browser-cdp-and-seq-stay-on-the-bff) | S6 computer is a separate process; browser CDP and seq stay on the BFF | ✅ accepted (2026-08-20) |
| [ADR-P6-1](../architecture/architecture-decisions.md#adr-p6-1-s10-scheduler-clock-s11-public-webhooks-are-a-separate-process-crudhistoryseq-stay-on-the-bff) | S10 scheduler clock + S11 public webhooks are a separate process; CRUD/history/seq stay on the BFF | ✅ accepted (2026-08-20) |
| [ADR-P7-1](../architecture/architecture-decisions.md#adr-p7-1-native-v1-on-the-bff-vite-fe-fallback-not-cutover) | Native `/v1` on the BFF + Vite FE (fallback, not cutover) | ⚠️ accepted (2026-08-20); cutover clause superseded by ADR-F0-1 |
| [ADR-F0-1](../architecture/architecture-decisions.md#adr-f0-1-fe-gốc-đã-patch-là-ui-production-acl-là-lõi-vĩnh-viễn) | FE gốc đã patch là UI production; ACL là lõi vĩnh viễn | ✅ accepted (2026-08-20) |
| [0004](0004-stack-fe.md) | Stack cho `apps/grokbot-web`: React + `react-resizable-panels` + `@tanstack/react-virtual` | ⚠️ **hoãn thi hành** (2026-08-23) — X4 tới, đo lại thì tiền đề sai: vẽ lại tất cả chỉ 0,84 ms, lỗi thật là mất vị trí cuộn. Điều kiện kích hoạt viết lại |

## Đọc gì trước

**ADR-F0-1** là bản lề của cả dự án: nó biến `packages/cursor-acl` + `packages/grokbot-proto` từ
"lớp tạm sẽ gỡ ở Phase 8" thành **lõi vĩnh viễn**, và xoá hẳn Phase 8. Mọi comment nào còn nói
"ACL rồi sẽ gỡ" đều đã hết hiệu lực. Nếu chỉ đọc một ADR thì đọc cái đó.

## Chưa viết — đã quyết trong thực tế nhưng chưa ai ghi

Nợ tài liệu, không phải danh sách mong muốn. Ba quyết định dưới đây **đang chi phối code hằng ngày**
mà lý do chỉ nằm trong comment hoặc trong đầu người. Ai chạm vào vùng tương ứng thì viết ADR cho nó.

| Số dành sẵn | Quyết định | Lý do hiện nằm ở đâu |
|---|---|---|
| `0001` | Patch client bằng **pipeline dữ liệu**, không sửa tay `resources/app` | comment đầu `infra/patches/index.mjs` |
| `0002` | Avatar dùng `bloub` (MIT) thay vì asset của hãng | `apps/grokbot-web/src/vendor/bloub/PROVENANCE.md` |
| `0003` | Hợp đồng `/v1` là **một** khai báo TypeBox cho cả FE và BE | comment đầu `packages/api-contract/src/v1.ts` |

## Khuôn cho ADR mới

`docs/adr/NNNN-tieu-de.md`, định dạng MADR: **Bối cảnh · Quyết định · Hệ quả · Đã cân nhắc gì khác**.
Một trang là đủ. Bắt buộc có *Đã cân nhắc gì khác* — một quyết định không có phương án bị loại thì
chưa phải quyết định.

Số bắt đầu từ `0004` vì `0001`–`0003` đã **dành sẵn** cho ba quyết định ở bảng trên — chúng đã có
hiệu lực, chỉ chưa được viết. Đánh số trước để khi viết không phải sắp lại.

Không đổi số các ADR trong file gộp (`ADR-P0-*`, `ADR-F0-1`): mọi liên kết đang trỏ tới chúng —
trong `ROADMAP.md`, trong comment code, trong chính sổ này — sẽ chết.
