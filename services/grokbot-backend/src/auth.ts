import type { ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { tokenVersionOf } from "./token-version.js";
import { ownerOfTicket } from "./gateway-ticket.js";
import { authMode } from "./auth-mode.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function b64url(b: string | Buffer): string {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * HMAC secret for signing user JWTs (multi-tenant Phase 4).
 *
 * Persisted per install (like the gateway token) so tokens survive a restart, and read from
 * `GROKBOT2_JWT_SECRET` first so a real deployment can inject one. Until Phase 4 the JWT signature
 * was a constant and never checked — fine for the single-user desktop on loopback, a forgery hole
 * the moment two tenants share a backend. Now `verifyJwt` rejects any token not signed with this.
 */
const SECRET_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const SECRET_FILE = join(SECRET_DIR, "jwt-secret.txt");
let cachedSecret = "";
function jwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env.GROKBOT2_JWT_SECRET?.trim();
  if (env) return (cachedSecret = env);
  try {
    const saved = readFileSync(SECRET_FILE, "utf8").trim();
    if (saved.length >= 32) return (cachedSecret = saved);
  } catch { /* first run */ }
  const minted = randomBytes(32).toString("hex");
  try {
    mkdirSync(SECRET_DIR, { recursive: true });
    writeFileSync(SECRET_FILE, minted, { mode: 0o600 });
  } catch (e) {
    console.warn("[auth] could not persist jwt secret (tokens will not survive restart):", (e as Error).message);
  }
  return (cachedSecret = minted);
}

const sign = (headerB64: string, payloadB64: string): string =>
  b64url(createHmac("sha256", jwtSecret()).update(`${headerB64}.${payloadB64}`).digest());

/**
 * Mint a structurally-valid (unsigned) JWT. The Grok Bot client decodes the
 * payload for exp/email/sub but does NOT verify the signature locally — so a
 * self-minted token is accepted. (Verified empirically during the spike.)
 */
export interface TokenUser {
  authId: string;
  email: string;
}

/** The single identity the backend hands out until multi-user login is wired (see billing.ts). */
export const DEFAULT_USER: TokenUser = { authId: "auth0|grokbot2-user", email: "user@localhost" };

/**
 * Hạn dùng mặc định — DÀI, và cố ý.
 *
 * Token này cũng là thứ `/oauth/token` trả cho app desktop, mà app thì không biết tự làm mới: hết
 * hạn là app chết mà người dùng không có nút nào bấm. Đường web ngắn hơn nhiều (`WEB_TOKEN_DAYS`),
 * vì ở đó có màn hình đăng nhập để lấy token mới.
 */
const DESKTOP_TOKEN_DAYS = 365;

/** Đường web: 30 ngày. Mất token thì thiệt hại dừng ở 30 ngày, không phải một năm. */
export const WEB_TOKEN_DAYS = 30;

export interface MintOptions {
  /** Số ngày sống. Mặc định là hạn dài của đường desktop. */
  days?: number;
  /** Số đời — có nó thì đăng xuất thu hồi được. Đường desktop không có, xem token-version.ts. */
  tokenVersion?: number;
}

export function mintJwt(user: TokenUser = DEFAULT_USER, opts: MintOptions = {}): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: user.authId, email: user.email, iat: now,
      exp: now + (opts.days ?? DESKTOP_TOKEN_DAYS) * 86400,
      ...(opts.tokenVersion !== undefined ? { tv: opts.tokenVersion } : {}),
    }),
  );
  // Now a REAL HMAC signature (Phase 4). The desktop app only decodes the payload, so signing does
  // not affect it; `verifyJwt` on the backend is what the signature is for.
  return `${header}.${payload}.${sign(header, payload)}`;
}

/**
 * Verify a Bearer JWT's signature and expiry, returning the trusted user or null.
 *
 * This is the ONLY source of identity for a shared backend, and it must stay the only one. A second
 * one existed until 27/08 — `userFromToken`, which merely base64-decoded the payload and therefore
 * believed whatever `sub` the caller wrote. It was removed after a forged row turned up in the live
 * users table on the VPS.
 *
 * Owner derivation (index.ts) uses `ownerFromAuth`, built on this. A non-JWT bearer (the /gw gateway
 * ticket) fails here and falls back to the default identity.
 */
