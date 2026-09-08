/**
 * Marker CÓ và neo đã MẤT — nhưng thân nằm đó có phải thân của bản vá hiện tại không?
 *
 * ── Vì sao câu hỏi này phải tồn tại ────────────────────────────────────────────────────────────
 *
 * Cho tới 08/09 `--verify` chỉ hỏi hai câu: "có marker chưa" và "còn chỗ nào chưa vá không". Hai
 * câu ấy đủ cho một bản vá không bao giờ đổi nội dung, và **không đủ** cho bản vá đổi THÂN: thân cũ
 * đã nuốt mất neo, nên `pickVariant` không tìm thấy gì để báo ⇒ kết luận *applied · 0 unpatched* ⇒
 * xanh vĩnh viễn, kể cả khi thân trong bundle là bản viết từ tuần trước.
 *
 * Đo được 08/09 trên `%LOCALAPPDATA%\Programs\Bot Noi Bo 043` (bản người dùng đang mở): ba bản vá
 * `computer-tab-{ipc,label,permission}` báo XANH trong khi thân của cả ba vẫn đọc
 * `process.env.GROKBOT2_GATEWAY_TOKEN` — tức bản vá vé người dùng (`computer-tab-ve`, 07/09) có áp
 * thêm cũng vô ích, vì ba chỗ ĐỌC vé đều là bản cũ. Cùng họ với "một guard chỉ đáng tin khi đã thấy
 * nó trả TRUE một lần": ở đây guard chưa bao giờ được thấy trả FALSE.
 *
 * ── Phép kiểm ─────────────────────────────────────────────────────────────────────────────────
 *
 * Máy vá là `split(find).join(replace)` THUẦN CHỮ, không regex, không biến đổi tính toán. Nên sau
 * một lần áp, chuỗi `replace` phải nằm NGUYÊN VĂN trong file. Đó là phép kiểm rẻ và chắc: không
 * biến thể nào của bản vá có thân trong file ⇒ thân ấy do một bản `patch-client` CŨ đặt vào.
 *
 * Hỏi theo TẬP biến thể chứ không theo biến thể "đang khớp": sau khi vá thì không biến thể nào còn
 * khớp neo nữa, nên không có cách nào biết bundle này thuộc bản nào ngoài việc nhìn xem thân của ai
 * đang nằm đó.
 *
 * Người gọi chỉ nên hỏi khi marker ĐÃ có. Bundle chưa vá thì `pickVariant` lo rồi, và ở đó câu trả
 * lời đúng là "còn n chỗ chưa vá", không phải "thân cũ".
 */
export function thanHienHanh(p, src) {
  const list = p.variants ?? [p];
  return list.some((v) => {
    const replace = v.replace ?? p.replace;
    return typeof replace === "string" && replace.length > 0 && src.includes(replace);
  });
}
