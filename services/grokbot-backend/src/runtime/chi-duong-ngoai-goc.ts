/**
 * Tệp nằm ngoài thư mục gốc của daemon: nói cho model biết ĐI ĐƯỜNG NÀO, không chỉ nói "bị chặn".
 *
 * ── Đo được 08/09/2026 ──────────────────────────────────────────────────────────────────────────
 *
 * `local_read` lên `D:\111\Desktop\runway-workflows-5c286efc\model_response.json` nhận đúng câu này
 * của daemon HÃNG:
 *
 *     Path is outside the allowed local-exec root and was refused: D:\111\…\model_response.json
 *
 * và **cùng tệp ấy qua `local_shell` thì exit 0, 86.182 byte, `cwd=C:\Users\admin`**. Tức cửa không
 * đóng — chỉ có cửa FILE-OP đóng. `localRoot` là thứ daemon tự khai trong khung `hello`
 * (`local-exec.ts` §hợp đồng) và `containPath` chặn BÊN TRONG daemon, nên backend không nới được;
 * thứ backend làm được là chỉ đường.
 *
 * Vì sao đáng làm: câu của daemon đúng về CƠ CHẾ nhưng đọc lên như một bức tường, nên model coi đó
 * là hết đường. Lượt thật 08/09 bot tự mò ra `local_shell` sau hai lần thử — nó tìm được, nhưng
 * bằng cách đoán. Một câu báo lỗi nêu đường đi biến chuyện đoán thành chuyện đọc.
 *
 * Vì sao CHỈ cho ĐỌC: hàng rào ghi có lý do riêng, và đi vòng một hàng rào GHI là quyết định của
 * chủ dự án chứ không phải của một câu báo lỗi. `local_write` giữ nguyên câu trần của daemon.
 *
 * Module này THUẦN và không import gì — `tools.ts` kéo cả pool lẫn box nên bài đo không nạp được nó
 * (bảng theo dõi §7); cùng lý do `runtime/tran-luot.ts` tách ra.
 */

/** Mảnh chuỗi ổn định trong câu của daemon. Khớp theo mảnh vì phần sau là đường dẫn của người dùng. */
export const NGOAI_GOC = "outside the allowed local-exec root";

/** Câu chỉ đường, viết cho MODEL đọc: nêu tool, nêu ví dụ, và nói rõ người dùng vẫn được hỏi. */
export const CAU_CHI_DUONG =
  "Đường đi được: tệp ngoài thư mục gốc vẫn ĐỌC được bằng `local_shell`"
  + " (Windows: `type <đường dẫn>`; nếu tệp lớn thì `powershell -NoProfile -Command \"Get-Content -TotalCount 200 '<đường dẫn>'\"`)."
  + " Mỗi lệnh shell vẫn hỏi người dùng bằng thẻ trong khung chat, nên đừng coi đây là đường tắt bỏ qua quyền.";

/**
 * Gắn câu chỉ đường vào đúng ca "ngoài thư mục gốc", giữ nguyên mọi câu lỗi khác.
 *
 * Không đổi câu gốc mà chỉ NỐI thêm: câu của daemon là bằng chứng, và một bài đo sau này còn khớp
 * chuỗi ấy để nhận ra ca này.
 */
export function chiDuongKhiNgoaiGoc(loi: string): string {
  return loi.includes(NGOAI_GOC) ? `${loi}\n\n${CAU_CHI_DUONG}` : loi;
}
