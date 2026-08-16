/**
 * Real UI end-to-end driver — attaches to the running Grok Bot app over CDP and
 * operates the actual interface (no mocks, no HTTP shortcuts).
 *
 * Launch the app with `--remote-debugging-port=9222` first (see infra/scripts/run.ps1),
 * then:  node scripts/e2e-ui.mjs [--probe | --chat "message" | --tool]
 *
 * The app is Electron, so CDP exposes its renderer as an ordinary page.
 */
import { chromium } from "playwright-core";

const CDP = process.env.GROKBOT2_CDP ?? "http://127.0.0.1:9222";
const mode = process.argv.includes("--chat") ? "chat" : process.argv.includes("--tool") ? "tool" : "probe";
const message = process.argv[process.argv.indexOf("--chat") + 1] ?? "Xin chào, bạn là ai?";

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /Grok Bot/i.test(p.url()) || true);
if (!page) { console.error("no renderer page found over CDP"); process.exit(1); }

const log = (...a) => console.log(...a);
const shot = async (name) => { await page.screenshot({ path: `.data/${name}.png` }).catch(() => {}); };

log(`connected: ${await page.title()}`);

// ── what's on screen right now ──
const probe = async () => {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const text = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis);
    return {
      title: document.title,
      buttons: pick("button,[role=button]").slice(0, 25).map((b) => ({ label: text(b) || b.getAttribute("aria-label") || "", cls: (b.className || "").toString().slice(0, 28) })),
      inputs: pick("input,textarea,[contenteditable=true]").map((i) => ({ tag: i.tagName.toLowerCase(), ph: i.getAttribute("placeholder") || i.getAttribute("aria-label") || "", editable: i.isContentEditable })),
      bodyText: text(document.body).slice(0, 200),
    };
  });
  log("\n--- visible buttons ---");
  for (const b of info.buttons) log(`  [${b.label || "(icon)"}]`);
  log("\n--- inputs ---");
  for (const i of info.inputs) log(`  <${i.tag}${i.editable ? " contenteditable" : ""}> ${i.ph}`);
  log("\n--- body (head) ---\n  " + info.bodyText);
  await shot("ui-probe");
};

// ── type into the composer and send ──
const sendChat = async (text) => {
  const composer = page.locator('[contenteditable="true"], textarea, input[type="text"]').last();
  await composer.waitFor({ state: "visible", timeout: 8000 });
  await composer.click();
  await composer.type(text, { delay: 12 });
  await shot("ui-typed");
  await page.keyboard.press("Enter");
  log(`sent: ${text}`);
  // watch the transcript grow
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    const t = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(-400));
    log(`  t+${i + 1}s  …${t.slice(-160)}`);
  }
  await shot("ui-after-send");
};

if (mode === "probe") await probe();
else if (mode === "chat") { await probe(); await sendChat(message); }
else if (mode === "tool") { await probe(); await sendChat("đếm số từ trong câu: xin chào các bạn"); }

await browser.close();
