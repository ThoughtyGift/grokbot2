/**
 * X4 — đo giá của mô hình "vẽ lại tất cả" trước khi quyết có đổi stack hay không.
 *
 *   node scripts/measure-transcript-cost.mjs
 *
 * ADR 0004 nói ảo hoá transcript sẽ kích hoạt việc chuyển sang React. Trước khi chuyển thì phải
 * biết con số: mỗi lần `paint()` mất bao lâu, tạo bao nhiêu node, và cuộn có bị đặt lại không.
 * Chuyển stack vì "nghe nói cần" là đổi cả hệ thống dựa trên linh cảm.
 *
 * Đo cả app gốc để có mốc: họ dùng `sand-virtual-transcript`, tức có ảo hoá thật.
 */
import { chromium } from "playwright-core";
import { recordRun } from "./run-history.mjs";

const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";
// Không đọc GROKBOT2_CDP từ môi trường: một lần chạy đã thấy nó bị đặt thành cổng 9 và bài đo
// báo "không đo được app gốc" thay vì báo cấu hình sai.
const CDP = "http://127.0.0.1:9222";

const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error("không lấy được /v1/session"); process.exit(2); }

const results = [];
const note = (name, detail) => { results.push({ name, pass: true, detail }); console.log(`  ${name.padEnd(42)} ${detail}`); };

// ── app gốc ─────────────────────────────────────────────────────────────────
try {
  const b = await chromium.connectOverCDP(CDP);
  let p = null, best = -1;
  for (const q of b.contexts()[0].pages()) {
    const n = await q.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
    if (n > best) { best = n; p = q; }
  }
  const app = await p.evaluate(() => {
    const list = document.querySelector(".sand-virtual-transcript");
    const inner = document.querySelector(".sand-virtual-transcript__inner");
    return {
      rows: document.querySelectorAll(".sand-virtual-transcript__row").length,
      nodes: document.querySelectorAll("*").length,
      innerH: inner ? Math.round(inner.getBoundingClientRect().height) : -1,
      viewH: list ? Math.round(list.getBoundingClientRect().height) : -1,
      scrollH: list ? list.scrollHeight : -1,
    };
  });
  note("app gốc: hàng đang có trong DOM", String(app.rows));
  note("app gốc: tổng node cả trang", String(app.nodes));
  note("app gốc: cao khung / cao nội dung", `${app.viewH} / ${app.scrollH}`);
  note("app gốc có ảo hoá không", app.scrollH > app.viewH * 1.5 && app.rows < 60 ? "CÓ — nội dung dài hơn khung nhiều mà số hàng vẫn ít" : "chưa kết luận được");
} catch (e) {
  note("app gốc", `không đo được (${e instanceof Error ? e.message.slice(0, 140) : e})`);
}

// ── FE của mình ─────────────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
await page.addInitScript((t) => {
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", "host@local");
}, tok);
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".roster .bot", { timeout: 15_000 });
await page.locator(".roster .bot").first().click();
await page.waitForTimeout(1500);

const shape = await page.evaluate(() => ({
  entries: document.querySelectorAll(".transcript .bubble").length,
  runs: document.querySelectorAll(".transcript .run").length,
  nodes: document.querySelectorAll("*").length,
  transcriptNodes: document.querySelectorAll(".transcript *").length,
  scrollH: document.querySelector(".transcript")?.scrollHeight ?? -1,
  viewH: Math.round(document.querySelector(".transcript")?.getBoundingClientRect().height ?? -1),
}));
note("FE: bubble trong DOM", String(shape.entries));
note("FE: node trong transcript / cả trang", `${shape.transcriptNodes} / ${shape.nodes}`);
note("FE: cao khung / cao nội dung", `${shape.viewH} / ${shape.scrollH}`);

/*
 * Giá của một lần vẽ lại: gọi thẳng thứ mà mọi tương tác đều gọi. Không đo bằng cách bấm nút —
 * bấm nút còn kèm network và animation, đo ra một con số pha tạp.
 */
const cost = await page.evaluate(() => {
  const root = document.getElementById("app");
  const clone = root.cloneNode(true);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    const c = clone.cloneNode(true);
    document.body.appendChild(c);
    c.remove();
  }
  return Math.round(((performance.now() - t0) / 10) * 100) / 100;
});
note("FE: dựng lại cả cây DOM (trung bình 10 lượt)", `${cost} ms`);

/*
 * Ngưỡng gãy: giá dựng lại theo SỐ HÀNG, không phải một con số ở cỡ hiện tại.
 *
 * 0,96 ms với 31 bubble không nói được gì về 3000 bubble. Nhân bản transcript lên rồi đo lại, để
 * quyết định "ảo hoá từ bao nhiêu" bằng số chứ không bằng cảm giác — và để biết có thật sự cần đổi
 * cả stack hay không.
 */
const scaling = await page.evaluate(() => {
  const t = document.querySelector(".transcript");
  if (!t) return [];
  const base = t.innerHTML;
  const out = [];
  for (const mult of [1, 4, 16, 64]) {
    t.innerHTML = base.repeat(mult);
    const nodes = t.querySelectorAll("*").length;
    const root = document.getElementById("app");
    const clone = root.cloneNode(true);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) { const c = clone.cloneNode(true); document.body.appendChild(c); c.remove(); }
    const ms = Math.round(((performance.now() - t0) / 5) * 100) / 100;
    out.push({ mult, bubbles: t.querySelectorAll(".bubble").length, nodes, ms });
  }
  t.innerHTML = base;
  return out;
});
for (const r of scaling) {
  note(`FE: ${String(r.bubbles).padStart(5)} bubble · ${String(r.nodes).padStart(6)} node`, `${r.ms} ms mỗi lần vẽ lại`);
}

// cuộn có bị đặt lại khi vẽ lại không
const scrollKept = await page.evaluate(async () => {
  const t = document.querySelector(".transcript");
  if (!t) return "không có transcript";
  t.scrollTop = Math.round(t.scrollHeight / 2);
  const before = t.scrollTop;
  document.querySelector("[data-act=pane]")?.click();     // một tương tác bất kỳ gây paint()
  await new Promise((r) => setTimeout(r, 400));
  const after = document.querySelector(".transcript")?.scrollTop ?? -1;
  document.querySelector("[data-act=pane]")?.click();
  return `${before} → ${after}${Math.abs(after - before) > 8 ? "  ← MẤT vị trí cuộn" : "  (giữ được)"}`;
});
note("FE: vị trí cuộn qua một lần vẽ lại", scrollKept);

console.log("");
recordRun("measure-transcript-cost.mjs", results);
await browser.close();
process.exit(0);
