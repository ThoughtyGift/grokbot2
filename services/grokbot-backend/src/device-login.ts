/**
 * Đăng nhập thiết bị — mắt xích còn thiếu giữa app desktop và tài khoản thật.
 *
 * Vì sao phải có: `/oauth/token` và `/auth/poll` **phát token cho bất kỳ ai gọi**, không hỏi gì.
 * Đo ngày 25/08 từ một máy khác trong LAN: một `POST /oauth/token` rỗng trả về token 199 ký tự, và
 * token đó đọc được `/v1/agents` — thấy đủ tên bot. Chừng nào còn thế thì backend **không được ra
 * mạng**, nên đây là thứ chặn chặng 4.
 *
 * Hợp đồng lấy từ chính bản dựng của client (`dist/electron-main/main.cjs`, hàm `GCi`) chứ không
 * đoán:
 *
 *   r = randomBytes(32)
 *   verifier  = base64url(r)
 *   challenge = base64url(sha256(verifier))        ← băm CHUỖI verifier, không phải byte gốc
 *   uuid      = randomUUID()
 *   mở trình duyệt: {website}/loginDeepControl?challenge=…&uuid=…&mode=login&redirectTarget=sand
 *   rồi hỏi vòng:  GET {backend}/auth/poll?uuid=…&verifier=…
 *
 * Đây là PKCE S256. Giá trị của nó ở đây: `uuid` đi qua **trình duyệt** (thấy được trên thanh địa
 * chỉ, trong lịch sử, trong log proxy), còn `verifier` thì **không rời khỏi app**. Nên ai nhặt được
 * uuid vẫn không lấy được token — muốn nhận token phải chứng minh mình giữ verifier khớp challenge.
 * Đó chính là lý do phải kiểm cặp này thay vì chỉ tra uuid.
 *
 * Giữ trong bộ nhớ, không xuống đĩa: một phiên đăng nhập sống vài phút, và khởi động lại backend thì
 * bắt đầu lại là đúng chứ không phải mất mát.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { TokenUser } from "./auth.js";

/** Một phiên chỉ sống 10 phút — đủ để người ta gõ mật khẩu, không đủ để bỏ quên qua đêm. */
const TTL_MS = 10 * 60 * 1000;

/** Chặn trên số phiên chờ, để một kẻ gọi `/loginDeepControl` liên tục không ăn hết bộ nhớ. */
const MAX_PENDING = 200;

type Pending = {
  challenge: string;
  createdAt: number;
  /** Có người đã đăng nhập thật và duyệt phiên này chưa — `null` là còn chờ. */
  user: TokenUser | null;
};

const pending = new Map<string, Pending>();

/** base64url(sha256(verifier)) — đúng phép biến đổi client dùng để sinh challenge. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sweep(now: number): void {
  for (const [uuid, p] of pending) if (now - p.createdAt > TTL_MS) pending.delete(uuid);
}

/**
 * Trình duyệt vừa mở `/loginDeepControl` — ghi nhận cặp uuid/challenge của phiên này.
 *
 * Đây là lần đầu backend nhìn thấy cặp đó: app sinh nó rồi đưa thẳng cho trình duyệt qua URL, không
 * báo backend. Nên hàm này không "cấp" gì cả, chỉ mở một ô trống chờ người duyệt.
 */
export function noteLoginOpened(uuid: string, challenge: string): void {
  const now = Date.now();
  sweep(now);
  if (!uuid || !challenge) return;
  if (pending.has(uuid)) return;                  // mở lại cùng một trang thì không tạo ô mới
  if (pending.size >= MAX_PENDING) return;
  pending.set(uuid, { challenge, createdAt: now, user: null });
}

/**
 * Người đã đăng nhập thật trong trình duyệt và bấm duyệt.
 *
 * Trả `false` khi không có phiên nào đang chờ với uuid đó — hết hạn, sai uuid, hoặc trang được mở
 * thẳng mà không qua `/loginDeepControl`. Không tự tạo phiên ở đây: làm thế là dựng lại đúng cái lỗ
 * vừa bịt, chỉ đổi tên đường.
 */
export function approveLogin(uuid: string, user: TokenUser): boolean {
  const now = Date.now();
  sweep(now);
  const p = pending.get(uuid);
  if (!p) return false;
  p.user = user;
  return true;
}

export type ClaimResult =
  | { state: "ready"; user: TokenUser }
  | { state: "pending" }
  | { state: "unknown" };

/**
 * App hỏi vòng: phiên này xong chưa, và tôi có đúng là người mở nó không?
 *
 * Xong thì trả người dùng **đúng một lần** rồi xoá phiên. Một mã đăng nhập dùng lại được là một mã
 * đăng nhập bị chép lại được — và ô này sống trong bộ nhớ nên xoá là xoá thật.
 *
 * `unknown` cho cả ba trường hợp: sai uuid, hết hạn, và **verifier không khớp**. Gộp làm một là cố
 * ý: tách ra thì người dò biết uuid nào có thật để dò tiếp verifier.
 */
export function claimLogin(uuid: string, verifier: string): ClaimResult {
  const now = Date.now();
  sweep(now);
  const p = pending.get(uuid);
  if (!p) return { state: "unknown" };

  const want = Buffer.from(p.challenge);
  const got = Buffer.from(challengeFor(verifier ?? ""));
  // So sánh theo thời gian hằng: hai chuỗi cùng độ dài mới so được, khác độ dài thì đã sai rồi.
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { state: "unknown" };

  if (!p.user) return { state: "pending" };
  pending.delete(uuid);
  return { state: "ready", user: p.user };
}

/** Cho bài kiểm: xoá sạch giữa hai bài. */
export function resetDeviceLogins(): void {
  pending.clear();
}
