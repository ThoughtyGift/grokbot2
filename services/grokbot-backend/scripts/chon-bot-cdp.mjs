/**
 * Mở một bot trên client 0.43 local bằng cú bấm THẬT vào hàng sidebar (CDP :9225) — cho các bài E2E bấm-thật
 * (`e2e-chia-se-mau`, `e2e-teach`) vốn đo trên "bot đang mở": chúng cần một bot CHƯA có mẫu, mà bot việc của người
 * dùng thường đã có (06/09: `New Bot` có mẫu đang lên Marketplace ⇒ mốc 1 của e2e-chia-se-mau đỏ đúng, không phải lỗi).
 *
 *   node services/grokbot-backend/scripts/chon-bot-cdp.mjs <agentId>      # in ra bot đang mở TRƯỚC đó (để bấm về sau)
 *
 * Guard là `[data-active="true"][data-agent-id]` — thuộc tính thật của hàng đang mở (bảng theo dõi §7 "guard chỉ đáng
 * tin khi đã thấy nó trả TRUE"); bấm tối đa 4 lần tới khi khớp. Exit 0 = đã mở đúng bot; 1 = không mở được.
 */
import { chromium } from "playwright-core";
const CDP = process.env.CDP_APP ?? "http://127.0.0.1:9225";
const id = process.argv[2];
if (!id) { console.error("dùng: chon-bot-cdp.mjs <agentId>"); process.exit(1); }
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await chromium.connectOverCDP(CDP, { timeout: 10_000 });
const page = app.contexts().flatMap((c) => c.pages()).find((p) => !/devtools/.test(p.url())) ?? app.contexts()[0].pages()[0];
await page.bringToFront().catch(() => {});   // cửa sổ bị che thì timer của trang bị bóp — bài đo sau cần nó ở trước
const truoc = await page.evaluate(() => document.querySelector('[data-active="true"][data-agent-id]')?.getAttribute("data-agent-id") ?? null);
console.log("trước:", truoc);
let active = truoc;
for (let lan = 0; lan < 4 && active !== id; lan++) {
  let r2 = null;
  for (let i = 0; i < 20 && !r2; i++) {
    r2 = await page.evaluate((id) => { const el = document.querySelector(`[data-agent-id="${id}"]`); if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, id);
    if (!r2) await sl(500);
  }
  if (!r2) { console.error("không thấy hàng sidebar của", id); break; }
  await page.mouse.move(r2.x, r2.y); await page.mouse.down(); await sl(60); await page.mouse.up();
  await sl(1500);
  active = await page.evaluate(() => document.querySelector('[data-active="true"][data-agent-id]')?.getAttribute("data-agent-id"));
  console.log("bấm lần", lan + 1, "→ đang mở:", active, active === id ? "✓" : "✗");
}
await app.close().catch(() => {});
process.exit(active === id ? 0 : 1);
