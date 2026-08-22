/**
 * The orchestrator — run a plan's gates in order and stop at the first red one.
 *
 * The loop in docs/history/execution-roadmap.md §2 is only followed if it is cheaper to run than to skip.
 * Four scripts with four different invocations is not; one command is.
 *
 *   node scripts/e2e-run.mjs --plan P2
 *   node scripts/e2e-run.mjs --plan P2 --run 3
 *   node scripts/e2e-run.mjs --plan P2 --no-goc      # skip Gate C when the original is not up
 *   node scripts/e2e-run.mjs --regression            # every chocked plan's gates, in order
 *
 * Why it stops at the first failure rather than running everything and summarising: a red Gate A
 * means the protocol shape is wrong, and every Gate B assertion after it would then be testing
 * behaviour built on a shape we already know is incorrect. Those cascading failures are noise, and
 * noise is what made the previous ad-hoc harness unreadable.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const RUNS = join(REPO, "docs", "parity-runs");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PLAN = arg("--plan", "P2");
const RUN = Number(arg("--run", "1"));
const NO_GOC = process.argv.includes("--no-goc");
const REGRESSION = process.argv.includes("--regression");

/**
 * Which gates each plan owns.
 *
 * A plan with no Gate C entry is not an oversight — P0 and P1 add no user-visible surface, and the
 * roadmap asks for "skipped with a reason" rather than a blank. P4's gates are kept even though the
 * bug is fixed: presence broke silently six times and can break again, so its checks became
 * permanent regression rather than being retired with the plan.
 */
const PLANS = {
  P0: [
    { gate: "A", script: "contract-test.mjs", args: ["--only", "auth,routes"] },
  ],
  P1: [
    // P1 built the judge; it did not change the backend. So its permanent check is that the
    // extractor still agrees with the committed contract — drift means the app updated and every
    // downstream gate is now measuring against a stale reference.
    //
    // Running the full contract test here was wrong: it failed on the 18 unhandled commands, which
    // P1 never claimed to fix. P1's one-time acceptance was reproducing the hand-measured numbers
    // (4 routes, 5 health fields, 18 + 9 commands); that is a milestone, not a regression check.
    { gate: "A", script: "extract-contract.mjs", args: ["--check"] },
  ],
  P2: [
    // Scoped to what P2 owns. Running the full contract test here made P2 stop on the 18 unhandled
    // gateway commands, which are P3's job — a plan whose gate fails on the NEXT plan's work can
    // never go green, and a gate that can never go green stops being read.
    { gate: "A", script: "contract-test.mjs", args: ["--only", "routes,auth,channels"] },
    { gate: "B", script: "e2e-avatar.mjs", args: [] },
    { gate: "C", script: "parity-gate.mjs", args: [], needsGoc: true },
  ],
  P3: [
    { gate: "A", script: "contract-test.mjs", args: ["--only", "commands"] },
    { gate: "C", script: "parity-gate.mjs", args: [], needsGoc: true },
  ],
  P4: [
    { gate: "B", script: "probe-indicator.cjs", args: [], optional: true,
      why: "avatar motion: hash the avatar region across a turn. Kept as permanent regression." },
  ],
};

/** Plans already closed, replayed by --regression in the order they were closed. */
const CLOSED = ["P0", "P1", "P2", "P3"];

const isUp = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
};

const gocAvailable = NO_GOC ? false : await isUp("http://127.0.0.1:9333/json/version");
if (!NO_GOC && !gocAvailable) {
  console.log("note: the original app is not on :9333 — Gate C will be skipped WITH A REASON, not silently.\n");
}

const runOne = (plan, step, runNo) => {
  const script = join(HERE, step.script);
  if (!existsSync(script)) {
    return { ...step, plan, status: "missing", detail: `${step.script} does not exist` };
  }
  if (step.needsGoc && !gocAvailable) {
    return { ...step, plan, status: "skipped", detail: "the original app is not running on :9333" };
  }
  const runner = step.script.endsWith(".cjs") ? "node" : "node";
  const args = [script, ...step.args, "--plan", plan, "--run", String(runNo)];
  console.log(`── ${plan} Gate ${step.gate}  ${step.script} ${step.args.join(" ")}`);
  const r = spawnSync(runner, args, { cwd: join(REPO, "services", "grokbot-backend"), encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(out.split("\n").map((l) => (l ? `   ${l}` : l)).join("\n"));
  if (!out.endsWith("\n")) console.log("");
  return {
    ...step,
    plan,
    status: r.status === 0 ? "pass" : step.optional ? "warn" : "fail",
    exitCode: r.status,
  };
};

const plansToRun = REGRESSION ? [...CLOSED, PLAN].filter((p, i, a) => a.indexOf(p) === i) : [PLAN];
const results = [];
let stopped = null;

outer:
for (const plan of plansToRun) {
  const steps = PLANS[plan];
  if (!steps) {
    console.log(`no gates defined for ${plan} — add it to PLANS in e2e-run.mjs`);
    continue;
  }
  for (const step of steps) {
    const res = runOne(plan, step, RUN);
    results.push(res);
    if (res.status === "fail") {
      stopped = res;
      // Everything after a red gate would test behaviour built on a shape already known wrong.
      break outer;
    }
  }
}

let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); } catch { /* not a repo */ }

const summary = {
  plan: PLAN, run: RUN, backendCommit: commit,
  regression: REGRESSION,
  gocAvailable,
  gates: results.map(({ plan, gate, script, status, detail, exitCode }) => ({ plan, gate, script, status, ...(detail ? { detail } : {}), ...(exitCode != null ? { exitCode } : {}) })),
  stoppedAt: stopped ? `${stopped.plan} Gate ${stopped.gate}` : null,
  pass: !stopped,
};

mkdirSync(RUNS, { recursive: true });
const file = join(RUNS, `${PLAN}-run-${String(RUN).padStart(2, "0")}-summary.json`);
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);

console.log("\n─────────── summary ───────────");
for (const g of summary.gates) {
  const mark = { pass: "PASS", fail: "FAIL", skipped: "skip", warn: "warn", missing: "MISS" }[g.status];
  console.log(`${mark}  ${g.plan} Gate ${g.gate}  ${g.script}${g.detail ? `  (${g.detail})` : ""}`);
}
if (stopped) {
  console.log(`\nstopped at ${summary.stoppedAt}. Record the mismatches in docs/parity-runs/, classify each`);
  console.log("as loai 1 (protocol) / 2 (surface) / 3 (capability), fix, and re-run with --run N+1.");
  console.log("Three rounds on the same gate means stop guessing and write a new measurement instead.");
} else {
  console.log("\nall gates green.");
}
console.log(`\nwrote ${file}`);
process.exit(stopped ? 1 : 0);
