/**
 * The permission card must respect the answer the user already gave.
 *
 * The client persists it as `hostSettings.localToolPermission` and its own copy promises as much:
 * "Always allow … It can always be changed in Settings". Read off this machine it was already
 * `"always"` — the button had been pressed — and every later shell request still raised the card.
 * We were storing the setting and never consulting it, so the app looked like it was forgetting
 * an answer it had explicitly promised to keep.
 *
 * All three states are exercised, and the setting is restored at the end.
 *
 *   node scripts/e2e-standing-permission.mjs
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

const original = (await post("getHostSettings", {})).localToolPermission;
console.log(`localToolPermission hien tai: ${JSON.stringify(original)}`);

/** Fire one tool that is NOT auto-approved, and report what the transcript shows. */
async function tryTool(label) {
  const { agent } = await post("createAgent", { name: `Perm ${label} ${Date.now() % 1000}` });
  const before = ((await post("getAgentTranscript", { id: agent.id, limit: 30 })).entries ?? []).length;
  await post("sendPrompt", {
    agentId: agent.id, clientNonce: `p${Date.now()}${Math.random()}`,
    content: '/tool edit_file_v2 {"relative_workspace_path":"perm_probe.txt","contents_after_edit":"xin chao"}',
  });
  await sleep(8000);
  const fresh = ((await post("getAgentTranscript", { id: agent.id, limit: 30 })).entries ?? []).slice(before);
  const card = fresh.find((e) => e.message?.type === "local-tool-permission");
  const call = fresh.find((e) => e.kind === "tool-call");
  await post("deleteAgents", { ids: [agent.id] });
  return { card: card?.message?.ask?.status ?? null, status: call?.status ?? null, result: String(call?.result ?? "").slice(0, 60) };
}

try {
  console.log('\n1. "ask" — the card appears and the tool waits');
  await post("setHostSettings", { localToolPermission: "ask" });
  const asked = await tryTool("ask");
  check("a card is raised", asked.card === "pending", `card=${asked.card}`);
  check("the tool waits for it", asked.status === "pending", `status=${asked.status}`);

  console.log('\n2. "always" — no card, the tool just runs');
  await post("setHostSettings", { localToolPermission: "always" });
  const always = await tryTool("always");
  check("no card is raised", always.card === null, always.card ? `card=${always.card}` : "none");
  check("the tool ran", always.status === "done", `status=${always.status} ${always.result}`);

  console.log('\n3. "never" — refused out loud, not silently dropped');
  await post("setHostSettings", { localToolPermission: "never" });
  const never = await tryTool("never");
  check("the refusal is visible", never.card === "denied", `card=${never.card}`);
  check("the tool does not run, and says why", never.status === "done" && /chặn/.test(never.result),
    `status=${never.status} ${never.result}`);
} finally {
  // Put the user's own setting back, whatever it was.
  await post("setHostSettings", { localToolPermission: original ?? "ask" });
  console.log(`\nda tra lai localToolPermission = ${JSON.stringify((await post("getHostSettings", {})).localToolPermission)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
