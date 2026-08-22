/**
 * Slack Events API — public ingress on ops, not on the BFF `/gw` surface.
 *
 * Signature verification (X-Slack-Signature) stays a TODO behind GROKBOT2_SLACK_SIGNING_SECRET
 * rather than faked: without the secret it cannot be done, and pretending to verify is worse
 * than plainly not. Do not expose this endpoint on a public NIC until that is on.
 */
const bffBase = (): string => (process.env.GROKBOT2_BFF_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

export interface SlackResult { status: number; body: unknown }

async function fireListeners(platform: string, context: string): Promise<number> {
  const r = await fetch(`${bffBase()}/internal/ops/fire-listeners`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform, context }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({})) as { fired?: number };
  if (!r.ok) throw new Error(`BFF fire-listeners HTTP ${r.status}`);
  return typeof j.fired === "number" ? j.fired : 0;
}

export async function handleSlackEvent(body: Record<string, unknown>): Promise<SlackResult> {
  if (body?.type === "url_verification") {
    return { status: 200, body: { challenge: String(body.challenge ?? "") } };
  }

  if (body?.type === "event_callback" && body.event && typeof body.event === "object") {
    const e = body.event as Record<string, unknown>;
    if (e.bot_id) return { status: 200, body: { ok: true, fired: 0, ignored: "bot message" } };
    if (e.type !== "app_mention" && e.type !== "message") {
      return { status: 200, body: { ok: true, fired: 0, ignored: e.type } };
    }
    const context =
      `[Slack] Một tin nhắn Slack vừa đánh thức bạn.\n` +
      `channel: ${e.channel ?? "?"}\n` +
      (e.thread_ts ? `thread_ts: ${e.thread_ts}\n` : "") +
      (e.user ? `từ: ${e.user}\n` : "") +
      `nội dung: ${e.text ?? ""}`;
    try {
      const fired = await fireListeners("slack", context);
      return { status: 200, body: { ok: true, fired } };
    } catch (err) {
      console.warn("[grokbot-ops] slack fire-listeners failed:", (err as Error).message);
      return { status: 503, body: { ok: false, error: "bff unreachable" } };
    }
  }

  return { status: 200, body: { ok: true, fired: 0, ignored: "unknown" } };
}
