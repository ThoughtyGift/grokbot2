/**
 * GitHub webhooks — public ingress on ops.
 *
 * Signature verification (X-Hub-Signature-256) stays a TODO behind GROKBOT2_GITHUB_WEBHOOK_SECRET
 * rather than faked. Do not expose this endpoint on a public NIC until that is on.
 */
const bffBase = (): string => (process.env.GROKBOT2_BFF_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

export interface GitHubResult { status: number; body: unknown }

function kindOf(event: string, action?: string): string {
  if (event === "pull_request") {
    if (action === "opened" || action === "reopened") return "pr-opened";
    if (action === "synchronize") return "pr-pushed";
    if (action === "closed") return "pr-merged";
    return "pr-event";
  }
  if (event === "pull_request_review") return "review-requested";
  if (event === "issues" && (action === "opened" || action === "reopened")) return "issue-opened";
  if (event === "push") return "push";
  return event;
}

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

export async function handleGitHubEvent(event: string, body: Record<string, any>): Promise<GitHubResult> {
  if (event === "ping") return { status: 200, body: { ok: true, pong: true } };

  const repo = body?.repository?.full_name ?? "?";
  const sender = body?.sender?.login ?? "?";
  const kind = kindOf(event, body?.action);
  const subject = body?.pull_request ?? body?.issue ?? null;
  const context =
    `[GitHub] Một sự kiện GitHub vừa đánh thức bạn.\n` +
    `repo: ${repo}\n` +
    `sự kiện: ${kind}${body?.action ? ` (${body.action})` : ""}\n` +
    `bởi: ${sender}\n` +
    (subject ? `#${subject.number} ${subject.title ?? ""}\n${subject.html_url ?? ""}\n` : "");

  try {
    const fired = await fireListeners("github", context);
    return { status: 200, body: { ok: true, kind, fired } };
  } catch (err) {
    console.warn("[grokbot-ops] github fire-listeners failed:", (err as Error).message);
    return { status: 503, body: { ok: false, kind, error: "bff unreachable" } };
  }
}
