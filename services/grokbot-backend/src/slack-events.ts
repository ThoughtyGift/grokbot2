/**
 * Slack Events API receiver — Tầng 1 of the Slack bridge.
 *
 * This is the inbound half: a Slack mention arrives here and wakes the matching routine, turning an
 * event-triggered routine from "shown in the panel" into "actually runs". It does NOT reply back into
 * Slack — that is Tầng 2 and needs a Slack bot token (chat.postMessage), the piece the original also
 * gates behind a connector. So after this fires, the agent processes the message and answers in the
 * app; closing the loop to Slack is the next layer.
 *
 * The shapes are Slack's own Events API:
 *   { "type": "url_verification", "challenge": "…" }              → echo the challenge (handshake)
 *   { "type": "event_callback", "event": { "type": "app_mention"|"message", "text", "channel",
 *       "thread_ts", "user", "ts" } }                             → fire slack listeners with context
 *
 * Signature verification (X-Slack-Signature) is deliberately left as a TODO with a loud note rather
 * than faked: without the signing secret it cannot be done, and pretending to verify is worse than
 * plainly not. Set GROKBOT2_SLACK_SIGNING_SECRET to enable it before exposing this endpoint publicly.
 */
import { fireListeners } from "./automations.js";

export interface SlackVerification { type: "url_verification"; challenge: string }
export interface SlackEventCallback {
  type: "event_callback";
  event?: { type?: string; text?: string; channel?: string; thread_ts?: string; ts?: string; user?: string; bot_id?: string };
}
type SlackBody = SlackVerification | SlackEventCallback | Record<string, unknown>;

export interface SlackResult { status: number; body: unknown }

/**
 * Handle one Slack Events API POST. Returns what to write back:
 *   - the challenge string for the handshake,
 *   - `{ ok: true, fired }` for an event, where `fired` is how many routines woke.
 */
export function handleSlackEvent(body: SlackBody): SlackResult {
  if (body && (body as SlackVerification).type === "url_verification") {
    return { status: 200, body: { challenge: (body as SlackVerification).challenge ?? "" } };
  }

  const cb = body as SlackEventCallback;
  if (cb?.type === "event_callback" && cb.event) {
    const e = cb.event;
    // Ignore the bot's own messages, or a mention wakes the routine that just replied — an echo loop.
    if (e.bot_id) return { status: 200, body: { ok: true, fired: 0, ignored: "bot message" } };
    if (e.type !== "app_mention" && e.type !== "message") {
      return { status: 200, body: { ok: true, fired: 0, ignored: e.type } };
    }
    // The context the routine's instruction acts on. The original's instruction says "reply in that
    // Slack thread (same channel, thread_ts)", so both travel with the text.
    const context =
      `[Slack] Một tin nhắn Slack vừa đánh thức bạn.\n` +
      `channel: ${e.channel ?? "?"}\n` +
      (e.thread_ts ? `thread_ts: ${e.thread_ts}\n` : "") +
      (e.user ? `từ: ${e.user}\n` : "") +
      `nội dung: ${e.text ?? ""}`;
    const fired = fireListeners("slack", context);
    return { status: 200, body: { ok: true, fired } };
  }

  return { status: 200, body: { ok: true, fired: 0, ignored: "unknown" } };
}
