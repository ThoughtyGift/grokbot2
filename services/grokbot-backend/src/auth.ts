import type { ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

export function mintJwt(user: TokenUser = DEFAULT_USER): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: user.authId, email: user.email, iat: now, exp: now + 365 * 86400 }),
  );
  // Now a REAL HMAC signature (Phase 4). The desktop app only decodes the payload, so signing does
  // not affect it; `verifyJwt` on the backend is what the signature is for.
  return `${header}.${payload}.${sign(header, payload)}`;
}

/**
 * Verify a Bearer JWT's signature and expiry, returning the trusted user or null.
 *
 * This is the ONLY safe source of identity for a shared backend: `userFromToken` merely decodes and
 * would trust a forged `sub`. Owner derivation (index.ts) uses `ownerFromAuth`, which is built on
 * this. A non-JWT bearer (the /gw gateway ticket) fails here and falls back to the default identity.
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
    const { sub, email, exp: expSec, purpose } = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as {
      sub?: string; email?: string; exp?: number; purpose?: string;
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
  return verifyJwt(authHeader)?.authId ?? DEFAULT_USER.authId;
}

/**
 * Who a request belongs to, from its `Authorization: Bearer <jwt>` header.
 *
 * The payload is READ, not verified — this backend minted the token and the client never checks the
 * signature either (see mintJwt), so decoding `sub`/`email` is all the identity there is. Returns
 * null on anything malformed so a caller can fall back to DEFAULT_USER rather than throw.
 */
export function userFromToken(authHeader?: string | string[]): TokenUser | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const jwt = raw?.replace(/^Bearer\s+/i, "").trim();
  const part = jwt?.split(".")[1];
  if (!part) return null;
  try {
    const { sub, email } = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
    };
    return sub ? { authId: sub, email: email ?? "" } : null;
  } catch {
    return null;
  }
}

/** Handle /oauth/token, /auth/* — always hand back a fresh token so login completes. */
export function handleAuth(res: ServerResponse): void {
  const jwt = mintJwt();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      access_token: jwt,
      refresh_token: jwt,
      id_token: jwt,
      token_type: "Bearer",
      expires_in: 365 * 86400,
      accessToken: jwt,
      refreshToken: jwt,
      authId: "auth0|grokbot2-user",
    }),
  );
}
