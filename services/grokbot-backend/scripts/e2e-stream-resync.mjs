/**
 * A reply that streams while the event stream blinks must still end up complete on screen.
 *
 * Observed in the app: a bubble reading "Để" while the backend held the full 1118-character
 * answer. Nothing was wrong with the generation, and the push path is correct in isolation —
 * "added" once, then "updated" per token. The suspicion is the gap: the transcript is pushed as
 * deltas, so any update sent while the stream is down is simply gone, and nothing re-syncs
 * afterwards. The bubble keeps whatever text it had when the connection dropped.
 *
 * That is easy to believe and easy to get wrong, so it is measured rather than argued: start a
 * long reply, cut the stream mid-generation with /gw/__dropsse (the server stays up, so the
 * client reconnects in ~5s), then compare what the app renders against what the backend holds.
 *
 * Needs the backend and the app running, with the target bot's conversation OPEN in the app:
 *   node scripts/e2e-stream-resync.mjs "Bot Name"
 */
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const APP_CDP = process.env.APP_CDP ?? "http://127.0.0.1:9222";
const WANTED = process.argv[2] ?? "";

const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

async function inApp(expression) {
  const targets = await (await fetch(`${APP_CDP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && !/devtools/.test(t.url));
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const reply = new Promise((r) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result); }; });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  const out = await Promise.race([reply, sleep(10000).then(() => null)]);
  ws.close();
  return out?.result?.value ?? null;
}

/**
 * How much of a known reply the app is actually showing.
 *
 * Picking "the last bubble" out of the DOM was the first attempt and it measured the wrong
 * node — it reported 57 characters for a reply that had already streamed 332, which is not a
 * possible state and so was a bug in the ruler, not a finding. Searching the page text for
 * fragments of the reply we are holding needs no knowledge of the markup at all.
 */
const seenFraction = async (text) => {
  const body = await inApp(`document.body.innerText`);
  if (typeof body !== "string" || text.length === 0) return { head: false, tail: false, bodyLen: 0 };
  const head = text.slice(0, 40);
  const tail = text.slice(-40);
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return { head: norm(body).includes(norm(head)), tail: norm(body).includes(norm(tail)), bodyLen: body.length };
};

const rows = await post("listAgents", {});
const all = rows.agents ?? rows;
const bot = WANTED ? all.find((a) => a.name === WANTED) : all[all.length - 1];
if (!bot) { console.log(`khong thay bot "${WANTED}"`); process.exit(1); }
console.log(`bot: ${bot.name} (${bot.id}) — mo dung hoi thoai nay trong app truoc khi chay`);

console.log("\n1. a long reply is cut off mid-stream by an SSE drop");
await post("sendPrompt", {
  agentId: bot.id,
  content: "Viet mot doan dai khoang 800 chu ve loi ich cua viec doc sach moi ngay.",
  clientNonce: `sr${Date.now()}`,
});
// Wait until the bubble is genuinely mid-generation, then cut. Cutting before any token has
// been pushed would test reconnection, not resync.
let midLen = 0;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const t = await post("getAgentTranscript", { id: bot.id, limit: 4 });
  const last = (t.entries ?? []).at(-1);
  midLen = String(last?.message?.content ?? "").length;
  if (midLen > 120) break;
}
check("reply was streaming when cut", midLen > 120, `${midLen} chars generated`);
const dropped = await (await fetch("http://localhost:8788/gw/__dropsse")).json();
console.log(`   cut ${dropped.dropped} stream(s) at ${midLen} chars`);

console.log("\n2. after the turn finishes, the app agrees with the backend");
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const t = await post("getAgentTranscript", { id: bot.id, limit: 4 });
  if ((t.entries ?? []).at(-1)?.streaming === false) break;
}
await sleep(4000);   // let the reconnect land and the renderer settle

const t = await post("getAgentTranscript", { id: bot.id, limit: 4 });
const backendText = String((t.entries ?? []).at(-1)?.message?.content ?? "");
const { head, tail, bodyLen } = await seenFraction(backendText);
console.log(`   backend ${backendText.length} chars · app page text ${bodyLen} chars`);
check("the reply is on screen at all", head, head ? "opening words found" : "opening words missing");
// The ending is the whole question: everything generated after the cut lives there.
check("the reply is complete on screen", tail, tail ? "closing words found" : "closing words MISSING — updates after the cut were never applied");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
