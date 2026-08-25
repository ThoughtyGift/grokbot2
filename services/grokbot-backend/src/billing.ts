/**
 * Billing state — users, per-day usage, and plan definitions.
 *
 * ĐÃ NỐI (25/08/2026) — chú thích cũ ở đây nói "INERT until wired" và điều đó thôi đúng từ lâu:
 * `index.ts` truyền `access: accessVerdict(rpcUser)` và `usage: currentPeriodUsage(rpcUser)` vào
 * ctx, `bootstrap.ts` trả `payment_required` theo `ctx.access`, và `turn.ts` chặn lượt khi
 * `billingMode() === "enforce"`. Một chú thích nói tính năng chưa tồn tại trong khi nó đang chạy
 * còn nguy hiểm hơn không có chú thích: người đọc tin nó và bỏ qua cả đường tiền.
 *
 * Thứ CHƯA nối là lối thoát: `plans.checkout_url` đã có chỗ trong bảng nhưng chưa gắn vào phán
 * quyết, nên người bị chặn thấy màn hình chặn mà không có nút trả tiền. Xem
 * docs/plan/ship-to-users.md chặng D.
 *
 * Rollout mirrors auth-gate.ts: `GROKBOT2_BILLING` = off | warn | enforce. `off` (default) never
 * calls in here at all; `warn` records usage and logs the verdict but still grants; `enforce` lets
 * the gate answer PAYMENT_REQUIRED. The warn pass answers "does the app send our token, and is
 * usage counted right?" with a measurement before enforce depends on it.
 *
 * Shares store.ts's single writer via `withDb` — a second DatabaseSync on the same WAL file would
 * race the BFF's writes (SQLITE_BUSY). See store.ts getDb().
 */
import { withDb } from "./store.js";

export type BillingMode = "off" | "warn" | "enforce";

/**
 * Read per call so `.env` can flip it with a tsx reload — same shape as auth-gate.ts.
 *   off      (default) never meter, never gate
 *   warn     meter usage + log, but still grant
 *   enforce  meter usage AND let the access gate answer PAYMENT_REQUIRED
 */
export function billingMode(): BillingMode {
  const raw = (process.env.GROKBOT2_BILLING ?? "off").trim().toLowerCase();
  return raw === "warn" || raw === "enforce" ? raw : "off";
}

export interface UserRow {
  authId: string;
  email: string;
  plan: string;
  /** null = no expiry (unlimited / free). */
  planExpiresMs: number | null;
}

export interface PlanRow {
  name: string;
  /** null = uncapped. */
  monthlyTokenCap: number | null;
  /** Where the app's "upgrade" button should send the user — YOUR checkout page. */
  checkoutUrl: string | null;
}

/**
 * Seed defaults once per process. `INSERT OR IGNORE` so an operator who has edited the `plans` row
 * in the DB is never overwritten — these are only the first-boot values.
 */
const DEFAULT_PLANS: PlanRow[] = [
  { name: "free", monthlyTokenCap: 100_000, checkoutUrl: null },
  { name: "pro", monthlyTokenCap: null, checkoutUrl: process.env.GROKBOT2_CHECKOUT_URL ?? null },
];

let seeded = false;
function seedPlans(): void {
  if (seeded) return;
  withDb((db) => {
    const ins = db.prepare(
      "INSERT OR IGNORE INTO plans (name, monthly_token_cap, checkout_url) VALUES (?, ?, ?)",
    );
    for (const p of DEFAULT_PLANS) ins.run(p.name, p.monthlyTokenCap, p.checkoutUrl);
  });
  seeded = true;
}

/** The signed-in user's row, creating a free-plan row the first time we see this auth id. */
export function ensureUser(authId: string, email: string): UserRow | null {
  if (!authId) return null;
  seedPlans();
  return withDb((db) => {
    db.prepare(
      "INSERT OR IGNORE INTO users (auth_id, email, plan, plan_expires_ms, created_at_ms) VALUES (?, ?, 'free', NULL, ?)",
    ).run(authId, email, Date.now());
    const r = db
      .prepare("SELECT auth_id, email, plan, plan_expires_ms FROM users WHERE auth_id = ?")
      .get(authId) as { auth_id: string; email: string; plan: string; plan_expires_ms: number | null };
    return { authId: r.auth_id, email: r.email, plan: r.plan, planExpiresMs: r.plan_expires_ms ?? null };
  });
}

