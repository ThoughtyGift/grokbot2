# Bản ghi + ngữ cảnh của MỘT phiên bot — app gốc 0.43 làm gì, local chép gì (06/09/2026)

> Câu hỏi của chủ dự án: app gốc cuộn ngược lên chỉ hiện một cửa sổ, app local hiện từ đầu đến cuối và
> giật; và "bộ não" đọc ngữ cảnh kiểu gì để lịch sử không phình. Trả lời bằng ba tầng FE · API · BE, mỗi
> tầng đọc từ nguồn thật (renderer 0.43 `index-Df98_wE4.js`, schema coordinator, đĩa của app gốc, SQLite của ta).

## 1 · Kết luận trước

| tầng | app gốc 0.43 | local trước 06/09 | local từ 06/09 |
|---|---|---|---|
| FE tải bản ghi | `getAgentTranscriptTail{id, limit: 500 (bot đang mở) / 200 (bot khác)}`, cuộn lên → trang cũ `limit: 100, beforeSeq` tới khi reply vắng `nextBeforeSeq` | y hệt (cùng renderer) | y hệt |
| FE vẽ | danh sách ẢO HOÁ (`overscanCount`, hàng absolute) — chỉ vẽ hàng trong khung nhìn | y hệt | y hệt |
| API đẩy sống | khung SSE `transcript` **có `ordered`** `{replicaKey:"transcript:<bot>", epoch, sequence}` → replica áp `entry` ngay | khung KHÔNG `ordered` → client coi là tiếng gõ, **bỏ `entry`**, tải lại cả đuôi (500 entry) sau MỖI khung — ta phát một khung mỗi tick 45 ms | **có `ordered`** — đo: 38 → 5 lượt tải đuôi/lượt bot, DOM vẽ sống, replica trên đĩa neo `epochHint` |
| API trọng lượng | entry tool-call chỉ `id·kind·name·status·summary·timestampMs` | entry tool-call mang `rawArgs` + `result` = **51 %** của trang 292 KB (New Bot, 441 entry) | bỏ hai khoá ấy ở cửa `/gw` (renderer đọc chúng 0 lần) |
| BE ngữ cảnh model | server hãng (Temporal), không đọc được; cờ client: `grok_bot_early_compaction {enabled:false, contextTokenThreshold:100k}`, `client_speculative_summarization_config {tokenUsageThresholdPercentage:70}` | `compaction.ts`: tóm tắt phần cũ khi lịch sử > 12k token, giữ 8 tin cuối nguyên văn; đã chạy thật (11 bot có bản tóm tắt trong SQLite, New Bot 5,4 KB) | không đổi — trần đọc từ `GROKBOT2_CONTEXT_BUDGET` / `GROKBOT2_KEEP_RECENT` |

Cái "giật" không nằm ở số hàng vẽ (renderer ảo hoá) mà ở **đường đẩy sống**: mỗi token là một khung, mỗi khung
là một lượt tải 292 KB rồi ghép lại 441 entry. Với bot 5 hàng thì 38 lượt/6 s vô hại; với New Bot là ~3 MB/s JSON.
Cùng cơ chế ấy sinh ra "bản ghi sống đứng" (bảng theo dõi §5 mục 19): một lượt tải không về giữ `isFetchInFlight`
và mọi tiếng gõ sau chỉ ghi cờ.

## 2 · FE — renderer 0.43 tải và giữ bản ghi thế nào

Hằng đọc từ bundle: `vT=500` (trang đầu của bot đang mở) · `QV=200` (bot khác) · `y_t=100` (trang cũ mỗi lần cuộn lên) ·
`JV=1e3` (trần tổng entry giữ trong bộ nhớ cho các bot KHÔNG đang mở — vượt thì cắt đều) · `p_t=512` (đệm sự kiện lệch thứ tự).

