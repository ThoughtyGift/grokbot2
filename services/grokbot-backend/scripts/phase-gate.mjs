/**
 * Phase gate — run the current ROADMAP phase's checks; only then advance.
 *
 *   node scripts/phase-gate.mjs              # measure current phase, do not advance
 *   node scripts/phase-gate.mjs --advance    # if green, write next phase to phase-current.json
 *   node scripts/phase-gate.mjs --phase P1   # override
 *
 * If the local app is on CDP 9222 and the phase added a user-visible surface, Gate B
 * scripts run against it. Gate C (original on 9333) is skipped with a reason when missing.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { recordScript } from "./run-history.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const RUNS = join(REPO, "docs", "parity-runs");
const STATE = join(RUNS, "phase-current.json");
const BACKEND = join(REPO, "services", "grokbot-backend");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ADVANCE = process.argv.includes("--advance");
/**
 * P0–P8 are the archived "FE native" programme (docs/history/ROADMAP-native-fe.archived.md). P0–P6 shipped;
 * P7 stopped where it stood; P8 was deleted when the programme pivoted on 2026-08-20.
 *
 * F0–F7 are the live programme: grokbot2 serving the PATCHED STOCK CLIENT (ROADMAP.md). They come
 * after P8 in this list so `--advance` walks forward into them rather than dead-ending, and so a
 * pointer left on an old P-phase still resolves.
 */
const ORDER = ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"];
const HUMAN = join(REPO, "docs", "state", "phase-state.json");

const loadState = () => {
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { phase: "P0" }; }
};
const normalizePhase = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim().toUpperCase();
  if (/^\d+$/.test(s)) return `P${s}`;
  return s.startsWith("P") ? s : s;
};
const saved = loadState();
const requested = normalizePhase(arg("--phase", ""));
const pointerPhase = normalizePhase(saved.phase) || "P0";
const current = requested || pointerPhase;
const GATE_RUN = String(Date.now()).slice(-6);

const isUp = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
};

/**
 * Chạy một script của gate và GHI LẠI dấu vết.
 *
 * Trước đây hàm này chỉ trả về pass/fail + exit code, còn chi tiết thì đi ra stdout rồi trôi mất.
 * Ngày 2026-08-22 hai lượt đỏ mất bằng chứng đúng theo kiểu đó (`e2e-app-full`, rồi `e2e-avatar-ui`),
 * và bản ghi `phase-gate-F*.json` thì bị lượt xanh sau ghi đè.
 *
 * Ghi ở ĐÂY, không phải trong từng script: gate chạy hàng chục bài viết theo nhiều kiểu khác nhau,
 * nên một chỗ đọc stdout phủ được tất cả — kể cả những bài viết sau này.
 */
