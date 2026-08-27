/**
 * Tính năng 2 — nhịp "rà → kể tên thật → hỏi → mới cài" + bot tự viết skill. Đo trên pool thật.
 *
 * Chuẩn so là b2-replay lần 1 (28/08): 4 case app gốc HỎI bằng widget trước khi cài (5, 8, 15, 23)
 * thì bên mình nhảy thẳng vào thẻ setup_plugin. Ở đây phát lại đúng hai input trong số đó và đòi:
 *   - có widget ask_question trong lượt;
 *   - KHÔNG có thẻ setup_plugin({"plugin":…}) nào trước khi người dùng chọn.
 *
 * Nửa sau: create_skill — có thẻ xin phép (skill là lời dặn đứng lại lâu dài), Allow xong thì file
 * SKILL.md phải nằm đúng $HOME/.claude/skills/<slug>/ trên box và lượt sau bot phải kể được tên nó.
 *
 *   node services/grokbot-backend/scripts/e2e-feature2.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gwHeaders } from "./gw-auth.mjs";
import { killPort } from "./kill-port.mjs";

const PORT = 18889;
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing */ } });
const root = await mkdtemp(join(tmpdir(), "grokbot-f2-"));
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

// exec daemon trực tiếp — để kiểm file skill trên box và dọn sau khi xong.
try { process.loadEnvFile(".env"); } catch { /* env thật đã có */ }
const BOX = (process.env.GROKBOT2_BOX_EXEC_URL ?? "").replace(/[/]+$/, "");
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
const boxExec = (command) =>
  fetch(`${BOX}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-grokbot2-owner": "auth0|grokbot2-user" },
    body: JSON.stringify({ command, timeoutMs: 60_000 }),
  }).then((r) => r.json());

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
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 260)}`}`);
};

const bot = (await gw("createAgent", { name: "Ra Truoc" })).agent;

/** Gửi một câu; chờ lượt lắng (kể cả khi lượt ĐỖ ở widget — widget chưa trả lời cũng là lắng). */
async function ask(prompt, { approveTools = false, timeoutMs = 120_000 } = {}) {
  const before = (await entriesOf(bot.id)).length;
  await gw("sendPrompt", { agentId: bot.id, content: prompt });
  const deadline = Date.now() + timeoutMs;
  const approved = new Set();
  let stable = 0, lastLen = -1;
  while (Date.now() < deadline) {
    await wait(2500);
    const now = (await entriesOf(bot.id)).slice(before);
    if (approveTools) {
      for (const card of now.filter((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending")) {
        const rid = card.message.ask.requestId;
        if (approved.has(rid)) continue;
        approved.add(rid);
        await gw("resolveLocalToolPermission", { requestId: rid, agentId: bot.id, resolution: "allow-once" });
      }
    }
    const streaming = now.some((e) => e.streaming);
    const calls = now.filter((e) => e.kind === "tool-call");
    const busy = calls.some((e) => e.status === "running");
    const hasWidget = now.some((e) => e.kind === "send-message" && e.message?.type === "widget" && e.respondedValue == null && e.widgetDismissed !== true);
    const hasText = now.some((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim() && !e.streaming);
    const hasPendingCard = !approveTools && now.some((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending");
    if (!streaming && !busy && (hasWidget || hasText || hasPendingCard)) {
      if (now.length === lastLen) { stable += 1; if (stable >= 2) break; }
      else stable = 0;
    } else stable = 0;
    lastLen = now.length;
  }
  return (await entriesOf(bot.id)).slice(before);
}

const widgetsOf = (t) => t.filter((e) => e.kind === "send-message" && e.message?.type === "widget");
const installCardsOf = (t) => t.filter((e) =>
  e.kind === "send-message" && e.message?.type === "local-tool-permission" &&
  /setup_plugin[(].*plugin/.test(String(e.message.ask?.target ?? "")));
const textOf = (t) => t.filter((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").trim())
  .map((e) => e.message.content).join(" ");

// ── A. nhịp rà→hỏi — đúng input case 23 của B2 ─────────────────────────────────────────────────
console.log("A1. case 23: capcut");
const a1 = await ask("kiểm tra có MCP skill plugin chuyên nghiệp giống capcut không");
check("A1 có hỏi bằng widget", widgetsOf(a1).length > 0, JSON.stringify(a1.map((e) => e.kind === "send-message" ? e.message?.type : e.kind)));
check("A1 KHÔNG cài trước khi người dùng chọn", installCardsOf(a1).length === 0, JSON.stringify(installCardsOf(a1).map((e) => e.message.ask?.target)));
const w1 = widgetsOf(a1)[0];
if (w1) console.log(`      widget: ${w1.message.widget?.prompt} — ${(w1.message.widget?.options ?? []).map((o) => o.label).join(" / ")}`);
console.log(`      text  : ${textOf(a1).replace(/[ ]+/g, " ").slice(0, 160)}`);

// ── A2. đúng input case 5 của B2 ────────────────────────────────────────────────────────────────
console.log("A2. case 5: tìm mcp shopee");
const a2 = await ask("tìm mcp shopee");
check("A2 có hỏi bằng widget", widgetsOf(a2).length > 0, JSON.stringify(a2.map((e) => e.kind === "send-message" ? e.message?.type : e.kind)));
check("A2 KHÔNG cài trước khi người dùng chọn", installCardsOf(a2).length === 0, JSON.stringify(installCardsOf(a2).map((e) => e.message.ask?.target)));

// ── B. create_skill — có thẻ, Allow, file nằm đúng chỗ, lượt sau thấy ──────────────────────────
console.log("B. create_skill");
await boxExec('rm -rf "$HOME/.claude/skills/dong-goi-shopee"');
const b1 = await ask(
  "Lưu quy trình này thành skill tên 'dong-goi-shopee' (description: dùng khi đóng gói đơn Shopee): " +
  "① quay video 6 mặt gói hàng ② dán nhãn vận đơn, zoom rõ mã ③ bàn giao SPX trước 23:59.",
  { approveTools: true, timeoutMs: 150_000 },
);
const skillCall = b1.filter((e) => e.kind === "tool-call" && e.name === "create_skill");
check("B bot tự gọi create_skill", skillCall.length > 0, JSON.stringify(b1.map((e) => e.kind === "tool-call" ? e.name : e.kind)));
check("B tool chạy xong", skillCall.some((e) => e.status === "done" && /Đã lưu skill/.test(String(e.result ?? ""))), JSON.stringify(skillCall.map((e) => [e.status, String(e.result).slice(0, 100)])));
const onBox = await boxExec('cat "$HOME/.claude/skills/dong-goi-shopee/SKILL.md" 2>/dev/null');
check("B file SKILL.md nằm đúng chỗ trên box", onBox.exitCode === 0 && /SPX/.test(onBox.stdout) && /name: dong-goi-shopee/.test(onBox.stdout), JSON.stringify(onBox).slice(0, 200));

const b2 = await ask("Bạn đang có những skill nào trong danh sách? Kể tên thôi.");
check("B lượt sau thấy skill vừa ghi", /dong-goi-shopee/i.test(textOf(b2)), textOf(b2).slice(0, 200));
console.log(`      bot: ${textOf(b2).replace(/[ ]+/g, " ").slice(0, 160)}`);

await boxExec('rm -rf "$HOME/.claude/skills/dong-goi-shopee"');
console.log(`\n${pass} ok, ${fail} fail`);
await stop();
process.exit(fail ? 1 : 0);
