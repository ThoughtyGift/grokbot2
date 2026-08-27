# 7.4.x — Tính năng mới của 0.29, theo bằng chứng thật

Kế hoạch riêng cho hàng `7.4` trong [bang-theo-doi.md](../state/bang-theo-doi.md). Dựng từ hai nguồn
**đo được**, không từ trí nhớ:

- **B1 — quét bản 0.29 thật**: bundle đã giải nén (`asar-extracted`, `"version": "0.29.0"`) + roster
  và transcript cache của chính app gốc đang chạy trên máy này.
- **B2 — toàn bộ lịch sử chat của app gốc**: [docs/extracted/chat-goc-0.29.md](../extracted/chat-goc-0.29.md)
  — 7 bot, 7 transcript, kèm description từng bot. Xuất lại bất cứ lúc nào:
  `node services/grokbot-backend/scripts/export-vendor-chat.mjs`
  (đọc `%APPDATA%/Grok Bot/sand-client-persistence`, giải mã tên blob base32; đây là cache phía
  client — bản đầy đủ nằm trong `store.db` trên box của hãng, ngoài tầm với).

Nguyên tắc nghiệm thu: **mỗi tính năng một E2E chạy đúng kịch bản B2 — cùng đầu vào, so đầu ra với
app gốc.**

---

## Tình trạng

| việc | tính năng (theo lời bạn) | trạng thái | bằng chứng |
|---|---|---|---|
| Luật lượt nói trong phòng chung | 1 (nửa sau) | ✅ **28/08** | `e2e-group-turn.mjs` 7/7 |
| Bot tự dựng đội: description + phòng | 1 (nửa đầu) | ✅ **28/08** | `e2e-team-build.mjs` 5/5 |
| Description vào lời nhắc hệ thống | nền của 1 và 2 | ✅ **28/08** | `prompt-persona.test.ts` |
| Bot xem video, tự chấm đầu ra | 3L | ⬜ **đề nghị làm kế tiếp** | — |
| Bot tự cài phần mềm trên box (OBS…) | 3 | ⬜ hạ tầng, làm sau 3L | — |
| Lời nhắc "bộ não" gợi ý skill/MCP/plugin | 2 | ⬜ | — |
| Chạy lại kịch bản B2 còn lại (OBS, CapCut) | khép vòng | ⬜ cần 3 + 3L | — |

---

## Tính năng 1 — bot tạo bot, gán description, mở phòng chung — ✅ XONG

**App gốc làm gì (đo trong B2):** Test Clone sinh 5 bot Shopee trong 6 giây (06:37:25–31), mỗi con
mang một bản SOP đầy đủ trong ô Description (Kho/CS/Ads/Listing/Kế toán — xem B2, phần roster), rồi
7 giây sau mở nhóm "Shopee Ops" chứa cả dàn. Trong phòng, mỗi lời nói mang `author {id, name}` của
thành viên; tin bot-gửi-bot phía người gửi là `{role:"assistant", toAgent:{id,name,kind:"agent"}}`,
phía người nhận là `{role:"user", fromAgent:{id,name}}` — cả hai shape bên ta **đã khớp sẵn**.

**Đã làm bên ta (28/08):**
- `create_agent` nhận `{"agents":[{name,description}]}` — SOP đóng đinh vào bot con, không trôi theo
  transcript; đúng chủ sở hữu kể cả lượt nền (`runWithOwner(ownerOf(bot mẹ))`).
- Tool mới `create_group` — thành viên nhận theo TÊN, chỉ so trong dàn bot của chính chủ.
- Ba luật lượt nói trong `sendPrompt`: lần lượt mỗi con một lượt (con sau đọc được lời con trước);
  bot không kích hoạt bot (chặn vòng lặp tận gốc); bản ghi thuộc nhóm còn giọng thuộc thành viên
  (`speakAs`).
- Hai lỗi thật bắt được bằng đo: (a) Description chưa bao giờ vào lời nhắc hệ thống — bot "Kho" tự
  giới thiệu thành trợ lý đa năng; (b) `summarise()` hardcode `isGroup:false` + `memberIds:[]` đè
  sự thật trên MỌI roster row — model làm đúng hết mà sidebar vẫn vẽ bot thường.

---

## Tính năng 3L — bot xem video, tự chấm đầu ra — ⬜ KẾ TIẾP

**App gốc làm gì (đo trong B2, transcript Test Clone):** sau khi ghi hình bằng OBS, bot MỞ file
`2026-08-08_20-17-52.mp4` và tự kết luận: *"~20 giây toàn màn đen, không đệ quy, không đổi scene,
không thấy UI"*, *"tiếng thì track AAC có mà gần như câm (-91 dB)"* — rồi tự sửa scene và quay lại,
clip mới *"không đen, ~15s, chữ xanh Shopee E2E Man hinh"*. Tức: **rút khung hình + đo âm lượng +
nhìn khung bằng mắt model**, không có phép màu nào khác.

