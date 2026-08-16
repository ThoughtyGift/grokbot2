/**
 * End-to-end: create a routine through the app's own editor and confirm the backend
 * stored it. Driving the real form is what proves the arg shapes — issuing the RPC
 * ourselves would only prove our own assumptions.
 */
import { chromium } from "playwright-core";

const GW = "http://127.0.0.1:8788/gw/api";
const call = (m, body = {}) =>
  fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const before = await call("listAllAutomations");
console.log(`routines before: ${before.length}`);

const b = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9222", { timeout: 8000 });
const page = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("renderer"));

const snap = () =>
  page.evaluate(() => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    const pane = document.querySelector('[class*="sand-info-pane"]');
    return {
      pane: pane ? n(pane.innerText).slice(0, 400) : null,
      inputs: [...document.querySelectorAll("input,textarea,[contenteditable=true]")]
        .filter((e) => e.offsetParent !== null)
        .map((e) => ({ tag: e.tagName.toLowerCase(), ph: e.placeholder ?? n(e.getAttribute("aria-label")) ?? "" })),
      buttons: [...document.querySelectorAll("button,[role=button]")]
        .filter((e) => e.offsetParent !== null)
        .map((e) => n(e.innerText) || n(e.getAttribute("aria-label")))
        .filter((s) => s && s.length < 34),
    };
  });

// The routines list only exists while the info pane is open, and a previous run may
// have left the pane closed or sitting inside the editor — normalise both.
// A menu left open by an earlier run swallows clicks — dismiss before anything else.
// (A page reload resets state too, but leaves the info pane empty for several seconds,
// which is worse to wait on than just clearing the overlay.)
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

const paneOpen = () => page.evaluate(() => {
  const p = document.querySelector('[class*="sand-info-pane"]');
  return Boolean(p && p.offsetParent !== null);
});
if (!(await paneOpen())) {
  await page.evaluate(() => {
    const n = (s) => (s || "").trim().replace(/\s+/g, " ");
    [...document.querySelectorAll("button,[role=button]")]
      .find((e) => e.offsetParent !== null && /details|info|Bot settings/i.test(`${n(e.getAttribute("aria-label"))} ${n(e.title)}`))
      ?.click();
  });
  await page.waitForTimeout(1600);
}
console.log(`info pane open: ${await paneOpen()}`);

const back = page.getByRole("button", { name: /Back to Routines/i }).first();
if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(1200); }

// A synthetic .click() misses React's handler here — use a real input event.
await page.locator('[data-routine-row="new"]').first().click({ timeout: 8000 });
await page.waitForTimeout(1800);

const form = await snap();
console.log("\n=== editor opened ===");
console.log(`pane   : ${form.pane}`);
console.log(`inputs : ${JSON.stringify(form.inputs)}`);
console.log(`buttons: ${JSON.stringify(form.buttons.slice(0, 20))}`);
await page.screenshot({ path: ".data/routine-editor.png" });

// These are controlled inputs: assigning .value does not reach React's state, so the
// field looks filled and commits empty. Type through the page instead.
await page.getByPlaceholder("Name this routine").fill("E2E Routine");
await page.getByPlaceholder("What should this routine do each time it runs?").fill("noi xin chao bang tieng Viet");
await page.waitForTimeout(600);
console.log(`\ntyped: ${JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll("input,textarea")].filter((e) => e.offsetParent !== null && e.type !== "file")
    .map((e) => ({ ph: e.placeholder ?? "", value: e.value }))))}`);

// The editor has no Save button: it commits once name, instruction AND a trigger
// are all present, so the routine only reaches the backend after a trigger is added.
await page.getByText("Add trigger", { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1600);
console.log("\n=== after Add trigger ===");
const trig = await snap();
console.log(`pane   : ${trig.pane}`);
console.log(`buttons: ${JSON.stringify(trig.buttons.filter((x) => !/^(New|Search)$/.test(x)).slice(-14))}`);
await page.screenshot({ path: ".data/routine-trigger.png" });

// The trigger menu offers schedule plus channel sources (Slack, Git, Linear…) that need
// external services; only the schedule branch is ours to satisfy.
await page.getByText("On a schedule", { exact: false }).first().click({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(1400);
const sched = await snap();
console.log(`\nschedule submenu: ${JSON.stringify(sched.buttons.slice(-12))}`);
await page.screenshot({ path: ".data/routine-schedule.png" });

// Take the first concrete schedule option the submenu offers.
const picked = await page.evaluate(() => {
  const n = (s) => (s || "").trim().replace(/\s+/g, " ");
  const item = [...document.querySelectorAll("[role=menuitem],[role=option],button")]
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ e, t: n(e.innerText) }))
    .find((x) => /every day|daily|hour|week|custom/i.test(x.t));
  item?.e.click();
  return item?.t ?? null;
});
console.log(`picked schedule: ${picked}`);
await page.waitForTimeout(1600);

// Commit by moving focus out of the editor.
await page.keyboard.press("Escape");
await page.waitForTimeout(2400);

const after = await call("listAllAutomations");
console.log(`\nroutines after : ${after.length}`);
for (const a of after.slice(-3)) console.log(`  - "${a.name}" | ${a.trigger} | ${a.triggerDescription} | runs=${a.runs?.length ?? "MISSING"}`);

await page.screenshot({ path: ".data/routine-created.png" });
console.log("\nscreenshots: .data/routine-editor.png .data/routine-created.png");
await b.close();
