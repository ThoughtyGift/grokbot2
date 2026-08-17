/**
 * What the client actually asked for — recorded, and kept across restarts.
 *
 * Two separate holes this closes, both of which made the app's real behaviour unmeasurable:
 *
 * 1. **Unknown paths were invisible.** Both fallbacks — the gateway's and the server's — answered
 *    `200 {}` to anything unrecognised, with no log and no counter. Three completely invented
 *    URLs (`/gw/khong-ton-tai-abc`, `/gw/subscribe`, `/hoan-toan-la`) each came back 200 with an
 *    empty object and left no trace anywhere. So an endpoint the app needs and we have never
 *    implemented is indistinguishable from one that legitimately returns nothing, and the
 *    instrument is blind exactly where it matters.
 *
 *    The real box host ends its router with `404 "not found: <METHOD> <path>"`. Matching that is
 *    the goal — but flipping it blind is how you break the app without learning which path did
 *    it, so this module ships the recorder first and the 404 behind `GROKBOT2_STRICT_404=1`.
 *
 * 2. **Counters died on every restart.** `tsx watch` restarts the backend on every file save;
 *    the coverage numbers were in-memory only and were observed resetting three times in one
 *    hour — the evidence disappearing precisely while it was being gathered.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const FILE = process.env.GROKBOT2_COVERAGE_FILE ?? join(DIR, "coverage.json");

/**
 * `false` (default) = observe only: record the path, still answer `200 {}`.
 * `true`            = answer 404 like the real host does.
 *
 * Two phases on purpose, same as the auth switch. The observe pass is what turns
 * "which endpoints does the app need?" from a guess into a list.
 */
// Read per call rather than captured at import, so the phase can be flipped by editing `.env`
// and letting tsx reload — the whole point of a two-phase rollout is being able to go back
// quickly, and a value frozen at module load makes that a rebuild instead of a restart.
export const isStrict404 = (): boolean => process.env.GROKBOT2_STRICT_404 === "1";

export interface UnknownHit {
  /** How many times this exact METHOD + path arrived. */
  n: number;
  firstMs: number;
  lastMs: number;
  /** First body seen, redacted and truncated — enough to tell what it wanted. */
  sample: string;
  /** Whether we answered 200 (observing) or 404 (strict) the last time. */
  answered: number;
}

interface Persisted {
  savedAtMs: number;
  /** METHOD + path (query stripped) -> hit record. */
  unknownPaths: Record<string, UnknownHit>;
  /** Gateway method -> {n, lastMs}. */
  calls: Record<string, { n: number; lastMs: number }>;
  /** Gateway method -> last argument object seen. */
  lastArgs: Record<string, unknown>;
  sse: { opened: number; closed: number; lastOpenedMs: number };
}

const unknownPaths = new Map<string, UnknownHit>();
const calls = new Map<string, { n: number; lastMs: number }>();
const lastArgs = new Map<string, unknown>();
const sse = { opened: 0, closed: 0, lastOpenedMs: 0 };

// ── load ──────────────────────────────────────────────────────────────────────
{
  try {
    const p = JSON.parse(readFileSync(FILE, "utf8")) as Persisted;
    for (const [k, v] of Object.entries(p.unknownPaths ?? {})) unknownPaths.set(k, v);
    for (const [k, v] of Object.entries(p.calls ?? {})) calls.set(k, v);
    for (const [k, v] of Object.entries(p.lastArgs ?? {})) lastArgs.set(k, v);
    Object.assign(sse, p.sse ?? {});
    const total = [...calls.values()].reduce((n, c) => n + c.n, 0);
    console.log(`[grokbot2] coverage restored: ${calls.size} method(s), ${total} call(s), ${unknownPaths.size} unknown path(s)`);
  } catch {
    /* first run */
  }
}

// ── save (debounced: a poll burst is one write) ────────────────────────────────
let pending: NodeJS.Timeout | null = null;
function save(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const out: Persisted = {
      savedAtMs: Date.now(),
      unknownPaths: Object.fromEntries(unknownPaths),
      calls: Object.fromEntries(calls),
      lastArgs: Object.fromEntries(lastArgs),
      sse: { opened: sse.opened, closed: sse.closed, lastOpenedMs: sse.lastOpenedMs },
    };
    try {
      mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(out, null, 1));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[grokbot2] coverage save failed:", (e as Error).message);
    }
  }, 2000);
}

