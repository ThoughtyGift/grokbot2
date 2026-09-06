/*
 * Đo ĐƯỜNG BẢN GHI SỐNG trên client 0.43 local (CDP :9225) — một lượt model, tự dọn.
 *
 *   bot thử → bấm THẬT vào nó trên sidebar (tới khi data-active đổi) → sendPrompt một câu dài → trong lúc bot gõ:
 *   · đếm lượt getAgentTranscriptTail (coverage) — có `ordered` thì ~5/lượt (mở bot + neo + xong); không có thì một lượt
 *     cho MỌI khung SSE (đo 06/09: 38 trong 6 s, New Bot 292 KB/lượt = cái "giật")
 *   · DOM có mọc chữ không cần tải lại
 *   · replica client ghi xuống đĩa có epochHint/acceptedSequenceHint không (= client đang ở chế độ replica)
 *   Dọn: xoá bot thử, bấm lại bot đang mở trước đó. Không chạy khi người dùng đang chat trên :9225.
 *
 *   node services/grokbot-backend/scripts/do-ban-ghi-song.mjs
 */
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CDP = process.env.CDP_APP ?? "http://127.0.0.1:9225";
const GW = "http://127.0.0.1:8788/gw/api";
const gw = async (m, b = {}) => {
  const r = await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  return r.json().catch(() => null);
};
const cov = async () => { const c = await (await fetch("http://127.0.0.1:8788/gw/__coverage")).json(); return c.calls?.getAgentTranscriptTail?.n ?? 0; };
const sl = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await chromium.connectOverCDP(CDP, { timeout: 10_000 });
const page = app.contexts().flatMap((c) => c.pages()).find((p) => !/devtools/.test(p.url())) ?? app.contexts()[0].pages()[0];
console.log("page:", page.url().slice(0, 60));
const truoc = await page.evaluate(() => document.querySelector('[data-active="true"][data-agent-id]')?.getAttribute("data-agent-id") ?? null);
console.log("bot đang mở trước đó:", truoc);

const bot = await gw("createAgent", { name: "e2e-ban-ghi-thu" });
const id = bot?.id ?? bot?.agent?.id ?? (await gw("listAgents", {})).find?.((a) => a.name === "e2e-ban-ghi-thu")?.id;
console.log("bot thử:", id);
if (!id) process.exit(1);
try {
  // bấm vào bot thử (click THẬT qua toạ độ)
  let rect = null;
  for (let i = 0; i < 20 && !rect; i++) {
    rect = await page.evaluate((id) => { const el = document.querySelector(`[data-agent-id="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    if (!rect) await sl(500);
  }
  if (!rect) throw new Error("không thấy hàng sidebar của bot thử");
  let active = null;
  for (let lan = 0; lan < 4 && active !== id; lan++) {
    const r2 = await page.evaluate((id) => { const el = document.querySelector(`[data-agent-id="${id}"]`); if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
    if (r2) { await page.mouse.move(r2.x, r2.y); await page.mouse.down(); await sl(60); await page.mouse.up(); }
    await sl(1500);
    active = await page.evaluate(() => document.querySelector('[data-active="true"][data-agent-id]')?.getAttribute("data-agent-id"));
    console.log("bấm lần", lan + 1, "→ đang mở:", active, active === id ? "✓" : "✗");
  }
  const rows0 = await page.evaluate(() => document.querySelectorAll("[data-row-key]").length);
  const n0 = await cov();
  const t0 = Date.now();
  await gw("sendPrompt", { agentId: id, content: "Đếm từ 1 đến 25, mỗi số một dòng kèm một từ tiếng Việt bắt đầu bằng chữ cái bất kỳ. Không giải thích thêm." });
  // theo dõi 45 s
  let firstText = null, last = "";
  const mau = [];
  for (let t = 0; t < 45; t++) {
    await sl(1000);
    const s = await page.evaluate(() => { const rows = [...document.querySelectorAll("[data-row-key]")]; return { n: rows.length, text: rows.map((r) => r.textContent).join("\n").slice(-400) }; });
    const n = await cov();
    if (firstText == null && /\b2\b/.test(s.text) && s.n > rows0) firstText = Date.now() - t0;
    mau.push({ t: t + 1, rows: s.n, tail: n - n0 });
    last = s.text;
    if (/25/.test(s.text) && t > 8) break;
  }
  const h = await gw("getAgentTranscriptTail", { id, limit: 50 });
  const daXong = (h?.entries ?? []).some((e) => e.kind === "send-message" && e.streaming === false && /25/.test(e.message?.content ?? ""));
  console.log("mẫu (giây → hàng DOM, lượt tải đuôi cộng dồn):", mau.map((m) => `${m.t}s:${m.rows}/${m.tail}`).join(" "));
  console.log("chữ đầu lên DOM sau:", firstText, "ms · bot xong:", daXong, "· tổng lượt tải đuôi trong lượt:", (await cov()) - n0);
  console.log("DOM cuối:", JSON.stringify(last.slice(-200)));
  // replica trên đĩa của client local: có epochHint?
  await sl(3000);
  const dir = join(process.env.APPDATA, "Grok Bot (local 043)", "sand-client-persistence");
  const b32 = (s) => { const A = "abcdefghijklmnopqrstuvwxyz234567"; let bits = "", out = []; for (const c of s) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); } for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out).toString("utf8"); };
  for (const f of readdirSync(dir)) {
    const key = b32(f.replace(/\.blob$/, ""));
    if (!key.endsWith(`transcript.replicas.${id}`)) continue;
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    console.log("replica trên đĩa:", JSON.stringify({ epochHint: j.value.epochHint, acceptedSequenceHint: j.value.acceptedSequenceHint, entries: j.value.entries.length }));
  }
} finally {
  await gw("deleteAgents", { ids: [id] });
  if (truoc) {
    const r = await page.evaluate((id) => { const el = document.querySelector(`[data-agent-id="${id}"]`); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, truoc);
    if (r) { await page.mouse.click(r.x, r.y); console.log("đã bấm lại", truoc); }
  }
  await app.close();
}
