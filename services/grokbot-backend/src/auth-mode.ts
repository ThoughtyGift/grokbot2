/**
 * Ba mức siết đăng nhập — để riêng một chỗ vì **hai bên đều cần mà không được nhập lẫn nhau**.
 *
 * `auth-gate.ts` nhập `auth.ts` (nó cần `verifyJwt`). Khi `auth.ts` cũng phải biết mức siết — để
 * `/oauth/token` từ chối đúng lúc — thì nhập ngược lại là một vòng tròn. Chép lại phép đọc biến môi
 * trường ở hai nơi thì rẻ hơn một dòng nhưng đắt về sau: hai nơi lệch nhau là cổng siết một nửa,
 * mà nửa nào siết thì không đọc code không biết.
 *
 *   off      (mặc định) không kiểm, không ghi
 *   warn     kiểm, ghi phán quyết, vẫn cho qua
 *   enforce  kiểm và trả 401
 *
 * Đọc mỗi lần gọi, không nhớ: sửa `.env` rồi để tsx nạp lại là đổi được mức, không phải khởi động.
 */
export type AuthMode = "off" | "warn" | "enforce";

export const authMode = (): AuthMode => {
  const raw = (process.env.GROKBOT2_AUTH ?? "off").trim().toLowerCase();
  return raw === "warn" || raw === "enforce" ? raw : "off";
};
