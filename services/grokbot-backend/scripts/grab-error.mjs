/**
 * Pull the detail behind the app's "Couldn't render this" card.
 *
 * The card hides the real exception; the app offers a "Copy error" button, so click
 * it and read the clipboard rather than guessing from the visible text.
 */
import { chromium } from "playwright-core";

const b = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9222", { timeout: 8000 });
const ctx = b.contexts()[0];
const p = ctx.pages().find((x) => x.url().includes("renderer"));
if (!p) { console.log("no renderer page"); process.exit(1); }

const logs = [];
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
p.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 600)}`));

try { await ctx.grantPermissions(["clipboard-read", "clipboard-write"]); } catch { /* not always supported over CDP */ }

const clicked = await p.evaluate(() => {
  const n = (s) => (s || "").trim().replace(/\s+/g, " ");
  const btn = [...document.querySelectorAll("button,[role=button],a")]
    .find((e) => e.offsetParent !== null && /copy error/i.test(n(e.innerText)));
  if (!btn) return false;
  btn.click();
  return true;
});
console.log(`"Copy error" clicked: ${clicked}`);
await p.waitForTimeout(800);

if (clicked) {
  const text = await p.evaluate(async () => {
    try { return await navigator.clipboard.readText(); } catch (e) { return `clipboard blocked: ${e}`; }
  });
  console.log("\n=== copied error ===\n" + String(text).slice(0, 2500));
}

// Force a re-render so the failing component throws again while we are listening.
await p.evaluate(() => {
  const n = (s) => (s || "").trim().replace(/\s+/g, " ");
  [...document.querySelectorAll("button,[role=button]")]
    .filter((e) => e.offsetParent !== null && n(e.innerText) === "Retry")
    .forEach((e) => e.click());
});
await p.waitForTimeout(2500);

console.log("\n=== console during retry ===");
console.log(logs.length ? logs.slice(0, 25).join("\n") : "(nothing captured)");
await b.close();
