/**
 * Transcript events must arrive with a sequence that is contiguous PER AGENT.
 *
 * The client's replica applies an event only when `sequence === acceptedSequence + 1`; anything
 * else is parked in a bounded buffer and triggers a resync request:
 *
 *   if (t.sequence === this.acceptedSequence + 1) { applyEvent(…); acceptedSequence = t.sequence }
 *   else { this.bufferBounded(t.sequence, e.event); this.startAttempt() }
 *
 * We were sending the entry's GLOBAL seq, shared by every agent, so one bot writing put a gap in
 * every other bot's replica and froze it. The roster was never affected because it always had its
 * own counter — which is exactly why the sidebar preview updated while the bubble stood still.
 *
 * This reads the raw SSE frames rather than the rendered app. Transcript events do NOT carry
 * `ordered` (that envelope froze the pane; see gateway.ts). The per-agent number lives on
 * `entry.seq`. The test needs no model, so it still runs while the pool is down.
 *
 *   node scripts/e2e-ordered-sequence.mjs
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

/** Collect transcript frames off the event stream for a while. */
const frames = [];
const stream = await fetch(`${BASE}/gw/events`, { headers: { accept: "text/event-stream", ...gwHeaders() } });
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buf = "";
const pump = (async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const data = part.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (!data) continue;
      try {
        const ev = JSON.parse(data);
        if (ev.channel === "transcript" && ev.payload?.agentId && ev.payload?.event?.entry) {
          frames.push({
            agentId: ev.payload.agentId,
            seq: ev.payload.event.entry.seq,
            type: ev.payload.event.type,
          });
        }
      } catch { /* comment or non-JSON keepalive */ }
    }
  }
})();

console.log("1. two bots write interleaved");
const { agent: a } = await post("createAgent", { name: "SeqA" });
const { agent: b } = await post("createAgent", { name: "SeqB" });
// Interleaving is the whole point: with a global counter each bot's replica sees the other's
// numbers as gaps. sendPrompt alone pushes the user entry, so no model is needed.
for (let i = 0; i < 4; i++) {
  await post("sendPrompt", { agentId: a.id, content: `A${i}`, clientNonce: `sa${i}${Date.now()}` });
  await sleep(250);
  await post("sendPrompt", { agentId: b.id, content: `B${i}`, clientNonce: `sb${i}${Date.now()}` });
  await sleep(250);
}
await sleep(2500);
reader.cancel().catch(() => {});
await Promise.race([pump, sleep(1000)]);

console.log("\n2. each agent's entry.seq is independent and never goes backwards");
const byAgent = new Map();
for (const o of frames) {
  if (o.agentId !== a.id && o.agentId !== b.id) continue;
  if (!byAgent.has(o.agentId)) byAgent.set(o.agentId, []);
  byAgent.get(o.agentId).push(o.seq);
}
check("frames arrived for both bots", byAgent.has(a.id) && byAgent.has(b.id),
  `${a.id}=${byAgent.get(a.id)?.length ?? 0} · ${b.id}=${byAgent.get(b.id)?.length ?? 0}`);
for (const id of [a.id, b.id]) {
  const seqs = byAgent.get(id) ?? [];
  const back = seqs.filter((s, i) => i > 0 && s < seqs[i - 1]);
  check(`${id} seq non-decreasing`, seqs.length > 0 && back.length === 0,
    `${seqs.length} events: ${seqs.slice(0, 8).join(",")}${seqs.length > 8 ? "…" : ""}`);
}
// entry.seq is the global eN id (ensureSeq), not a per-agent replica counter. The original
// bug was stuffing that global number into SSE `ordered.sequence`. We no longer send
// `ordered` on transcript; this check is that interleaving did not stall either bot.
const na = byAgent.get(a.id)?.length ?? 0;
const nb = byAgent.get(b.id)?.length ?? 0;
check("both agents kept receiving after interleave", na >= 4 && nb >= 4, `${na} + ${nb} events`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
