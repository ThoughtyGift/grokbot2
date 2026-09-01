# Luồng transcript trực tiếp ở 0.30 — và chỗ bản ghi của ta không nói được "đã mất gì"

> Trích 2026-09-01 từ `app.asar` của **app gốc đang cài** (`C:\Program Files\Grok Bot`, phiên bản
> `0.30.0`) — khác mọi lần trước, vốn dùng bản 0.29. Chín message đã gộp vào
> [`proto-messages.json`](./proto-messages.json) (2.491 → 2.500).
>
> Việc này bắt đầu từ một câu hỏi khác: *"app gốc xử lý replay thế nào"*. Câu trả lời là **không có
> replay cho skill** — xem §1. Nhưng cùng lúc lộ ra một họ message mà bên mình chưa trích lấy một
> cái, và nó nói về đúng thứ hay hỏng nhất: mất kết nối rồi nối lại.

## 1 · "Replay" ở app gốc không phải chạy lại skill

Grep toàn bộ host 0.30 (7,2 MB):

```
teach-sessions · session.json · ffmpegPid · videoPath · x11grab · gdigrab · "Teach recording queue"
  → 0 lần, tất cả
replay → 27 lần, không lần nào liên quan teach
```

27 lần ấy là telemetry, Sentry session recording, và **một trường trong proto** (§2). Chạy lại một
skill thì đi đúng đường đã đo 01/09: chip skill trong khung soạn → `@<tên skill>` trong nội dung tin.
Không có lệnh nào riêng cho việc đó.

Kèm theo, hai điều xác nhận được:

- **Hợp đồng teach của client chỉ có ba lệnh** — `teach: ["startTeachRecording", "stopTeachRecording",
  "getTeachRecordingStatus"]`. Cả ba đã có bên mình.
- **`x11grab` / `ffmpegPid` 0 lần trong client** — toàn bộ phần quay video nằm ở host phía họ, không
  trong app. Nên cách bên mình làm (`ffmpeg x11grab` trên box, backend giữ phiên) là **cùng kiến
  trúc**, không phải một lối khác.

## 2 · Chín message của luồng transcript

`Frame` là oneof bọc tám loại còn lại:

| message | field |
|---|---|
| `Frame` | `connected`, `rows`, `cleared`, `cursor_too_old`, `heartbeat`, `agent_state`, `computer_actions`, `agent_state_changed` |
| `Connected` | `stream_id`, `server_time_ms`, `absolute_lifetime_ms` |
| `Rows` | `agent_id`, `generation`, `entries[]`, `deletes[]`, **`replay`** |
| `Cleared` | `agent_id`, `new_generation` |
| `CursorTooOld` | `agent_id`, `generation` |
| `Heartbeat` | `server_time_ms` |
| `AgentState` | `live`, `snapshot`, `client` |
| `ComputerActions` | `actions` |
| `AgentStateChanged` | `agent_id`, `families`, `changed_at_ms` |

## 3 · Đặt cạnh đường `/gw` của ta

Bên mình phát một khung transcript như sau (`packages/cursor-acl/src/sse.ts`):

```ts
broadcast("transcript", { agentId, event: { type: "appended" | "updated", entry: last } })
```

| | app gốc 0.30 | ta |
|---|---|---|
| số entry mỗi khung | `entries[]` — một **lô** | đúng **một** entry |
| xoá | `deletes[]` | không có |
| thế hệ | `generation`, và `Cleared` cấp `new_generation` | không có |
| "cursor quá cũ" | `CursorTooOld` → client biết phải tải lại | không có |
| phát lại | cờ `replay` trên lô | không có |
| tuổi thọ stream | `Connected.absolute_lifetime_ms` — nói trước | không có |
| nhịp tim | `Heartbeat.server_time_ms` | có (kênh riêng) |

Ba dòng giữa là một cơ chế, không phải ba tính năng rời: `generation` + `CursorTooOld` + `Cleared`
cho client biết **nó đã bỏ lỡ gì**, và `replay` cho biết **lô đang tới là hàng cũ**. Bên mình không
có vế nào, nên sau một lần mất kết nối, client không có cách nào phân biệt "chưa có gì mới" với
"đã lỡ mất vài entry".

## 4 · Vì sao CHƯA vá

Chưa đo được hệ quả trên màn hình. Ba khả năng, và tôi không biết cái nào đúng:

- client tự xử được vì nó gọi `getAgentTranscriptTail` mỗi khi mở lại một bot (rất có thể — nó gọi
  lệnh đó 130.420 lần theo `coverage.json`);
- hoặc nó thông báo lại tin cũ như tin mới sau khi nối lại;
- hoặc nó im lặng thiếu entry cho tới lần mở lại tiếp theo.

Cách đo: rút mạng vài phút trong lúc một bot đang trả lời, nối lại, rồi so bản ghi trên màn hình với
`getAgentTranscriptTail`. Đó là phép đo cần một lượt thật, và §8 của bảng theo dõi đã ghi "mất mạng"
vào danh sách **chưa chắc chắn** từ trước — cùng một chỗ trống.

Vá trước khi đo là dựng một cơ chế `generation` cho một cái bệnh chưa biết có tồn tại.
