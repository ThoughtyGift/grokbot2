/**
 * Drive the real app to the Routines surface and report what it shows.
 *
 * The routine list is not a top-level control — it sits behind a bot's menu, so a
 * plain DOM scan of the workspace will always report "no routines" even when the
 * backend is answering correctly.
 */
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
if (!page) { console.log("no renderer page"); process.exit(1); }

const labels = () =>
  page.evaluate(() => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    return [...new Set(
      [...document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem],[role=menuitemcheckbox]")]
        .filter((e) => e.offsetParent !== null)
        .map((e) => n(e.innerText) || n(e.getAttribute("aria-label")) || n(e.title))
        .filter((s) => s && s.length < 44)
    )];
  });

const hits = (list) => list.filter((l) => /routine|automation|schedul/i.test(l));

console.log("=== workspace controls ===");
const base = await labels();
console.log(`${base.length} controls; routine-ish: ${JSON.stringify(hits(base))}`);

// The routines entry lives in the per-bot menu. Right-click the first sidebar row,
// then walk any menu that opens.
const opened = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role=button],[role=option],[role=listitem],a,li')]
    .filter((e) => e.offsetParent !== null && (e.innerText || "").trim().length > 0);
  const row = rows.find((e) => /PersistTest|Claude|Grok/i.test(e.innerText));
  if (!row) return null;
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 120 }));
  return (row.innerText || "").trim().slice(0, 40);
});
console.log(`\ncontext-menu on: ${opened ?? "(no row found)"}`);
await page.waitForTimeout(1200);

const menu = await labels();
const fresh = menu.filter((l) => !base.includes(l));
console.log(`menu items appeared: ${JSON.stringify(fresh.slice(0, 25))}`);
console.log(`routine-ish in menu: ${JSON.stringify(hits(menu))}`);

// If a routines item is present, click it and report the panel.
const target = hits(menu)[0];
if (target) {
  await page.evaluate((t) => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    const el = [...document.querySelectorAll("button,[role=button],[role=menuitem]")]
      .find((e) => e.offsetParent !== null && (n(e.innerText) === t || n(e.getAttribute("aria-label")) === t));
    el?.click();
  }, target);
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700));
  console.log(`\n=== after clicking "${target}" ===\n${panel}`);
}

await browser.close();
