/**
 * Phát lại kịch bản B2 trên backend MÌNH — cùng đầu vào với app gốc, ghi đầu ra hai bên cạnh nhau.
 *
 * Nguồn: docs/extracted/kich-ban-b2.json (xuất bởi export-vendor-chat.mjs). Mỗi bot được dựng lại
 * với ĐÚNG tên + description của app gốc (persona vào lời nhắc hệ thống từ 7.4.2), nhóm dựng lại
 * đúng thành viên, rồi từng tin người dùng được gửi theo thứ tự thật.
 *
 * Thẻ xin quyền KHÔNG được tự bấm Allow: một lệnh shell sinh từ kịch bản người khác không nên chạy
 * thật trên box chung. Thẻ đang chờ CHÍNH LÀ kết quả ghi nhận — nó cho thấy bot mình chọn cùng
 * loại hành động với bot gốc, không cần thi hành.
 *
 * Kết quả: docs/parity-runs/b2-replay-<stamp>.md — bảng so từng cặp, kèm hai thước đo thô:
 *   - trả lời: bot mình có nói gì đó (text/widget/thẻ quyền) không
 *   - cùng nhịp tương tác: app gốc có widget/thẻ quyền thì bên mình cũng có (và ngược lại)
 * Nội dung chữ thì người đọc tự so — hai model khác nhau không bao giờ trùng câu.
 *
 *   node services/grokbot-backend/scripts/e2e-replay-b2.mjs [--only "Test Clone"] [--max N]
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ONLY = argOf("--only", "");
const MAX = Number(argOf("--max", "0")) || Infinity;

const PORT = 18887;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-replay-"));
const procs = [];
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid || p.exitCode !== null || p.killed) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const stop = async () => { for (const p of procs) await killTree(p); await rm(root, { recursive: true, force: true }); };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);

const data = JSON.parse(await readFile("docs/extracted/kich-ban-b2.json", "utf8"));

try {
  await fetch(`http://127.0.0.1:${PORT}/gw/health`, { signal: AbortSignal.timeout(1200) });
  console.error(`port ${PORT} already in use`); process.exit(1);
} catch { /* expected */ }

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${PORT}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) }).then((r) => r.json());
const entriesOf = (id) => gw("getAgentTranscriptTail", { id, limit: 300 }).then((r) => r.entries ?? []);

// ── Dựng lại dàn bot đúng như app gốc ───────────────────────────────────────────────────────────
const idOf = new Map(); // tên bot gốc -> id bên mình
for (const sc of data.scenarios.filter((x) => !x.isGroup)) {
  const a = (await gw("createAgent", { name: sc.bot, description: sc.description })).agent;
  idOf.set(sc.bot, a.id);
}
for (const sc of data.scenarios.filter((x) => x.isGroup)) {
  const memberAgentIds = sc.memberNames.map((n) => idOf.get(n)).filter(Boolean);
  const g = (await gw("createGroup", { name: sc.bot, memberAgentIds })).agent;
  idOf.set(sc.bot, g.id);
  console.log(`  phòng ${sc.bot}: ${memberAgentIds.length}/${sc.memberNames.length} thành viên`);
}

// ── Thu gọn một entry của MÌNH về cùng từ vựng với expected ────────────────────────────────────
function oursOf(list) {
  const out = [];
  for (const e of list) {
    if (e.kind === "message" && e.role === "assistant" && e.toAgent) out.push({ kind: "message_agent", to: e.toAgent.name, text: e.content ?? "" });
    else if (e.kind === "send-message") {
      const msg = e.message ?? {};
      if (msg.type === "text" && (msg.content ?? "").trim() && !e.streaming) out.push({ kind: "text", author: e.author?.name ?? null, text: msg.content });
      else if (msg.type === "widget") out.push({ kind: "widget", prompt: msg.widget?.prompt ?? "", options: (msg.widget?.options ?? []).map((o) => o.label) });
      else if (msg.type === "attachment") out.push({ kind: "attachment", fileName: msg.file_name ?? "" });
      else if (msg.type === "local-tool-permission") out.push({ kind: "permission", action: msg.ask?.action ?? "", target: String(msg.ask?.target ?? "").slice(0, 200), status: msg.ask?.status });
    } else if (e.kind === "tool-call") out.push({ kind: "tool", name: e.name, status: e.status });
  }
  return out;
}
const interactive = (arr) => arr.some((x) => x.kind === "widget" || x.kind === "permission");
const brief = (x) => {
  if (x.kind === "text") return `${x.author ? x.author + ": " : ""}${String(x.text).replace(/[ ]+/g, " ").slice(0, 160)}`;
  if (x.kind === "widget") return `[widget] ${x.prompt} — ${(x.options ?? []).join(" / ")}`;
  if (x.kind === "permission") return `[xin quyền] ${x.action}: ${String(x.target).slice(0, 120)}`;
  if (x.kind === "attachment") return `[đính kèm] ${x.fileName}`;
  if (x.kind === "message_agent") return `[nhắn ${x.to}] ${String(x.text).slice(0, 120)}`;
  if (x.kind === "from_agent") return `[từ ${x.from}] ${String(x.text).slice(0, 120)}`;
  if (x.kind === "tool") return `[tool ${x.name}] ${x.status}`;
  return JSON.stringify(x).slice(0, 120);
};