const runNode = (script, extra = []) => {
  const file = join(HERE, script);
  if (!existsSync(file)) {
    const missing = { script, status: "fail", detail: "file not found" };
    recordScript(script, { phase: current, status: "fail", exitCode: null, stdout: "file not found", args: extra });
    return missing;
  }
  console.log(`── ${script} ${extra.join(" ")}`);
  const r = spawnSync(process.execPath, [file, ...extra], { cwd: BACKEND, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  const status = r.status === 0 ? "pass" : "fail";
  // stderr đi kèm: một script chết vì ngoại lệ không in dòng "FAIL" nào cả.
  recordScript(script, { phase: current, status, exitCode: r.status, stdout: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, args: extra });
  return { script, status, exitCode: r.status };
};

/**
 * The one check that looks at the screen, in every phase from P2 on.
 *
 * P2 was measured GREEN by an HTTP-only gate after the command table and the SSE hub moved into
 * `@grokbot2/cursor-acl` — correct bytes, and not one pixel examined. Running the app driver
 * caught three reds the wire checks could not see (parity.md §2ag). Its two remaining gaps are on
 * its own KNOWN_OPEN list, so this makes the gate red for NEW breakage, not for recorded gaps.
 *
 * Costs ~90s and needs the app on CDP 9222, which is exactly the condition `e2eIfLocal` already
 * guards: with no app, it is skipped with a reason rather than silently passed.
 */
const UI = "e2e-app-full.mjs";

const GATES = {
  P0: {
    e2eIfLocal: true,
    extraE2e: ["e2e-ui.mjs"],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "contract-test.mjs", args: ["--only", "routes,auth,commands,channels", "--plan", "P0", "--run", GATE_RUN] },
      { script: "extract-contract.mjs", args: ["--check"] },
      { script: "e2e-run.mjs", args: ["--regression", "--no-goc"] },
    ],
  },
  P1: {
    e2eIfLocal: true,
    extraE2e: ["e2e-ordered-sequence.mjs"],
    steps: () => [
      { script: "contract-test.mjs", args: ["--only", "channels,commands"] },
      { script: "extract-contract.mjs", args: ["--check"] },
    ],
  },
  P2: {
    e2eIfLocal: true,
    extraE2e: ["e2e-avatar.mjs", UI],
    steps: () => [
      { script: "contract-test.mjs", args: ["--only", "routes,auth,channels"] },
    ],
  },
  P3: {
    e2eIfLocal: true,
    extraE2e: ["e2e-standing-permission.mjs", UI],
    steps: () => [
      { script: "contract-test.mjs", args: ["--only", "commands"] },
      { script: "verify-sqlite.mjs" },
    ],
  },
  P4: {
    e2eIfLocal: true,
    // HTTP exit criteria must run even when the app is not on CDP 9222. Skipping them with
    // "no local app" is how P4 once advanced to P5 without abort/pool-failure/ordered-sequence.
    httpE2e: ["e2e-abort-swallows-tool.mjs", "e2e-pool-failure.mjs", "e2e-runtime-down.mjs", "e2e-ordered-sequence.mjs"],
    extraE2e: [UI],
    steps: () => [
      { script: "verify-runtime.mjs" },
      { script: "measure-p4-latency.mjs", args: ["5"] },
    ],
  },
  P5: {
    e2eIfLocal: true,
    // HTTP exit must run even when CDP 9222 is down (same lesson as P4). box-push / handoff /
    // computer-down spawn their own computer+BFF; verify-computer hits live :8790.
    httpE2e: ["e2e-computer-down.mjs", "e2e-handoff.mjs", "e2e-box-push.mjs"],
    extraE2e: [UI],
    steps: () => [
      { script: "verify-computer.mjs" },
    ],
  },
  P6: {
    e2eIfLocal: true,
    httpE2e: ["e2e-ops-down.mjs", "e2e-cron.mjs", "e2e-webhook-ops.mjs"],
    extraE2e: ["e2e-routine.mjs", UI],
    steps: () => [
      { script: "verify-ops.mjs" },
      { script: "measure-p6-latency.mjs" },
    ],
  },
  P7: {
    e2eIfLocal: true,
    httpE2e: ["e2e-native.mjs"],
    extraE2e: [UI],
    steps: () => [
      { script: "verify-native.mjs" },
    ],
  },
  P8: {
    e2eIfLocal: true,
    extraE2e: ["e2e-app-full.mjs"],
    steps: () => [],
  },

  // ─────────── FE-gốc programme (ROADMAP.md) ───────────
  //
  // From F3 on, `requireLocalApp` flips Gate B from "skipped with a reason" to RED. Under this
  // programme the patched stock client is the only production surface, so a gate that passes
  // without ever launching it is measuring the wrong thing.

  F0: {
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "extract-contract.mjs", args: ["--check"] },
    ],
  },
  F1: {
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "verify-client-patch.mjs" },
    ],
  },
  F2: {
    e2eIfLocal: true,
    requireLocalApp: true,
    extraE2e: [UI],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "verify-client-patch.mjs" },
    ],
  },
  F3: {
    e2eIfLocal: true,
    requireLocalApp: true,
    httpE2e: ["e2e-ordered-sequence.mjs", "e2e-standing-permission.mjs", "e2e-abort-swallows-tool.mjs", "e2e-pool-failure.mjs"],
    extraE2e: [UI],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "verify-client-patch.mjs" },
    ],
  },
  F4: {
    e2eIfLocal: true,
    requireLocalApp: true,
    extraE2e: [UI],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "contract-test.mjs", args: ["--plan", "F4", "--run", GATE_RUN] },
    ],
  },
  F5: {
    e2eIfLocal: true,
    requireLocalApp: true,
    extraE2e: [UI],
    steps: () => [{ script: "parity-report.mjs" }],
  },
  F6: {
    e2eIfLocal: true,
    requireLocalApp: true,
    extraE2e: [UI],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "verify-client-patch.mjs" },
    ],
  },
  F7: {
    e2eIfLocal: true,
    requireLocalApp: true,
    // Avatar chạy qua HTTP nên không cần app trên CDP. Nó ở đây vì avatar là chỗ duy nhất mà
    // FE fallback (`/v1`) và client hãng (`/gw/avatars`) ghi vào cùng một chỗ lưu — hỏng một
    // đường là hỏng cả hai giao diện, và không nhìn ra được bằng mắt.
    httpE2e: ['e2e-avatar.mjs', 'e2e-reaction.mjs --no-ui'],
    extraE2e: [UI],
    steps: () => [
      { script: "parity-report.mjs" },
      { script: "verify-client-patch.mjs" },
    ],
    /**
     * Exit của F7 là THỜI GIAN, và nó phải nằm trong gate: không có điều kiện này thì gate xanh vì
     * code xanh, và `--advance` đóng cả chương trình F với soak 1/5.
     *
     * Chạy SAU CÙNG, không phải như một step. Một step đỏ làm gate dừng ngay, nên đặt soak vào
     * `steps` sẽ khiến bốn ngày tới gate không đo code nữa — một điều kiện thời gian chưa tới hạn
     * lại che mất chính thứ nó phải bảo vệ.
     */
    requireSoak: true,
  },
};

