/**
 * Chặn đoán mật khẩu.
 *
 * Trước chặng này không có gì cản: gọi `/v1/login` bao nhiêu lần cũng được, mà `scrypt` tuy chậm
 * nhưng chậm cho **một** lần thử — kẻ đoán thì gửi song song. Một mật khẩu 8 ký tự yếu sẽ đổ.
 *
 * Đếm theo **email + địa chỉ gọi**, không phải chỉ một trong hai:
 *   - chỉ theo email → một máy quét được cả nghìn tài khoản, mỗi tài khoản vài lần, không ai chặn;
 *   - chỉ theo địa chỉ → nhiều người sau cùng một NAT khoá lẫn nhau.
 *
 * Trong bộ nhớ, không vào sổ. Khởi động lại là quên — chấp nhận được: kẻ tấn công không bấm được
 * nút khởi động lại backend của bạn, còn ghi vào sổ thì mỗi lần đoán sai là một lần ghi đĩa, đúng
 * thứ mà kẻ tấn công muốn.
 */

/** Sai quá số này trong một cửa sổ thì khoá. Năm lần đủ rộng cho người gõ nhầm. */
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;

interface Bucket { fails: number; firstFailAt: number }
const buckets = new Map<string, Bucket>();

const keyOf = (email: string, ip: string): string => `${email.trim().toLowerCase()}::${ip}`;

/** Dọn những ô đã hết hạn — gọi kèm mỗi lần đọc, rẻ hơn một đồng hồ chạy nền. */
function fresh(b: Bucket | undefined, now: number): Bucket | undefined {
  if (!b) return undefined;
  return now - b.firstFailAt > WINDOW_MS ? undefined : b;
}

/**
 * Còn được thử không. `retryAfterSec` là số giây phải chờ, để trả trong header `Retry-After`.
 */
export function loginAllowed(email: string, ip: string, now = Date.now()):
  { ok: true } | { ok: false; retryAfterSec: number } {
  const b = fresh(buckets.get(keyOf(email, ip)), now);
  if (!b || b.fails < MAX_FAILS) return { ok: true };
  return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - b.firstFailAt)) / 1000) };
}

/** Ghi một lần đoán sai. */
export function noteLoginFailure(email: string, ip: string, now = Date.now()): void {
  const key = keyOf(email, ip);
  const b = fresh(buckets.get(key), now);
  if (!b) buckets.set(key, { fails: 1, firstFailAt: now });
  else b.fails += 1;
}

/**
 * Đăng nhập được thì xoá sổ đoán sai.
 *
 * Nếu không xoá, người gõ nhầm bốn lần rồi vào đúng vẫn mang theo bốn vết, và lần sau gõ nhầm một
 * cái là bị khoá — phạt người dùng thật vì một chuyện đã qua.
 */
export function noteLoginSuccess(email: string, ip: string): void {
  buckets.delete(keyOf(email, ip));
}

/** Chỉ dùng cho bài kiểm. */
export function _resetThrottle(): void {
  buckets.clear();
}
