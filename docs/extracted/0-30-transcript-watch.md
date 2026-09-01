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

## 4 · Hợp đồng tin nhắn người dùng — và một tên trường tôi tự đặt sai

Cùng lần trích, từ `SendGrokBotUserMessageRequest`:

| no | field | ta có? |
|---|---|---|
| 1 | `agent_id` | ✅ `agentId` |
| 2 | `message_id` | ❌ bỏ qua |
| 3 | `text` | ✅ |
| 4 | `sent_at_ms` | ❌ bỏ qua (ta tự đóng dấu thời gian) |
| 5 | `rich_text` | ✅ `richText.text` |
| 6 | **`reply_to_id`** | ❌ **ta đọc `replyToEntryId`** — tên tôi tự đặt |
| 7 | `is_fork` | ❌ chưa dùng |
| 8 | `attachment_paths[]` | ✅ |
| 9 | `attachment_names[]` | ✅ |
| 10 | `traceparent` | ❌ bỏ qua |
| 11 | `enter_epoch_ms` | ❌ bỏ qua |
| 12 | `composed_at_ms` | ❌ bỏ qua |

Dòng 6 là một bug thật, và nó giải thích con số đã đo hôm nay: **0 trên 748 entry** của bản ghi mang
`replyTo`. Renderer 0.30 dùng `replyToId` 55 lần; backend đọc `replyToEntryId`; hai bên không gặp
nhau, nên tham chiếu trả lời của người dùng **chưa từng tới backend một lần nào**. Bản vá "bot trả
lời có tham chiếu" sáng 01/09 vì thế chạy trên một đường không ai đi — nó đúng về logic và vô hình
trong thực tế.

Nay nhận cả ba cách viết (`replyToId`, `reply_to_id`, `replyToEntryId`), với bài test cho từng cái.

Bài học rộng hơn, và nó lặp lại lần thứ ba trong repo này: **đặt tên trường theo suy đoán rồi để bài
test tự khoá cái tên suy đoán ấy** thì mọi thứ xanh mà không có ai gọi tới. Cách duy nhất bắt được
là đọc hợp đồng thật — `coverage.json` `lastArgs`, hoặc proto trong asar.

## 5 · Vì sao CHƯA vá cơ chế generation

Chưa đo được hệ quả trên màn hình. Ba khả năng, và tôi không biết cái nào đúng:

- client tự xử được vì nó gọi `getAgentTranscriptTail` mỗi khi mở lại một bot (rất có thể — nó gọi
  lệnh đó 130.420 lần theo `coverage.json`);
- hoặc nó thông báo lại tin cũ như tin mới sau khi nối lại;
- hoặc nó im lặng thiếu entry cho tới lần mở lại tiếp theo.

Cách đo: rút mạng vài phút trong lúc một bot đang trả lời, nối lại, rồi so bản ghi trên màn hình với
`getAgentTranscriptTail`. Đó là phép đo cần một lượt thật, và §8 của bảng theo dõi đã ghi "mất mạng"
vào danh sách **chưa chắc chắn** từ trước — cùng một chỗ trống.

Vá trước khi đo là dựng một cơ chế `generation` cho một cái bệnh chưa biết có tồn tại.

## 6 · Khối trích dẫn trả lời: ba điều kiện, không phải một

Trích 01/09 từ renderer 0.30. `(deleted)` không phải thông báo lỗi — nó là nhãn i18n `JKr1yF`, vẽ
bởi nhánh `{kind:"missing"}` của preview. Đường đi đầy đủ:

```js
function f$t({targetId}) { … bT(resolveEntry(targetId)) … }      // component khối trích dẫn
entryById = new Map(entries.map(e => [e.id, e]))                 // khoá là entry.id
resolveEntry(id) → entryById.get(id) ?? null

function bT(t) {
  if (t == null) return {kind:"missing"};                         // → "(deleted)"
  switch (t.kind) {
    case "message":          return {kind: t.role==="user"&&t.fromAgent==null ? "user-text":"assistant-text", text:t.content};
    case "send-message":     return zzt(t.message);
    case "user-attachment":  return …;
    case "tool-call": case "notice": case "event":
    case "feedback": case "voice-call":  return {kind:"missing"}; // → CŨNG "(deleted)"
  }
}
```

Nên một tham chiếu trả lời chỉ vẽ đúng khi **cả ba** đều đạt:

| # | điều kiện | hỏng thì thấy gì |
|---|---|---|
| ① | `replyTo` là **string id**, không phải object | `(deleted)` |
| ② | trong **cùng cửa sổ transcript đang nạp** có entry `id === replyTo` | `(deleted)` |
| ③ | entry đích có `kind ∈ {message, send-message, user-attachment}` | `(deleted)` |

Điều kiện ② là chỗ đáng nhớ nhất: khối trích dẫn tra trong **tập entry client đang giữ**, nên một
tin nằm ngoài cửa sổ tail vẫn ra `(deleted)` dù dây hoàn toàn đúng. Điều kiện ③ thì chưa từng nghĩ
tới — trả lời một `tool-call` là `(deleted)` **theo thiết kế của hãng**, không phải lỗi.

Chữ trong khối cắt ở **96 ký tự** (`lH("quote") = 96`), chip trong khung soạn cắt ở 56.

