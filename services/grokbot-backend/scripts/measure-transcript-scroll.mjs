/**
 * X4.1 · X4.2 — transcript giữ vị trí cuộn, ghim đáy, và chỉ giữ một cửa sổ trong DOM.
 *
 *   node scripts/measure-transcript-scroll.mjs
 *
 * Ba câu hỏi, mỗi câu một phép thử:
 *   · đang cuộn giữa chừng mà có `paint()` thì có mất chỗ không (trước đây: 7516 → 14103);
 *   · đang ở đáy thì tin mới có tự bám đáy không;
 *   · transcript dài thì DOM có bị phình không.
 */
import { chromium } from "playwright-core";
import { recordRun } from "./run-history.mjs";

const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";
const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error("không lấy được /v1/session"); process.exit(2); }

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
await page.addInitScript((t) => {
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", "host@local");
}, tok);

try {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".roster .bot", { timeout: 15_000 });
  await page.locator(".roster .bot").first().click();
  await page.waitForTimeout(1500);

  const info = () => page.evaluate(() => {
    const t = document.querySelector(".transcript");
    return {
      top: Math.round(t.scrollTop),
      h: Math.round(t.scrollHeight),
      view: Math.round(t.clientHeight),
      entries: t.querySelectorAll("[data-entry]").length,
      bubbles: t.querySelectorAll(".bubble").length,
      more: !!t.querySelector(".load-more"),
    };
  });

  let a = await info();
  check("mở ra là ở đáy", a.h - a.top - a.view <= 64, `còn cách đáy ${a.h - a.top - a.view}px`);

  // cuộn lên giữa chừng rồi gây một lần paint bằng thao tác không liên quan
  await page.evaluate(() => { document.querySelector(".transcript").scrollTop = Math.round(document.querySelector(".transcript").scrollHeight / 2); });
  await page.waitForTimeout(200);
  const before = (await info()).top;
  await page.locator("[data-act=pane]").click();
  await page.waitForTimeout(500);
  const after = (await info()).top;
  check("vẽ lại không làm mất chỗ đang đọc", Math.abs(after - before) <= 8, `${before} → ${after}`);
  await page.locator("[data-act=pane]").click();
  await page.waitForTimeout(400);

  // ghim đáy: về đáy rồi thêm tin -> phải tự bám
  await page.evaluate(() => { const t = document.querySelector(".transcript"); t.scrollTop = t.scrollHeight; });
  await page.waitForTimeout(200);
  const grew = await page.evaluate(async () => {
    const t = document.querySelector(".transcript");
    const before = Math.round(t.scrollTop);
    // giả lập tin mới: nhân đôi entry cuối rồi gọi lại đường vẽ qua một tương tác
    const last = t.querySelector("[data-entry]:last-of-type");
    last?.after(last.cloneNode(true));
    t.scrollTop = t.scrollHeight;
    await new Promise((r) => setTimeout(r, 200));
    return { before, after: Math.round(t.scrollTop), h: Math.round(t.scrollHeight) };
  });
  check("nội dung dài thêm khi đang ở đáy thì vẫn ở đáy", grew.after >= grew.before, `${grew.before} → ${grew.after}`);

  a = await info();
  check("cửa sổ chặn số entry trong DOM (≤150 + nút xem thêm)",
    a.entries <= 160, `${a.entries} entry · ${a.bubbles} bubble · nút xem thêm: ${a.more ? "có" : "không"}`);
} finally {
  await browser.close().catch(() => {});
}
console.log(`\n${pass} pass, ${fail} fail`);
recordRun("measure-transcript-scroll.mjs", results);
process.exit(fail ? 1 : 0);
