/**
 * 7.4.2 — luật lượt nói trong phòng chung, đo trên backend thật với pool thật.
 *
 * Ba luật phải thấy được trong transcript (đối chiếu app gốc 0.29 — nhóm Shopee Ops trong
 * docs/extracted/chat-goc-0.29.md):
 *
 *   1. Người nói → MỖI thành viên đúng MỘT lượt, LẦN LƯỢT theo thứ tự memberIds.
 *   2. Mỗi lời nói mang author {id, name} của THÀNH VIÊN — không phải của nhóm.
 *   3. Bot trả lời KHÔNG kích hoạt bot khác — sau khi cả hai nói xong, phòng im.
 *
 *   node services/grokbot-backend/scripts/e2e-group-turn.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18885;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-group-"));
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
const entries = (id) => gw("getAgentTranscriptTail", { id, limit: 200 }).then((r) => r.entries ?? []);
const spoken = (list) => list.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim() && !e.streaming);

// ── dựng phòng ────────────────────────────────────────────────────────────────
const kho = (await gw("createAgent", { name: "Kho", description: "Bạn là thủ kho. Chỉ nói về tồn kho. Trả lời đúng MỘT câu tiếng Việt." })).agent;
const ads = (await gw("createAgent", { name: "Ads", description: "Bạn lo quảng cáo. Chỉ nói về ads. Trả lời đúng MỘT câu tiếng Việt." })).agent;
const g = (await gw("createGroup", { name: "Phong Ops", memberAgentIds: [kho.id, ads.id] })).agent;

check("createGroup trả về record có id", typeof g?.id === "string" && g.id.length > 0, JSON.stringify(g));
check("record mang isGroup + memberIds đúng thứ tự", g?.isGroup === true && JSON.stringify(g?.memberIds) === JSON.stringify([kho.id, ads.id]), JSON.stringify(g?.memberIds));

// ── một tin của NGƯỜI mở đúng một vòng ───────────────────────────────────────
await gw("sendPrompt", { agentId: g.id, content: "Chào cả phòng, mỗi người tự giới thiệu vai của mình trong MỘT câu." });

let list = [];
for (let i = 0; i < 80; i += 1) {
  await wait(1500);
  list = await entries(g.id);
  const s = spoken(list);
  const haveKho = s.some((e) => e.author?.id === kho.id);
  const haveAds = s.some((e) => e.author?.id === ads.id);
  if (haveKho && haveAds) break;
}
const s = spoken(list);
check("cả hai thành viên đều đã nói", s.some((e) => e.author?.id === kho.id) && s.some((e) => e.author?.id === ads.id),
  JSON.stringify(s.map((e) => e.author)));

// Luật 2: author là {id, name} của THÀNH VIÊN — đúng shape app gốc.
check("author mang {id, name} của thành viên", s.every((e) => e.author && typeof e.author.id === "string" && typeof e.author.name === "string" && e.author.id !== g.id),
  JSON.stringify(s.map((e) => e.author)));

// Luật 1: LẦN LƯỢT — mọi câu của Kho đứng trước mọi câu của Ads trong vòng này.
const lastKho = s.map((e, i) => (e.author?.id === kho.id ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
const firstAds = s.findIndex((e) => e.author?.id === ads.id);
check("Kho nói xong rồi mới tới Ads (tuần tự, không song song)", lastKho >= 0 && firstAds > lastKho, `lastKho=${lastKho} firstAds=${firstAds}`);

// Con thứ hai phải THẤY câu của con thứ nhất — lịch sử dựng lại mỗi lượt.
// (không assert nội dung vì model tự do, chỉ ghi ra cho người đọc soi)
for (const e of s) console.log(`      ${e.author?.name}: ${(e.message.content ?? "").replace(/\s+/g, " ").slice(0, 120)}`);

// Luật 3: bot KHÔNG kích hoạt bot — phòng phải im sau vòng.
const before = spoken(await entries(g.id)).length;
await wait(10000);
const after = spoken(await entries(g.id)).length;
check("sau vòng phòng im — bot không kích hoạt bot", after === before, `bubbles ${before} -> ${after}`);

// ── tin nhắn thẳng cho MỘT bot không lôi cả phòng vào ────────────────────────
await gw("sendPrompt", { agentId: kho.id, content: "Tồn kho ổn không? Một câu thôi." });
let khoSolo = [];
for (let i = 0; i < 40; i += 1) { await wait(1500); khoSolo = spoken(await entries(kho.id)); if (khoSolo.length) break; }
check("hỏi riêng Kho thì chỉ Kho trả lời", khoSolo.length > 0 && khoSolo.every((e) => e.author?.id === kho.id), JSON.stringify(khoSolo.map((e) => e.author)));
const adsQuiet = spoken(await entries(ads.id)).filter((e) => e.author?.id === ads.id).length;
console.log(`      (Ads có ${adsQuiet} câu trong kênh riêng — chỉ để đối chiếu)`);

console.log(`\n${pass} ok, ${fail} fail`);
await stop();
process.exit(fail ? 1 : 0);
