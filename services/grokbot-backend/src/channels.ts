/**
 * The two request/response channels the host exposes: `local-exec` and `webauthn`.
 *
 * Both are the same shape, and the host's own router shows it:
 *
 *   GET  /local-exec/requests   → T3s: register a provider, stream requests to it
 *   POST /local-exec/responses  → b3s: `r.submitResponses(o); ZOt(n,{ok:true})`
 *   GET  /webauthn/requests     → _3s: same
 *   POST /webauthn/responses    → I3s: same
 *
 * and when the channel is absent it answers `404 "<name> channel not enabled"` rather than
 * pretending. Both require gateway authentication in the host — the only two routes that do
 * unconditionally.
 *
 * We had the `requests` halves (parked long polls) and **neither** `responses` half, which the
 * observe pass caught the app actually using:
 *
 *     POST /gw/webauthn/responses    {"frames":[{"kind":"ping"}]}
 *     POST /gw/local-exec/responses  ×2
 *
 * Those went into the `200 {}` fallback and vanished. The app got a success it could not act on.
 *
 * What this module does NOT do is implement WebAuthn or local execution. Nothing here issues a
 * request, because this backend has no provider to run one — shell and file work go to the box
 * exec daemon instead (box-exec.ts). So the queue is legitimately always empty. What it does do
 * is close the loop honestly: park a poll, accept the responses the app posts, answer `{ok:true}`
 * the way the host does, and KEEP what arrived so the frame shapes can be read rather than
 * guessed the way `{"frames":[{"kind":"ping"}]}` had to be.
 */
import type { ServerResponse } from "node:http";
import { redact } from "./redact.js";

export type ChannelName = "local-exec" | "webauthn";

/** The host holds a poll open until it has work; answering instantly is a bug, not a fast path. */
const PARK_MS = Number(process.env.GROKBOT2_CHANNEL_PARK_MS ?? 25_000);

/** The empty batch each channel answers with on timeout — different key per channel. */
const EMPTY: Record<ChannelName, string> = {
  "local-exec": JSON.stringify({ requests: [] }),
  webauthn: JSON.stringify({ frames: [] }),
};

interface Waiter { res: ServerResponse; timer: NodeJS.Timeout }

interface Channel {
  waiters: Set<Waiter>;
  /** Requests waiting for a provider to pick them up. Always empty today — see the note above. */
  queue: unknown[];
  /** Frames the app has posted back, newest last. Bounded: this is a diagnostic, not a store. */
  received: { atMs: number; payload: unknown }[];
  /** Total responses accepted, for the coverage report. */
  submitted: number;
}

const MAX_RECEIVED = 20;

const channels: Record<ChannelName, Channel> = {
  "local-exec": { waiters: new Set(), queue: [], received: [], submitted: 0 },
  webauthn: { waiters: new Set(), queue: [], received: [], submitted: 0 },
};

/**
 * Both channels are enabled: we answer their `requests` polls, so claiming otherwise and
 * returning the host's 404 would be a lie in the other direction.
 */
export const isChannelEnabled = (_name: ChannelName): boolean => true;

/** Park a `requests` poll. Resolves with an empty batch on timeout, or early if work arrives. */
export function parkRequests(name: ChannelName, res: ServerResponse): void {
  const ch = channels[name];

  // Work already waiting: answer at once. (Never happens today; correct when it does.)
  if (ch.queue.length > 0) {
    const batch = ch.queue.splice(0, ch.queue.length);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(name === "webauthn" ? { frames: batch } : { requests: batch }));
    return;
  }

  const waiter: Waiter = {
    res,
    timer: setTimeout(() => {
      ch.waiters.delete(waiter);
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(EMPTY[name]);
      } catch { /* client gone */ }
    }, PARK_MS),
  };
  ch.waiters.add(waiter);
  res.on("close", () => { clearTimeout(waiter.timer); ch.waiters.delete(waiter); });
}

/**
 * Accept a `responses` POST.
 *
 * The host's handler parses the body, hands it to the channel and answers `{ok:true}` — it does
 * not validate the frames, so neither do we. An unparseable body is still recorded, because a
 * body we cannot read is exactly the thing worth seeing.
 */
export function submitResponses(name: ChannelName, body: Buffer): { ok: true } {
  const ch = channels[name];
  let payload: unknown;
  try {
    payload = body.length ? JSON.parse(body.toString("utf8")) : null;
  } catch {
    payload = { unparseable: redact(body.toString("utf8").slice(0, 300)) };
  }
  ch.submitted += 1;
  ch.received.push({ atMs: Date.now(), payload });
  while (ch.received.length > MAX_RECEIVED) ch.received.shift();
  return { ok: true };
}

/** What each channel has seen — surfaced through `/gw/__coverage` so the shapes are readable. */
export const channelSnapshot = () =>
  Object.fromEntries(
    (Object.keys(channels) as ChannelName[]).map((name) => [
      name,
      {
        enabled: isChannelEnabled(name),
        parkedPolls: channels[name].waiters.size,
        queued: channels[name].queue.length,
        submitted: channels[name].submitted,
        // Newest first: the most recent frame is the one being debugged.
        recent: [...channels[name].received].reverse().slice(0, 5),
      },
    ]),
  );
