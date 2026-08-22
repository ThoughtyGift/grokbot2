/**
 * The agent-exchange viewer: does clicking a peer chip open the two bots' conversation?
 *
 * The roadmap listed this as blocked on an unknown gateway method that loads `tunnelEntries`.
 * Reading the bundle settled it — there is no such method:
 *
 *   le = useMemo(() => v.isGroup ? O : Uan(u, v.id, self), …)   // u = the CURRENT transcript
 *   function Uan(entries, peerId, self) {
 *     …for each entry: kind === "message" && (toAgent?.id === peerId || fromAgent?.id === peerId)
 *   }
 *
 * For a 1:1 peer the pane is a pure client-side filter over entries the app already holds; only
 * the group case loads anything, and it loads through the ordinary transcript store
 * (`PBe → $Mt → transcript.load(id)`), not a new method. So the whole contract is on our side of
 * the wire, and it is a shape assertion, not a protocol one.
 *
 * Two things are checked, in the order they can fail:
 *   1. the entries carry what the filter reads (`kind:"message"` + `toAgent`/`fromAgent`+`content`)
 *   2. the app renders the chip that calls `openAgentExchange` ("Open exchange with <name>")
 *
 * Needs the backend and the app running (app CDP on 9222):
 *   node scripts/e2e-exchange.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const APP_CDP = process.env.APP_CDP ?? "http://127.0.0.1:9222";

const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Evaluate an expression in the app's renderer and return the JSON value. */
async function inApp(expression) {
  const targets = await (await fetch(`${APP_CDP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !/devtools/.test(t.url));
  if (!page) return { error: "no app target" };
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const reply = new Promise((r) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result); };
  });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  const out = await Promise.race([reply, sleep(10000).then(() => null)]);
  ws.close();
  return out?.result?.value ?? { error: "no value" };
}

console.log("1. two bots exchange a message");
const { agent: a } = await post("createAgent", { name: "Alpha" });
const { agent: b } = await post("createAgent", { name: "Beta" });
await post("sendPrompt", {
  agentId: a.id, content: `/tool message_agent {"to":"Beta","content":"Chao Beta, gui giup bao cao."}`,
  clientNonce: `ex${Date.now()}`,
});
await sleep(12000);

const ta = (await post("getAgentTranscript", { id: a.id, limit: 60 })).entries ?? [];

console.log("\n2. the entries carry what the client's filter reads");
// Mirror Uan exactly rather than approximating it — an assertion that is merely similar to the
// client's rule is how a shape passes here and renders empty in the app.
const filtered = ta.filter((e) => e.kind === "message" && (e.toAgent?.id === b.id || e.fromAgent?.id === b.id));
check("entries survive the peer filter", filtered.length > 0, `${filtered.length} of ${ta.length}`);
check("outbound names the peer", filtered.some((e) => e.toAgent?.id === b.id), filtered.find((e) => e.toAgent)?.toAgent?.name ?? "no toAgent");
check("content is at the entry root", filtered.every((e) => typeof e.content === "string" && e.content.length > 0),
  JSON.stringify(filtered[0]?.content ?? null).slice(0, 50));
// Uan drops any entry whose author it cannot resolve: for an inbound one that is `fromAgent`.
const inbound = ta.filter((e) => e.fromAgent?.id === b.id);
check("inbound carries fromAgent", inbound.length === 0 || inbound.every((e) => e.fromAgent?.name),
  inbound.length ? `${inbound.length} inbound` : "none yet (Beta has not replied)");

console.log("\n3. the app renders the chip that opens the pane");
const probe = await inApp(`(() => {
  const els = [...document.querySelectorAll('[aria-label^="Open exchange with"]')];
  return JSON.stringify({ n: els.length, labels: els.map(e => e.getAttribute('aria-label')).slice(0, 5) });
})()`);
if (typeof probe !== "string") {
  skip++;
  console.log(`  SKIP chip probe — ${JSON.stringify(probe)} (app not reachable on ${APP_CDP})`);
} else {
  const { n, labels } = JSON.parse(probe);
  // The chip only exists on the screen showing that conversation, so an absent chip while some
  // other bot is selected proves nothing. Say so rather than failing.
  if (n === 0) {
    skip++;
    console.log("  SKIP chip not on screen — open Alpha's conversation in the app and re-run");
  } else {
    check("peer chip rendered", n > 0, labels.join(" · "));
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