export function verifyJwt(authHeader?: string | string[]): TokenUser | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const jwt = raw?.replace(/^Bearer\s+/i, "").trim();
  const parts = jwt?.split(".");
  if (!parts || parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = sign(h, p);
  const got = Buffer.from(s), exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
  try {
    const { sub, email, exp: expSec, purpose, tv } = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as {
      sub?: string; email?: string; exp?: number; purpose?: string; tv?: number;
    };
    if (!sub) return null;
    if (typeof expSec === "number" && expSec * 1000 < Date.now()) return null;
    /*
     * `purpose` — bịt một lỗ chỉ xuất hiện khi dùng chung secret với cinAPI (docs/plan/cinapi-merge.md P1).
     *
     * cinAPI phát NĂM loại token cùng thuật toán, cùng secret, cùng `sub`: `access`, `email_verify`,
     * `password_reset`, `2fa_pending`, `step_up`. Bản trước chỉ kiểm chữ ký + `exp`, nên một token
     * "đặt lại mật khẩu" hoặc "2FA chưa xong" cũng mở được toàn bộ agent — leo thang im lặng, không
     * lỗi ở đâu cả. Có `purpose` thì bắt buộc phải là `access`.
     *
     * KHÔNG có `purpose` vẫn hợp lệ: đó là token grokbot2 tự mint (`mintJwt`, desktop, e2e) — giữ
     * tương thích ngược thay vì bắt mọi đường cũ phải khai thêm một trường chúng chưa từng có.
     */
    if (typeof purpose === "string" && purpose !== "access") return null;
    /*
     * Số đời — đây là chỗ `/v1/logout` thật sự cắt được token đã phát.
     *
     * KHÔNG có `tv` thì bỏ qua, cùng lối tương thích ngược với `purpose` ở trên. Nhánh đó nay chỉ
     * còn để đỡ token cũ đã phát ra ngoài: **mọi token ta phát hôm nay đều mang `tv`**, kể cả
     * token desktop — `tokenPayload()` gọi `mintJwt(user, { days, tokenVersion: … })`. Đo bằng
     * cách lấy token thật từ `/auth/poll` rồi giải mã (27/08):
     *
     *     {"sub":"auth0|grokbot2-user","email":"user@localhost","iat":…,"exp":…,"tv":0}   365 ngày
     *
     * Chú thích cũ ở đây nói ngược — rằng token desktop "chưa từng mang trường này" — và bảng theo
     * dõi chép lại điều đó. Hệ quả THẬT thì ngược hẳn: một cú `/v1/logout` trên web nâng số đời của
     * chính danh tính ấy, nên nó **cắt luôn token của app desktop** cùng tài khoản. Đó là hành vi
     * đúng của "đăng xuất", nhưng đừng ai đọc chú thích cũ rồi tưởng app không bị đụng tới.
     */
    if (typeof tv === "number" && tv !== tokenVersionOf(sub)) return null;
    return { authId: sub, email: email ?? "" };
  } catch {
    return null;
  }
}

/** Tên cookie access-token của cinAPI (`internal/middleware/auth.go`: `CookieAccess`). */
const CINAPI_COOKIE = "cinapi_at";

/**
 * Token trong cookie — FE của cinAPI gửi danh tính bằng cookie httpOnly `cinapi_at`, KHÔNG phải
 * header `Authorization` (ADR-005 của họ: không để JWT trong localStorage). grokbot2 trước đây chỉ
 * đọc header, nên một phiên cinAPI hợp lệ vẫn bị coi là vô danh.
 */
function tokenFromCookie(cookieHeader?: string | string[]): string | undefined {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CINAPI_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    return v || undefined;
  }
  return undefined;
}

/**
 * Danh tính của một request, xét CẢ header và cookie — điểm vào duy nhất cho `/v1`.
 *
 * Thứ tự có chủ ý: `Authorization` trước, vì một caller gắn header là đang nói rõ mình là ai (e2e,
 * SDK, desktop), và nó phải thắng cookie của phiên trình duyệt đang mở cùng máy.
 */
export function ownerFromRequest(headers: { authorization?: string | string[]; cookie?: string | string[] }): string {
  const byHeader = verifyJwt(headers.authorization);
  if (byHeader) return byHeader.authId;
  return cinapiCookieUser(headers)?.authId ?? DEFAULT_USER.authId;
}

/**
 * Người dùng suy ra từ cookie `cinapi_at` — dùng ở CẢ hai lớp: cổng vào (`auth-gate.checkAuth`) và
 * suy ra owner (`ownerFromRequest`). Một hàm cho cả hai, để luật `purpose` không thể đúng ở lớp này
 * mà hở ở lớp kia.
 *
 * Nhận `Record<string, unknown>` vì `checkAuth` nhận headers ở dạng đó; đọc mềm thay vì ép kiểu.
 */
export function cinapiCookieUser(headers: Record<string, unknown> | { cookie?: string | string[] }): TokenUser | null {
  const bag = headers as Record<string, unknown>;
  const rawCookie = bag["cookie"] ?? bag["Cookie"];
  const token = tokenFromCookie(
    Array.isArray(rawCookie) ? rawCookie.map(String) : rawCookie == null ? undefined : String(rawCookie),
  );
  return token ? verifyJwt(token) : null;
}

