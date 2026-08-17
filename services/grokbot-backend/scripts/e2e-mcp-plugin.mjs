/**
 * E2E for the plugin path, matching the original's logic: a plugin (MCP server) is connected, the
 * agent sees its tools, and calls one. The original shows "Slack MCP server — 19 tools" then the agent
 * uses them; we prove the same mechanism with a credential-free MCP server (server-everything as
 * "toolbox"), so the OAuth broker (Cursor cloud, which we do not have) is not in the way of measuring
 * the tool-call path itself.
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

async function turn(id, text, ms = 90_000) {
  const t0 = Date.now();
  await gw("sendPrompt", { agentId: id, text });
  while (Date.now() - t0 < ms) {
    const r = await gw("listAgents", {});
    if (Array.isArray(r) && !r.some((x) => x.id === id && x.isRunning)) break;
    await sleep(1500);
  }
  return (await gw("getAgentTranscriptTail", { agentId: id }))?.entries ?? [];
}

// 1. plugin connected — the original's "Added"
const mcp = await gw("refreshMcp", {});
step("plugin (MCP server) da ket noi", mcp?.servers?.includes("toolbox") && mcp?.servers?.includes("CinAI"), (mcp?.servers || []).join(", "));

const made = await gw("createAgent", { name: "mcp-e2e" });
const id = made?.agent?.id ?? made?.id;

// 2. agent lists the plugin's tools (get_mcp_tools)
let entries = await turn(id, "Dung get_mcp_tools de xem toolbox co nhung cong cu gi.");
const gt = entries.filter((e) => e.kind === "tool-call" && e.name === "get_mcp_tools");
step("agent liet ke duoc tool cua plugin", gt.some((e) => e.status === "done" && /echo|get-sum|toolbox/.test(String(e.result))), gt.map((e) => e.name + "/" + e.status).join(", ") || "khong goi");

// 3. agent CALLS a plugin tool (call_mcp_tool) — the original's exact contract
entries = await turn(id, 'Goi cong cu get-sum cua server toolbox voi a=2 va b=3 bang call_mcp_tool. Cho biet ket qua.');
const ct = entries.filter((e) => e.kind === "tool-call" && e.name === "call_mcp_tool");
const called = ct.find((e) => e.status === "done");
step("agent GOI duoc tool cua plugin qua call_mcp_tool", Boolean(called), ct.map((e) => e.name + "/" + e.status).join(", ") || "khong goi");
if (called) console.log(`     ket qua tool: ${JSON.stringify(String(called.result).slice(0, 80))}`);
const answer = entries.filter((e) => e.kind === "send-message" && String(e.message?.content ?? "").trim()).pop();
console.log(`     agent tra loi: ${JSON.stringify(String(answer?.message?.content ?? "").slice(0, 90))}`);

await gw("deleteAgents", { agentIds: [id] });
const ok = pass.filter(Boolean).length;
console.log(`\n${ok}/${pass.length} PASS`);
process.exit(ok === pass.length ? 0 : 1);