export function getUser(authId: string): UserRow | null {
  if (!authId) return null;
  return withDb((db) => {
    const r = db
      .prepare("SELECT auth_id, email, plan, plan_expires_ms FROM users WHERE auth_id = ?")
      .get(authId) as { auth_id: string; email: string; plan: string; plan_expires_ms: number | null } | undefined;
    return r ? { authId: r.auth_id, email: r.email, plan: r.plan, planExpiresMs: r.plan_expires_ms ?? null } : null;
  });
}

/** Move a user onto a plan. Called by the checkout webhook (step ⑤) after a real payment. */
export function setPlan(authId: string, plan: string, expiresMs: number | null): void {
  withDb((db) => {
    db.prepare("UPDATE users SET plan = ?, plan_expires_ms = ? WHERE auth_id = ?").run(plan, expiresMs, authId);
  });
}

export function getPlan(name: string): PlanRow | null {
  seedPlans();
  return withDb((db) => {
    const r = db
      .prepare("SELECT name, monthly_token_cap, checkout_url FROM plans WHERE name = ?")
      .get(name) as { name: string; monthly_token_cap: number | null; checkout_url: string | null } | undefined;
    return r ? { name: r.name, monthlyTokenCap: r.monthly_token_cap ?? null, checkoutUrl: r.checkout_url ?? null } : null;
  });
}

/** Day key in the user's local server time — matches how a "daily usage" row is read back. */
function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Add one turn's token counts to today's row. Pool-client returns these; the meter (⑤) calls it. */
export function recordUsage(authId: string, tokensIn: number, tokensOut: number): void {
  if (!authId) return;
  const day = dayKey();
  withDb((db) => {
    db.prepare(
      `INSERT INTO usage (auth_id, day, tokens_in, tokens_out, turns)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(auth_id, day) DO UPDATE SET
         tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out,
         turns = turns + 1`,
    ).run(authId, day, Math.max(0, tokensIn | 0), Math.max(0, tokensOut | 0));
  });
}

/**
 * The access decision for one user (billing step ④).
 *
 * `"granted"` unless GROKBOT2_BILLING is `enforce` — so off/warn behave exactly as before (the app
 * is never locked while measuring). Under enforce:
 *   - a paid plan that has not expired → granted
 *   - a paid plan past its expiry      → payment_required
 *   - the free plan over its monthly token cap (estimated) → payment_required
 * A plan with a null cap is uncapped → granted. Creates the user row on first sight (free plan).
 */
export function accessVerdict(user: { authId: string; email: string }): "granted" | "payment_required" {
  if (billingMode() !== "enforce") return "granted";
  const u = ensureUser(user.authId, user.email);
  if (!u) return "granted";
  if (u.plan !== "free") {
    return u.planExpiresMs == null || u.planExpiresMs > Date.now() ? "granted" : "payment_required";
  }
  const cap = getPlan(u.plan)?.monthlyTokenCap ?? null;
  if (cap == null) return "granted";
  return monthlyTokens(u.authId) >= cap ? "payment_required" : "granted";
}

/**
 * This period's usage for the app's own usage bar (GetCurrentPeriodUsage).
 *
 * Returns null when billing is off or the plan is uncapped — the RPC then answers `enabled:false`
 * and the app draws no bar, which is the historical behaviour. The window is the same trailing 30
 * days `accessVerdict` gates on, so the bar and the lock can never disagree.
 */
export function currentPeriodUsage(user: { authId: string; email: string }, now = Date.now()):
  { used: number; limit: number; cycleStartMs: number; cycleEndMs: number } | null {
  if (billingMode() === "off") return null;
  const u = ensureUser(user.authId, user.email);
  if (!u) return null;
  const cap = getPlan(u.plan)?.monthlyTokenCap ?? null;
  if (cap == null) return null;   // uncapped plan — nothing meaningful to draw
  return {
    used: monthlyTokens(u.authId, now),
    limit: cap,
    cycleStartMs: now - 30 * 86_400_000,
    cycleEndMs: now,
  };
}

/** Tokens (in + out) used in the trailing 30 days — what the monthly cap is checked against. */
export function monthlyTokens(authId: string, now = Date.now()): number {
  if (!authId) return 0;
  const since = dayKey(now - 30 * 86_400_000);
  return withDb((db) => {
    const r = db
      .prepare(
        "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM usage WHERE auth_id = ? AND day >= ?",
      )
      .get(authId, since) as { total: number };
    return r.total;
  });
}
