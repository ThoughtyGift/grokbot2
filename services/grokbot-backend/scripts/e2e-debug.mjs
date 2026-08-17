/**
 * Stage-by-stage diagnostic against the running app: where does it actually break?
 *
 * Every earlier harness guessed which bot was open by matching transcript text against the
 * screen, and kept picking the wrong conversation — two runs disagreed for no real reason.
 * This reads the CHAT HEADER instead, which is what the app itself uses to tell the user
 * whose chat they are in, and refuses to measure anything if it cannot identify it.
 */
import { chromium } from "playwright-core";

const GW = "http://127.0.0.1:8788";
const gw = (m, b = {}) =>
  fetch(`${GW}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
    .then((r) => r.json()).catch((e) => ({ __error: String(e) }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (n, label, ok, detail = "") =>
  console.log(`${ok === null ? "  ??" : ok ? "  ok" : "FAIL"}  ${n}. ${label}${detail ? `  — ${detail}` : ""}`);

console.log("=== stages ===");

// 1. backend
const health = await fetch(`${GW}/gw/health`).then((r) => r.json()).catch(() => null);
step(1, "backend answers", Boolean(health?.ok));
if (!health?.ok) process.exit(1);

// 2. the app's event stream
const cov = await fetch(`${GW}/gw/__coverage`).then((r) => r.json()).catch(() => null);
step(2, "app is on the event stream", (cov?.sse?.connected ?? 0) > 0,
  `opened=${cov?.sse?.opened} closed=${cov?.sse?.closed} connected=${cov?.sse?.connected}`);

// 3. renderer reachable
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 8000 }).catch(() => null);
const page = browser?.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
step(3, "app window reachable", Boolean(page));
if (!page) { console.log("\n-> the app is not running; start it and re-run"); process.exit(1); }

// 4. which bot is open — from the header, the app's own answer to that question
const header = await page.evaluate(() => {
  const n = (s) => (s || "").trim().replace(/\s+/g, " ");
  const box = document.querySelector('[contenteditable="true"][aria-label="Prompt"]')?.getBoundingClientRect();
  const left = box ? box.left - 40 : 250;                       // chat column starts near the composer
  return [...document.querySelectorAll("span,h1,h2,div,button")]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return e.offsetParent !== null && r.top < 50 && r.left > left && r.width < 320 && (e.innerText || "").trim();
    })
    .map((e) => n(e.innerText)).filter((t) => t.length > 0 && t.length < 40)[0] ?? null;
});
const roster = await gw("listAgents");
const open = roster.find?.((a) => a.name === header) ?? null;
step(4, "a bot is open in the window", Boolean(open), header ? `header says "${header}"` : "no header found");
if (!open) {
  console.log("\n-> open a bot in the app and re-run; with none open there is no chat view to render into");
  await browser.close(); process.exit(1);
}
console.log(`      -> ${open.id} "${open.name}"`);

// 5. send, and watch each half separately
// The marker must be something ONLY a reply can contain. Putting it in the prompt makes the
// user's own message match the moment it renders, and every "the app showed it in 0.4s"
// measured that echo rather than the answer.
const MARK = "HANOI";
const before = ((await gw("getAgentTranscriptTail", { id: open.id, limit: 200 })).entries ?? []).length;
await gw("sendPrompt", { agentId: open.id, content: "Thu do cua Viet Nam ten la gi? Tra loi dung mot tu, viet HOA khong dau." });

let backendAt = null, uiAt = null, indAt = null;
const seenInd = new Set();
const presence = [];
const t0 = Date.now();
for (let i = 0; i < 200; i += 1) {
  await wait(200);
  if (!backendAt) {
    const es = (await gw("getAgentTranscriptTail", { id: open.id, limit: 200 })).entries ?? [];
    // Only assistant bubbles count; a user entry can never be the reply.
    if (es.some((e) => e.kind === "send-message" && e.message?.type === "text" &&
        String(e.message.content ?? "").toUpperCase().includes(MARK))) backendAt = Date.now() - t0;
  }
  const rec = (await gw("listAgents")).find?.((a) => a.id === open.id);
  const p = rec?.isRunning ? (rec.isComposingMessage ? "typing" : "working") : "none";
  if (presence[presence.length - 1] !== p) presence.push(p);
  const s = await page.evaluate((m) => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = t.match(/Thinking|Working|Searching the web|Reading the web|Reading file/i);
    return { ind: g ? g[0] : null, has: t.toUpperCase().includes(m) };
  }, MARK);
  if (s.ind) { seenInd.add(s.ind); indAt ??= Date.now() - t0; }
  if (s.has) { uiAt = Date.now() - t0; break; }
}

const after = ((await gw("getAgentTranscriptTail", { id: open.id, limit: 200 })).entries ?? []).length;
step(5, "backend produced the reply", backendAt !== null, backendAt ? `${(backendAt / 1000).toFixed(1)}s` : "never");
step(6, "presence moved on the wire", presence.length > 1, presence.join(" -> "));
step(7, "app drew the indicator", seenInd.size > 0, seenInd.size ? `${[...seenInd].join(", ")} after ${(indAt / 1000).toFixed(1)}s` : "not seen");
step(8, "app rendered the reply", uiAt !== null, uiAt ? `${(uiAt / 1000).toFixed(1)}s` : "not within 40s");
console.log(`      transcript grew ${before} -> ${after}`);

console.log("\n=== where it breaks ===");
if (backendAt === null) console.log("  the backend never produced a reply — a chat/pool problem, not a display one");
else if (uiAt === null && presence.length > 1) console.log("  backend and presence are both correct; the app is not applying updates — the event payload is what to look at");
else if (uiAt !== null && seenInd.size === 0) console.log("  replies render but the indicator does not: transcript events land, roster/presence events do not");
else if (uiAt !== null && seenInd.size > 0) console.log("  nothing broken — both halves work");
await browser.close();
