/**
 * Does the app render a new entry WITHOUT being touched?
 *
 * Isolates the update channel from everything else: the prompt is sent through the gateway,
 * not the composer, so nothing in the window is clicked, typed or reloaded. If the reply
 * appears, live updates work. If it does not, the client is never learning that anything
 * changed — which is the single cause behind "no indicator, no streaming, no reply".
 */
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const GW = process.env.GW ?? "http://127.0.0.1:8788";
const MARK = `LIVE-${Date.now().toString(36).toUpperCase()}`;

const gw = (m, b = {}) =>
  fetch(`${GW}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 150)}`}`);
};

const browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
if (!page) { console.error("no renderer page"); process.exit(1); }

// Focus the window first: the client tells the backend about focus (setWindowFocused is a
// real gateway command), so an unfocused window is a plausible reason to stop updating.
await page.bringToFront();
await wait(1500);

// Identify the open bot by its CONTENT, not its name: duplicate names are common here and
// picking the wrong twin makes the whole test measure a bot nobody is looking at.
const shown = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
const roster = await gw("listAgents");
let agent = null, best = 0;
for (const a of roster) {
  const entries = (await gw("getAgentTranscriptTail", { id: a.id, limit: 30 })).entries ?? [];
  const texts = entries
    .map((e) => String(e.message?.content ?? e.content ?? "").trim())
    .filter((t) => t.length > 12);
  const score = texts.filter((t) => shown.includes(t.slice(0, 40))).length;
  if (score > best) { best = score; agent = a; }
}
agent ??= roster[0];
console.log(`open bot : ${agent?.id} "${agent?.name}" (matched ${best} visible messages)\nmarker   : ${MARK}\n`);
check("the open bot was identified by content", best > 0, "fell back to the first agent");

const seen = () => page.evaluate((m) => (document.body.innerText || "").includes(m), MARK);
check("marker is not on screen yet", !(await seen()));

// Send through the gateway. Nothing touches the window from here on.
await gw("sendPrompt", { agentId: agent.id, content: `Trả lời đúng một dòng, lặp lại chính xác chuỗi này: ${MARK}` });
console.log("sent via gateway — the window is not touched from here\n");

let appeared = null;
let backendHadIt = null;
for (let i = 0; i < 60; i += 1) {
  await wait(1000);
  if (backendHadIt === null) {
    const entries = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 20 })).entries ?? [];
    if (entries.some((e) => (e.message?.content ?? e.content ?? "").includes(MARK) && e.kind === "send-message")) backendHadIt = i + 1;
  }
  if (await seen()) { appeared = i + 1; break; }
}

console.log(`      backend had the reply after : ${backendHadIt ?? "never"}s`);
console.log(`      window showed it after      : ${appeared ?? "never"}s`);
check("the backend produced the reply", backendHadIt !== null);
check("the window rendered it on its own", appeared !== null, "never appeared without interaction");
if (backendHadIt && appeared) check("it rendered promptly", appeared - backendHadIt <= 5, `${appeared - backendHadIt}s behind`);

// Deliberately no reload here. Reloading this window has twice ended with the app gone,
// and a diagnosis step that kills the subject is worse than no diagnosis step.

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
