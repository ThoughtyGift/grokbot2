/**
 * X5.1 · X5.2 · X5.5 — routine, tìm bot, danh sách subagent.
 *
 *   node scripts/e2e-routines.mjs
 *
 * Bốn điều đáng kiểm hơn là "route trả 200":
 *   · lịch KHÔNG ĐỌC ĐƯỢC phải bị từ chối ngay ở biên — nhận rồi im lặng không chạy thì tệ hơn;
 *   · routine của bot A không được sửa/xoá qua đường bot B;
 *   · `runs` luôn là mảng, kể cả routine vừa tạo (ở client hãng, biểu tượng trạng thái đọc
 *     `runs[0]?.status` không kiểm tra gì — thiếu `runs` là vỡ cả panel bên phải);
 *   · tìm kiếm phải nói VÌ SAO khớp: theo tên hay theo nội dung transcript.
 */
import { spawn } from "node:child_process";
import { recordRun } from "./run-history.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8811);
process.on("exit", () => { try { killPort(PORT); } catch { /* không có gì để dọn */ } });
const API = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-routines-"));

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

try {
  await fetch(`${API}/v1/health`, { signal: AbortSignal.timeout(1500) });
  console.log(`cổng ${PORT} đã có tiến trình khác — đóng nó trước.`);
  process.exit(1);
} catch { /* chưa ai nghe */ }

const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT), GROKBOT2_PORT: String(PORT),
    GROKBOT2_AUTH: "enforce",
    GROKBOT2_RUNTIME_URL: "", GROKBOT2_COMPUTER_URL: "", GROKBOT2_OPS_URL: "",
    GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
    GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
    GROKBOT2_GATEWAY_TOKEN: "e2e-routines-token",
    NODE_TEST_CONTEXT: "e2e-routines",
  },
});
const killTree = () => {
  if (child.pid == null || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });

try {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(`${API}/v1/health`)).ok) { up = true; break; } } catch { /* chưa lên */ }
  }
  if (!up) { console.log(`backend không lên được trên ${PORT}:\n${log.slice(-800)}`); process.exit(1); }

  const tok = (await (await fetch(`${API}/v1/session`)).json()).token;
  const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
  const mk = async (name) => (await (await fetch(`${API}/v1/agents`, {
    method: "POST", headers: h, body: JSON.stringify({ name }),
  })).json()).agent;

  const botA = await mk("Bot Lịch");
  const botB = await mk("Bot Khác");
  check("tạo được hai bot để thử", Boolean(botA?.id && botB?.id), `${botA?.id} · ${botB?.id}`);

  const empty = await J(await fetch(`${API}/v1/agents/${botA.id}/routines`, { headers: h }));
  check("bot mới chưa có routine nào",
    empty.status === 200 && Array.isArray(empty.body.routines) && empty.body.routines.length === 0,
    JSON.stringify(empty.body));

  const bad = await J(await fetch(`${API}/v1/agents/${botA.id}/routines`, {
    method: "POST", headers: h,
    body: JSON.stringify({ name: "X", prompt: "Y", schedule: "khi nào rảnh thì chạy" }),
  }));
  check("từ chối lịch không đọc được, ngay ở biên", bad.status === 400, `HTTP ${bad.status} ${JSON.stringify(bad.body)}`);

  const missing = await J(await fetch(`${API}/v1/agents/${botA.id}/routines`, {
    method: "POST", headers: h, body: JSON.stringify({ name: "X", schedule: "0 9 * * *" }),
  }));
  check("thiếu prompt thì 400", missing.status === 400, `HTTP ${missing.status}`);

  const made = await J(await fetch(`${API}/v1/agents/${botA.id}/routines`, {
    method: "POST", headers: h,
    body: JSON.stringify({ name: "Báo cáo sáng", prompt: "Tổng hợp việc hôm qua", schedule: "0 9 * * *" }),
  }));
  const r0 = made.body.routines?.[0];
  check("tạo được routine, trả 201", made.status === 201 && r0?.name === "Báo cáo sáng",
    `HTTP ${made.status} ${JSON.stringify(r0 ?? {})}`);
  check("có scheduleText do backend sinh, FE không phải đoán",
    typeof r0?.scheduleText === "string" && r0.scheduleText.length > 0, r0?.scheduleText);
  check("runs LUÔN là mảng, kể cả routine mới", Array.isArray(r0?.runs), JSON.stringify(r0?.runs));
  check("không lộ từ vựng bên trong (trigger · body)",
    Boolean(r0) && !("trigger" in r0) && !("body" in r0) && "schedule" in r0,
    Object.keys(r0 ?? {}).join(","));

  const off = await J(await fetch(`${API}/v1/agents/${botA.id}/routines/${r0.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ isEnabled: false }),
  }));
  check("tắt được routine", off.status === 200 && off.body.routines[0].isEnabled === false,
    String(off.body.routines?.[0]?.isEnabled));

  const renamed = await J(await fetch(`${API}/v1/agents/${botA.id}/routines/${r0.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ name: "Báo cáo chiều" }),
  }));
  check("đổi tên không làm mất lịch",
    renamed.body.routines[0].name === "Báo cáo chiều" && renamed.body.routines[0].schedule === "0 9 * * *",
    JSON.stringify(renamed.body.routines?.[0]));

  const badPatch = await J(await fetch(`${API}/v1/agents/${botA.id}/routines/${r0.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ schedule: "lúc nào cũng được" }),
  }));
  check("PATCH lịch không đọc được cũng bị từ chối", badPatch.status === 400, `HTTP ${badPatch.status}`);

  const wrongOwner = await J(await fetch(`${API}/v1/agents/${botB.id}/routines/${r0.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ isEnabled: true }),
  }));
  check("routine của bot A không sửa được qua đường bot B", wrongOwner.status === 404, `HTTP ${wrongOwner.status}`);

  const gone = await J(await fetch(`${API}/v1/agents/${botA.id}/routines/${r0.id}`, { method: "DELETE", headers: h }));
  check("xoá được routine", gone.status === 200 && gone.body.routines.length === 0, JSON.stringify(gone.body.routines));

  // ── tìm bot ────────────────────────────────────────────────────────────────
  const byName = await J(await fetch(`${API}/v1/search?q=${encodeURIComponent("Lịch")}`, { headers: h }));
  check("tìm theo tên, và nói rõ vì sao khớp",
    byName.status === 200 && byName.body.hits?.some((x) => x.agentId === botA.id && x.why === "name"),
    JSON.stringify(byName.body.hits));

  const none = await J(await fetch(`${API}/v1/search?q=${encodeURIComponent("khôngcógìtêntrùng")}`, { headers: h }));
  check("không khớp thì trả mảng rỗng, không phải trả hết", none.body.hits?.length === 0, JSON.stringify(none.body.hits));

  const blank = await J(await fetch(`${API}/v1/search?q=`, { headers: h }));
  check("q rỗng thì rỗng, không đổ cả roster ra", blank.body.hits?.length === 0, JSON.stringify(blank.body.hits));

  // ── subagent ───────────────────────────────────────────────────────────────
  const subs = await J(await fetch(`${API}/v1/subagents`, { headers: h }));
  const kinds = subs.body.kinds ?? [];
  check("liệt kê được các loại subagent", subs.status === 200 && kinds.length > 0,
    `${kinds.length} loại: ${kinds.map((k) => k.id).join(", ")}`);
  check("mỗi loại có label và số tool",
    kinds.every((k) => k.label && typeof k.toolCount === "number"), JSON.stringify(kinds[0] ?? {}));

  const noAuth = await fetch(`${API}/v1/subagents`);
  check("không có bearer thì 401", noAuth.status === 401, `HTTP ${noAuth.status}`);
} finally {
  killTree();
}

console.log(`\n${pass} pass, ${fail} fail`);
recordRun("e2e-routines.mjs", results);
process.exit(fail ? 1 : 0);
