/**
 * The `/gw/*` router — the Cursor dialect on the wire.
 *
 * Route shapes, header hardening, cache pins, the 404 body, the long-poll channels and the
 * dispatch into the command table all live here. Domain code never sees an `IncomingMessage`.
 */
import type { ServerResponse } from "node:http";
import { buildCommands } from "./commands.js";
import { createSseHub } from "./sse.js";
import type { AclPorts, Call, ChannelName } from "./ports.js";

export interface GatewayRouter {
  /** Returns true if it handled the request. */
  handle(url: string, body: Buffer, res: ServerResponse, headers?: Record<string, unknown>, method?: string): boolean;
  /** The host's `/health` shape — also served at the bare `/health` by the server shell. */
  hostHealth(): Record<string, unknown>;
}

export function createGatewayRouter(ports: AclPorts): GatewayRouter {
  // Hub first: a few commands are themselves the only place a value changes (host settings,
  // an MCP refresh), so they push on the way out rather than waiting for a poll. Nothing in the
  // domain observes those, so routing them through a domain event would invent a publisher.
  const sse = createSseHub(ports);
  const methods: Record<string, Call> = buildCommands(ports, sse.broadcast);
  const { identity, directory, connectors, observe } = ports;

  /**
   * When this process started, and when it was last doing work.
   *
   * `/health` reports both. `startedAt` cannot be derived after the fact and `lastBusyAtMs` has
   * to be observed as it happens, so both are captured rather than reconstructed.
   */
  const STARTED_AT = Date.now();
  let lastBusyAtMs = 0;

  /** How many bots are mid-turn. Read by `/prepare-upgrade` to decide whether to wait. */
  const runningTurns = (): number => directory.listAgents().filter((a) => a.isRunning === true).length;

  /**
   * The host's `/health` shape, field for field (contract: `health.fields`).
   *
   * `busyOnlyAwaitingApproval` is deliberately OMITTED. In the host it is a conditional spread —
   * present only when it can be determined — and we cannot determine it: our roster rows report
   * `awaitingUserResponse: null` unconditionally, so any value here would be invented. The
   * contract lists it as optional, so leaving it out is correct; guessing it would not be.
   */
  const hostHealth = (): Record<string, unknown> => {
    const running = directory.listAgents().filter((a) => a.isRunning === true);
    if (running.length > 0) lastBusyAtMs = Date.now();
    return {
      ok: true,
      pid: process.pid,
      isBusy: running.length > 0,
      activeAgentId: running[0]?.id ?? null,
      startedAt: STARTED_AT,
      lastBusyAtMs,
      // Kept from the previous shape: harmless, and something may already read it.
      status: "healthy",
    };
  };

  /** Every gateway method the FE has called this session — powers GET /gw/__coverage. */
  const called = new Set<string>();
  /** Last payload seen per method, so wrong-key bugs are visible instead of inferred. */
  const lastArgs = new Map<string, unknown>();
  /**
   * How many times each method has been called, and when it was last seen.
   *
   * Names alone cannot answer "does the client poll?" — that question is about RATE, and it
   * decides whether a missing update is a broken push or a poll that never runs.
   */
  const callCounts = new Map<string, { n: number; lastMs: number }>();

  const json = (res: ServerResponse, value: unknown, status = 200): true => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof value === "string" ? value : JSON.stringify(value ?? null));
    return true;
  };

  const handle: GatewayRouter["handle"] = (url, body, res, headers = {}, method = "?") => {
    if (!url.startsWith("/gw/")) return false;

    // P0-5. In `warn` this only records the verdict; in `enforce` it answers 401 with the host's
    // own message. `/gw/health` and `/gw/__coverage` are exempt inside checkAuth — they are how
    // you diagnose a bad rollout, so they must not sit behind the credential that broke it.
    const verdict = identity.checkAuth(url, headers);
    identity.noteAuth(url, verdict);
    if (!verdict.allow) return json(res, { error: verdict.message }, 401);

    if (url.startsWith("/gw/health")) return json(res, hostHealth());

    // ── /avatars/<agentId>?v=<version> ────────────────────────────────────────
    //
    // The app fetches bot avatars over HTTP, not through a gateway command, and we never served
    // this route — which is why the sidebar showed initials where the original shows pictures.
    // Every branch below is the host's own (`E3s`), including the ones that are easy to skip:
    // the cross-site refusal, the version check, and the 304.
    if (url.startsWith("/gw/avatars/")) {
      const parsed = new URL(url, "http://x");
      // The host decodes the id, so a bot id with a reserved character still resolves.
      const agentId = decodeURIComponent(parsed.pathname.slice("/gw/avatars/".length));
      const fail = (status: number, msg: string) => json(res, { error: msg }, status);
      // An avatar is an image the renderer embeds; a cross-site read of it is never legitimate.
      if (String(headers["sec-fetch-site"] ?? "") === "cross-site") return fail(403, "cross-site avatar loads are not allowed");
      if (!agentId) return fail(404, "missing agent id");

      const { avatarDataUrl, avatarVersion } = directory.getAgentAvatar({ id: agentId });
      const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(avatarDataUrl ?? "");
      if (!avatarVersion || !m) return fail(404, "agent has no avatar");

      // `?v=` is a cache-busting pin. A stale pin must 404 rather than silently serve the new
      // image, or a client caching immutably would keep a picture it asked not to have.
      const asked = parsed.searchParams.get("v");
      if (asked != null && asked !== avatarVersion) return fail(404, "no such avatar version");

      const etag = `"${avatarVersion}"`;
      // Pinned requests are immutable for a year; unpinned ones must never be cached, because
      // the same URL will answer differently the moment the avatar changes.
      const caching = asked != null
        ? { "cache-control": "private, max-age=31536000, immutable", etag }
        : { "cache-control": "no-store", etag };

      if (String(headers["if-none-match"] ?? "") === etag) {
        res.writeHead(304, caching);
        res.end();
        return true;
      }
      const bytes = Buffer.from(m[2], "base64");
      res.writeHead(200, {
        ...caching,
        "content-type": m[1],
        "content-length": bytes.byteLength,
        // The host's three hardening headers. An avatar is untrusted bytes from the box: never
        // rendered as a document, never sniffed into one.
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      });
      res.end(bytes);
      return true;
    }

    // Asked before the app replaces the host. `runningTurns` is read to decide whether to wait,
    // so a hardcoded 0 would tell the app it is safe to swap the host out from under a live turn.
    if (url.startsWith("/gw/prepare-upgrade")) return json(res, { quiescing: false, runningTurns: runningTurns() });

    // The responses half of the two long-poll channels. Both were missing, and the observe pass
    // caught the app posting to both.
    if (url.startsWith("/gw/local-exec/responses") || url.startsWith("/gw/webauthn/responses")) {
      const name: ChannelName = url.includes("webauthn") ? "webauthn" : "local-exec";
      if (!connectors.channelEnabled(name)) return json(res, { error: `${name} channel not enabled` }, 404);
      return json(res, connectors.submitResponses(name, body));
    }

    // Slack Events API — a Slack mention lands here and wakes the matching routine. Exempt from
    // the gateway ticket: Slack posts with its own signature, not our bearer. When ops owns
    // public ingress these paths 404 so Slack/GitHub terminate on :8791, not on the BFF.
    if (url.startsWith("/gw/slack/events")) {
      if (connectors.publicWebhooks === false) return json(res, { error: "moved to ops /slack/events" }, 404);
      const out = connectors.handleSlackEvent(parseBody(body));
      return json(res, out.body, out.status);
    }
    // GitHub webhooks — the event name rides in the X-GitHub-Event header, not the body. Exempt
    // for the same reason: GitHub signs with X-Hub-Signature-256.
    if (url.startsWith("/gw/github/events")) {
      if (connectors.publicWebhooks === false) return json(res, { error: "moved to ops /github/events" }, 404);
      const out = connectors.handleGitHubEvent(String(headers["x-github-event"] ?? ""), parseBody(body));
      return json(res, out.body, out.status);
    }

    if (url.startsWith("/gw/events")) {
      // Record who opens the stream and what they ask for. Something connects here but no command
      // table references it, so identifying the caller is the open question — the headers say
      // whether this is the app's main process or one of our own probes.
      sse.attach(res, {
        url,
        accept: String(headers["accept"] ?? ""),
        userAgent: String(headers["user-agent"] ?? ""),
        lastEventId: String(headers["last-event-id"] ?? ""),
      });
      return true;
    }

    // Drop every live event stream on purpose, with the server still answering.
    //
    // This exists to tell two failures apart, because they look identical from the app and want
    // opposite fixes: a client that never retries needs the connection never to break, while a
    // client that retries only needs the restart to be quick. Killing the backend cannot answer
    // that — it takes the retry target away at the same moment — so the drop has to come from a
    // server that stays up. Diagnostic only; nothing in the product calls it.
    if (url.startsWith("/gw/__dropsse")) return json(res, { dropped: sse.drop() });

    // Long-poll channels: the box holds these open until it has work. Answering instantly makes
    // the client reconnect in a tight loop and read the box as flapping, so park them and return
    // an empty batch on timeout.
    if (url.startsWith("/gw/webauthn/requests") || url.startsWith("/gw/local-exec/requests")) {
      connectors.parkRequests(url.includes("webauthn") ? "webauthn" : "local-exec", res);
      return true;
    }

    // Coverage report: which gateway methods the FE exercised, and which are still unmapped.
    //
    // `lastArgs` is the important half. Coverage alone says a method is handled, never that the
    // handler reads the right keys — the bug class that has silently killed a feature six times
    // here. Recording what actually came over the wire makes it checkable.
    if (url.startsWith("/gw/__coverage")) {
      const params = new URL(url, "http://x").searchParams;
      const filter = params.get("method");
      const args = Object.fromEntries(
        [...lastArgs].filter(([n]) => !filter || n.toLowerCase().includes(filter.toLowerCase())).sort(),
      );
      // `?reset=unknown` forgets the recorded unknown paths. Needed because the record is
      // historical by design: implementing a route does not remove its row, so the list still
      // showed routes that now exist. A to-do list that only grows is not one.
      const cleared = params.get("reset") === "unknown" ? observe.clearUnknown() : undefined;
      // `persisted` is the half that survives a restart, and it is the half that matters: `tsx
      // watch` reloads on every save and the in-memory counters above were seen resetting three
      // times inside an hour.
      const persisted = observe.coverageSnapshot();
      return json(res, JSON.stringify({
        calledTotal: called.size,
        mapped: [...called].filter((n) => n in methods).sort(),
        unmapped: [...called].filter((n) => !(n in methods)).sort(),
        lastArgs: args,
        sse: sse.stats(),
        calls: Object.fromEntries([...callCounts].sort((a, b) => b[1].n - a[1].n)),
        implemented: Object.keys(methods).sort(),
        // What each request/response channel has actually seen. The app posts frames we do not
        // yet consume, and reading their real shape here beats guessing it.
        channels: connectors.channelSnapshot(),
        auth: identity.authSnapshot(),
        ...(cleared !== undefined ? { clearedUnknownPaths: cleared } : {}),
        persisted: {
          ...persisted,
          // Same split as `mapped`/`unmapped`, but over everything ever seen rather than only
          // this process's lifetime.
          everCalled: observe.calledMethods().length,
          everUnmapped: observe.calledMethods().filter((n) => !(n in methods)).sort(),
          lastArgs: observe.lastArgsFor(filter),
        },
      }, null, 2));
    }

    const m = url.match(/\/gw\/api\/([A-Za-z]+)/);
    if (m) {
      const name = m[1];
      const args = parseBody(body);
      called.add(name);
      const prev = callCounts.get(name);
      callCounts.set(name, { n: (prev?.n ?? 0) + 1, lastMs: Date.now() });
      if (body.length) lastArgs.set(name, args);
      observe.recordCall(name, args, body.length > 0);   // same numbers, but surviving a restart
      if (process.env.GROKBOT2_LOG) console.log(`  gw ${name} ${JSON.stringify(args).slice(0, 220)}`);
      const fn = methods[name];
      if (!fn) console.warn(`[gateway] UNMAPPED ${name} ${body.length ? body.toString("utf8").slice(0, 120) : ""}`);
      let val: unknown = {};
      try {
        val = fn ? fn(args) : {};
      } catch (e) {
        console.error(`[gateway] ${name} threw:`, e);
      }
      // Handlers may be async. Every one used to be synchronous, so the result was stringified
      // directly — which turns a Promise into `{}`: a 200 with an empty body, indistinguishable
      // from a method that legitimately returns nothing. Awaiting is what makes the attachment
      // readers (which have to reach the box) return anything at all.
      if (val != null && typeof (val as { then?: unknown }).then === "function") {
        void (val as Promise<unknown>).then(
          (v) => json(res, v),
          (e) => { console.error(`[gateway] ${name} rejected:`, e); json(res, null); },
        );
        return true;
      }
      return json(res, val);
    }

    // A `/gw/...` request that matched nothing above.
    //
    // The real box host ends its router with `404 "not found: <METHOD> <path>"`. We answer that
    // only once GROKBOT2_STRICT_404=1; until then the path is RECORDED and still answered
    // `200 {}`, because flipping it blind breaks the app without telling you which path did it.
    observe.recordUnknown(method, url, body);
    const nf = observe.notFoundBody(method, url);
    if (nf) return json(res, nf, 404);
    return json(res, "{}");
  };

  return { handle, hostHealth };
}

/** Whatever the client sent, unreshaped — the command table is what knows the spellings. */
const parseBody = (body: Buffer): any => {
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return {};   // a body we cannot parse is treated as an argument-less call, not an error
  }
};