**Kế hoạch bên ta:** một tool `watch_video` trong `runtime/tools.ts`:
1. `ffprobe` trên box: dài, codec, kích thước (ffmpeg đã có trên box — bot hãng cũng dùng ffmpeg).
2. Rút N khung đều tay (`ffmpeg -vf fps=...`) + `volumedetect` lấy mean/max dB.
3. Đính các khung vào lượt kế như ảnh (đường ống ảnh inline đã có sẵn — `attachments.ts`).
4. Lời nhắc: "bạn ĐANG thấy các khung hình" — như ghi chú ảnh hiện có.

**Nghiệm thu:** E2E tạo một mp4 đen 5s + một mp4 có chữ trên box, hỏi bot "clip này có gì" — phải
phân biệt được đen/có nội dung và đọc được mức âm lượng. So câu trả lời với đoạn B2 ở trên.

---

## Tính năng 3 — bot tự cài phần mềm trên box (OBS, CapCut…) — ⬜

**App gốc làm gì (đo trong B2):** không có tool cài đặt riêng — bot dò OS (`uname -s`, thẻ xin phép
`run-command` trong B2), rồi cài bằng shell thường và **tự xoay khi kẹt**: OBS cài được và chạy;
CapCut desktop "không có bản Linux" nên bot mở **CapCut Web** trên Chrome của box; gặp popup bắt
đăng nhập thì **đưa máy cho người dùng** (thẻ "Đăng nhập CapCut (Google/TikTok/email)" — Computer
handoff, bên ta đã có `request_box_help`).

**Khoảng trống bên ta:** không phải tool — là **quyền**. Box chạy mỗi người một tài khoản OS thường
(chặng 5), `apt-get install` cần root. Hãng không lộ cách giải; ta chọn theo vận hành:
1. **Toolbelt trong ảnh box** (rẻ, an toàn): cài sẵn obs-studio, ffmpeg, xdotool… — danh sách rút từ
   chính các kịch bản B2. Bot chỉ *dùng*, không *cài*.
2. **Cửa cài có trần** (đúng chất 0.29 hơn): helper `install_app` chạy `apt-get install` qua sudo
   whitelist — CHỈ lệnh đó, CHỈ từ kho chuẩn, log theo người. Cần soi an ninh kỹ (một gói apt độc là
   root trên box chung).
Đề nghị: làm ①, đo nhu cầu thật rồi mới cân ②.

**Nghiệm thu:** chạy lại kịch bản OBS của B2 trên bot mình: cài/mở OBS, tạo scene, Start/Stop
Recording, ra file mp4 — so từng bước với transcript Test Clone.

---

## Tính năng 2 — "bộ não" gợi ý skill / MCP / plugin tốt hơn — ⬜

**App gốc làm gì (đo trong B2):** khi thiếu năng lực, bot KHÔNG nói "không làm được" — nó **rà
catalog trước** rồi báo kết quả có căn cứ: *"Catalog plugin không có CapCut, Premiere hay DaVinci.
Không có MCP 'kéo timeline như CapCut' chính thức. Gần nhất trên store: Remotion (làm video bằng
React, 12 skill), Canva…"* — và với Shopee thì tự đề xuất ba đường (web / MCP quản shop / MCP tìm
sản phẩm) bằng widget `ask_question`, kèm điều kiện từng đường (Partner ID, key…). Nó cũng tự viết
SOP thành file (`shopee-ops-sop.md` đính trong B2) — "skill" chính là file SOP trên đĩa.

**Kế hoạch bên ta:**
1. Lời nhắc: thêm đoạn "khi thiếu năng lực → rà `get_mcp_tools` + catalog plugin + skill trước, trả
   lời có tên cụ thể, đề xuất bằng `ask_question`" — đúng nhịp ba bước của B2.
2. Tool `create_skill`: ghi file SOP vào thư mục skill trên box của chính chủ (đường ống
   `skills.ts` + `cachedSkillsSection()` đã đọc sẵn thư mục đó — chỉ thiếu đường ghi).

**Nghiệm thu:** lặp đúng câu B2 *"kiểm tra có MCP skill plugin chuyên nghiệp giống capcut không"* —
câu trả lời phải rà catalog thật và nêu tên thật, không bịa; và *"lưu SOP này thành skill"* phải ra
file đọc lại được ở lượt sau.

---

## Ngoài lề nhưng ghi lại từ B1 (không làm đợt này)

- `local-tool-permission` của 0.29 có `status:"always"` — thẻ Allow luôn; bên ta đã có
  `resolveLocalToolPermission` với `allow-once`, đối chiếu thêm khi đụng.
- Widget 0.29 có `widgetSkipped:true` — người dùng bỏ qua câu hỏi mà turn vẫn chạy tiếp.
- Roster 0.29 mang `path: /home/box/sand-data/agents/<id>/store.db` — transcript đầy đủ nằm trên
  box, cache client chỉ là replica. Gợi ý dài hạn: chuyển transcript bên ta xuống SQLite theo bot.
