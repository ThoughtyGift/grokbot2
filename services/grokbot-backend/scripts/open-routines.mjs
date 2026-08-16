/**
 * Verify the routines section renders for the bot that owns one.
 *
 * The section lives in the info pane (`sand-info-pane`), keyed by agentId — so it is
 * queried by class and `data-routine-row`, not by guessing button labels.
 */
import { chromium } from "playwright-core";

const AGENT = process.env.AGENT ?? "agent-5";
const b = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9222", { timeout: 8000 });
const page = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));

const probe = () =>
  page.evaluate(() => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    const pane = document.querySelector('[class*="sand-info-pane"]');
    const rows = [...document.querySelectorAll("[data-routine-row]")];
    return {
      infoPaneMounted: Boolean(pane),
      paneVisible: Boolean(pane && pane.offsetParent !== null),
      routineRows: rows.map((r) => ({ kind: r.getAttribute("data-routine-row"), text: n(r.innerText).slice(0, 70) })),
      paneText: pane ? n(pane.innerText).slice(0, 500) : null,
    };
  });

// Dismiss any overlay, then select the bot that owns the routine.
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.mouse.click(640, 400);
await page.waitForTimeout(500);

const name = await fetch("http://127.0.0.1:8788/gw/api/listAgents", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
}).then((r) => r.json()).then((l) => l.find((a) => a.id === AGENT)?.name ?? null);

await page.evaluate((n) => {
  const row = [...document.querySelectorAll("[role=button],[role=option],li,a,div")]
    .filter((e) => e.offsetParent !== null && (e.innerText || "").trim() === n)
    .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  row?.click();
}, name);
await page.waitForTimeout(1500);
console.log(`agent ${AGENT} "${name}" selected`);

let state = await probe();
if (!state.paneVisible) {
  // Open the details/info pane via whichever header control toggles it.
  const opened = await page.evaluate(() => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    const el = [...document.querySelectorAll("button,[role=button]")].find((e) => {
      const l = `${n(e.getAttribute("aria-label"))} ${n(e.title)}`;
      return e.offsetParent !== null && /details|info|Bot settings/i.test(l);
    });
    el?.click();
    return el ? n(el.getAttribute("aria-label")) || n(el.title) : null;
  });
  console.log(`opened via: ${opened}`);
  await page.waitForTimeout(1800);
  state = await probe();
}

console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: ".data/routines-panel.png" });
console.log("screenshot: .data/routines-panel.png");
await b.close();
