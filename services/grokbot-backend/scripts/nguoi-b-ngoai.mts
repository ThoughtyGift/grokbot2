/**
 * Tài khoản web THỨ HAI cho bài đo — đăng ký (hoặc đăng nhập nếu đã có) NGOÀI tiến trình backend, trợ thủ của
 * `e2e-hai-tai-khoan.mjs`.
 *   npx tsx services/grokbot-backend/scripts/nguoi-b-ngoai.mts <email> <mật khẩu>   → {ok, token, email, authId}
 *
 * Vì sao ngoài tiến trình: `/v1/register` đóng khi đã có người (`registrationOpen()`), và mở lại đòi
 * `GROKBOT2_ALLOW_REGISTER=1` trong env của backend đang chạy — bài đo không được khởi động lại backend của người dùng.
 * Ở đây đặt biến ấy CHO RIÊNG tiến trình này rồi gọi thẳng `registerUser` — nó ghi vào cùng SQLite mà backend đọc mỗi lần
 * `loginUser`, nên JWT mint ra dùng được ngay với `/gw/api`. Người này tồn tại lâu dài trong kho dev (không có API xoá
 * người) — tên có chữ "e2e" để nhận ra.
 *
 * Trỏ vào kho THẬT là chủ ý (đo backend đang chạy); đừng chạy với `GROKBOT2_STATE_FILE`/`GROKBOT2_DATA_DIR` tạm.
 */
const [, , email, matKhau] = process.argv;
if (!email || !matKhau) { console.log(JSON.stringify({ ok: false, error: "cần <email> <mật khẩu>" })); process.exit(2); }
process.env.GROKBOT2_ALLOW_REGISTER = "1";
const W = await import("../src/web-auth.ts");
let r = W.loginUser(email, matKhau);
if (!r.ok) r = W.registerUser(email, matKhau);
if (!r.ok) { console.log(JSON.stringify(r)); process.exit(1); }
// `authIdFor` của web-auth.ts không export: dạng là `local|<email thường hoá>` (chỉ để in, không dùng để gọi).
console.log(JSON.stringify({ ok: true, token: r.token, email: r.email, authId: `local|${email.trim().toLowerCase()}` }));
process.exit(0);
