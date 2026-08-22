/**
 * The clock lives here. Matching + fire stay on the BFF so sqlite/seq/transcript stay single-writer.
 *
 *   POST {bff}/internal/ops/tick  { now?: iso }
 */
const bffBase = (): string => (process.env.GROKBOT2_BFF_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

export async function pokeTick(now = new Date()): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch(`${bffBase()}/internal/ops/tick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ now: now.toISOString() }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!r.ok) return { error: body.error ?? `HTTP ${r.status}` };
  return body;
}

/** 10s, same cadence as the old in-process scheduler. Cron itself is minute-granular. */
export function startScheduler(): void {
  setInterval(() => {
    void pokeTick().catch((e) => {
      console.warn(`[grokbot-ops] tick failed (BFF ${bffBase()}):`, (e as Error).message);
    });
  }, 10_000).unref?.();
  console.log(`[grokbot-ops] scheduler started (10s tick → ${bffBase()}/internal/ops/tick)`);
}