const plan = GATES[current];
if (!plan) {
  console.error(`unknown phase ${current}`);
  process.exit(2);
}

const backendUp = await isUp("http://127.0.0.1:8788/health");
const localApp = await isUp("http://127.0.0.1:9222/json/version");
console.log(`phase ${current}  backend=${backendUp ? "up" : "DOWN"}  localCDP9222=${localApp ? "up" : "down"}\n`);

const SPAWNED_HTTP = new Set([
  "e2e-pool-failure.mjs",
  "e2e-runtime-down.mjs",
  "e2e-computer-down.mjs",
  "e2e-handoff.mjs",
  "e2e-box-push.mjs",
  "e2e-ops-down.mjs",
  "e2e-cron.mjs",
  "e2e-webhook-ops.mjs",
  "e2e-native.mjs",
]);
if (!backendUp && (
  plan.steps().some((s) => s.script === "contract-test.mjs")
  || (plan.httpE2e ?? []).some((s) => !SPAWNED_HTTP.has(s.split(" ")[0]))
)) {
  console.error("backend :8788 is required for this phase gate");
  process.exit(2);
}

if (current === "P5") {
  const computerUp = await isUp("http://127.0.0.1:8790/health");
  console.log(`computer :8790=${computerUp ? "up" : "DOWN"}`);
  if (!computerUp && plan.steps().some((s) => s.script === "verify-computer.mjs")) {
    console.error("computer :8790 is required for P5 verify-computer (pnpm backend starts it)");
    process.exit(2);
  }
}

if (current === "P6") {
  const opsUp = await isUp("http://127.0.0.1:8791/health");
  console.log(`ops :8791=${opsUp ? "up" : "DOWN"}`);
  if (!opsUp && plan.steps().some((s) => s.script === "verify-ops.mjs")) {
    console.error("ops :8791 is required for P6 verify-ops (pnpm backend starts it)");
    process.exit(2);
  }
}

if (current === "P7") {
  if (!backendUp && plan.steps().some((s) => s.script === "verify-native.mjs")) {
    console.error("backend :8788 is required for P7 verify-native (pnpm backend starts it)");
    process.exit(2);
  }
}

const results = [];
for (const step of plan.steps()) {
  results.push(runNode(step.script, step.args ?? []));
  if (results.at(-1).status === "fail") break;
}

if (results.every((r) => r.status === "pass")) {
  for (const entry of plan.httpE2e ?? []) {
    // Một entry được phép mang cờ ("e2e-reaction.mjs --no-ui"): phần UI của bài đó cần Vite
    // :5173, mà không phase nào phụ thuộc FE fallback — nên gate chỉ chạy phần HTTP.
    const [script, ...args] = entry.split(" ");
    results.push(runNode(script, args));
    if (results.at(-1).status === "fail") break;
  }
}

