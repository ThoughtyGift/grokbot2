# Marketplace → Bots của app gốc 0.43: trích được gì, và app local lấy tài nguyên từ đâu (06/09/2026)

> Câu hỏi của chủ dự án: *"trích xuất các bot template trong các danh mục trên panel Marketplace của app gốc để mapping sang
> app local có tài nguyên — hay tự xây?"* Trả lời ngắn: **danh mục của hãng không trích được**, cả về kỹ thuật lẫn theo
> `legal.md`; app local có tài nguyên bằng **danh mục của mình** (9 bot + Thợ dựng bot), dựng bằng script, 0 lượt model.

## 1 · Đo: dữ liệu Marketplace của hãng nằm ở đâu

| nguồn | đọc được không | thấy gì |
|---|---|---|
| `%APPDATA%\Grok Bot\sand-client-persistence` (read-only, giải base32 tên lát cắt) | có | 33 lát cắt: `roster.last-roster` · 28 `transcript.replicas.<bot>` · `composer-drafts` · `send-journal` · `sidebar.last-sections` · `selection.last-agent` · `ui-agent-refs` · `ui-layout` · `account-slot`. **Không có lát cắt marketplace / template / listing nào** |
| SQLite của app gốc | không có file `.db`/`.sqlite` trong hồ sơ 0.43 (bản 0.29 trước đây có) | — |
| RPC `ListPublicGrokBotMarketplaceListings` + blob recipe | đi thẳng máy chủ hãng, chỉ khi mở tab; client không cache | — |
| thân skill của bot hãng | nằm trên box hãng; chỉ hiện trong UI khi mở skill | — |
| CDP vào app gốc | **không** — app gốc từ chối mọi cờ lạ (bảng theo dõi §7) | — |

Kết luận kỹ thuật: thứ duy nhất "của Marketplace hãng" có trên máy này là các bot người dùng **đã import** vào tài khoản hãng
(ví dụ *dr eggbot* của Lauren Tan, thấy trong `roster.last-roster`). Đó là nội dung của người tạo bên thứ ba; `legal.md` đã
ghi không kéo/phân phối lại nội dung Marketplace của hãng — nên không chép sang kho local (kho local có tài khoản B nhìn thấy,
tức là phân phối).

## 2 · Danh mục hãng nhìn từ UI — chỉ để đối chiếu HÌNH, không chép chữ

Ảnh chụp 06/09 (tab Bots): Featured 4 thẻ (*Lauren Tan's dr eggbot · Lenny Rachitsky's Overheard · Claire Vo's Tradbot · Eric
Zakariasson's Projects Manager*), ô tìm "creator or Bot name", chip nhóm (All · From Grok Bot Team · Engineering · Sales ·
Marketing · Design · Personal · More), mục *From Grok Bot Team* hai cột với "View all", mỗi dòng *tên · by người tạo · một câu*.
Các vai thấy được: thiết kế bot (dr eggbot), quản lý dự án từ Notion, tìm khách tiềm năng, SEO/AEO, kiểm chi tiêu SaaS, điều
phối tuyển dụng, podcast/overheard, giao dịch.

Phần HÌNH này đã chép xong từ 05/09 (§6 mục 21 bảng theo dõi): 9 nhóm đúng khoá renderer, Featured do người vận hành đặt,
hồ sơ người tạo, import ra bot mang id client đúc, trang `/bot/<id>`.

## 3 · Tài nguyên của app local: danh mục của mình

| nhóm | bot của mình | vai | featured |
|---|---|---|---|
| productivity | **Thợ dựng bot** (`src/tho-dung-bot.ts`) | hỏi 3 câu → dựng bot + skill + routine → đưa lên Marketplace | ★ |
| engineering | Trực Lỗi Sản Xuất | tóm tắt log · bản báo sự cố · checklist deploy | ★ |
| design | Duyệt Giao Diện | soát màn hình · brief cho designer | |
| marketing | Xưởng Caption | caption đa nền tảng · lịch đăng tuần · đổi giọng | ★ |
| customer-support | Trực Chat Shop | trả lời khách · phân loại khiếu nại · bộ mẫu câu | ★ |
| product | Sổ Ý Tưởng | gom phản hồi thành PRD · chấm ưu tiên | |
| ops-finance | Sổ Thu Chi | ghi thu chi · đối soát hai bảng · báo cáo tuần | |
| recruiting-people | Điều Phối Tuyển Dụng | JD · sàng lọc hồ sơ · bộ câu hỏi phỏng vấn | |
| sales | Săn Khách Mới | lọc khách tiềm năng · tin chào đầu · nhịp theo dõi | |
| productivity | Thư Ký Ngày | xếp việc hôm nay · chốt ngày | |

Nguồn: `src/danh-muc-mau.ts` (nội dung tự viết, tiếng Việt, mỗi skill có `{input}`, mỗi SOP có luật chung: hỏi trước việc
khó gỡ · không bịa số · bí mật qua `request_secret` · kết nối chưa có thì nói rõ). Hàng rào `loiDanhMuc()` chạy ở test và ở
script dựng — đúng ba luật validator client 0.43 (mọi chuỗi phải có chữ, nhóm đúng khoá, không trùng tên).

Dựng: `npx tsx services/grokbot-backend/scripts/dung-danh-muc-mau.mts` (+ `dung-tho-dung-bot.mts`) — tạo bot theo tên, skill
tạo/nâng tại chỗ, mẫu ngoài tiến trình, listing đúng nhóm; chạy lại an toàn. Muốn thêm bot: thêm một mục vào `DANH_MUC`,
chạy test, chạy script. Muốn bot làm được việc thật hơn nữa: mở bot đó, gõ `/`, sửa skill — mẫu bản kế `Update template`.

## 4 · Còn lại

- Mẫu trong danh mục chưa chở routine (recipe `routines` rỗng): `mau-bot-ngoai.mts` chỉ bind nguồn skill. Nếu cần, bind thêm
  `automations` ở script dựng (import kéo theo `chat.js` — cân nhắc) hoặc để bot tự tạo routine khi người dùng yêu cầu.
- Ảnh người tạo: hồ sơ "Đội Vận Hành" chưa có ảnh — `setCreatorProfile{profilePhotoUrl}`.
