/**
 * Tính năng 1 của 0.29, chạy trên backend mình: bot mẹ TỰ dựng dàn bot con — mỗi con một
 * description (SOP) — rồi TỰ mở phòng chung cho cả dàn.
 *
 * Kịch bản lấy từ B2 (docs/extracted/chat-goc-0.29.md): Test Clone của hãng sinh 5 bot Shopee
 * trong 6 giây, con nào cũng mang SOP đầy đủ trong ô Description, rồi 7 giây sau mở nhóm
 * Shopee Ops chứa cả dàn. Ở đây thu nhỏ còn 2 bot + 1 phòng, và đo đúng ba dấu vết đó trên roster.
 *
 *   node services/grokbot-backend/scripts/e2e-team-build.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18886;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-team-"));
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

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 300)}`}`);
};
const roster = () => gw("listAgents").then((r) => r.agents ?? r ?? []);

const me = (await gw("createAgent", { name: "Quan ly" })).agent;
await gw("sendPrompt", {
  agentId: me.id,
  content:
    "Dựng giúp mình một dàn Shopee: tạo 2 bot — 'Kho E2E' (SOP: theo dõi tồn kho, ưu tiên đơn Hỏa Tốc, " +
    "cutoff 18:00) và 'CS E2E' (SOP: trả Shopee Chat trong 2 phút, cấm kêu khách hủy đơn) — nhớ ghi SOP " +
    "vào description của từng bot, rồi mở phòng chung tên 'Ops E2E' gồm cả hai bot đó.",
});

// Bot mẹ cần vài lượt tool, và create_agent/create_group cố ý KHÔNG auto-approve — chúng đổi
// sidebar của người dùng. Ở đây đóng vai người dùng bấm Allow trên từng thẻ, như trong app thật.
let rows = [];
const seen = new Set();
for (let i = 0; i < 90; i += 1) {
  await wait(2000);
  const entries = (await gw("getAgentTranscriptTail", { id: me.id, limit: 200 })).entries ?? [];
  for (const card of entries.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending")) {
    const rid = card.message.ask.requestId;
    if (seen.has(rid)) continue;
    seen.add(rid);
    await gw("resolveLocalToolPermission", { requestId: rid, agentId: me.id, resolution: "allow-once" });
  }
  rows = await roster();
  const names = rows.map((r) => r.name);
  if (["Kho E2E", "CS E2E", "Ops E2E"].every((n) => names.includes(n))) break;
}
// Uu tien ban ghi NHOM khi trung ten — model co the vua create_agent vua create_group cung mot ten.
const byName = (n) => rows.find((r) => r.name === n && r.isGroup) ?? rows.find((r) => r.name === n);
const kho = byName("Kho E2E"), cs = byName("CS E2E"), ops = byName("Ops E2E");

check("bot mẹ tạo đủ 2 bot con", Boolean(kho && cs), JSON.stringify(rows.map((r) => r.name)));
check("mỗi bot con mang description (SOP) không rỗng",
  Boolean((kho?.description ?? "").trim() && (cs?.description ?? "").trim()),
  JSON.stringify({ kho: kho?.description, cs: cs?.description }));
check("description nhắc đúng vai (tồn kho / chat)",
  /tồn kho|ton kho/i.test(kho?.description ?? "") && /chat/i.test(cs?.description ?? ""),
  JSON.stringify({ kho: kho?.description, cs: cs?.description }));
check("phòng chung được mở và là NHÓM", ops?.isGroup === true, JSON.stringify(ops));
check("phòng chứa đúng 2 thành viên",
  Array.isArray(ops?.memberIds) && ops.memberIds.length === 2 &&
  ops.memberIds.includes(kho?.id) && ops.memberIds.includes(cs?.id),
  JSON.stringify(ops?.memberIds));

if (kho?.description) console.log(`      Kho E2E: ${kho.description.replace(/\s+/g, " ").slice(0, 110)}`);
if (cs?.description) console.log(`      CS E2E : ${cs.description.replace(/\s+/g, " ").slice(0, 110)}`);

console.log(`\n${pass} ok, ${fail} fail`);
// Soi bang chung: model da goi nhung tool nao, voi doi so gi.
const trail = (await gw("getAgentTranscriptTail", { id: me.id, limit: 200 })).entries ?? [];
for (const e of trail.filter((x) => x.kind === "tool-call"))
  console.log(`      TOOL ${e.name} ${String(e.rawArgs ?? "").slice(0, 140)} => ${e.status} ${String(e.result ?? "").slice(0, 90)}`);
console.log(`      roster: ${JSON.stringify(rows.map((r) => ({ name: r.name, isGroup: r.isGroup, m: (r.memberIds ?? []).length })))}`);
await stop();
process.exit(fail ? 1 : 0);
