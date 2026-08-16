/** End-to-end check of the model-driven tool loop: ask → model requests a tool → approve → answer. */
const BASE = process.env.GROKBOT2_BASE ?? "http://localhost:8788";
const post = (m, b) => fetch(`${BASE}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dump = async (agentId, label) => {
  const { entries } = await post("getAgentTranscriptTail", { agentId });
  console.log(`\n--- ${label} ---`);
  for (const e of entries) {
    if (e.kind === "message") console.log("  [user]", JSON.stringify(e.content).slice(0, 60));
    else if (e.kind === "tool-call") console.log("  [tool-call]", e.name, `status=${e.status}`, `result=${e.result ?? "-"}`);
    else if (e.kind === "send-message" && e.message.type === "text") console.log("  [agent]", JSON.stringify(e.message.content).slice(0, 70));
    else if (e.kind === "send-message") console.log("  [card]", e.message.type, `status=${e.message.ask?.status}`, e.message.ask?.target ?? "");
  }
  return entries;
};

const { agent } = await post("createAgent", { name: "ToolLoopE2E" });
await post("sendPrompt", { agentId: agent.id, content: "tinh giup toi 137*89" });
await wait(10_000);
let entries = await dump(agent.id, "after send");

const card = entries.find((e) => e.kind === "send-message" && e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending");
if (!card) { console.log("\nmodel did not request a tool this time"); process.exit(0); }

console.log(`\napproving ${card.message.ask.target} (${card.message.ask.requestId})`);
await post("resolveLocalToolPermission", { requestId: card.message.ask.requestId, approved: true });
await wait(10_000);
await dump(agent.id, "after approval");