if (results.every((r) => r.status === "pass") && plan.e2eIfLocal) {
  if (!localApp && plan.requireLocalApp) {
    // The FE-gốc programme (F2+) has exactly one production surface: the patched stock client.
    // "Skipped with a reason" was honest while a native FE was the goal; here it would mean the
    // gate never looked at the product. So this is RED, and the fix is to launch the app.
    results.push({ script: "local-e2e", status: "fail", detail: "CDP 9222 down — Gate B is REQUIRED from F2 on (run: pnpm dev:app)" });
    /*
     * Ghi cả dòng này. Nó KHÔNG đi qua `runNode()` nên nhật ký bỏ sót đúng bước đã làm gate đỏ —
     * đo được 2026-08-22: một lượt gate đỏ vì "CDP 9222 down" mà nhật ký chỉ toàn dòng xanh. Một
     * nhật ký bỏ qua đúng cái hỏng thì tệ hơn không có, vì nó trông như đầy đủ.
     */
    recordScript("local-e2e", { phase: current, status: "fail", exitCode: null, stdout: "FAIL CDP 9222 down — Gate B is REQUIRED from F2 on" });
    console.log("Gate B is required for this phase: the patched stock client must be on :9222.\n");
  } else if (!localApp) {
    results.push({ script: "local-e2e", status: "skipped", detail: "CDP 9222 down — Gate B skipped WITH A REASON" });
    recordScript("local-e2e", { phase: current, status: "skipped", exitCode: null, stdout: "CDP 9222 down — Gate B skipped WITH A REASON" });
    console.log("note: local Grok Bot is not on :9222 — E2E skipped with a reason, not silently.\n");
  } else {
    for (const script of plan.extraE2e ?? []) {
      results.push(runNode(script));
      if (results.at(-1).status === "fail") break;
    }
  }
}

/*
 * Điều kiện thời gian đi cuối: mọi phép đo code đã chạy xong rồi mới hỏi "đã dùng đủ ngày chưa".
 * Nhờ vậy trong lúc chờ đủ ngày, gate vẫn phát hiện được regression thay vì đỏ vì một lý do khác.
 */
if (plan.requireSoak) {
  results.push(runNode("soak-day.mjs", ["--gate"]));
}

const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skipped");
const pass = failed.length === 0 && results.some((r) => r.status === "pass" || r.status === "skipped");
const next = ORDER[ORDER.indexOf(current) + 1] ?? null;

mkdirSync(RUNS, { recursive: true });
const report = {
  phase: current,
  pass,
  next,
  backendUp,
  localApp,
  results,
  advanced: false,
};
const pointerNote = "pointer for pnpm phase:gate / phase:advance. Advance only when the gate is green.";

/**
 * `guard` is the human's line, not the gate's — a standing "do not advance past this, and here is
 * why" that outlives a run. Every previous version rewrote `note` wholesale, which silently ate a
 * P7 soak warning that said in as many words "do not --advance". Carry it forward instead.
 */
let priorGuard;
try { priorGuard = JSON.parse(readFileSync(STATE, "utf8")).guard; } catch { /* first write */ }
const withGuard = (o) => (priorGuard ? { ...o, guard: priorGuard } : o);

if (ADVANCE && requested && requested !== pointerPhase) {
  console.error(`--advance with --phase ${requested} would move a different pointer (${pointerPhase}). Measure first, then --advance without --phase.`);
  process.exit(2);
}

if (ADVANCE && pass && next) {
  writeFileSync(STATE, `${JSON.stringify(withGuard({ phase: next, previous: current, advancedAt: new Date().toISOString(), note: pointerNote }), null, 2)}\n`);
  report.advanced = true;
  report.phaseNow = next;
} else {
  // `--phase F3` is a measurement. It must not persist F3 as the official pointer.
  const keepPass = requested && requested !== pointerPhase ? saved.lastGatePass : pass;
  writeFileSync(STATE, `${JSON.stringify(withGuard({
    phase: pointerPhase,
    lastGatePass: keepPass,
    lastMeasured: { phase: current, pass, at: new Date().toISOString() },
    at: new Date().toISOString(),
    note: pointerNote,
  }), null, 2)}\n`);
}
writeFileSync(join(RUNS, `phase-gate-${current}.json`), `${JSON.stringify(report, null, 2)}\n`);

let human = {};
try { human = JSON.parse(readFileSync(HUMAN, "utf8")); } catch { /* first write */ }
writeFileSync(HUMAN, `${JSON.stringify({
  ...human,
  currentPhase: report.phaseNow ?? pointerPhase,
  pointerFile: "docs/parity-runs/phase-current.json",
  lastRun: { phase: current, pass, advanced: report.advanced, at: new Date().toISOString() },
}, null, 2)}\n`);

console.log("─────────── phase gate ───────────");
for (const r of results) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.script}${r.detail ? `  (${r.detail})` : ""}`);
if (skipped.length) console.log(`skipped ${skipped.length} (reason recorded)`);
if (pass && ADVANCE && next) console.log(`ADVANCED ${current} → ${next}`);
else if (pass) console.log(`GREEN ${current}. Next is ${next ?? "done"}. Re-run with --advance to move the pointer.`);
else console.log(`RED ${current}. Do not start ${next}.`);
process.exit(pass ? 0 : 1);
