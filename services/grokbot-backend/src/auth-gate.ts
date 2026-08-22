/**
 * P0-5 â€” check the gateway ticket, the way the real host does.
 *
 * The backend MINTS a gateway token (`ensureSandBox` stamps it as field 11) and then never looked
 * at it. Demonstrated, not theorised: with no credential of any kind, plain PowerShell against
 * `127.0.0.1:8788` created a bot, sent chat that spent pool quota, ran a directory-listing tool
 * **inside the box**, and deleted a bot. The only thing standing in the way was that the listener
 * is bound to loopback, so an attacker has to already be running code on this machine â€” which a
 * mistyped `npm install` satisfies.
 *
 * The host is not permissive here. Its router carries three explicit branches:
 *
 *   local-exec && no token  â†’ 401 "local-exec requires gateway authentication"
 *   webauthn  && no token   â†’ 401 "webauthn requires gateway authentication"
 *   token set && mismatch   â†’ 401 "unauthorized"
 *
 * So enforcing is matching the original, not adding a lock it does not have.
 *
 * â”€â”€ Two phases, and why it must not be one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Turning this on blind is the highest-risk change in the whole P0 set: if the client presents its
 * ticket somewhere other than an `authorization: Bearer` header â€” a different header, a query
 * parameter, not at all â€” then every gateway call 401s and the app is simply dead, with no clue
 * which assumption was wrong.
 *
 * So `GROKBOT2_AUTH` has three settings:
 *
 *   off      (default) no checking, no logging
 *   warn     check, log the VERDICT, allow everything through
 *   enforce  check and answer 401
 *
 * The `warn` pass is what makes `enforce` safe: it answers "does the app actually send the token
 * we minted?" with a measurement instead of a guess. The same shape as P0-3's observe-then-flip,
 * for the same reason.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.js";
import { verifyJwt } from "./auth.js";

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
/** Where operator tools read the per-boot token from. Inside the gitignored state directory. */
export const TOKEN_FILE = join(TOKEN_DIR, "gateway-token.txt");

export type AuthMode = "off" | "warn" | "enforce";

/** Read per call so the mode can be changed by editing `.env` and letting tsx reload. */
export const authMode = (): AuthMode => {
  const raw = (process.env.GROKBOT2_AUTH ?? "off").trim().toLowerCase();
  return raw === "warn" || raw === "enforce" ? raw : "off";
};

/**
 * The token we handed the client in the box descriptor â€” generated fresh each boot.
 *
 * The descriptor used to stamp the literal `"gw-token"`, and checking a constant that is written
 * in the source would be security theatre: the threat here is another process on this machine,
 * and that process can read the repo. A per-boot random value cannot be guessed and cannot be
 * copied out of a checkout; the only way to hold it is to have been handed it by `EnsureSandBox`,
 * which is exactly the property we want.
 *
 * `bootstrap.ts` stamps whatever is in `GROKBOT2_GATEWAY_TOKEN`, and this reads the same variable,
 * so the value checked is by construction the value issued. Overridable so a fixed token can be
 * pinned when something outside this process has to hold one.
 *
 * Operator tools cannot guess it either, so it is written to `.data/gateway-token.txt` for them
 * (`.data/` is gitignored). That file is the harness's copy, not a second source of truth.
 */
export function ensureGatewayToken(): string {
  const existing = process.env.GROKBOT2_GATEWAY_TOKEN?.trim();
  if (existing) return existing;

  // Random per INSTALL, stable across restarts â€” and the second half is not a convenience.
  //
  // Minting on every boot was the first attempt, and the warn pass caught what that does: the app
  // caches the box descriptor, so a new token orphans the ticket it is holding and every call
  // becomes `wrong-bearer`. Under `tsx watch`, which restarts on each file save, that would
  // invalidate the app's ticket several times a minute. Reading the file back keeps the value
  // unguessable and out of the source while letting a restart be a restart.
  try {
    const saved = readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved.length >= 16) {
      process.env.GROKBOT2_GATEWAY_TOKEN = saved;
      return saved;
    }
  } catch {
    /* first run */
  }

  const minted = `gw-${randomBytes(24).toString("hex")}`;
  process.env.GROKBOT2_GATEWAY_TOKEN = minted;
  try {
    mkdirSync(TOKEN_DIR, { recursive: true });
    // 0o600 is advisory on Windows but correct on the VPS this is headed for.
    writeFileSync(TOKEN_FILE, minted, { mode: 0o600 });
    console.log("[auth] minted a new gateway token â€” the app must re-fetch EnsureSandBox (restart it) before enforce");
  } catch (e) {
    console.warn("[auth] could not write the gateway token file:", (e as Error).message);
  }
  return minted;
}

export const expectedToken = (): string => process.env.GROKBOT2_GATEWAY_TOKEN ?? "";

export interface AuthVerdict {
  /** Whether the request may proceed. In `warn` this is always true. */
  allow: boolean;
  /** Set when the request should be refused: the host's own message for this case. */
  message?: string;
  /** What we saw, for the warn log. Never the token itself. */
  saw: "matching-bearer" | "user-jwt" | "stale-literal" | "unknown-token" | "other-scheme" | "no-header";
}

/** Shape (never value) of the last unrecognised token, to tell a wrong guess from a stale cache. */
let lastUnknownShape: string | null = null;

/** Which routes the host refuses outright when no token is configured at all. */
const requiresToken = (url: string): "local-exec" | "webauthn" | null => {
  if (url.startsWith("/gw/local-exec/")) return "local-exec";
  if (url.startsWith("/gw/webauthn/")) return "webauthn";
  return null;
};

