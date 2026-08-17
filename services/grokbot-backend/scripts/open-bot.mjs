/**
 * Open a bot by name in a running instance and dump what the transcript renders.
 *
 * Compares like with like: the point is the DOM the user sees, not the entries we sent.
 *   CDP=http://127.0.0.1:9333 BOT=Marketing node scripts/open-bot.mjs
 */
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const BOT = process.env.BOT ?? "";
const OUT = process.env.OUT ?? "";

const b = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));
if (!p) { console.log("no renderer page"); process.exit(1); }

if (BOT) {
  // Click the SIDEBAR row, not the first text match: a bot's name also appears inside other
  // conversations, and `text=Marketing` happily opened the chat that merely mentioned it.
  const clicked = await p.evaluate((name) => {
    const rows = [...document.querySelectorAll("div,li,a")].filter((e) => {
      if (e.offsetParent === null) return false;
      const r = e.getBoundingClientRect();
      return r.left < 40 && r.width > 150 && r.width < 340 && r.height > 30 && r.height < 90;
    });
    const hit = rows.find((e) => (e.innerText || "").split("\n")[0].trim() === name)
      ?? rows.find((e) => (e.innerText || "").split("\n")[0].trim().startsWith(name));
    if (!hit) return false;
    hit.click();
    return true;
  }, BOT);
  if (!clicked) console.log("could not find sidebar row:", BOT);
  await p.waitForTimeout(2500);
}

const dump = await p.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  // The transcript column: widest visible column that is not the sidebar.
  const main = [...document.querySelectorAll("div")]
    .filter((e) => e.offsetParent !== null)
    .filter((e) => { const r = e.getBoundingClientRect(); return r.left > 250 && r.width > 300; })
    .sort((a, b2) => b2.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  const lines = norm(main?.innerText).split(" · ").join(" · ");
  return {
    header: norm(document.querySelector("header")?.innerText),
    body: lines.slice(0, 1400),
    // Anything the renderer treats as an attachment / chip / image.
    chips: [...document.querySelectorAll('[class*="attachment"],[class*="chip"],img')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => norm(e.innerText) || e.tagName + ":" + norm(e.getAttribute("alt")))
      .filter(Boolean).slice(0, 12),
  };
});
console.log(JSON.stringify(dump, null, 1));
if (OUT) { await p.screenshot({ path: OUT }); console.log("shot:", OUT); }
await b.close();
