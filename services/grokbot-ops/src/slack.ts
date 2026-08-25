/**
 * Slack Events API — public ingress on ops, not on the BFF `/gw` surface.
 *
 * Signature verification (X-Slack-Signature) stays a TODO behind GROKBOT2_SLACK_SIGNING_SECRET
 * rather than faked: without the secret it cannot be done, and pretending to verify is worse
 * than plainly not. Do not expose this endpoint on a public NIC until that is on.
 */
const bffBase = (): string => (process.env.GROKBOT2_BFF_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

export interface SlackResult { status: number; body: unknown }

/**
 * `event` đi kèm `context` chứ không thay thế nó: đoạn văn là thứ MODEL đọc, còn `event` là thứ
 * BACKEND đối chiếu với điều kiện người dùng đặt (kênh, từ khoá, repo). Gộp hai vai vào một chuỗi
 * là lý do bộ lọc trước đây không tồn tại — không ai đi khớp `#ke-toan` bằng cách dò chuỗi trong
 * một câu tiếng Việt.
 */
async function fireListeners(platform: string, context: string, event?: Record<string, unknown>): Promise<number> {
  const r = await fetch(`${bffBase()}/internal/ops/fire-listeners`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform, context, event }),
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
      const fired = await fireListeners("slack", context, {
        channel: typeof e.channel === "string" ? e.channel : undefined,
        // Slack gửi id kênh (`C123`); tên chỉ có khi app bật `channel_name`. Gửi cả hai và để
        // backend khớp cái nào có — người dùng gõ `#ke-toan`, Slack nói `C0123`.
        channelName: typeof (e as { channel_name?: unknown }).channel_name === "string"
          ? (e as { channel_name?: string }).channel_name : undefined,
        text: typeof e.text === "string" ? e.text : undefined,
        user: typeof e.user === "string" ? e.user : undefined,
      });
      return { status: 200, body: { ok: true, fired } };
    } catch (err) {
      console.warn("[grokbot-ops] slack fire-listeners failed:", (err as Error).message);
      return { status: 503, body: { ok: false, error: "bff unreachable" } };
    }
  }

  return { status: 200, body: { ok: true, fired: 0, ignored: "unknown" } };
}
