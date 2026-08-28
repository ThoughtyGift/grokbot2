/**
 * Ba thứ làm hôm nay chưa bao giờ đi qua một model thật: `create_diagram`, `share_bot_template`,
 * và subagent `media_review`.
 *
 *   node services/grokbot-backend/scripts/e2e-today.mjs
 *
 * Unit test phủ phần logic (khối mermaid dựng đúng, mẫu chở đủ thành viên). Cái CHƯA ai đo là câu
 * hỏi khác hẳn: **model có tự chọn dùng chúng khi nên dùng không.** Một tool không ai gọi thì cũng
 * như không có — và đó là thứ chỉ đo được bằng cách nói chuyện thật với pool.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18891;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-today-"));
const procs = [];
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid || p.exitCode !== null || p.killed) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stop = async () => {
  for (const p of procs) await killTree(p);
  for (let i = 0; i < 5; i += 1) { try { await rm(root, { recursive: true, force: true }); return; } catch { await wait(600); } }
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));

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
const entriesOf = (id) => gw("getAgentTranscriptTail", { id, limit: 200 }).then((r) => r.entries ?? []);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 240)}`}`);
};
const FENCE = "```";

/** Gửi một câu, tự bấm Allow, chờ lượt lắng. */
async function ask(agentId, prompt, timeoutMs = 180_000) {
  const before = (await entriesOf(agentId)).length;
  await gw("sendPrompt", { agentId, content: prompt });
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  let stable = 0, lastLen = -1;
  while (Date.now() < deadline) {
    await wait(2500);
    const now = (await entriesOf(agentId)).slice(before);
    for (const card of now.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending")) {
      const rid = card.message.ask.requestId;
      if (seen.has(rid)) continue;
      seen.add(rid);
      await gw("resolveLocalToolPermission", { requestId: rid, agentId, resolution: "allow-once" });
    }
    const busy = now.some((e) => e.streaming) || now.some((e) => e.kind === "tool-call" && (e.status === "running" || e.status === "pending"));
    const hasText = now.some((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim() && !e.streaming);
    if (!busy && hasText) { if (now.length === lastLen) { stable += 1; if (stable >= 2) break; } else stable = 0; }
    else stable = 0;
    lastLen = now.length;
  }
  return (await entriesOf(agentId)).slice(before);
}
const toolsIn = (t) => t.filter((e) => e.kind === "tool-call").map((e) => e.name);
const textIn = (t) => t.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim())
  .map((e) => e.message.content).join("\n");

// ── 1. create_diagram: model có TỰ chọn vẽ không ───────────────────────────────────────────────
console.log("create_diagram");
const a1 = (await gw("createAgent", { name: "Ve So Do" })).agent;
const t1 = await ask(a1.id, "Giải thích luồng xử lý một đơn Shopee từ lúc khách đặt tới lúc bàn giao SPX. Vẽ cho mình xem bằng sơ đồ.");
check("model tự gọi create_diagram", toolsIn(t1).includes("create_diagram"), JSON.stringify(toolsIn(t1)));
const txt1 = textIn(t1);
check("có khối mermaid trong hội thoại", txt1.includes(`${FENCE}mermaid`), txt1.slice(0, 200));
const head = (txt1.split(`${FENCE}mermaid`)[1] ?? "").trim().split(/\s|\n/)[0] ?? "";
check("khối mở đúng loại sơ đồ mermaid", /^(flowchart|graph|sequenceDiagram|stateDiagram)/.test(head), `dòng đầu: ${head}`);
console.log(`      loại: ${head}`);

// ── 2. share_bot_template: đóng gói cả ĐỘI ─────────────────────────────────────────────────────
console.log("\nshare_bot_template");
const kho = (await gw("createAgent", { name: "Kho T", description: "Ưu tiên Hỏa Tốc, cutoff 18:00." })).agent;
const cs = (await gw("createAgent", { name: "CS T", description: "Trả chat trong 2 phút." })).agent;
const room = (await gw("createGroup", { name: "Ops T", memberAgentIds: [kho.id, cs.id] })).agent;
const boss = (await gw("createAgent", { name: "Quan Ly T" })).agent;
const t2 = await ask(boss.id, `Đóng gói nhóm "Ops T" thành mẫu để mình phát cho máy khác dùng lại.`);
check("model tự gọi share_bot_template", toolsIn(t2).includes("share_bot_template"), JSON.stringify(toolsIn(t2)));
const tpls = await gw("listBotTemplates", {});
const list = Array.isArray(tpls) ? tpls : [];
const mine = list.find((t) => t.sourceAgentId === room.id);
check("mẫu được tạo cho ĐÚNG nhóm", Boolean(mine), JSON.stringify(list.map((t) => t.name)));
check("mẫu chở theo 2 thành viên kèm SOP", (mine?.snapshot?.members?.length ?? 0) === 2 && /Hỏa Tốc/.test(mine?.snapshot?.members?.[0]?.description ?? ""), JSON.stringify(mine?.snapshot?.members));
check("mẫu đã xuất bản (published + activeVersion)", mine?.published === true && mine?.activeVersion != null, JSON.stringify({ p: mine?.published, v: mine?.activeVersion }));

// dựng lại từ mẫu và kiểm cả đội quay về
if (mine) {
  const made = await gw("createAgentFromTemplate", { shareId: mine.shareId, agentId: "", name: "Ops T (bản sao)", avatarShape: "blob", avatarColor: "blue", expectedActiveVersion: mine.activeVersion });
  const copy = made?.agent;
  check("dựng lại từ mẫu ra NHÓM đủ 2 người", copy?.isGroup === true && (copy?.memberIds?.length ?? 0) === 2, JSON.stringify(made).slice(0, 200));
}

// ── 3. media_review: subagent soi ảnh/clip ─────────────────────────────────────────────────────
console.log("\nmedia_review (subagent)");
const a3 = (await gw("createAgent", { name: "Soi Media" })).agent;
const t3 = await ask(a3.id, "Trên máy của bạn có subagent nào chuyên soi ảnh/video/tài liệu không? Kể tên các loại subagent bạn gọi được, đúng tên.");
const txt3 = textIn(t3);
// Bài này TỪNG xanh vì lý do sai: bot nói "KHÔNG, mình không có subagent kiểu 'soi ảnh'" và regex
// khớp đúng cụm đó — trong một câu phủ định. Cùng cái bẫy đã mắc với "không câm như clip kia".
// Giờ đòi đúng TÊN loại, và chặn câu phủ định.
const noiKhong = /(không|chưa)\s+(có|hỗ trợ)/i.test(txt3);
check("model kể được TÊN loại subagent soi media", /mediaReview|media_review/i.test(txt3) && !noiKhong,
  (noiKhong ? "[bot đang nói KHÔNG có] " : "") + txt3.slice(0, 220));
console.log(`      bot: ${txt3.replace(/\s+/g, " ").slice(0, 180)}`);

console.log(`\n${pass} ok, ${fail} fail`);
await stop();
process.exit(fail ? 1 : 0);
