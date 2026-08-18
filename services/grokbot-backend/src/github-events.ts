/**
 * GitHub webhook receiver — the next platform after Slack, and the closest in shape.
 *
 * Same pattern as slack-events.ts: an inbound GitHub event wakes the matching routine, turning a
 * `github` trigger from "shown in the panel" into "actually runs". It does not push back to GitHub
 * (commenting on a PR would be Tang 2, needing a GitHub token) — after this fires, the agent processes
 * the event and answers in the app.
 *
 * GitHub's webhook contract:
 *   Header `X-GitHub-Event`: "ping" | "pull_request" | "issues" | "push" | "pull_request_review" | …
 *   Body: { action?: "opened"|"closed"|…, repository?: {full_name}, sender?: {login},
 *           pull_request?: {number,title,html_url}, issue?: {number,title,html_url} }
 *   A `ping` is sent once on setup and must be answered 200.
 *
 * Signature verification (X-Hub-Signature-256, HMAC-SHA256 of the body with the webhook secret) is a
 * loud TODO behind GROKBOT2_GITHUB_WEBHOOK_SECRET rather than faked — the endpoint must not be public
 * until it is on.
 */
import { fireListeners } from "./automations.js";

export interface GitHubResult { status: number; body: unknown }

/** Map the raw event + action to one of the original's github trigger kinds, for the log line. */
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

export function handleGitHubEvent(event: string, body: Record<string, any>): GitHubResult {
  // Setup handshake — GitHub sends this once and expects a 200.
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

  const fired = fireListeners("github", context);
  return { status: 200, body: { ok: true, kind, fired } };
}