/**
 * Classify one request. Pure: it decides nothing about the response, so the caller controls
 * whether a verdict is acted on or merely logged.
 */
export function checkAuth(url: string, headers: Record<string, unknown>): AuthVerdict {
  const raw = String(headers["authorization"] ?? headers["Authorization"] ?? "");
  const expected = expectedToken();

  let saw: AuthVerdict["saw"];
  if (!raw) saw = "no-header";
  else if (!/^Bearer\s+/i.test(raw)) saw = "other-scheme";
  else {
    const presented = raw.replace(/^Bearer\s+/i, "").trim();
    if (presented === expected) saw = "matching-bearer";
    // A signed grokbot-web user token (multi-tenant Phase 4) — a real credential, verified by HMAC,
    // distinct from the desktop's gateway ticket. Accepting it is what lets GROKBOT2_AUTH=enforce
    // protect the /v1 web surface without rejecting logged-in browser users.
    else if (verifyJwt(raw)) saw = "user-jwt";
    // Restarting the app did NOT make it present the new ticket, and "wrong-bearer" alone cannot
    // say why. Two very different causes need opposite fixes:
    //
    //   stale-literal   it is still sending the old hardcoded "gw-token", i.e. it is reusing a
    //                   CACHED box descriptor and never re-called EnsureSandBox. Fix: make it
    //                   re-fetch, or accept that the token has to stay stable once issued.
    //   unknown-token   it is sending something else entirely, i.e. our assumption about WHICH
    //                   value travels in this header is wrong. Fix: find the real source.
    //
    // Comparing against the old literal is safe to record: it was public in the source until this
    // commit's parent. The unknown case reports shape only â€” length and prefix, never the value.
    else if (presented === "gw-token") saw = "stale-literal";
    else saw = "unknown-token";
    if (saw === "unknown-token") lastUnknownShape = `len=${presented.length} prefix=${presented.slice(0, 3)}â€¦`;
  }

  const mode = authMode();
  if (mode !== "enforce") return { allow: true, saw };

  // Never gate the coverage report or the health probe: those are how you find out WHY the app
  // went dark, and locking them behind the credential that just broke is how a bad rollout
  // becomes an unrecoverable one.
  if (url.startsWith("/gw/__coverage") || url.startsWith("/gw/health")) return { allow: true, saw };
  // Slack's Events API posts from Slack's servers, which do not carry our gateway ticket — they
  // authenticate with their own X-Slack-Signature instead (verified in slack-events.ts once the
  // signing secret is set). Gating this on our bearer would reject every real Slack event.
  if (url.startsWith("/gw/slack/events")) return { allow: true, saw };
  if (url.startsWith("/gw/github/events")) return { allow: true, saw };  // GitHub signs with X-Hub-Signature-256, not our bearer

  const channel = requiresToken(url);
  if (saw === "no-header" || saw === "other-scheme") {
    return channel
      ? { allow: false, message: `${channel} requires gateway authentication`, saw }
      : { allow: false, message: "unauthorized", saw };
  }
  if (saw === "stale-literal" || saw === "unknown-token") return { allow: false, message: "unauthorized", saw };
  return { allow: true, saw };
}

// â”€â”€ warn-phase reporting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// One line per DISTINCT verdict, not per request: the app polls, and a per-request log would
// bury the finding under thousands of identical lines.
const seen = new Map<string, number>();
/**
 * Which paths arrived WITHOUT a usable ticket.
 *
 * A count alone is not enough to enforce on. The warn pass reported 36 matching bearers and 2
 * requests with no header, and "2" cannot distinguish "the app has an unauthenticated route we
 * are about to break" from "those were the operator's own curl calls". The paths can. Only the
 * failing verdicts are tracked â€” the matching ones need no diagnosis and would just grow the map.
 */
const unticketedPaths = new Map<string, { n: number; saw: string }>();

export function noteAuth(url: string, verdict: AuthVerdict): void {
  if (authMode() === "off") return;
  const key = verdict.saw;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  if (key !== "matching-bearer") {
    const path = url.split("?")[0];
    const prev = unticketedPaths.get(path);
    unticketedPaths.set(path, { n: (prev?.n ?? 0) + 1, saw: key });
  }
  if (n > 1) return;
  const where = redact(url.split("?")[0]);
  const verb = authMode() === "enforce" ? (verdict.allow ? "allowed" : `REFUSED (${verdict.message})`) : "would allow";
  console.log(`[auth] first request with ${key} â€” ${verb}  (e.g. ${where})`);
  if (key === "no-header") {
    console.log("[auth] the client is not sending an authorization header on this route.");
    console.log("[auth] do NOT set GROKBOT2_AUTH=enforce yet â€” find where the ticket travels first.");
  }
}

/** Counts by verdict, surfaced through `/gw/__coverage` so the warn pass is readable. */
export const authSnapshot = () => ({
  mode: authMode(),
  // The expected value is a non-secret literal from the box descriptor, but report only whether
  // one is configured â€” habit matters more than this particular string.
  tokenConfigured: expectedToken().length > 0,
  verdicts: Object.fromEntries([...seen].sort()),
  ...(lastUnknownShape ? { lastUnknownTokenShape: lastUnknownShape } : {}),
  // The list to read before flipping to enforce. Anything here that is NOT exempt and NOT an
  // operator tool is a route that will start answering 401.
  unticketedPaths: Object.fromEntries([...unticketedPaths].sort()),
});
