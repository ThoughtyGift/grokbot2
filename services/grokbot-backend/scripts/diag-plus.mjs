/**
 * Catch the exact moment "+" creates a bot, on three tracks at once:
 *   1. which gateway method the client calls to create (network),
 *   2. what the backend pushes on the roster SSE right after (isRunning value),
 *   3. what the client's pane shows for the new bot over the next seconds (activity mark present?).
 *
 * That triangulates the standing question: does the backend send isRunning=false and the client ignore
 * it, or does the client never get a correcting event and keep its own "working" state?
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const T = fs.readFileSync(".data/gateway-token.txt", "utf8").trim();
const gw = (m, a) => fetch("http://127.0.0.1:8788/gw/api/" + m, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${T}` },
  body: JSON.stringify(a || {}),
}).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── track 2: backend roster SSE ──────────────────────────────────────────────
const rosterEvents = [];
const res = await fetch("http://127.0.0.1:8788/gw/events", { headers: { authorization: `Bearer ${T}` } });
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
(async () => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    for (const line of buf.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.channel === "agent-upserted" || j.channel === "agents") {
          const a = j.payload?.agent;
          rosterEvents.push({ at: Date.now(), channel: j.channel, id: a?.id, isRunning: a?.isRunning, activity: a?.currentActivity ?? null });
        }
      } catch {}
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
})();

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith("devtools://"));

// ── track 1: network — which method creates the bot ──────────────────────────
const calls = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/gw/api/")) calls.push({ at: Date.now(), method: u.split("/gw/api/")[1]?.split("?")[0] });
});

const before = new Set((await gw("listAgents", {})).map((r) => r.id));
const t0 = Date.now();

// The "+" that starts a new bot — the sidebar rail-new button.
const plus = page.locator('[aria-label="New"]').first();
await plus.click({ timeout: 8000 }).catch(async () => {
  // Fallback: the top-left "+" is the first button in the sidebar header.
  await page.locator('button').first().click({ timeout: 5000 }).catch(() => {});
});
await sleep(1000);

const rows = await gw("listAgents", {});
const fresh = rows.find((r) => !before.has(r.id));
console.log(`bot moi: ${fresh?.id ?? "KHONG TAO DUOC (nut + chua dung selector)"}`);
if (!fresh) { await browser.close(); process.exit(1); }

// ── track 3: client pane — activity mark present over time ───────────────────
for (let i = 0; i < 8; i++) {
  const s = await page.evaluate(() => {
    const mark = document.querySelector(".sand-activity-mark");
    const shimmer = document.querySelector(".sand-shimmer-text");
    return { mark: Boolean(mark), shimmer: Boolean(shimmer), markTxt: (mark?.textContent || "").slice(0, 40) };
  });
  const be = (await gw("listAgents", {})).find((r) => r.id === fresh.id);
  console.log(`  +${i}s  client: mark=${s.mark} shimmer=${s.shimmer} "${s.markTxt}"   backend: isRunning=${be?.isRunning} activity=${JSON.stringify(be?.currentActivity ?? null)}`);
  await sleep(1000);
}

console.log(`\nlenh client goi khi tao (${calls.length}):`);
for (const c of calls.filter((c) => c.at >= t0 - 500)) console.log(`  +${c.at - t0}ms  ${c.method}`);

console.log(`\nroster event backend day cho bot moi:`);
const mine = rosterEvents.filter((e) => e.id === fresh.id);
if (!mine.length) console.log("  KHONG CO event nao cho bot moi — client khong duoc bao presence");
for (const e of mine) console.log(`  +${e.at - t0}ms  ${e.channel}  isRunning=${e.isRunning}  activity=${JSON.stringify(e.activity)}`);

await gw("deleteAgents", { agentIds: [fresh.id] });
await browser.close();
process.exit(0);
