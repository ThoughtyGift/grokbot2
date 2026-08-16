/** Does the reply render after a manual re-open? Distinguishes a shape bug from a refresh bug. */
import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP(process.env.GROKBOT2_CDP ?? "http://127.0.0.1:9222");
const page = b.contexts()[0].pages()[0];
const body = () => page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));

console.log("before switch:", (await body()).includes("Hà Nội") ? "REPLY VISIBLE" : "reply NOT visible");

// click a different bot, then back to PersistTest — forces openAgentTail
const names = ["Alpha", "PersistTest"];
for (const n of names) {
  const btn = page.locator(`button:has-text("${n}")`).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); console.log(`clicked ${n}`); }
}
await page.waitForTimeout(1500);
const after = await body();
console.log("after re-open:", after.includes("Hà Nội") ? "REPLY VISIBLE ✅" : "reply STILL missing ❌");
console.log("tail:", after.slice(-220));
await page.screenshot({ path: ".data/e2e-refresh.png" }).catch(() => {});
await b.close();
