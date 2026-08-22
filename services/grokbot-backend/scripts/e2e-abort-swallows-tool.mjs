/**
 * A second message must not swallow the tool call the first turn was about to make.
 *
 * Found in a real multi-agent run: Frontend Dev's transcript held a 28k-character bubble whose
 * text ended in a complete, valid `TOOL_CALL: edit_file_v2({...})` that never executed. The
 * parser was innocent — that exact string matches in 0ms and the tool runs fine when invoked
 * directly. What gave it away was the entry two rows earlier: an EMPTY bubble, immediately
 * followed by an inbound message. That is the shape of an aborted turn.
 *
 *   sendPrompt → inflight.get(agentId)?.abort()      // a new message kills the running turn
 *   runTurn    → if (controller.signal.aborted) return;   // returns BEFORE parseToolCall
 *
 * So when a bot is messaged while it is mid-turn — routine in a multi-agent setup, where peers
 * write to each other — whatever the model had just decided to do is left sitting in the bubble
 * as raw text and never runs.
 *
 * This reproduces it deterministically: ask for something that needs a tool, then send a second
 * message before the first turn finishes.
 *
 *   node scripts/e2e-abort-swallows-tool.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const BASE = "http://localhost:8788";
const post = async (m, b) => (await fetch(`${BASE}/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const { agent } = await post("createAgent", { name: `Abort ${Date.now() % 10000}` });
const tail = async () => ((await post("getAgentTranscript", { id: agent.id, limit: 40 })).entries ?? []);

console.log("1. a turn that will call a tool is interrupted by a second message");
await post("sendPrompt", {
  agentId: agent.id, clientNonce: `a1${Date.now()}`,
  content: "Tao file ghi_chu.txt voi noi dung 'xin chao'. Dung cong cu de tao that.",
});
// Interrupt once the turn is running but before it can finish: this is what an incoming peer
// message does in a multi-agent conversation.
await sleep(3000);
await post("sendPrompt", {
  agentId: agent.id, clientNonce: `a2${Date.now()}`,
  content: "Khoan da, doi mot chut.",
});

for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const rows = await post("listAgents", {});
  const me = (Array.isArray(rows) ? rows : rows.agents).find((a) => a.id === agent.id);
  if (me?.isRunning === false) break;
}
await sleep(2000);

const entries = await tail();
for (const e of entries) {
  const c = String(e.message?.content ?? e.content ?? "");
  console.log(`   ${e.kind}/${e.message?.type ?? ""}${e.name ? `(${e.name})` : ""} len=${c.length} ${/TOOL_CALL/.test(c) ? "<< co TOOL_CALL tho" : ""}`);
}

console.log("\n2. what the interruption left behind");
const raw = entries.filter((e) => /TOOL_CALL:/.test(String(e.message?.content ?? "")));
check("no bubble is left holding a raw TOOL_CALL", raw.length === 0,
  raw.length ? `${raw.length} bubble(s) — the tool never ran and the user sees the machine line` : "none");
const empties = entries.filter((e) => e.kind === "send-message" && e.message?.type === "text" && String(e.message.content).length === 0);
check("no empty bubble is left behind", empties.length === 0, `${empties.length} empty bubble(s)`);

await post("deleteAgents", { ids: [agent.id] });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