**Đo 01/09, cả hai vế.** Trên dây: `e13969 kind=message · replyTo="e13968" (string) · tra được ·
kind đích send-message` → 1/1 đạt. Trên màn hình app local: `sand-reply-quote__label` =
`"Ảnh chưa tới được chỗ mình, mình chỉ thấy cái đường dẫn chứ không thấy nội dung sơ đồ. Bạn gửi…"`,
đúng `e13968.message.content` cắt ở 96, và `(deleted)` không còn trên màn hình.


## 7 · Vì sao thiếu `generation` KHÔNG phải một cái bệnh — đo 02/09

§5 để ngỏ ba khả năng và nói phải đo trước khi vá. Hai con số khép được câu hỏi mà không cần rút dây
mạng, vì chúng nói client thật sự làm gì:

```
getAgentTranscriptTail   n = 198.691   lastArgs {"id":"agent-…","limit":500}
openAgentTail            n =   2.378   lastArgs {"id":"agent-…","limit":500}
```

Và `openAgentTail` trong hợp đồng renderer trả **`transcript-page`**, không phải một luồng — mở lại
tail nghĩa là lấy nguyên một trang. Bên mình cả hai lệnh đều vào `conversation.transcriptTail`, hàm
đó tôn trọng `limit` của client (trần 1000) và trả kèm `hasMore` · `nextBeforeSeq` · `cursor`.

Ghép lại: sau một lần mất kết nối, client không cần ai nói cho nó biết đã lỡ gì — **nhịp tra kế tiếp
trả về 500 entry cuối**, gồm cả những entry khung SSE không tới. Cơ chế `generation` + `CursorTooOld`
của hãng là thứ cho phép họ **khỏi phải tra liên tục**; nó là tối ưu hoá băng thông, không phải điều
kiện để bản ghi đúng.

**Chỗ còn hở, và chỉ còn đúng chỗ này:** một lần mất kết nối mà trong đó bản ghi mọc thêm **hơn 500
entry**. Lúc ấy trang cuối không phủ hết, và việc lật ngược bằng `nextBeforeSeq` là do client quyết
định chứ không phải ta. Đó là ca hiếm (bot phải rất bận, mạng phải đứt lâu) nhưng nó có thật, và nó
là thứ duy nhất còn đáng đo bằng cách rút dây mạng.


## 8 · Sáu trường bỏ qua — trường nào thật sự có hệ quả (đo 02/09)

§4 liệt kê sáu trường ta không đọc và để ngỏ "chưa rõ cái nào quan trọng". Đọc renderer 0.30 thì
chúng tách thành ba nhóm rõ rệt:

| trường | renderer dùng làm gì | hệ quả khi bỏ qua |
|---|---|---|
| `traceparent` · `enter_epoch_ms` | `emitTtfr` / `reportStream` — **đo lường thuần** | không có |
| `sent_at_ms` | **0 lần** trong renderer (chỉ có ở tầng proto) | không có |
| `message_id` | 1 chỗ thật: `messageIdAtTurnStart` để nhận ra lượt bắt đầu/kết thúc | không có |
| `composed_at_ms` | → `sentWhileOfflineAtMs`, vẽ nhãn *"soạn lúc …"* kèm class `sand-sent-while-offline-notice` | tin soạn lúc mất mạng **không hiện mốc thời gian soạn**; chỉ rơi về chỉ báo "đang xếp hàng" |
| **`is_fork`** | ghép với `replyToId` thành **khoá gốc luồng**: `dpt()` → `sand:thread <agentId> <rootId>` | **một trả lời dạng nhánh bị gộp vào luồng chính** thay vì thành nhánh riêng |

```js
function dpt(t){ return t.authoredThreadRootId !== undefined ? t.authoredThreadRootId
                 : (t.isFork === true && t.replyToId != null ? t.replyToId : null) }
function fpt(t){ const e = dpt(t); return e == null ? t.agentId : `sand:thread ${t.agentId} ${e}` }
```

`authoredThreadRootId` chỉ xuất hiện trong renderer (2 lần), **không** có trong `electron-main` — nó
là trạng thái phía client. Nên trên dây, `is_fork` + `reply_to_id` mới là cơ chế thật để tách nhánh.

**Một giả thuyết của tôi sai, và nó đáng chép.** Tôi đoán `message_id` là khoá khử trùng khi gửi lại,
nên bỏ qua nó sẽ **nhân đôi tin** mỗi lần bấm "resend" — nghe rất hợp lý, và sai. Renderer dùng
`clientNonce` cho việc đó (ta đã xử lý đúng), còn `message_id` chỉ để nhận ra mốc lượt. Nếu tôi "sửa"
theo giả thuyết ấy thì đã thêm một cơ chế khử trùng cho một cái bệnh không tồn tại — đúng họ với
`generation` ở §7.

**Việc còn lại thu về đúng một trường:** `is_fork`. Nó đã có chỗ trong `conversation/types.ts`
(`isFork?: boolean`) nhưng chưa được đọc lẫn phát lại. `composed_at_ms` là mục thẩm mỹ, chỉ thấy khi
soạn lúc mất mạng. Bốn trường còn lại: bỏ qua là ĐÚNG, không phải nợ.