```
mở bot          → getAgentTranscriptTail({id, limit: 500})            reply SandTranscriptPage {entries, nextBeforeSeq?}
cuộn lên đỉnh   → t_t(history): cursor.kind==="more" ? {beforeSeq: cursor.beforeSeq, limit: 100} : null
                → getAgentTranscriptTail({id, limit: 100, beforeSeq})  → n_t ghép trang, cursor = nextBeforeSeq ? more : exhausted
tiếng gõ (SSE không ordered) → Q(record) = tải lại trang đầu; history trang cũ bị THAY bằng mA(nextBeforeSeq) trừ khi preserveRetainedHistory
```

Ghi xuống đĩa (`sand-client-persistence/…transcript.replicas.<bot>`): `{entries, epochHint, acceptedSequenceHint, persistedAt}`,
trần `a_t=200` entry · `i_t=768 KB` · `YV=24` bot · TTL 7 ngày, flush 2 s. **Đĩa của app gốc** (đọc 06/09, read-only):
bot đang dùng có `epochHint: "fbf22d21-…"`, `acceptedSequenceHint: 9`; bot cũ (01/09) `null` — hãng đã chuyển sang replica có
thứ tự cho bản ghi. Số entry hãng giữ: 144 (61 KB) · 118 (52 KB) · 42 · 29… — không thấy entry `tool-call` nào trong
persistence của hãng (kinds: message · send-message · event · feedback · user-attachment).

Danh sách hàng: ảo hoá (`fL({cachedBounds, containerScrollOffset, containerSize, itemCount, overscanCount})`) — hàng ngoài khung
không có trong DOM, nên "hiện từ đầu đến cuối" thật ra là "có thể cuộn tới đầu" (hãng cũng vậy: ảnh chụp app gốc cuộn tới
*Sun, Aug 30* với mũi tên về cuối).

## 3 · API — replica có thứ tự (`mJ`) và phong bì `OrderedStamp`

Schema 0.43 `events.transcript` là union: `{type:"snapshot", activeAgentId, entries, ordered?, coverage?}` ·
`{type:"appended"|"updated", entry, agentId?, ordered?}` · `{type:"removed", id}` · `{type:"cleared"}`; `OrderedStamp =
{epoch: string, replicaKey: string, sequence: number}`. Khung PHẲNG — không có khoá `event` lồng.

Renderer (`ne=V=>{const{ordered:K}=V; …}`):

```
K == null      → tiếng gõ: agentId = V.agentId; nếu record.isFetchInFlight thì chỉ đặt isActivityRefreshQueued; không thì Q(record)
K != null      → agentId = tz(K.replicaKey)  (cắt sau tiền tố "transcript:"; "\0" tách sessionId, mặc định bs)
                 record.observedAnchor = {epoch: K.epoch, sequence: K.sequence}
                 replica.ingestEvent({ordered: K, event: {type: V.type, entry: V.entry}})
mJ.ingestEvent → epoch lạ hoặc chưa có → joinOrStartAttempt() (resync) + đệm
              → sequence === accepted + 1 → applyEvent (m_t: appended thay-hoặc-thêm theo id · updated map theo id · removed · cleared)
              → lệch → đệm (tối đa 512) + startAttempt()
resync         → Q(record) tải đuôi; reply + anchor → ingestSnapshot({replicaKey, epoch: anchor.epoch, throughSequence: anchor.sequence,
                 coverage: {kind:"transcript-live-range", fromSequence, throughSequence}, value:{entries}}) → drainBuffer
```

Vì đuôi và sự kiện cùng đọc một bản ghi trong bộ nhớ backend nên chuỗi luôn khớp; backend khởi động lại = epoch mới = client
neo lại (một lượt tải), không đứng.

## 4 · BE local — chép gì (06/09)

- `packages/cursor-acl/src/sse.ts` `onTranscriptAppend`: phát `{type, agentId, entry, ordered: nextTranscriptOrdered(agentId)}`
  (phẳng). `nextTranscriptOrdered` (`conversation/index.ts`, viết 08/2026 cho client 0.30 rồi bỏ) nay dùng thật:
  `replicaKey: transcript:<bot>`, `epoch: EPOCH` (chuỗi, chung tiến trình), `sequence` +1 theo bot (gieo từ số entry).
  Cổng ports `ConversationPort.nextTranscriptOrdered?`. Tắt khẩn: `GROKBOT2_TRANSCRIPT_ORDERED=0` → khung tiếng gõ như trước.
