/**
 * Dựng ĐỘI bot — bước thứ tư mà lời nhắc đang thiếu: đặt lịch cho từng con.
 *
 * ── Đo được, không phải cảm giác ────────────────────────────────────────────────────────────────
 *
 * Bot mẹ bên mình dựng đội xong thì mỗi con có một bảng Routines TRỐNG ("Routines are recurring
 * tasks this Bot runs on a schedule · Create Routine"). App gốc thì không — nó đặt lịch ngay trong
 * cùng cuộc trò chuyện, và bản ghi 0.29 nói thẳng:
 *
 *     "Mình set lịch check ads 2 lần/ngày (sáng + 16h): spend, ROAS, pause SKU hết hàng…"
 *     "Đã set lịch check 8h sáng và 16h mỗi ngày, cả T7 CN (ads cháy tiền cuối tuần)."
 *     "Muốn mình chạy standup group mỗi sáng 8h thứ 2–6 không?"
 *
 * Một đội bot không có lịch thì chỉ chạy khi người dùng nhớ ra mà mở từng con — tức là đúng thứ
 * việc mà họ nhờ bot làm hộ.
 *
 * ── Năng lực đã có; thiếu là LỜI DẶN ────────────────────────────────────────────────────────────
 *
 * `create_routine` nhận `agent`/`for`/`bot` để gắn lịch vào bot con — sửa từ 28/08, sau khi đo được
 * bot mẹ tạo hai routine cho hai con mà cả hai rơi vào chính bot mẹ. Nên chỗ hổng không nằm ở tool
 * mà ở chỗ lời nhắc dạy dựng đội theo BA bước (`create_agent` → `create_group` → gửi việc đầu vào
 * room) rồi dừng.
 *
 * Đây là bước thứ tư, tách ra file riêng để đoạn PEER_PROTOCOL trong `tools.ts` khỏi phình thêm —
 * nó đã dài và trộn bốn chủ đề rồi.
 */

/**
 * Bước 4: mỗi con một lịch.
 *
 * Hai chỗ cố ý:
 *
 *   · **Nêu tên bot trong `agent`** — không có trường đó thì routine rơi vào bot mẹ, và bot mẹ là
 *     con duy nhất không bao giờ chạy chúng. Đây từng là lỗi thật, không phải lo xa.
 *   · **Hỏi trước khi đặt** giờ chạy. Một cái lịch là thứ tự chạy mãi về sau; đặt hộ rồi báo sau
 *     thì người dùng phát hiện ra nó vào lúc nó đã chạy vài hôm. App gốc cũng hỏi
 *     ("Muốn mình chạy standup group mỗi sáng 8h không?") chứ không tự quyết.
 */
export const BUOC_DAT_LICH = [
  "",
  "Bước 4 — MỖI CON MỘT LỊCH. Một đội không có lịch chỉ chạy khi người dùng nhớ ra mà mở từng bot,",
  "tức đúng việc họ nhờ bạn làm hộ. Sau khi dựng xong đội, đề nghị lịch cho từng vai bằng câu ngắn,",
  "rồi khi người dùng ừ thì đặt:",
  "",
  'TOOL_CALL: create_routine({"agent":"Kho","name":"Rà đơn chờ lấy","prompt":"Mở Kênh Người Bán, đếm đơn Chờ lấy hàng, ưu tiên Hỏa Tốc và hạn hôm nay, báo lại","trigger":"0 8 * * 1-5"})',
  "",
  'PHẢI có `"agent"` — thiếu nó thì lịch rơi vào chính bạn, và bạn là con duy nhất không chạy nó.',
  "Lịch nên bám nhịp làm việc thật của vai đó (CS theo ca trực, Ads sáng và ~16h, Kế toán cuối tuần),",
  "không phải cùng một giờ cho tất cả.",
  "",
  "Đừng tự đặt rồi báo sau: một cái lịch chạy mãi về sau, nên hỏi một câu trước khi tạo.",
].join(String.fromCharCode(10));

/**
 * Đặt tên bot — luật trích từ CHÍNH tên app gốc đã tạo, không phải từ prompt.
 *
 * Prompt live của hãng (`docs/extracted/prompt-base-goc-live.md`) không có mục nào về đặt tên, nên
 * luật phải đọc ngược từ kết quả. Hai nguồn, cách nhau nhiều ngày, cho cùng một khuôn:
 *
 *     bản ghi 0.29   Shopee CS · Shopee Kho · Shopee Listing · Shopee Ads · Shopee Kế toán
 *                    nhóm: Shopee Ops
 *     app hiện tại   Shopee CSKH · Shopee Đơn Hàng · Shopee Sản Phẩm · Shopee Khiếu Nại ·
 *                    Shopee Tài Chính · nhóm: Shopee Kinh doanh, Shopee Vận hành
 *
 * Khuôn: `<Miền> <Vai>`. Miền là nền tảng/lĩnh vực người dùng đang nói tới; vai là một hai từ.
 *
 * Bên mình đặt "Vận Hành Đơn", "CSKH", "Ads & Khuyến Mãi", "Sản Phẩm & Nội Dung", "Báo Cáo" — đúng
 * vai nhưng KHÔNG có miền. Cái giá chỉ hiện ra khi người dùng có đội thứ hai: một sidebar lẫn lộn
 * "CSKH" của Shopee với "CSKH" của TikTok, và ô Search không giúp được vì gõ "shopee" không ra gì.
 * Tiền tố chính là thứ làm cả đội nằm liền một khối và tìm được bằng một từ.
 */
export const LUAT_DAT_TEN = [
  "",
  "ĐẶT TÊN BOT: `<Miền> <Vai>` — miền là nền tảng hoặc lĩnh vực người dùng đang nói tới, vai là một",
  "hai từ. Ví dụ có thật: `Shopee CS`, `Shopee Kho`, `Shopee Ads`, `Shopee Kế toán`; nhóm cũng cùng",
  "tiền tố: `Shopee Ops`, `Shopee Vận hành`.",
  "",
  "Tiền tố không phải để cho đẹp: nó làm cả đội nằm liền một khối trong sidebar và tìm được bằng",
  "một từ. Bỏ nó đi thì đội thứ hai sẽ có một `CSKH` thứ hai, và không ai biết con nào của sàn nào.",
  "",
  "Đừng thêm `Bot` vào tên, đừng đánh số, đừng dùng `&` hay dấu gạch — tên hiển thị trong một hàng",
  "hẹp. Viết hoa như tiếng Việt bình thường (`Shopee Đơn Hàng`, không phải `Shopee ĐƠN HÀNG`).",
].join(String.fromCharCode(10));
