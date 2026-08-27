/**
 * Vé cổng **mang theo danh tính** — chỗ hai tài khoản đang dùng chung dữ liệu.
 *
 * ── Triệu chứng, đo được ───────────────────────────────────────────────────────────────────────
 *
 * Máy 3 đăng ký tài khoản mới (`ngoclongdz96@…`), đăng nhập thành công, và nhìn thấy **nguyên bộ
 * bot của máy 2** (`auth0|grokbot2-user`). Nhưng phân tách theo chủ sở hữu KHÔNG hỏng: gọi thẳng
 * `/gw/api/listAgents` kèm JWT của một người mới trả về đúng **0 bot**. Hai điều đó chỉ cùng đúng
 * khi app không gửi JWT.
 *
 * `/gw/__coverage` nói ra:
 *
 *     verdicts: { "matching-bearer": 429, "user-jwt": 3, "no-header": 6 }
 *
 * 429 lượt mang **vé cổng**, 3 lượt mang JWT (là mấy lệnh thử của tôi). App xác thực mọi lời gọi
 * `/gw` bằng vé cổng chứ không bằng token người dùng — và `ownerFromAuth` chỉ đọc được JWT:
 *
 *     verifyJwt(authHeader)?.authId ?? DEFAULT_USER.authId
 *
 * Vé không phải JWT ⇒ rơi về danh tính mặc định ⇒ **mọi máy desktop là cùng một người**.
 *
 * ── Vì sao không sửa bằng cách bắt app gửi JWT ─────────────────────────────────────────────────
 *
 * Vì ta không viết app. Nó gửi cái gì là hợp đồng của nó. Nhưng cái nó gửi lại là **thứ ta đã đưa
 * cho nó**: `EnsureSandBox` đóng dấu vé vào trường 11 của bản mô tả box, và app chỉ dội lại. Nên
 * chỗ đúng để sửa là lúc PHÁT vé: mỗi người một vé, và vé tự nói mình của ai.
 *
 * ── Hình dạng ──────────────────────────────────────────────────────────────────────────────────
 *
 *     gwu.<base64url(authId)>.<base64url(HMAC-SHA256(bí mật, authId))[0..32]>
 *
 * Bí mật là chính vé dùng chung đã có (`GROKBOT2_GATEWAY_TOKEN`): ngẫu nhiên theo từng bản cài,
 * đã nằm trong `.data/` và đã được giữ kín. Thêm một bí mật thứ hai là thêm một thứ để rò và một
 * thứ để quên xoay.
 *
 * `authId` đi CÔNG KHAI trong vé, không mã hoá — nó không phải bí mật (email của chính người dùng
 * đã nằm trong JWT họ cầm). Chữ ký mới là thứ ngăn người khác tự bịa ra một vé của người khác.
 *
 * Vé cũ vẫn được chấp nhận, và vẫn ra danh tính mặc định. Không phải vì lười: app **giữ cache bản
 * mô tả box**, nên một máy đang chạy còn cầm vé cũ cho tới lần khởi động sau. Từ chối nó là làm
 * chết app đang chạy để đổi lấy một thứ mà chỉ cần khởi động lại là có.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "gwu.";
/** Đủ dài để không dò ra, đủ ngắn để vé không thành một dòng dài lê thê trong log. */
const SIG_LEN = 32;

const b64u = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64u = (s: string): string => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
};

/**
 * Bí mật ký vé. Đọc thẳng `process.env` chứ không nhập từ `auth-gate.ts`.
 *
 * `auth-gate` sẽ nhập ngược lại module này để nhận ra vé, nên nhập hai chiều là một vòng tròn —
 * và vòng tròn ESM không nổ ngay, nó chỉ làm một trong hai biến thành `undefined` vào một thời
 * điểm khó đoán. Cùng một giá trị, không phải nguồn sự thật thứ hai: `ensureGatewayToken()` ghi
 * biến này trước khi bất cứ ai xin vé.
 */
const secret = (): string => process.env.GROKBOT2_GATEWAY_TOKEN ?? "";

const sign = (authId: string): string =>
  b64u(createHmac("sha256", secret()).update(`gw:${authId}`).digest()).slice(0, SIG_LEN);

/**
 * Vé của một người. Trả về vé dùng chung khi chưa có bí mật (không nên xảy ra, nhưng một vé
 * không ký được thì thà là vé cũ còn hơn một chuỗi vô nghĩa mà app đem đi dùng thật).
 */
export function mintTicket(authId: string): string {
  if (!authId || !secret()) return secret();
  return `${PREFIX}${b64u(Buffer.from(authId, "utf8"))}.${sign(authId)}`;
}

/**
 * Chủ nhân của một vé, hoặc `null` nếu đây không phải vé của ta.
 *
 * So chữ ký bằng `timingSafeEqual`. Ở đây chênh lệch thời gian gần như không khai thác được qua
 * mạng, nhưng "gần như" không phải là lý do để viết một phép so sánh sai kiểu.
 */
export function ownerOfTicket(presented: string): string | null {
  if (!presented.startsWith(PREFIX) || !secret()) return null;
  const phan = presented.slice(PREFIX.length).split(".");
  if (phan.length !== 2) return null;
  let authId: string;
  try { authId = unb64u(phan[0]); } catch { return null; }
  if (!authId) return null;
  const mong = Buffer.from(sign(authId), "utf8");
  const thay = Buffer.from(phan[1], "utf8");
  if (mong.length !== thay.length) return null;
  return timingSafeEqual(mong, thay) ? authId : null;
}

/** Có phải hình dạng vé-theo-người không (kể cả khi chữ ký sai) — để log phân biệt được hai ca. */
export const looksLikeUserTicket = (presented: string): boolean => presented.startsWith(PREFIX);
