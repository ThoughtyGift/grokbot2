/**
 * Replay the ORIGINAL app's "Thư ký" conversation against this backend, turn for turn.
 *
 * The inputs are not invented: they come from the original client's own stored replica
 * (`.data/profile-real/sand-client-persistence`, the same ordered-replica protocol this backend
 * emulates), so the comparison is against what the real product actually did, not a paraphrase of it.
 *
 * One agent for the whole run, sequentially, because the conversation is stateful — turn 19 asks for
 * bots that turn 18 discussed. Each turn waits for the agent to go idle before the next is sent;
 * firing them off in a batch would abort each turn with the next one, which is a mistake this repo's
 * E2E harness has already made once.
 */
import fs from "node:fs";

const BASE = "http://127.0.0.1:8788";
const TOKEN = fs.readFileSync(".data/gateway-token.txt", "utf8").trim();
const SCRATCH = "C:/Users/admin/AppData/Local/Temp/claude/c--Users-admin-Desktop-grokbot2/eaada360-f857-4797-9134-91fa41755587/scratchpad";
const TURN_TIMEOUT_MS = 150_000;

const gw = async (method, args) => {
  const r = await fetch(`${BASE}/gw/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const turns = JSON.parse(fs.readFileSync(`${SCRATCH}/thuky-user-turns.json`, "utf8"));
const BRIEF =
  "Thư ký cinai.tv. User chat ở đây hoặc qua kênh đã nối. Giao đúng 1 việc cho Gmail, Discord CSKH, " +
  "Marketing, Sales, Onboarding. Không tự gửi mail, không CSKH Discord, không đăng social, không chốt PLUS.";

const made = await gw("createAgent", { name: "Thư ký (replay)", brief: BRIEF, prompt: BRIEF });
const agentId = made?.agent?.id ?? made?.id ?? made?.agentId;
console.log(`agent ${agentId} — ${turns.length} luot\n`);

const out = [];
for (const [i, text] of turns.entries()) {
  const before = ((await gw("getAgentTranscriptTail", { agentId }))?.entries ?? []).length;
  const t0 = Date.now();
  const sent = await gw("sendPrompt", { agentId, text });
  if (!sent?.accepted) { console.log(`${String(i + 1).padStart(2)}. KHONG GUI DUOC: ${JSON.stringify(sent).slice(0, 80)}`); continue; }

  // Wait for the turn to START before waiting for it to finish.
  //
  // Waiting only for idle looks right and silently measures nothing: `sendPrompt` returns as soon as
  // it is accepted, `isRunning` has not flipped yet, so the idle check passes immediately and the
  // transcript is sampled before the turn produces anything. That is how a run came back with 22 of
  // 66 turns blank and no error anywhere — and the resulting parity table read those blanks as
  // missing surfaces. Same fault this repo's app harness already had, unfixed here until it bit.
  const started = await (async () => {
    while (Date.now() - t0 < 30_000) {
      const rows = await gw("listAgents", {});
      if (Array.isArray(rows) && rows.some((r) => r.id === agentId && r.isRunning)) return true;
      if ((await gw("getAgentTranscriptTail", { agentId }))?.entries?.length > before) return true;
      await sleep(300);
    }
    return false;
  })();
  while (started && Date.now() - t0 < TURN_TIMEOUT_MS) {
    const rows = await gw("listAgents", {});
    if (Array.isArray(rows) && !rows.some((r) => r.id === agentId && r.isRunning)) break;
    await sleep(1500);
  }
  const tail = await gw("getAgentTranscriptTail", { agentId });
  const fresh = (tail?.entries ?? []).slice(before);
  const replies = fresh.filter((e) => e.kind === "send-message" && String(e.message?.content ?? "").trim());
  const tools = fresh.filter((e) => e.kind === "tool-call");
  const kinds = [...new Set(fresh.map((e) => `${e.kind}/${e.message?.type ?? "-"}`))];

  const record = {
    n: i + 1,
    input: text,
    ms: Date.now() - t0,
    reply: replies.map((e) => String(e.message?.content ?? "")).join("\n---\n"),
    tools: tools.map((e) => `${e.name}/${e.status}`),
    kinds,
    // A turn that produced nothing is a hole in the comparison, not a data point. Marked here so the
    // table can exclude it instead of reading it as "the backend emitted no surfaces".
    blank: fresh.length === 0,
  };
  out.push(record);
  const flag = record.blank ? "  ⟵ TRONG, khong ghi duoc gi" : "";
  console.log(`${String(i + 1).padStart(2)}. ${String(Math.round(record.ms / 100) / 10 + "s").padStart(6)}  tool=${record.tools.length}  ${JSON.stringify(text.slice(0, 40))} -> ${JSON.stringify(record.reply.slice(0, 60).replace(/\n/g, " "))}${flag}`);
  fs.writeFileSync(`${SCRATCH}/replay-local.json`, JSON.stringify(out, null, 2));
}

const blanks = out.filter((r) => r.blank);
console.log(`\nxong ${out.length}/${turns.length} luot -> ${SCRATCH}/replay-local.json`);
if (blanks.length) {
  console.log(`\nCANH BAO: ${blanks.length} luot khong ghi duoc gi (${blanks.map((r) => r.n).join(", ")}).`);
  console.log("Bang doi chieu se BO QUA nhung luot nay — dung doc chung nhu be mat thieu.");
}
await gw("deleteAgents", { agentIds: [agentId] });
process.exit(0);
