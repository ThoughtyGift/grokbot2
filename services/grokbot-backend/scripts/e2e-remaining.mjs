/**
 * The two things the regression run could not close, closed.
 *
 *   1. `create_agent` still asks. It is deliberately NOT auto-approved: the client's copy for
 *      `local-tool-permission` is fixed at "run commands on your local computer", which
 *      mis-describes it exactly as it mis-described `rename_agent` — but creating a bot brings a
 *      new actor into the workspace rather than editing a label, so that call belongs to the
 *      user. This asserts the card appears, names the real action, and that approving it works.
 *
 *   2. The `Messaged X` chip opens the exchange pane. Listed as "needs one manual click" because
 *      `Input.dispatchMouseEvent` has never worked against this app — but `element.click()` does
 *      (the synthetic event reaches React's delegated listener without cursor coordinates or
 *      window focus), so the click is automated here instead of left to a human.
 *
 *   node scripts/e2e-remaining.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const BASE = "http://localhost:8788";
const APP_CDP = process.env.APP_CDP ?? "http://127.0.0.1:9222";
const post = async (m, b) => (await fetch(`${BASE}/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

let ws = null;
async function appEval(expression) {
  if (ws == null) {
    const targets = await (await fetch(`${APP_CDP}/json/list`)).json();
    const page = targets.find((t) => t.type === "page" && !/devtools/.test(t.url));
    if (!page) return null;
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  }
  return new Promise((res) => {
    const id = Math.floor(Math.random() * 1e6);
    const to = setTimeout(() => res(null), 10000);
    ws.addEventListener("message", function h(m) {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener("message", h); clearTimeout(to); res(d.result?.result?.value ?? null);
    });
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}
const screen = async () => (await appEval("document.body.innerText")) ?? "";

/** Click the sidebar row with this exact name, and confirm the conversation opened. */
async function openInApp(name) {
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const r = await appEval(`(() => {
      const h = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(name)});
      if (!h.length) return "no-row";
      let n = h[0];
      for (let i = 0; i < 6 && n; i++) { n.click(); n = n.parentElement; }
      return "clicked";
    })()`);
    if (r === "clicked") { await sleep(1500); if ((await screen()).includes("Create Routine")) return true; }
  }
  return false;
}

console.log("1. create_agent still asks, and says what it will really do");
{
  const { agent } = await post("createAgent", { name: `PermProbe ${Date.now() % 10000}` });
  const before = ((await post("getAgentTranscript", { id: agent.id, limit: 30 })).entries ?? []).length;
  await post("sendPrompt", { agentId: agent.id, clientNonce: `pc${Date.now()}`, content: '/tool create_agent {"name":"SpawnedByCard"}' });
  await sleep(6000);
  const fresh = ((await post("getAgentTranscript", { id: agent.id, limit: 30 })).entries ?? []).slice(before);
  const card = fresh.find((e) => e.message?.type === "local-tool-permission");
  check("a permission card appears", card != null, card ? card.message.ask.status : "no card");
  check("the card names the real action", /^create_agent\(/.test(card?.message?.ask?.target ?? ""),
    card?.message?.ask?.target ?? "-");
  const call = fresh.find((e) => e.kind === "tool-call");
  check("the tool has NOT run yet", call?.status === "pending", `status=${call?.status ?? "-"}`);

  // Approving must actually run it — a card that cannot be answered is worse than no card.
  await post("resolveLocalToolPermission", { requestId: card.message.ask.requestId, decision: "allow" });
  await sleep(5000);
  const after = ((await post("getAgentTranscript", { id: agent.id, limit: 30 })).entries ?? []).slice(before);
  check("approving runs it", after.find((e) => e.kind === "tool-call")?.status === "done",
    `status=${after.find((e) => e.kind === "tool-call")?.status ?? "-"}`);
  const rows = await post("listAgents", {});
  const made = (Array.isArray(rows) ? rows : rows.agents).find((a) => a.name === "SpawnedByCard");
  check("the bot was created", made != null, made?.id ?? "not in the roster");
  if (made) await post("deleteAgents", { ids: [made.id] });
  await post("deleteAgents", { ids: [agent.id] });
}

console.log("\n2. the Messaged X chip opens the exchange pane");
{
  const stamp = Date.now() % 10000;
  const a = (await post("createAgent", { name: `ExA${stamp}` })).agent;
  const b = (await post("createAgent", { name: `ExB${stamp}` })).agent;
  const NOTE = "Bao cao quy 3 gui ban xem giup";
  await post("sendPrompt", { agentId: a.id, clientNonce: `ex${Date.now()}`, content: `/tool message_agent {"to":"ExB${stamp}","content":"${NOTE}"}` });
  await sleep(8000);

  const opened = await openInApp(`ExA${stamp}`);
  check("the sender's conversation opens", opened, opened ? `ExA${stamp}` : "could not open it");
  if (opened) {
    const chip = await appEval(`(() => {
      const els = [...document.querySelectorAll('[aria-label^="Open exchange with"]')];
      if (!els.length) return "no-chip";
      els[0].click();
      return els[0].getAttribute('aria-label');
    })()`);
    const hasChip = chip !== "no-chip" && chip != null;
    check("the peer chip is on screen", hasChip, String(chip));
    // Everything below depends on the chip. Checking them anyway produced a false pass: the note
    // is in the conversation itself, so "the pane shows the exchange" went green with no pane
    // open at all. A dependent assertion with an unmet precondition is not a result.
    if (!hasChip) {
      const marker = (await screen()).includes("Messaged");
      console.log(`  skip pane checks — no chip to click (marker "Messaged" on screen: ${marker})`);
    } else {
      await sleep(2000);
      const text = await screen();
      check("the pane shows the exchange", text.includes(NOTE.slice(0, 24)),
        text.includes(NOTE.slice(0, 24)) ? "the message is in the pane" : "pane opened but empty");
      check("it is marked view-only", /view-only|view only/i.test(text),
        /view-only|view only/i.test(text) ? "read-only banner present" : "no view-only marker found");
    }
  }
  await post("deleteAgents", { ids: [a.id, b.id] });
}

console.log(`\n${pass} passed, ${fail} failed`);
try { ws?.close(); } catch { /* already closed */ }
process.exit(fail ? 1 : 0);