- `conversation/index.ts` `choClientGoc`: entry `tool-call` ra `/gw` bỏ `rawArgs` + `result` (schema không có, renderer đọc 0 lần).
  Trang đuôi New Bot 292 KB → ~146 KB. Bản ghi nội bộ và `/v1` không đổi.
- Trang đuôi (`transcriptTail`) đã đúng giao thức từ trước: `limit` (mặc định 200, trần 1000), `beforeSeq`, `nextBeforeSeq` vắng
  khi hết; `kiem-reply-0-43` xanh cho cả trang đầu lẫn trang cũ sau khi cắt hai khoá.

**Đo bằng `scripts/do-ban-ghi-song.mjs`** (bot thử, một câu 25 dòng, client 0.43 local, cùng ngày, cách nhau 10 phút):

| | khung tiếng gõ (trước) | khung `ordered` (sau) |
|---|---|---|
| lượt `getAgentTranscriptTail` trong một lượt bot | **38** (trong ~6 s gõ) | **5** (mở bot 2 · neo 2 · xong 1) |
| DOM mọc chữ sống | có | có (chữ đầu 5,4 s = độ trễ model) |
| replica client trên đĩa | `epochHint: null` | `epochHint: "1788654445924"`, `acceptedSequenceHint: 37` |

## 5 · "Bộ não" đọc ngữ cảnh — hãng vs ta

Phần này của hãng chạy trên server (workflow Temporal), bundle chỉ để lộ hai cờ: `grok_bot_early_compaction` (mặc định tắt,
`contextTokenThreshold` 100k, khoảng hợp lệ 32k–1M) và `client_speculative_summarization_config` (tóm tắt khi dùng 70 % cửa sổ,
dung sai 5 %, lượt đang bay tối đa 5 phút). Tức hãng để lịch sử lớn tới cỡ trăm nghìn token rồi mới nén.

Ta (`compaction.ts` + `turn.ts`): `historyFor` lấy TOÀN bộ bản ghi của bot, lọc ra tin có chữ (New Bot: 269/441 entry ≈ 10,7k
token ước lượng len/2,8), `needsCompaction` khi > 12k token và > 16 tin → gọi model viết "bản giao ca" cho phần cũ, giữ 8 tin cuối
nguyên văn, lưu `{summary, coveredCount}` vào bảng `compaction` (SQLite: 11 bot đã có, New Bot 5.473 B). Nên ngữ cảnh gửi model
**bị chặn** ở ~12k + 8 tin, không phình theo bản ghi; đổi bằng `GROKBOT2_CONTEXT_BUDGET` / `GROKBOT2_KEEP_RECENT`. Khác hãng ở
CON SỐ (12k vs ~100k), không ở cơ chế — trần thấp rẻ hơn và quên sớm hơn; nâng lên là quyết định chi phí, không phải việc code.

## 6 · Việc còn lại

- Quan sát vài ngày: `coverage.calls.getAgentTranscriptTail.n` phải tăng theo số lần MỞ bot, không theo số token; §5 mục 19
  (bản ghi đứng) coi là đã xử gốc nếu không tái hiện trong `e2e-chia-se-mau` nhiều lượt.
- Chưa phát `snapshot`/`removed`/`cleared` — chưa có đường nào xoá entry rời; xoá bot xoá cả bản ghi nên client không cần.
- Nhịp 45 ms/khung là hiệu ứng gõ chữ của ta (`setTimeout(tick, 45)`), giờ mỗi khung ~1 KB nên để nguyên; nếu VPS nhiều bot
  cùng gõ thì gom 100–150 ms là chỗ tiết kiệm kế tiếp.