/** The trusted owner for a request, from a verified JWT — or the default identity when absent/invalid
 *  (the /gw gateway ticket, or the single-user desktop). One place decides the identity trust. */
export function ownerFromAuth(authHeader?: string | string[]): string {
  const jwt = verifyJwt(authHeader);
  if (jwt) return jwt.authId;
  /*
   * Vé cổng cũng là một danh tính — và trên thực tế nó là danh tính DUY NHẤT mà app desktop gửi.
   *
   * Đo trên VPS 27/08: `/gw/__coverage` đếm 429 lượt `matching-bearer` và 3 lượt `user-jwt`. Ba
   * lượt kia là lệnh thử của tôi; app không gửi JWT bao giờ. Nên dòng cũ — chỉ đọc JWT rồi rơi về
   * danh tính mặc định — biến mọi máy desktop thành cùng một người, và tài khoản mới trên máy 3
   * mở ra thấy nguyên bộ bot của máy 2.
   */
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const presented = String(raw ?? "").replace(/^Bearer\s+/i, "").trim();
  return ownerOfTicket(presented) ?? DEFAULT_USER.authId;
}


/** Gói token đúng hình dạng app đọc — cả hai lối viết tên, vì client đọc cả hai. */
export function tokenPayload(user: TokenUser, days = DESKTOP_TOKEN_DAYS): string {
  const jwt = mintJwt(user, { days, tokenVersion: tokenVersionOf(user.authId) });
  return JSON.stringify({
    access_token: jwt,
    refresh_token: jwt,
    id_token: jwt,
    token_type: "Bearer",
    expires_in: days * 86400,
    accessToken: jwt,
    refreshToken: jwt,
    authId: user.authId,
  });
}

/**
 * `/oauth/token`, `/auth/*` — **cửa cấp token**, và cho tới hôm nay nó không hỏi gì cả.
 *
 * Bản trước gọi `mintJwt()` rồi trả về, không cần thân request, không cần thông tin đăng nhập, không
 * cần gì. Đo thật ngày 25/08 từ một máy khác trong LAN: `POST /oauth/token` với thân **rỗng** trả về
 * token 199 ký tự, và token đó `GET /v1/agents` được — đọc ra tên các bot. Đây là thứ khiến backend
 * không được rời `127.0.0.1`, tức là thứ đang chặn chặng 4.
 *
 * Client dùng đường này cho **một** việc, và bản dựng của nó nói rõ (`runRefreshAccessToken`):
 *
 *   POST /oauth/token  {client_id, grant_type:"refresh_token", refresh_token:<token cũ>}
 *
 * Nên câu hỏi đúng để hỏi là: *token cũ đó có phải do ta phát không.* `verifyJwt` trả lời được —
 * nó kiểm chữ ký thật và cả số đời, nên token đã bị đăng xuất cũng không làm mới được nữa. Ai không
 * có token thì không có gì để làm mới, và câu trả lời đúng là 401 chứ không phải một token mới.
 *
 * Lần đăng nhập ĐẦU không đi qua đây — nó đi `/auth/poll`, xem `device-login.ts`.
 *
 * Vẫn giữ ba mức của `GROKBOT2_AUTH` như phần còn lại của cổng: `off`/`warn` vẫn cấp như cũ để máy
 * đang chạy không chết giữa chừng, `enforce` mới từ chối. Cùng một khớp nối, cùng một lý do: chỗ
 * siết phải bật được sau khi đã đo, chứ không phải bật mù.
 */
export function handleAuth(res: ServerResponse, body?: Buffer | string): void {
  const mode = authMode();
  const asked = parseGrant(body);
  const user = asked.refreshToken ? verifyJwt(asked.refreshToken) : null;

  if (!user) {
    if (mode === "enforce") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "refresh token missing or not issued here" }));
      return;
    }
    if (mode === "warn") {
      console.warn(`[auth] /oauth/token cấp KHÔNG kiểm — ${asked.refreshToken ? "token không hợp lệ" : "không có refresh_token"}; enforce sẽ trả 401`);
    }
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(tokenPayload(user ?? DEFAULT_USER));
}

/** Đọc `refresh_token` từ thân, chấp cả JSON lẫn form — hai lối một cửa OAuth có thể nhận. */
function parseGrant(body?: Buffer | string): { refreshToken: string | null } {
  const text = (typeof body === "string" ? body : body?.toString("utf8") ?? "").trim();
  if (!text) return { refreshToken: null };
  try {
    const j = JSON.parse(text) as { refresh_token?: unknown; refreshToken?: unknown };
    const t = j.refresh_token ?? j.refreshToken;
    if (typeof t === "string" && t) return { refreshToken: t };
  } catch { /* không phải JSON — thử dạng form bên dưới */ }
  const t = new URLSearchParams(text).get("refresh_token");
  return { refreshToken: t || null };
}
