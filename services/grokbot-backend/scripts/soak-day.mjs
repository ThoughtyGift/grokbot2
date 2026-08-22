/**
 * Record one day of the F7 soak — and record USE, not attendance.
 *
 * F7's exit is "the patched client is the daily driver for ≥ 5 days", which until now lived only in
 * someone's memory. A script that just stamps a date would be worse than nothing: it would let the
 * phase close on five days of the app sitting idle. So a day counts only if the backend actually
 * served the client that day, measured from the gateway's own call counter and the transcript.
 *
 *   node scripts/soak-day.mjs          # record today, print progress
 *   node scripts/soak-day.mjs --status # print progress, record nothing
 *
 * Log: docs/parity-runs/soak-log.json — one entry per calendar day, idempotent (re-running on the
 * same day updates that day's numbers rather than inventing a second day).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gwHeaders } from "./gw-auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const LOG = join(REPO, "docs", "parity-runs", "soak-log.json");
const BASE = process.env.GROKBOT2_BASE ?? "http://localhost:8788";
const STATUS_ONLY = process.argv.includes("--status");
/**
 * `--gate`: chỉ đọc, và thoát khác 0 khi chưa đủ ngày.
 *
 * Gate F7 trước đây không hỏi soak một câu nào: nó xanh vì parity + patch + Gate B đều xanh, nên
 * `phase:advance` đóng được cả chương trình F với soak 1/5. Đó đúng là điều file này mở đầu bằng
 * cách cảnh báo — một script chỉ đóng dấu ngày thì tệ hơn là không có. Điều kiện thời gian phải
 * nằm trong gate, không nằm trong trí nhớ của ai.
 *
 * Đọc, không ghi: gate chạy nhiều lần một ngày, và một lượt gate không phải một ngày dùng app.
 */
const GATE = process.argv.includes("--gate");
const REQUIRED_DAYS = 5;

/** A day with no new gateway traffic is not a day of use, however long the app was open. */
const MIN_CALLS_PER_DAY = 50;

const load = () => {
  try { return JSON.parse(readFileSync(LOG, "utf8")); } catch { return { days: [] }; }
};
const save = (o) => {
  mkdirSync(dirname(LOG), { recursive: true });
  writeFileSync(LOG, `${JSON.stringify(o, null, 2)}\n`);
};

const gw = (m, b) =>
  fetch(`${BASE}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b ?? {}) })
    .then((r) => r.json())
    .catch(() => null);

const log = load();
const qualified = log.days.filter((d) => d.counts);

if (GATE) {
  console.log(`soak: ${qualified.length}/${REQUIRED_DAYS} qualifying day(s)`);
  for (const d of log.days) {
    console.log(`  ${d.date}  ${d.counts ? "counts" : "does NOT count"}  ${d.why ?? `+${d.callsDelta} gateway calls`}`);
  }
  if (qualified.length < REQUIRED_DAYS) {
    console.log(`\nF7 chưa đóng được: cần ${REQUIRED_DAYS} ngày dùng thật, đang có ${qualified.length}.`);
    console.log("Dùng app bằng `pnpm dev:app`, cuối ngày chạy `pnpm soak`.");
    process.exit(1);
  }
  console.log("\nĐiều kiện thời gian của F7 đã đủ.");
  process.exit(0);
}

if (STATUS_ONLY) {
  console.log(`soak: ${qualified.length}/${REQUIRED_DAYS} qualifying day(s)`);
  for (const d of log.days) console.log(`  ${d.date}  ${d.counts ? "counts" : "does NOT count"}  ${d.why ?? `+${d.callsDelta} gateway calls`}`);
  process.exit(0);
}

// ── the two things a soak day has to prove ────────────────────────────────────

const patch = spawnSync(process.execPath, [join(REPO, "infra", "scripts", "patch-client.mjs"), "--verify"], { encoding: "utf8" });
const patchOk = patch.status === 0;
if (!patchOk) {
  console.log(patch.stdout?.split("\n").filter((l) => /FAIL|problem/.test(l)).join("\n") || "(patch verify failed)");
}

const cov = await fetch(`${BASE}/gw/__coverage`, { headers: gwHeaders() }).then((r) => r.json()).catch(() => null);
const callsTotal = cov ? Object.values(cov.calls ?? {}).reduce((n, v) => n + (v.n ?? v ?? 0), 0) : null;

const agents = await gw("listAgents", {});
const list = Array.isArray(agents) ? agents : (agents?.agents ?? []);

const today = new Date().toISOString().slice(0, 10);
const prev = log.days.filter((d) => d.date !== today).at(-1);
/**
 * The gateway counter is cumulative and survives restarts, but not a wiped `.data`. A reset makes
 * the delta negative, which would silently disqualify a day that was genuinely used — so treat a
 * counter that went backwards as "counting from zero again" rather than as no traffic.
 */
const rawDelta = callsTotal == null ? 0 : callsTotal - (prev?.callsTotal ?? 0);
const counterReset = callsTotal != null && rawDelta < 0;
const callsDelta = counterReset ? callsTotal : rawDelta;

/**
 * Both conditions, and the reason recorded either way. "Did not count" is as useful as "counted":
 * five stamped days with the patch broken on three of them is not a soak.
 */
const counts = patchOk && callsDelta >= MIN_CALLS_PER_DAY;
const why = !patchOk ? "patch not intact" : callsDelta < MIN_CALLS_PER_DAY ? `only +${callsDelta} gateway calls (need ${MIN_CALLS_PER_DAY})` : null;

const entry = { date: today, at: new Date().toISOString(), patchOk, callsTotal, callsDelta, agents: list.length, counts, ...(counterReset ? { counterReset: true } : {}), ...(why ? { why } : {}) };
log.days = [...log.days.filter((d) => d.date !== today), entry].sort((a, b) => a.date.localeCompare(b.date));
log.note = `A day counts only when the patch verifies AND the gateway served ≥ ${MIN_CALLS_PER_DAY} calls since the previous recorded day. ROADMAP F7 needs ${REQUIRED_DAYS}.`;
save(log);

const now = log.days.filter((d) => d.counts).length;
console.log(`${today}: patch ${patchOk ? "intact" : "BROKEN"}, +${callsDelta} gateway calls, ${list.length} bots`);
console.log(counts ? "  counts toward the soak" : `  does NOT count — ${why}`);
console.log(`\nsoak: ${now}/${REQUIRED_DAYS} qualifying day(s)  → ${LOG.replace(REPO, ".")}`);
if (now >= REQUIRED_DAYS) console.log("F7's daily-use condition is met — the gate can be advanced.");
