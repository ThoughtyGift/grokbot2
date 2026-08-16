/**
 * Drive the REAL app window and watch the indicator the user actually sees.
 *
 * Every other suite talks to a backend directly. This one types into the composer of the
 * running Grok Bot and watches two things at once: the agent record the client polls, and
 * the DOM it renders from it. Both matter — presence being correct on the wire is not the
 * same as the app drawing it.
 */
import { chromium } from "playwright-core";

const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const GW = process.env.GW ?? "http://127.0.0.1:8788";
const MSG = process.env.MSG ?? "Kể mình nghe 2 câu về biển Nha Trang.";

const gw = (m, b = {}) =>
  fetch(`${GW}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 170)}`}`);
};
/** The client's own formula, applied to what the client is actually given. */
const indicator = (a) => (a?.isRunning ? (a.isComposingMessage ? "typing" : "working") : "none");

const browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
if (!page) { console.error("no renderer page — is the app running?"); process.exit(1); }

// Which bot is on screen? The composer placeholder names it, which is how the app itself
// tells the user what they are typing into.
// The chat header names the bot on screen. (The composer is a ProseMirror contenteditable
// with aria-label "Prompt", not an input with a "Message <name>" placeholder — that text is
// a CSS-rendered placeholder, invisible to getAttribute.)
const openName = await page.evaluate(() => {
  const n = (s) => (s || "").trim().replace(/\s+/g, " ");
  const head = [...document.querySelectorAll("button,[role=button],h1,h2,span")]
    .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().top < 55)
    .map((e) => n(e.innerText)).filter((t) => t && t.length < 40);
  return head[0] ?? null;
});
const roster = await gw("listAgents");
const agent = roster.find((a) => a.name === openName) ?? roster[0];
console.log(`app window : bot "${openName}"\nbackend    : ${agent?.id} "${agent?.name}"\nprompt     : ${MSG}\n`);
check("the open bot is one the backend knows", Boolean(agent), openName ?? "(no composer found)");

const before = ((await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? []).length;

// Type it the way a person does, so the composer's own handlers run.
const composer = page.locator('[contenteditable="true"][aria-label="Prompt"]').first();
await composer.click({ timeout: 10000 });
// type(), not fill(): ProseMirror builds its document from real key events, and a filled
// value leaves the editor's own state empty so Enter sends nothing.
await page.keyboard.type(MSG, { delay: 12 });
await page.keyboard.press("Enter");
console.log("sent from the app window\n");

// Watch presence and the DOM together.
const seen = [];
const activities = new Set();
let sawIndicatorInDom = false;
let sawPartialText = false;
let lastLen = 0;

for (let i = 0; i < 100; i += 1) {
  await wait(300);
  const rec = (await gw("listAgents")).find((a) => a.id === agent.id);
  const state = indicator(rec);
  if (seen[seen.length - 1] !== state) seen.push(state);
  if (rec?.currentActivity) activities.add(JSON.stringify(rec.currentActivity));

  const dom = await page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      // The indicator renders as its own row; the activity words are the visible proof.
      hasIndicator: /Thinking|Working|Searching the web|Reading the web|Reading file|Đang/i.test(t),
      len: t.length,
    };
  });
  if (dom.hasIndicator) sawIndicatorInDom = true;
  // Text growing across polls is streaming; a single jump is not.
  if (dom.len > lastLen && lastLen > 0) sawPartialText = true;
  lastLen = dom.len;

  if (seen.length >= 3 && state === "none") break;
}

console.log(`      presence sequence : ${seen.join(" → ")}`);
console.log(`      activities        : ${[...activities].join(" ") || "(none)"}`);

check("indicator turns on", seen.includes("working") || seen.includes("typing"), seen.join(","));
check("reaches 'typing' while answering", seen.includes("typing"), seen.join(","));
check("returns to none when finished", seen[seen.length - 1] === "none", seen.join(","));
check("the app DREW an indicator", sawIndicatorInDom, "no Thinking/Working row seen in the DOM");
check("text arrived progressively (streaming)", sawPartialText, "the reply appeared in one jump");

const after = (await gw("getAgentTranscriptTail", { id: agent.id, limit: 200 })).entries ?? [];
const turn = after.slice(before);
const reply = [...turn].reverse().find((e) => e.kind === "send-message" && e.message?.type === "text" &&
  (e.message.content ?? "").trim() && !(e.message.content ?? "").startsWith("🔧 "));
check("a real reply landed", Boolean(reply), turn.map((e) => e.kind).join(","));
if (reply) console.log(`      reply: ${reply.message.content.replace(/\s+/g, " ").slice(0, 160)}`);
check("no bubble left streaming", !turn.some((e) => e.streaming), turn.filter((e) => e.streaming).length + " stuck");

const shown = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
check("the reply is visible in the window", reply ? shown.includes(reply.message.content.trim().slice(0, 25)) : false);

await page.screenshot({ path: ".data/live-app.png" });
console.log("\nscreenshot: .data/live-app.png");
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