/** Flush immediately — called on shutdown so an in-flight debounce is not lost. */
export function saveCoverageNow(): void {
  if (pending) { clearTimeout(pending); pending = null; }
  const out: Persisted = {
    savedAtMs: Date.now(),
    unknownPaths: Object.fromEntries(unknownPaths),
    calls: Object.fromEntries(calls),
    lastArgs: Object.fromEntries(lastArgs),
    sse: { opened: sse.opened, closed: sse.closed, lastOpenedMs: sse.lastOpenedMs },
  };
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(out, null, 1));
  } catch { /* best effort */ }
}

// ── record ────────────────────────────────────────────────────────────────────

/**
 * A request that matched no route.
 *
 * Keyed by METHOD + pathname with the query string dropped, so a polled endpoint with a rolling
 * parameter aggregates into one row instead of thousands. The query still reaches `sample` via
 * the body when there is one.
 */
export function recordUnknown(method: string, url: string, body: Buffer): void {
  const path = url.split("?")[0];
  const key = `${method} ${path}`;
  const prev = unknownPaths.get(key);
  const now = Date.now();
  unknownPaths.set(key, {
    n: (prev?.n ?? 0) + 1,
    firstMs: prev?.firstMs ?? now,
    lastMs: now,
    // Redacted: an unknown endpoint is exactly where an unexpected credential shows up.
    sample: prev?.sample ?? redact(body.toString("utf8").slice(0, 300)),
    answered: isStrict404() ? 404 : 200,
  });
  // Loud on the first hit only: this is the line that turns an invisible gap into a task, and
  // repeating it on every poll would bury it.
  if (!prev) console.warn(`[gateway] UNKNOWN PATH ${key} — answering ${isStrict404() ? 404 : "200 {} (observe mode)"}`);
  save();
}

export function recordCall(method: string, args: unknown, hasBody: boolean): void {
  const prev = calls.get(method);
  calls.set(method, { n: (prev?.n ?? 0) + 1, lastMs: Date.now() });
  if (hasBody) lastArgs.set(method, args);
  save();
}

export function recordSseOpen(): void { sse.opened += 1; sse.lastOpenedMs = Date.now(); save(); }
export function recordSseClose(): void { sse.closed += 1; save(); }

// ── read ──────────────────────────────────────────────────────────────────────

/**
 * Forget the recorded unknown paths.
 *
 * The record is deliberately historical, which means implementing a route does NOT remove its
 * row — after P2 the list still showed `/gw/avatars/…` and `/gw/prepare-upgrade` from before they
 * existed, next to leftovers from this script's own probes. A list that only ever grows stops
 * being a to-do list. Clearing is explicit and manual: `GET /gw/__coverage?reset=unknown`.
 */
export function clearUnknown(): number {
  const n = unknownPaths.size;
  unknownPaths.clear();
  saveCoverageNow();
  console.log(`[grokbot2] cleared ${n} recorded unknown path(s)`);
  return n;
}

export const coverageSnapshot = () => ({
  strict404: isStrict404(),
  unknownPaths: Object.fromEntries([...unknownPaths].sort((a, b) => b[1].n - a[1].n)),
  calls: Object.fromEntries([...calls].sort((a, b) => b[1].n - a[1].n)),
  lastArgs: Object.fromEntries([...lastArgs].sort()),
  sse: { ...sse },
});

export const calledMethods = (): string[] => [...calls.keys()];
export const lastArgsFor = (filter?: string | null): Record<string, unknown> =>
  Object.fromEntries(
    [...lastArgs].filter(([n]) => !filter || n.toLowerCase().includes(filter.toLowerCase())).sort(),
  );

/**
 * The body to answer an unmatched request with.
 *
 * `null` means "not strict — carry on and answer 200 {}", so callers read as:
 * `const nf = notFoundBody(...); if (nf) { …404… } else { …200 {}… }`
 */
export function notFoundBody(method: string, url: string): string | null {
  if (!isStrict404()) return null;
  return JSON.stringify({ error: `not found: ${method} ${url.split("?")[0]}` });
}
