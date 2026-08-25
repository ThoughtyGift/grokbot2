/**
 * Số hiệu đời của token — thứ làm cho **đăng xuất thu hồi được thật**.
 *
 * JWT không có trạng thái: đã phát ra là không rút lại được từng cái. Trước chặng này, `/v1/logout`
 * trả 204 rồi thôi — token cũ vẫn mở được `/v1/me` suốt **365 ngày**. Ai cầm được token là cầm được
 * tài khoản trong một năm, và không có cách nào cắt.
 *
 * Cách rẻ nhất không cần danh sách đen: mỗi người một số đời. Token mang `tv`; đăng xuất thì tăng
 * số; mọi token đời cũ chết ngay. Không có gì phải dọn, và không phải tra sổ mỗi request nhờ bộ nhớ
 * đệm bên dưới.
 *
 * **Token KHÔNG có `tv` vẫn hợp lệ** — đó là token của đường desktop và của e2e, vốn chưa từng có
 * trường này. Cùng một lối tương thích ngược đã dùng cho `purpose` trong `auth.ts`: bắt mọi đường cũ
 * khai thêm một trường mới thì đường app hỏng ngay, mà đường app mới là đường người dùng thật đi.
 */
import { withDb } from "./store.js";

/**
 * `verifyJwt` chạy trên MỌI request, nên không thể tra sổ mỗi lần.
 *
 * Đệm là đúng ở đây vì chỉ một tiến trình được ghi (xem `enableWriting`), nên chỗ duy nhất đổi số
 * cũng là chỗ duy nhất phải xoá đệm — không có ai khác đổi sau lưng.
 */
const cache = new Map<string, number>();

/** Số đời hiện tại của một người. Người chưa có trong sổ coi như đời 0. */
export function tokenVersionOf(authId: string): number {
  const hit = cache.get(authId);
  if (hit !== undefined) return hit;
  const v = withDb((db) => {
    const row = db.prepare("SELECT token_version FROM users WHERE auth_id = ?").get(authId) as
      { token_version?: number } | undefined;
    return row?.token_version ?? 0;
  });
  cache.set(authId, v);
  return v;
}

/**
 * Tăng đời — gọi khi đăng xuất, và nên gọi cả khi đổi mật khẩu.
 *
 * Trả về số mới. Người chưa có dòng trong `users` thì không có gì để thu hồi, trả 0.
 */
export function bumpTokenVersion(authId: string): number {
  if (!authId) return 0;
  const next = withDb((db) => {
    const info = db.prepare("UPDATE users SET token_version = token_version + 1 WHERE auth_id = ?").run(authId);
    if (!info.changes) return 0;
    const row = db.prepare("SELECT token_version FROM users WHERE auth_id = ?").get(authId) as
      { token_version?: number } | undefined;
    return row?.token_version ?? 0;
  });
  cache.set(authId, next);
  return next;
}
