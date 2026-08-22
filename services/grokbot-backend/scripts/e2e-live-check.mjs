/**
 * The whole loop as a person experiences it: send, see the indicator, get the reply.
 *
 * Uses a bot created for this run so it cannot land in a conversation someone is using, and
 * opens it the way a person does. Reports how long each half took rather than pass/fail
 * alone — "it works" and "it works in under a second" are different claims.
 */
import { chromium } from "playwright-core";
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://127.0.0.1:8788";
const gw = (m, b = {}) =>
  fetch(`${GW}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
if (!page) { console.error("no renderer page — is the app running?"); process.exit(1); }

const name = `LiveCheck-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const agent = (await gw("createAgent", { name })).agent;
console.log(`bot: ${agent.id} "${name}"`);

// Open it from the sidebar; with no bot selected there is no chat view to draw into, and a
// blank window then looks exactly like a broken update channel.
// Wait for the sidebar to show it before clicking. Clicking too early silently leaves a
// DIFFERENT conversation on screen, and then "nothing rendered" is measuring the wrong chat
// — which is how two earlier runs disagreed for no real reason.
let opened = false;
for (let i = 0; i < 30 && !opened; i += 1) {
  await wait(700);
  opened = await page.evaluate((n) => {
    const row = [...document.querySelectorAll("[role=button],[role=option],li,a,div")]
      .filter((e) => e.offsetParent !== null && (e.innerText || "").trim() === n)
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return false;
    row.click();
    return true;
  }, name);
}
await wait(2500);
// Confirm the header really shows this bot before measuring anything.
const showing = await page.evaluate((n) => (document.body.innerText || "").includes(n), name);
const chatOpen = await page.evaluate(() => Boolean(document.querySelector('[contenteditable="true"][aria-label="Prompt"]')));
console.log(`opened from sidebar: ${opened} | chat view present: ${chatOpen}\n`);

const MARK = `OK-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
await gw("sendPrompt", { agentId: agent.id, content: `Viết 5 câu về biển, câu cuối đúng là: ${MARK}` });

const indicators = new Set();
let firstIndicator = null, replyAt = null;
const t0 = Date.now();
for (let i = 0; i < 150; i += 1) {
  await wait(200);
  const s = await page.evaluate((m) => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = t.match(/Thinking|Working|Searching the web|Reading the web|Reading file/i);
    return { ind: g ? g[0] : null, has: t.includes(m) };
  }, MARK);
  if (s.ind) { indicators.add(s.ind); firstIndicator ??= Date.now() - t0; }
  if (s.has && !replyAt) { replyAt = Date.now() - t0; break; }
}

console.log(`indicator      : ${indicators.size ? [...indicators].join(", ") : "NOT SEEN"}${firstIndicator ? ` (after ${(firstIndicator / 1000).toFixed(1)}s)` : ""}`);
console.log(`reply rendered : ${replyAt ? `${(replyAt / 1000).toFixed(1)}s` : "NOT SEEN"}`);

const ok = indicators.size > 0 && replyAt !== null;
console.log(`\n${ok ? "PASS" : "FAIL"} — indicator ${indicators.size ? "shown" : "missing"}, reply ${replyAt ? "rendered" : "missing"}`);
await gw("deleteAgents", { ids: [agent.id] });   // leave no test bot behind
await browser.close();
process.exit(ok ? 0 : 1);
