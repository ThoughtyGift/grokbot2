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

## 3 · Bên mình — đã khớp tới đâu (06/09/2026)

Nút `+` đi đường VIDEO từ 06/09 (bảng theo dõi §6 mục 25). Bảng lệch cũ giữ lại bên trái để thấy đã đổi gì:

| | hãng 0.30 | grokbot2 tới 05/09 | grokbot2 từ 06/09 |
|---|---|---|---|
| dữ liệu bài học | video màn hình (mp4) | sự kiện DOM qua CDP | **video** (x11grab display của đúng bot) **+** nhật ký CDP kèm — thay cho "lịch sử Chrome" hãng đối chiếu |
| ai học | **bot**, trong một lượt chat | backend đồng bộ, `hocNen` nền | **bot**, một lượt chat, 6 câu tiến độ (đo: *"Khung ở giây thứ 8 là trang example.com, bản ghi ổn" → "khớp đúng với nhật ký thao tác"*) |
| người dùng thấy | tin `teach-recording` + chip + tiến độ + link skill | trạng thái pane, không tin | tin `role:user` đúng câu hằng + `clientNonce` `teach-recording:<sha256>:teach-<ISO>-<uuid>.json` → renderer vẽ kiểu teach-recording; tiến độ; link |
| sản phẩm | 1 skill có `{input}` | routine + skill "Việc đã dạy — …" | **1 skill** bot đặt tên (*"Mở trang example domains của IANA"*) |
| link skill | `[Tên](sand-workflow:<slug>)` | 0 lần | `[Tên](sand-workflow:<id>)` — `create_workflow` trả id + cú pháp; renderer so `slug === workflow.id` (`dft()` → `{kind:"skill", workflowId}` → `focusSkillId`), id `wf-…` khớp regex slug |
| không hỏi lại | — | cờ `luotHocTuBanGhi` chỉ bật qua `sendPrompt` | cờ bật vì `content` đúng bằng câu hằng; video/nhật ký đi `modelNote` (chỉ model đọc) |
| không có box | — | đường CDP | **rơi về đường CDP cũ** nguyên vẹn |

| chip dưới câu | `richText` doc: `workflowReference{id:"learn-from-demonstration", label, teachQueueScope}` | — | **cùng doc**, `id` = id THẬT của skill học-từ-demo (`wf-…`) để bấm chip mở đúng skill (pill so `x.id`), label giữ chữ hãng; entry `message` nay lưu `richText` string — schema 0.43 có khoá này, và client cũng gửi `richText` string cho mọi tin thường (đo `coverage.lastArgs`) nên mention/chip người dùng gõ cũng vẽ lại đúng sau khi mở lại |

Còn khác, cố ý hoặc chưa: hãng đổi `requestId` giữa chừng vì uỷ thác subagent xem video (ta xem trong một lượt); hãng
mời dry-run bằng widget hoặc câu (ta dặn trong skill — đo 06/09 bot kết *"Muốn mình chạy thử một lượt với chính
example.com không?"*). `demo_start`/`demo_stop` (bot tự quay khi được nhờ) vẫn còn, cùng hạ tầng.
