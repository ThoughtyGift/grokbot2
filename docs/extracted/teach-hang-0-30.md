# Teach a task của hãng (0.30) — chuỗi thật đọc từ cache client, 05/09/2026

> Nguồn: `%APPDATA%\Grok Bot\sand-client-persistence` (SQLite/blob của app GỐC, tài khoản người dùng),
> hai lượt dạy thật (31/08 và 05/09), cộng bundle `index-B3DQqRUH.js`. Không đoán một dòng nào.
> Script đọc: `doc-chuoi-teach.mjs` / `doc-teach-chitiet.mjs` (scratchpad phiên).

## 1 · FE — client làm gì khi bấm Stop

Client **tự đăng một tin đứng tên người dùng**, không cần người gõ:

```json
{ "kind": "message", "role": "user",
  "content": "The recording is finished. Learn the task from it.",
  "richText": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"workflowReference\",
               \"attrs\":{\"id\":\"learn-from-demonstration\",\"label\":\"Learn from demonstration\",
               \"teachQueueScope\":\"d15f09de…26e8\"}}]}]}",
  "clientNonce": "teach-recording:d15f09de…26e8:teach-20260905T040542Z-3b35d3c0-….json",
  "requestId": "676fdd69-…" }
```

Bundle chỉ **nhận ra** chuỗi này, không **dựng** nó (`Snn`: `clientNonce.startsWith("teach-recording:") && content === CAU`
→ vẽ kiểu `teach-recording`; `tS`: `id==="learn-from-demonstration"` → nhãn i18n). `teachQueueScope` xuất hiện **0 lần**
trong bundle ⇒ tin được host/BE của hãng tạo và đẩy vào transcript. Chip `workflowReference` (`AFt`) có `onClick → l7e()(id)`:
**mở panel skill**, không phải nút kích hoạt — bot đã trả lời sau 7,9 s mà không có thao tác nào khác.

## 2 · BE — chuỗi quan sát được (đúng thứ tự, mốc từ lúc tin đăng)

| lượt 05/09 (video 16 s) | lượt 31/08 (video ~3,5 phút) |
|---|---|
| +7,9 s *"Đang xem bản ghi dạy việc — mình học workflow từ demo."* | +39 s *"Mình xem video demo vừa quay, rồi tách thành skill dùng lại được."* |
| +18,7 s *"Bản ghi ~16 giây. Đang cắt khung kiểm tra rồi xem chi tiết."* | +57 s *"Clip ~3.5 phút. Mình lấy vài frame xem đã, rồi xem hết video."* |
| +41 s *"Thấy demo trên cinai.tv — mở template … Đang xem lại toàn bộ."* | +71 s *"Đang xem demo: Chrome, Shopee seller, rồi search Alibaba…"* |
| +99 s *"Đã thấy: reload → gallery → … Chờ xem hết video."* | +124 s *"**Lịch sử Chrome**: search Shopee, rồi 1688 (dính login)… Đang xem hết video cho khớp từng bước."* |
| — **requestId ĐỔI** (khoảng trống 31 s) — | — **requestId ĐỔI** (khoảng trống 183 s) — |
| +131 s *"Xong play-by-play … Đang lưu thành skill."* | +308 s *"Video khớp lịch sử … Đang tách thành skill."* |
| +145 s *"Đã học xong → [Preview CinAI template workflow](sand-workflow:preview-cinai-template-workflow)"* + 5 bước, `{template}` là input | +324 s *"Tách xong thành [Search Alibaba wholesale](sand-workflow:search-alibaba-wholesale)"* + 5 bước, `{query}` là input |
| +145 s **widget** *"Chạy thử skill với template vừa demo?"* [Dry run · Để sau] | +324 s câu văn *"Muốn chạy thử với `nến thơm` không?"* + ghi chú loại gì (1688 dính login, AI Mode fail CAPTCHA) |

Đọc ra thuật toán (khớp Instructions của skill trong ảnh chụp UI):

1. `ffprobe` thời lượng → cắt vài khung kiểm tra (bản ghi trắng thì dừng sớm).
2. Xem hết video (mp4 tách theo keyframe ~12 MB/phần, trần đính kèm 15 MB) — uỷ thác cho subagent `watchVideo`
   qua `Task(run_in_background)`. **Đây là chỗ `requestId` đổi**: lượt cha kết thúc sau khi uỷ thác, subagent
   báo về làm mọc một lượt mới.
3. **Đối chiếu với lịch sử Chrome trên box** để khớp từng bước (chỉ lượt dài mới thấy bước này).
4. Tách INPUT khỏi hằng số, viết 5 bước theo URL + nhãn nút (không toạ độ), ghi rõ bước có hậu quả phải hỏi trước.
5. Tạo skill, trả link `[Tên](sand-workflow:<slug>)` — bundle kiểm `slug` bằng `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; trùng
   slug thì hậu tố `-2` (bot dựng từ template nhận `search-alibaba-wholesale-2`).
6. Mời chạy thử với đúng giá trị vừa demo.

Cache **không có entry tool-call nào** (khớp kết luận 24 transcript trước) và **không có slice workflows** — thân skill
sống trong `store.db` trên box hãng, client lấy qua `getAgentWorkflows`. Nên BE ở đây là **quan sát được**, không
**trích được** — phần trích được trọn là FE + API (tin, nonce, richText, link).

## 3 · Bên mình — đang lệch ở đâu

| | hãng 0.30 | grokbot2 (nút `+` → `stopTeachRecording`) |
|---|---|---|
| dữ liệu bài học | video màn hình (mp4) | sự kiện DOM qua CDP (`teach.ts`) |
| ai học | **bot**, trong một lượt chat, có tiến độ từng câu | **backend**, đồng bộ, rồi `hocNen` sửa tên/prompt nền |
| người dùng thấy | tin hệ thống + chip + 4–6 câu tiến độ + link skill + mời chạy thử | trạng thái `saved` qua kênh `teach-recording`; không tin trong chat |
| sản phẩm | **1 skill** có `{input}` | routine `manual` **+** skill cùng tên "Việc đã dạy — MM-DD HH:mm" |
| tự xác nhận | mời dry-run | không |
| link skill trong câu | `sand-workflow:<slug>` → chip | 0 lần trong `src` — bot chưa bao giờ phát |

Đường video **đã có** ở bên mình: `teach-demo.ts` quay x11grab, `tinGiaoBaiHoc()` trả đúng câu
`CAU_GHI_XONG` + `@learn-from-demonstration`, và `turn.ts` khoá `ask_question` cho lượt ấy. Nhưng nó chỉ nối vào
hai tool **bot** gọi (`demo_start`/`demo_stop`), chưa nối vào nút `+` của client (`gateway.ts:170-171` → `teach.ts`).

Việc còn lại (§5 mục 14 bảng theo dõi): quyết định nút `+` đi đường nào, rồi (a) đăng tin `role:user` với
`clientNonce` `teach-recording:…` + `richText` chip để client vẽ đúng kiểu, (b) cho bot phát `sand-workflow:<slug>`
sau khi `create_workflow`, (c) kết bằng lời mời chạy thử. Cờ `sand_teach_by_demonstration`, ba lệnh
`start/stop/getTeachRecordingStatus` đã khớp từng chữ — không phải đụng tầng dây.
