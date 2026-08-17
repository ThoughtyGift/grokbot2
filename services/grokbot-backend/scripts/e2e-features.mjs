/**
 * Feature-level E2E: every surface this backend claims, driven through the gateway.
 *
 * Deliberately NOT through the UI. `e2e-app-full.mjs` drives the real app and is the right tool for
 * "does the client render it", but its keystrokes drop often enough that a red box there says more
 * about Playwright than about the backend — measured: the same prompt that failed to submit in the UI
 * completed against the box in 6.1s through `sendPrompt`. This script answers the other question,
 * "does the backend actually do it", and answers it deterministically.
 *
 * Each check states what it would take to pass, so a failure names the missing capability rather than
 * just going red.
 */
import fs from "node:fs";

const BASE = "http://127.0.0.1:8788";
const TOKEN = fs.readFileSync(".data/gateway-token.txt", "utf8").trim();
const results = [];
const step = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

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

/** Send one prompt and wait for the turn to go idle, returning everything it produced. */
async function turn(agentId, text, ms = 150_000) {
  const before = ((await gw("getAgentTranscriptTail", { agentId }))?.entries ?? []).length;
  const t0 = Date.now();
  await gw("sendPrompt", { agentId, text });
  while (Date.now() - t0 < ms) {
    const rows = await gw("listAgents", {});
    if (Array.isArray(rows) && !rows.some((r) => r.id === agentId && r.isRunning)) break;
    await sleep(1200);
  }
  const tail = await gw("getAgentTranscriptTail", { agentId });
  const fresh = (tail?.entries ?? []).slice(before);
  return {
    fresh,
    tools: fresh.filter((e) => e.kind === "tool-call"),
    texts: fresh.filter((e) => e.kind === "send-message" && String(e.message?.content ?? "").trim()),
    types: [...new Set(fresh.map((e) => e.message?.type).filter(Boolean))],
    ms: Date.now() - t0,
  };
}

const made = await gw("createAgent", { name: "e2e-features" });
const agentId = made?.agent?.id ?? made?.id;
step("createAgent returns an id", Boolean(agentId), agentId ?? "none");

// ── health and roster ────────────────────────────────────────────────────────
const health = await (await fetch(`${BASE}/health`)).json().catch(() => ({}));
step("/health answers with the fields the client reads", Boolean(health?.ok && "isBusy" in health && "status" in health),
  Object.keys(health).join(","));
const roster = await gw("listAgents", {});
step("listAgents returns the roster", Array.isArray(roster) && roster.length > 0, `${roster?.length ?? 0} bot`);

// ── plain answer, no tool ────────────────────────────────────────────────────
const plain = await turn(agentId, "Tra loi that ngan: 2+2 bang may?");
step("a plain question answers without calling a tool", plain.texts.length > 0 && plain.tools.length === 0,
  `${plain.tools.length} tool, ${Math.round(plain.ms / 100) / 10}s`);

// ── box: read-only tool ──────────────────────────────────────────────────────
const read = await turn(agentId, "Doc file ghi-chu.md trong box.");
step("a read-only box tool runs without asking approval",
  read.tools.some((t) => t.name === "read_file_v2" && t.status === "done"),
  read.tools.map((t) => `${t.name}/${t.status}`).join(", ") || "no tool");

// ── P5-2: several tools in ONE turn ──────────────────────────────────────────
const multi = await turn(agentId, "Doc CA HAI file ghi-chu.md va loi_ich_doc_sach.md trong box, trong CUNG mot luot.");
const reads = multi.tools.filter((t) => t.name === "read_file_v2" && t.status === "done");
step("P5: two tools run in one turn, answered once", reads.length >= 2 && multi.texts.length <= 2,
  `${reads.length} read, ${multi.texts.length} bubble, ${Math.round(multi.ms / 100) / 10}s`);

