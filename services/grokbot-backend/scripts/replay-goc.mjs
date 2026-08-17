/**
 * Replay the original app's conversation against our backend, input for input.
 *
 * Same words in, so the only thing that differs is the backend. Prints each pair so the two
 * answers can be read side by side rather than summarised — a "looks similar" judgement from a
 * summary is worth nothing here.
 *
 *   node scripts/replay-goc.mjs [count]      # default: the first 8 user inputs
 */
import { readFileSync, writeFileSync } from "node:fs";

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();

const COUNT = Number(process.argv[2] ?? 8);
const turns = JSON.parse(readFileSync(".data/goc-thuky-turns.json", "utf8"));

/** Pair each user turn with the bot text that follows it, in transcript order. */
const pairs = [];
for (let i = 0; i < turns.length; i++) {
  if (turns[i].role !== "user") continue;
  const reply = [];
  for (let j = i + 1; j < turns.length && turns[j].role === "bot"; j++) reply.push(turns[j].text);
  pairs.push({ input: turns[i].text, goc: reply.join(" ").slice(0, 400) });
}
console.log(`original: ${pairs.length} user turns; replaying the first ${COUNT}\n`);

const { agent } = await post("createAgent", { name: "Thư ký" });
console.log(`local bot: ${agent.id}\n`);

/** Send one prompt and wait for the reply to stop streaming. */
async function ask(text) {
  const t0 = Date.now();
  await post("sendPrompt", { agentId: agent.id, content: text, clientNonce: `n${t0}${Math.random()}` });
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const t = await post("getAgentTranscript", { id: agent.id, limit: 40 });
    const entries = t.entries ?? [];
    const last = entries[entries.length - 1];
    if (!last) continue;
    // A pending approval card means the turn is parked on the user, not still thinking.
    const pending = entries.find((e) => e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending");
    if (pending) return { text: `[cho duyet: ${pending.message.ask.target?.slice(0, 60)}]`, ms: Date.now() - t0 };
    if (last.kind === "send-message" && last.message?.type === "text" && last.streaming === false && (last.message.content ?? "").length > 0) {
      return { text: last.message.content, ms: Date.now() - t0 };
    }
  }
  return { text: "(khong tra loi trong 90s)", ms: Date.now() - t0 };
}

const out = [];
for (let i = 0; i < Math.min(COUNT, pairs.length); i++) {
  const { input, goc } = pairs[i];
  const local = await ask(input);
  out.push({ n: i + 1, input, goc, local: local.text, ms: local.ms });
  console.log(`──────── ${i + 1}. INPUT: ${input.slice(0, 110)}`);
  console.log(`  GOC   : ${goc.replace(/\s+/g, " ").slice(0, 240)}`);
  console.log(`  LOCAL : ${local.text.replace(/\s+/g, " ").slice(0, 240)}   (${(local.ms / 1000).toFixed(1)}s)`);
  console.log();
}
writeFileSync(".data/replay-compare.json", JSON.stringify(out, null, 1));
console.log("wrote .data/replay-compare.json");
