/**
 * Full routine flow through the REAL app over CDP, tracing where the data is lost.
 *
 * The bug: the agent reports the routine created, the transcript shows "Created routine • <name>", but
 * clicking it opens an EMPTY editor. The client editor looks the routine up by id in its local store
 * (`n.automations.get(automationId)`, a per-agent Map fed by the agents-automation SSE event), so an
 * empty form means the store never got it — or got it under a different id than the click asks for.
 *
 * This checks each hop: backend has it, the transcript event's automationId, the SSE push's ids, and
 * finally the rendered editor form.
 */
import { chromium } from "playwright-core";
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
const step = (n, ok, d = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);

// Capture the SSE push ids while the turn runs.
let pushedIds = null;
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
      try { const j = JSON.parse(line.slice(5).trim()); if (j.channel === "agents-automation") pushedIds = (j.payload?.automations || []).map((a) => a.id); } catch {}
    }
    buf = buf.slice(buf.lastIndexOf("\n") + 1);
  }
})();
await sleep(400);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith("devtools://"));

const made = await gw("createAgent", { name: "routine-ui" });
const id = made?.agent?.id ?? made?.id;
await page.locator('text="routine-ui"').first().click({ timeout: 15_000 }).catch(() => {});
await sleep(800);

// Create a routine via the tool.
const t0 = Date.now();
await gw("sendPrompt", { agentId: id, text: 'Tao routine chay 8h sang moi ngay, viec tong hop tin tuc AI, ten "Daily AI News".' });
while (Date.now() - t0 < 120_000) {
  const rows = await gw("listAgents", {});
  if (Array.isArray(rows) && !rows.some((r) => r.id === id && r.isRunning)) break;
  await sleep(1500);
}
await sleep(1500);

// 1. backend has it
const autos = await gw("getAgentAutomations", { id });
const beId = autos[0]?.id;
step("backend luu routine", autos.length >= 1, JSON.stringify(autos.map((a) => a.id + "/" + a.name)));

// 2. transcript event id
const entries = (await gw("getAgentTranscriptTail", { agentId: id }))?.entries ?? [];
const evt = entries.filter((e) => e.kind === "event" && e.event?.type === "automation-changed").pop();
const evtId = evt?.event?.automationId;
step("transcript automation-changed co automationId", Boolean(evtId), `event id=${evtId}`);

// 3. SSE push ids
step("SSE 'agents-automation' day danh sach co id", Array.isArray(pushedIds) && pushedIds.length > 0, `pushed=${JSON.stringify(pushedIds)}`);

// 4. do the ids MATCH — the click asks for evtId, the store is keyed by pushedIds
const idsMatch = evtId && pushedIds?.includes(evtId) && beId === evtId;
step("id KHOP giua backend / transcript / push", Boolean(idsMatch),
  `backend=${beId} event=${evtId} push=${JSON.stringify(pushedIds)}`);

// 5. click the transcript link and read the editor form
const link = page.locator('text=/Created routine|Daily AI News/').last();
await link.click({ timeout: 8000 }).catch(() => {});
await sleep(1500);
const nameVal = await page.locator('input[placeholder*="Name" i], input[value]').first().inputValue().catch(() => "");
const bodyText = await page.evaluate(() => document.body.innerText || "");
const editorHasName = bodyText.includes("Daily AI News");
step("editor hien du lieu routine sau khi click", editorHasName, editorHasName ? "co ten routine" : `name input=${JSON.stringify(nameVal)}`);

await gw("deleteAgents", { agentIds: [id] });
await browser.close();
process.exit(0);
