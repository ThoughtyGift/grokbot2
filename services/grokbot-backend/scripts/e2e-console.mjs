/** Watch the app's renderer console while a message round-trips — surfaces FE-side parse/validation errors. */
import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP(process.env.GROKBOT2_CDP ?? "http://127.0.0.1:9222");
const page = b.contexts()[0].pages()[0];

page.on("console", (m) => {
  const t = m.text();
  if (/error|warn|invalid|reject|drop|schema|parse|entry|transcript/i.test(t)) console.log(`[${m.type()}] ${t.slice(0, 300)}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));

console.log("listening… sending a message");
const composer = page.locator('[contenteditable="true"]').last();
await composer.click();
await composer.type("test console " + Date.now().toString().slice(-4), { delay: 10 });
await page.keyboard.press("Enter");
await page.waitForTimeout(15000);

// what does the FE actually hold for the visible transcript?
const seen = await page.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  return { hasFailed: t.includes("Failed to send"), tail: t.slice(-260) };
});
console.log("\nfailed-label present:", seen.hasFailed);
console.log("tail:", seen.tail);
await b.close();
