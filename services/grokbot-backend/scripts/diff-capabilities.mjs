/**
 * Side-by-side capability probe: what each running instance actually puts on screen.
 *
 * NOTE on method: watching the renderer's network is useless here — the box gateway is called
 * from the MAIN process, so `/gw/api/*` never appears in renderer CDP (the same reason
 * capture-box.mjs came back empty). What the renderer *does* have is the rendered result, so
 * this walks the DOM instead and reports which surfaces are live.
 *
 *   node scripts/diff-capabilities.mjs --cdp http://127.0.0.1:9333   # the original
 *   node scripts/diff-capabilities.mjs --cdp http://127.0.0.1:9222   # this backend
 *
 * Nothing but structure is printed — labels are counted, message text is not, because the
 * original is driving the owner's real agents.
 */
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const CDP = arg("--cdp", "http://127.0.0.1:9333");

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => /index\.html/.test(p.url()));
if (!page) { console.error("no renderer page on " + CDP); process.exit(1); }

/** Visit every sidebar agent so surfaces that only some agents use still get counted. */
const agents = await page.evaluate(() => {
  const seen = new Set();
  for (const el of document.querySelectorAll('[class*="sidebar"] [role="button"], nav [role="button"], aside [role="button"]')) {
    const t = (el.textContent || "").trim().split("\n")[0];
    if (t && t.length < 40) seen.add(t);
  }
  return [...seen];
});

const totals = {};
const bump = (k, n = 1) => { totals[k] = (totals[k] ?? 0) + n; };

async function sample() {
  const s = await page.evaluate(() => {
    const has = (sel) => document.querySelectorAll(sel).length;
    const body = document.body.innerText;
    return {
      images: has("main img, [class*='message'] img, [class*='bubble'] img"),
      imageFallback: (body.match(/Image unavailable/g) || []).length,
      attachments: has("[class*='attachment']"),
      // The ask_question widget renders a radio/checkbox group inside a message bubble.
      questionWidgets: has("[role='radiogroup'], [class*='question'] input, [class*='widget'] input"),
      toolCards: has("[class*='tool']"),
      approvalCards: (body.match(/Allow|Approve|Run this|Cho phép/g) || []).length,
      openComputer: (body.match(/Open computer/g) || []).length,
      screenPane: (body.match(/'s screen/g) || []).length,
      routines: has("[class*='routine']"),
      // A routine whose trigger is an event reads "When …"; a cron one reads a time.
      routineEventTriggers: (body.match(/When @?\w+/g) || []).length,
      routineCronTriggers: (body.match(/\d{1,2}:\d{2}\s*(daily|weekly)?/g) || []).length,
      codeBlocks: has("pre"),
      links: has("main a[href^='http']"),
    };
  });
  for (const [k, v] of Object.entries(s)) bump(k, v);
}

console.log(`probing ${CDP} — ${agents.length} sidebar entries\n`);
await sample();
for (const name of agents.slice(0, 12)) {
  try {
    await page.locator(`text=${name}`).first().click({ timeout: 3000 });
    await page.waitForTimeout(1800);
    await sample();
  } catch { /* not clickable — skip */ }
}

console.log("surface".padEnd(24) + "count (summed over agents visited)");
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}
await browser.close();
