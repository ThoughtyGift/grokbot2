/**
 * How long after the backend has a reply does the app actually show it?
 *
 * Measured over several rounds because the failure being chased is intermittent: a single
 * round that lands proves nothing, and a single round that misses proves nothing either.
 * Nothing touches the window — the prompt goes through the gateway.
 *
 *   node measure-render-lag.mjs [agentId] [rounds]
 */
import { chromium } from "playwright-core";

const AGENT = process.argv[2] ?? "agent-35";
const ROUNDS = Number(process.argv[3] ?? 3);
const GW = "http://127.0.0.1:8788";
const gw = (m, b) =>
  fetch(`${GW}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("renderer"));
if (!page) { console.error("no renderer page — is the app running?"); process.exit(1); }

// The bot must be OPEN: with none selected there is no chat view, and "nothing rendered"
// then says nothing about the update path. This is how the earlier runs misled.
const name = (await gw("listAgents", {})).find((a) => a.id === AGENT)?.name;
await page.evaluate((n) => {
  [...document.querySelectorAll("[role=button],[role=option],li,a,div")]
    .filter((e) => e.offsetParent !== null && (e.innerText || "").trim() === n)
    .sort((a, b) => a.innerText.length - b.innerText.length)[0]?.click();
}, name);
await wait(3000);
const open = await page.evaluate((n) => (document.body.innerText || "").includes(n), name);
console.log(`bot "${name}" open in the window: ${open}\n`);

const lags = [];
for (let round = 1; round <= ROUNDS; round += 1) {
  const MARK = `LAG${round}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  await gw("sendPrompt", { agentId: AGENT, content: `Trả lời đúng một dòng, lặp lại chuỗi này: ${MARK}` });
  let be = null, ui = null;
  const t0 = Date.now();
  for (let i = 0; i < 60; i += 1) {
    await wait(700);
    if (!be) {
      const es = (await gw("getAgentTranscriptTail", { id: AGENT, limit: 50 })).entries ?? [];
      if (es.some((e) => String(e.message?.content ?? "").includes(MARK))) be = Date.now() - t0;
    }
    if (!ui && (await page.evaluate((m) => document.body.innerText.includes(m), MARK))) ui = Date.now() - t0;
    if (be && ui) break;
  }
  const lag = be && ui ? (ui - be) / 1000 : null;
  lags.push(lag);
  console.log(`  round ${round}: backend ${be ? (be / 1000).toFixed(1) : "-"}s | app ${ui ? (ui / 1000).toFixed(1) : "NEVER"}s | lag ${lag !== null ? lag.toFixed(1) + "s" : "-"}`);
  await wait(2000);
}

const landed = lags.filter((l) => l !== null);
console.log(`\nrendered ${landed.length}/${ROUNDS}`);
if (landed.length) console.log(`lag: min ${Math.min(...landed).toFixed(1)}s · max ${Math.max(...landed).toFixed(1)}s`);
await browser.close();
process.exit(landed.length === ROUNDS ? 0 : 1);