// ── approval gate still stands for side-effecting tools ──────────────────────
// Drive the standing setting, do not assume it. `hostSettings.localToolPermission` is "always" on this
// install, and with it set every tool runs straight through by design — so the first version of this
// check reported "no permission card" and I read it as the gate being broken. It was the test that was
// wrong. Set "ask", prove the card appears, then put the user's setting back.
const wasPermission = (await gw("getHostSettings", {}))?.localToolPermission ?? "ask";
await gw("setHostSettings", { localToolPermission: "ask" });
const shell = await turn(agentId, "Chay lenh `df -h /` trong box.", 90_000);
const card = shell.fresh.find((e) => e.message?.type === "local-tool-permission");
await gw("setHostSettings", { localToolPermission: wasPermission });
// Name the tools when it fails. "no permission card" is true both when the gate is broken and when
// the model simply reached for a read-only tool instead, and those want opposite responses.
step("a side-effecting tool asks for approval (with localToolPermission=ask)", Boolean(card),
  card ? `card: ${String(card.message.ask.target).slice(0, 46)}`
       : `no permission card — tools: ${shell.tools.map((t) => `${t.name}/${t.status}`).join(", ") || "none"}`);

// ── web ──────────────────────────────────────────────────────────────────────
const web = await turn(agentId, "Tim tren web: ty gia USD sang VND hom nay.");
step("web_search reaches the network", web.tools.some((t) => t.name === "web_search" && t.status === "done"),
  web.tools.map((t) => `${t.name}/${t.status}`).join(", ") || "no tool");

// ── widget (ask_question) ────────────────────────────────────────────────────
const ask = await turn(agentId, "Hoi minh mot cau de chon giua hai huong: lam nhanh hay lam ky. Dung cong cu hoi.", 90_000);
step("ask_question renders a widget", ask.types.includes("widget"), ask.types.join(", ") || "none");

// ── memory ───────────────────────────────────────────────────────────────────
const mem = await turn(agentId, "Nho gium minh: minh ten Khanh Duy, thich tra loi ngan gon.");
step("knowledge_base stores a durable fact", mem.tools.some((t) => t.name === "knowledge_base" && t.status === "done"),
  mem.tools.map((t) => t.name).join(", ") || "no tool");

// ── avatar bytes ─────────────────────────────────────────────────────────────
// With the auth header. Both this and the stream below were written as bare fetches and both came
// back 401 — a red box that said nothing about the backend and everything about the test, since the
// gateway has been in enforce mode all evening.
const av = await fetch(`${BASE}/gw/avatars/${agentId}?v=1`, { headers: { authorization: `Bearer ${TOKEN}` } });
step("avatar bytes are served", av.ok && String(av.headers.get("content-type")).startsWith("image/"),
  `HTTP ${av.status} ${av.headers.get("content-type")}`);

// ── MCP ──────────────────────────────────────────────────────────────────────
const mcp = await gw("refreshMcp", {});
step("refreshMcp answers", mcp !== undefined && mcp !== null, JSON.stringify(mcp).slice(0, 60));

// ── event stream ─────────────────────────────────────────────────────────────
const ev = await fetch(`${BASE}/gw/events`, {
  headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(2500),
}).catch((e) => e);
step("/gw/events holds the connection open (long poll)",
  ev?.name === "TimeoutError" || ev?.ok === true, ev?.name ?? `HTTP ${ev?.status}`);

// ── rename, then delete ──────────────────────────────────────────────────────
await gw("updateAgent", { agentId, name: "e2e-renamed" });
const after = await gw("listAgents", {});
step("updateAgent renames the bot", after?.some?.((r) => r.id === agentId && r.name === "e2e-renamed"),
  after?.find?.((r) => r.id === agentId)?.name ?? "?");

await gw("deleteAgents", { agentIds: [agentId] });
const gone = await gw("listAgents", {});
step("deleteAgents removes it", !gone?.some?.((r) => r.id === agentId), `${gone?.length ?? "?"} bot left`);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed`);
if (pass < results.length) {
  console.log("\nfailed:");
  for (const r of results.filter((x) => !x.pass)) console.log(`  ${r.name}  — ${r.detail}`);
}
fs.writeFileSync(
  "C:/Users/admin/AppData/Local/Temp/claude/c--Users-admin-Desktop-grokbot2/eaada360-f857-4797-9134-91fa41755587/scratchpad/e2e-features.json",
  JSON.stringify(results, null, 2),
);
process.exit(pass === results.length ? 0 : 1);