// ── Phát lại ────────────────────────────────────────────────────────────────────────────────────
const report = [];
report.push("# Phát lại kịch bản B2 trên backend mình");
report.push("");
report.push(`> Chạy ${new Date().toISOString()} từ kich-ban-b2.json (xuất ${new Date(data.exportedAt).toISOString()}).`);
report.push("> Thẻ xin quyền không được tự Allow — thẻ đang chờ là kết quả ghi nhận, không thi hành lệnh của kịch bản trên box thật.");
report.push("");
let nCases = 0, nAnswered = 0, nRhythm = 0, nRhythmApplicable = 0;

for (const sc of data.scenarios) {
  if (ONLY && sc.bot !== ONLY) continue;
  if (!sc.cases.length) continue;
  const agentId = idOf.get(sc.bot);
  if (!agentId) { report.push(`## ${sc.bot} — KHÔNG dựng được bot, bỏ qua`); continue; }
  report.push(`## ${sc.bot}${sc.isGroup ? ` (nhóm: ${sc.memberNames.join(", ")})` : ""}`);
  report.push("");
  for (const [ci, c] of sc.cases.entries()) {
    if (nCases >= MAX) break;
    if (!String(c.input ?? "").trim()) continue;
    nCases += 1;
    const before = (await entriesOf(agentId)).length;
    await gw("sendPrompt", { agentId, content: c.input });
    // Chờ lượt lắng: không còn streaming, đã có gì đó (text/widget/thẻ), và đứng yên 2 nhịp.
    let ours = [], stable = 0, lastLen = -1;
    const deadline = Date.now() + (sc.isGroup ? 240_000 : 100_000);
    while (Date.now() < deadline) {
      await wait(2500);
      const now = (await entriesOf(agentId)).slice(before);
      const streaming = now.some((e) => e.streaming);
      ours = oursOf(now);
      const settled = !streaming && ours.length > 0;
      if (settled && now.length === lastLen) { stable += 1; if (stable >= 2) break; }
      else stable = 0;
      lastLen = now.length;
    }
    const answered = ours.length > 0;
    nAnswered += answered ? 1 : 0;
    const vendorInteractive = interactive(c.expected);
    if (vendorInteractive) { nRhythmApplicable += 1; if (interactive(ours)) nRhythm += 1; }
    console.log(`  [${sc.bot}] case ${ci + 1}/${sc.cases.length} ${answered ? "ok" : "IM LẶNG"} (${ours.length} output)`);
    report.push(`### ${ci + 1}. ⟵ ${String(c.input).replace(/[ ]+/g, " ").slice(0, 200)}`);
    report.push("");
    report.push("| app gốc | app mình |");
    report.push("|---|---|");
    // Dấu gạch đứng phá bảng markdown — thay bằng ¦ trong nội dung ô.
    const esc = (t) => String(t).split("|").join("¦");
    const L = c.expected.map(brief), R = ours.map(brief);
    for (let i = 0; i < Math.max(L.length, R.length); i += 1)
      report.push(`| ${esc(L[i] ?? "")} | ${esc(R[i] ?? "")} |`);
    report.push("");
  }
}

report.push("---");
report.push("");
report.push(`**Tổng:** ${nCases} case · bot mình trả lời ${nAnswered}/${nCases} · cùng nhịp tương tác ${nRhythm}/${nRhythmApplicable} (case app gốc có widget/thẻ quyền).`);
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
const OUTP = `docs/parity-runs/b2-replay-${stamp}.md`;
await mkdir("docs/parity-runs", { recursive: true });
await writeFile(OUTP, report.join(NL), "utf8");
console.log(`${NL}đã ghi ${OUTP}`);
console.log(`tổng: ${nCases} case, trả lời ${nAnswered}/${nCases}, cùng nhịp ${nRhythm}/${nRhythmApplicable}`);
await stop();
process.exit(0);
