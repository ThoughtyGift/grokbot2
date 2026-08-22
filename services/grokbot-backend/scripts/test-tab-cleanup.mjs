/**
 * Browser tabs must not outlive the bot that opened them.
 *
 * One tab per bot is the right model — the original's own tool says "By default reuses your
 * tab" — but nothing closed them, and the box accumulated 25 tabs, most owned by bots that had
 * already been deleted. Two release paths now exist, and both are asserted here because the
 * one that is never tested is the one that silently stops working:
 *
 *   1. the computer session is released after its grace period → the tab closes
 *   2. the bot is deleted                                      → the tab closes
 *
 * Run the backend with a short grace period so this finishes in seconds rather than minutes:
 *   GROKBOT2_COMPUTER_RELEASE_MS=4000 pnpm dev
 *   node scripts/test-tab-cleanup.mjs
 */
const GW = "http://localhost:8788/gw/api";
const CDP = process.env.GROKBOT2_BROWSER_CDP ?? "http://127.0.0.1:9223";

const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();
const tabs = async () => (await (await fetch(`${CDP}/json/list`)).json()).filter((t) => t.type === "page");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/**
 * Drive one bot to open a tab, and identify THAT tab.
 *
 * Counting total tabs looked simpler and was wrong: other bots open and release tabs while this
 * runs, so a correct close showed as "4 → 4" and the test failed on a product that worked.
 * Track the specific target id instead — that is the thing being asserted.
 */
async function browseWith(name) {
  const before = await tabs();
  const { agent } = await post("createAgent", { name });
  await post("sendPrompt", {
    agentId: agent.id,
    content: '/tool browser_navigate {"url":"https://example.com"}',
    clientNonce: `tab${Date.now()}${Math.random()}`,
  });
  let mine = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    mine = (await tabs()).find((t) => !before.some((b) => b.id === t.id)) ?? null;
    if (mine) break;
  }
  return { agent, tabId: mine?.id ?? null };
}

const tabExists = async (id) => (await tabs()).some((t) => t.id === id);

console.log("1. a browsing bot opens its own tab");
const a = await browseWith("TabLife");
check("tab opened", a.tabId != null, a.tabId ? a.tabId.slice(0, 12) : "none appeared");

console.log("\n2. the tab closes when the session is released");
// The session is released a grace period after the turn ends. Wait for it plus a margin.
const grace = Number(process.env.GROKBOT2_COMPUTER_RELEASE_MS ?? 120_000);
console.log(`   (grace period ${grace}ms — set GROKBOT2_COMPUTER_RELEASE_MS lower to speed this up)`);
let released = false;
for (let i = 0; i < Math.ceil(grace / 1000) + 12; i++) {
  await sleep(1000);
  const s = await post("getForeverBoxStatus", { id: a.agent.id });
  if (s.state === "off") { released = true; break; }
}
check("session released", released, released ? "state=off" : "still running");
await sleep(2500);
check("tab closed with the session", a.tabId != null && !(await tabExists(a.tabId)), "its own target is gone");

console.log("\n3. deleting a bot takes its tab with it");
const b = await browseWith("TabDelete");
check("tab opened", b.tabId != null, b.tabId ? b.tabId.slice(0, 12) : "none appeared");
await post("deleteAgents", { ids: [b.agent.id] });
await sleep(2500);
check("tab closed on delete", b.tabId != null && !(await tabExists(b.tabId)), "its own target is gone");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
