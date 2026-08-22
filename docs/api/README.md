# API `/v1` — lý do thiết kế

Phần **tra cứu** (đường dẫn, hình dạng, mã lỗi) nằm ở [grokbot2-v1.yaml](grokbot2-v1.yaml) và **do
máy sinh** từ [`packages/api-contract/src/v1.ts`](../../packages/api-contract/src/v1.ts). File này
giữ phần **giải thích** — thứ máy không sinh được.

Sinh lại: `pnpm api:gen`. Kiểm lệch: `pnpm self-xray` (mục "spec /v1").

## `/v1` là mặt nào của hệ thống

Client hãng nói phương ngữ Cursor, và `@grokbot2/cursor-acl` là thứ dịch (ROADMAP §4). `/v1` là
**mặt bên kia**: hợp đồng mà `apps/grokbot-web` gọi. Hai mặt sống song song và cố ý không giống
nhau — ACL là lõi vĩnh viễn, không phải lớp tạm (`ROADMAP.md` §0.2).

## Hai luật `/v1` giữ mà phương ngữ Cursor không giữ

**Một tên cho một việc.** Phương ngữ có **năm** cách gọi để đọc transcript —
`getAgentTranscriptTail`, `openAgentTail`, `getAgentTranscript`, `getAgentTranscriptPage`,
`getAgentThread` — và ACL trả cùng một cái tail cho cả năm. Ở `/v1` chỉ có một:
`GET /v1/agents/{id}/transcript`.

**Thất bại là mã trạng thái, không phải `{ok: false, reason}` trong một 200.** Phương ngữ không làm
được điều đó: client hãng coi mọi non-200 là box mất liên lạc, nên ACL buộc phải trả 200 kèm lý do.
Chỉ mặt `/v1` được phép nghiêm.

## Vì sao spec do máy sinh

Bản viết tay (`v0`) dài **666 dòng, trong đó 633 dòng là schema** — tức 95% là thứ máy sinh được.
Và nó đã lệch thật: thiếu route avatar, reaction, `host/sidebar`, lại dùng `{agentId}` trong khi
route thật là `{id}`. Một spec lệch tệ hơn không có spec, vì người đọc tin nó.

Bản v0 giữ ở [history/grokbot2-v0.yaml](../history/grokbot2-v0.yaml) để tra, không dùng nữa.

## Bề mặt còn để dành

Liệt kê ra để thấy **cái gì cố ý chưa có**, thay vì phải đoán. Cũng để những lần thêm route sau
không đụng chỗ nhau.

| | Bề mặt | Đường dẫn dự kiến | Tình trạng |
|---|---|---|---|
| S1 | identity | `/v1/session` | GET đã có từ P7 — chỉ token, chưa phải service danh tính |
| S6 | computer | `/v1/agents/{id}/computer` | GET đã có từ P7 — chỉ đọc trạng thái/VNC, chưa có begin/end |
| S8 | media | `/v1/attachments` | ảnh đã có từ P7; tệp khác đã bổ sung sau (xem `plan/fe-clone-plan.md`) |
| S9 | memory | `/v1/agents/{id}/memory` | **chưa** — và đo được là màn hình memory *không tồn tại* trong client hãng |
| S10 | automations | `/v1/agents/{id}/routines` | **chưa** — là việc B1 trong `plan/fe-clone-plan.md` |
| S11 | connectors | `/v1/channels` · `/webhooks/{platform}` | chưa |
| S12 | extensions | `/v1/mcp` · `/v1/skills` | chưa; `skillsCatalog: []` ở phía `/gw` là **đúng hợp đồng**, không phải thiếu |

## Luật khi thêm route

1. Khai schema trong `packages/api-contract/src/v1.ts` và thêm dòng vào bảng `ROUTES` **ở cùng file** —
   để cạnh nhau nên lúc sửa schema là lúc nhìn thấy bảng.
2. `pnpm api:gen` rồi commit cả spec.
3. Kèm một bài e2e có ghi nhật ký (`recordRun`) — cùng khuôn với `e2e-avatar`, `e2e-reaction`.

Quên bước 2 thì `pnpm self-xray` đỏ ở mục "spec /v1".
