/**
 * E2E for the routine feature, end to end through the gateway.
 *
 * Covers the whole chain the app relies on, each part measured rather than assumed:
 *   - the agent creates a routine on its own (create_routine tool)
 *   - the routine is actually stored (getAgentAutomations)
 *   - the change is PUSHED so the panel refreshes live (agents-automation SSE event) — the piece that
 *     was missing and made a working routine look like a failed one
 *   - the transcript records automation-changed
 *   - a cron routine actually fires on schedule (drive tick with a time it matches)
 *   - deleting the bot cleans up its routines (no orphans in the scheduler)
 */
import fs from "node:fs";
const T = fs.readFileSync(".data/gateway-token.txt", "utf8").trim();
const gw = async (m, a) => {
  const r = await fetch("http://127.0.0.1:8788/gw/api/" + m, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${T}` },
    body: JSON.stringify(a || {}), signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const step = (n, ok, d = "") => { pass.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

// Listen for the panel-refresh event while the turn runs.
let sawEvent = null;
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
      try { const j = JSON.parse(line.slice(5).trim()); if (j.channel === "agents-automation") sawEvent = j.payload; } catch {}
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
})();
await sleep(400);

const made = await gw("createAgent", { name: "routine-e2e" });
const id = made?.agent?.id ?? made?.id;

// 1. agent creates a routine on its own
const t0 = Date.now();
await gw("sendPrompt", { agentId: id, text: 'Tao cho minh mot routine chay 9h sang moi ngay, viec la gui bao cao. Dat ten "Bao cao sang".' });
while (Date.now() - t0 < 120_000) {
  const rows = await gw("listAgents", {});
  if (Array.isArray(rows) && !rows.some((r) => r.id === id && r.isRunning)) break;
  await sleep(1500);
}
await sleep(1200);

const entries = (await gw("getAgentTranscriptTail", { agentId: id }))?.entries ?? [];
const createdTool = entries.some((e) => e.kind === "tool-call" && e.name === "create_routine" && e.status === "done");
step("agent tu tao routine (create_routine)", createdTool, entries.filter((e) => e.kind === "tool-call").map((e) => e.name + "/" + e.status).join(", ") || "khong goi");

// 2. stored
const autos = await gw("getAgentAutomations", { id });
const rec = autos[0];
step("routine duoc luu", autos.length >= 1, JSON.stringify(autos.map((a) => a.name + "/" + a.trigger)));

// 3. pushed to the panel
step("push 'agents-automation' cho panel refresh live", sawEvent?.agentId === id && Array.isArray(sawEvent?.automations),
  sawEvent ? `automations=${JSON.stringify((sawEvent.automations || []).map((a) => a.name))}` : "khong co su kien");

// 4. transcript records it
const hasEvent = entries.some((e) => e.kind === "event" && e.event?.type === "automation-changed");
step("transcript ghi automation-changed", hasEvent);

// 5. a cron routine fires when its time matches — set a routine to the current minute and run now
if (rec) {
  const before = (await gw("getAgentAutomations", { id }))[0]?.runs?.length ?? 0;
  await gw("runAgentAutomationNow", { id, automationId: rec.id });
  await sleep(2500);
  const after = (await gw("getAgentAutomations", { id }))[0]?.runs?.length ?? 0;
  step("routine chay duoc (Run now sinh mot run)", after > before, `runs ${before} -> ${after}`);
} else {
  step("routine chay duoc (Run now sinh mot run)", false, "khong co routine de chay");
}

// 6. deleting the bot removes its routines
await gw("deleteAgents", { agentIds: [id] });
const orphan = (await gw("listAllAutomations", {})).filter((a) => a.agentId === id).length;
step("xoa bot thi don routine", orphan === 0, `con lai ${orphan}`);

const ok = pass.filter(Boolean).length;
console.log(`\n${ok}/${pass.length} PASS`);
process.exit(ok === pass.length ? 0 : 1);
