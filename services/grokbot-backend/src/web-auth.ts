/**
 * Web login for grokbot-web (multi-tenant Phase 4).
 *
 * Real credentials, unlike the desktop's tokenless handshake: an email + a scrypt-hashed password in
 * the `users` table, exchanged for a SIGNED JWT (auth.ts mintJwt) the browser then sends as Bearer on
 * /v1. The backend derives the owner from that JWT via `ownerFromAuth` (verified), so each account
 * gets its own space (Phase 1–3 do the scoping).
 *
 * scrypt + a per-user random salt, `timingSafeEqual` on compare — all node:crypto, no dependency.
 * Nothing here logs the password or the hash.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { withDb } from "./store.js";
import { mintJwt, WEB_TOKEN_DAYS } from "./auth.js";
import { tokenVersionOf } from "./token-version.js";

const N = 16384, r = 8, p = 1, KEYLEN = 32;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltHex, dkHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(dkHex, "hex");
  let dk: Buffer;
  try { dk = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) }); }
  catch { return false; }
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

const normalizeEmail = (e: string): string => e.trim().toLowerCase();
/** Deterministic per-account id, distinct from the desktop's `auth0|grokbot2-user`. */
const authIdFor = (email: string): string => `local|${normalizeEmail(email)}`;

export interface AuthResult { ok: boolean; token?: string; email?: string; error?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Đăng ký có mở không.
 *
 * **Sổ trống thì mở** — phải có đường cho người đầu tiên vào, nếu không backend vừa dựng lên là
 * không ai đăng nhập được. **Có người rồi thì đóng**, trừ khi bật `GROKBOT2_ALLOW_REGISTER=1`.
 *
 * Trước chặng này route mở cho bất kỳ ai gọi được cổng. Hôm nay vô hại vì cả bốn cổng chỉ nghe
 * `127.0.0.1`, nhưng ngày đưa lên VPS thì đó là "ai cũng tự tạo tài khoản trên backend của bạn".
 */
function registrationOpen(): boolean {
  if ((process.env.GROKBOT2_ALLOW_REGISTER ?? "").trim() === "1") return true;
  return withDb((db) => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL").get() as { n: number };
    return row.n === 0;
  });
}

export function registerUser(emailRaw: string, password: string): AuthResult {
  const email = normalizeEmail(emailRaw ?? "");
  if (!registrationOpen()) return { ok: false, error: "registration is closed" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid email" };
  if (typeof password !== "string" || password.length < 8) return { ok: false, error: "password must be at least 8 characters" };
  return withDb((db) => {
    const taken = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
    if (taken) return { ok: false, error: "email already registered" };
    const authId = authIdFor(email);
    db.prepare(
      "INSERT INTO users (auth_id, email, plan, plan_expires_ms, created_at_ms, password_hash) VALUES (?, ?, 'free', NULL, ?, ?)",
    ).run(authId, email, Date.now(), hashPassword(password));
    return { ok: true, token: mintJwt({ authId, email }, { days: WEB_TOKEN_DAYS, tokenVersion: 0 }), email };
  });
}

export function loginUser(emailRaw: string, password: string): AuthResult {
  const email = normalizeEmail(emailRaw ?? "");
  return withDb((db) => {
    const row = db.prepare("SELECT auth_id, email, password_hash FROM users WHERE email = ?")
      .get(email) as { auth_id: string; email: string; password_hash: string | null } | undefined;
    // Same generic message whether the account is missing or the password is wrong — never reveal
    // which, and never short-circuit before a hash so timing does not leak account existence.
    const ok = !!row?.password_hash && verifyPassword(password ?? "", row.password_hash);
    if (!ok || !row) return { ok: false, error: "invalid email or password" };
    const user = { authId: row.auth_id, email: row.email };
    return {
      ok: true,
      token: mintJwt(user, { days: WEB_TOKEN_DAYS, tokenVersion: tokenVersionOf(row.auth_id) }),
      email: row.email,
    };
  });
}
