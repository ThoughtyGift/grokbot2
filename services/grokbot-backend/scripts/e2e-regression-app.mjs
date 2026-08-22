/**
 * Every fix from this session, re-checked against the running app — not just the backend.
 *
 * The distinction matters: the transcript bug had correct data in the backend the whole time and
 * was invisible from there. So each claim below is measured where it can actually fail, and the
 * app-side ones read `document.body.innerText` through CDP.
 *
 *   1. transcript reaches the screen        — the per-agent sequence fix (parity.md §2ac)
 *   2. the model narrates before a tool      — the prompt no longer forbids it (§2ab area)
 *   3. images arrive as pictures, not links  — attach_image (§2u)
 *   4. renaming needs no permission card     — AUTO_APPROVED
 *   5. the computer pane is pushed           — forever-box channel (§2ad)
 *
 * It sends to whichever bot is OPEN in the app, because a bubble that renders in a conversation
 * nobody is looking at proves nothing about what the user sees.
 *
 *   node scripts/e2e-regression-app.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const BASE = "http://localhost:8788";
const APP_CDP = process.env.APP_CDP ?? "http://127.0.0.1:9222";
const post = async (m, b) => (await fetch(`${BASE}/gw/api/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, skip = 0;
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
      ws.removeEventListener("message", h); clearTimeout(to);
      res(d.result?.result?.value ?? null);
    });
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}
const screenText = async () => (await appEval("document.body.innerText")) ?? "";
// Words, not slices: the bubble renders markdown, so `**bold**` on the wire is plain on screen
// and a raw-substring ruler reports false misses. Learned the hard way earlier today.
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? [];
const coverage = (text, page) => {
  const w = words(text);
  if (w.length === 0) return 0;
  const seen = new Set(words(page));
  return w.filter((x) => seen.has(x)).length / w.length;
};

/**
 * Open a fresh conversation in the app, and drive it from there.
 *
 * Detecting whichever bot happened to be open turned out to be unreliable and unnecessary: the
 * page text begins with the sidebar, where every bot's name appears, and the composer exposes no
 * `placeholder` attribute to key off. Worse, the app can sit on "No Bot selected." with nothing
 * to detect at all.
 *
 * `element.click()` does work here, which `Input.dispatchMouseEvent` never did — the synthetic
 * event bubbles to React's delegated listener without needing real cursor coordinates or window
 * focus. So the test opens its own bot and leaves nothing to chance.
 */
const page0 = await screenText();
if (!page0) { console.log(`app khong phan hoi tren ${APP_CDP} — mo app roi chay lai`); process.exit(1); }
const NAME = `Regression ${new Date().toISOString().slice(11, 19)}`;
const open = (await post("createAgent", { name: NAME })).agent;
let selected = false;
for (let i = 0; i < 12 && !selected; i++) {
  await sleep(1000);   // the sidebar row arrives by push, ~1.5s
  const r = await appEval(`(() => {
    const hit = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(NAME)});
    if (hit.length === 0) return "no-row";
    let n = hit[0];
    for (let i = 0; i < 6 && n; i++) { n.click(); n = n.parentElement; }
    return "clicked";
  })()`);
  if (r === "clicked") { await sleep(1500); selected = (await screenText()).includes("Create Routine"); }
}
check("the new bot appears in the sidebar and opens", selected, selected ? NAME : "could not select it");
if (!selected) { console.log("\nkhong mo duoc hoi thoai trong app — dung lai de khong bao cao ket qua khong do duoc."); process.exit(1); }
console.log(`bot dang mo tren app: ${open.name} (${open.id})\n`);

const tail = async () => ((await post("getAgentTranscript", { id: open.id, limit: 60 })).entries ?? []);

console.log("1. a streamed reply reaches the screen while it is still arriving");
{
  const before = (await tail()).length;
  await post("sendPrompt", {
    agentId: open.id, clientNonce: `rg${Date.now()}`,
    content: "Viet mot doan khoang 200 chu ve loi ich cua di bo buoi sang.",
  });
  // Sample REPEATEDLY while it streams, and keep the best reading. One sample was worth nothing:
  // it can land in the gap between the backend appending a chunk and the renderer painting it,
  // and then reports 0% for a screen that updates perfectly a moment later.
  let mid = 0, samples = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(700);
    const t = await tail();
    const last = t.at(-1);
    const len = String(last?.message?.content ?? "").length;
    if (len > 100 && last?.streaming !== false) {
      samples += 1;
      mid = Math.max(mid, coverage(String(last.message.content).slice(0, 120), await screenText()));
    }
    if (len > 0 && last?.streaming === false) break;
  }
  await sleep(3000);
  const done = (await tail()).at(-1);
  const reply = String(done?.message?.content ?? "");
  const cov = coverage(reply, await screenText());
  check("the turn produced a reply", reply.length > 80, `${reply.length} chars`);
  // The claim is "text reaches the screen while the reply is still arriving", not "the screen
  // keeps pace". It cannot keep pace by design: runTurn feeds a typewriter buffer that reveals
  // text more slowly than the pool delivers it (GROKBOT2_PROGRESSIVE=0 turns that off), so a
  // high threshold at an arbitrary instant measures the buffer's speed, not the transport.
  // A direct probe sampling every second read 8/9 → 41/46 → 74/97 → 205/205 words.
  check("it was on screen mid-stream", samples === 0 || mid > 0.25,
    samples === 0 ? "finished too fast to sample" : `best of ${samples} samples: ${Math.round(mid * 100)}% of the opening (typewriter buffer runs behind on purpose)`);
  // The end of the reply is everything generated after the first frame — the part the old
  // sequence gap used to strand.
  check("the whole reply is on screen", cov > 0.9, `${Math.round(cov * 100)}% of ${words(reply).length} words`);
  check("entries grew", (await tail()).length > before, `${before} → ${(await tail()).length}`);
}

console.log("\n2. the model says what it is about to do, then does it");
{
  const before = (await tail()).length;
  await post("sendPrompt", {
    agentId: open.id, clientNonce: `rn${Date.now()}`,
    content: "Mo example.com va cho toi biet trang do noi gi.",
  });
  // Wait for the TURN to finish, not for the first finished bubble — the narration bubble closes
  // before the tool even runs, so the old condition stopped counting one bubble too early and
  // reported a working two-bubble turn as one.
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const rows = await post("listAgents", {});
    const me = (Array.isArray(rows) ? rows : rows.agents).find((a) => a.id === open.id);
    const t = (await tail()).slice(before);
    if (me?.isRunning === false && t.some((e) => e.kind === "tool-call")) break;
  }
  await sleep(2500);
  const fresh = (await tail()).slice(before);
  const bubbles = fresh.filter((e) => e.message?.type === "text" && String(e.message.content).trim().length > 0);
  const tools = fresh.filter((e) => e.kind === "tool-call");
  check("a tool ran", tools.length > 0, tools.map((e) => e.name).join(", ") || "none");
  check("two bubbles, not one", bubbles.length >= 2, `${bubbles.length} bubble(s)`);
  check("no raw TOOL_CALL leaked into a bubble", !bubbles.some((b) => /TOOL_CALL:/.test(b.message.content)),
    bubbles.map((b) => String(b.message.content).slice(0, 34)).join(" | ").slice(0, 90));
}

console.log("\n3. an image from the web arrives as a picture");
{
  const before = (await tail()).length;
  await post("sendPrompt", {
    agentId: open.id, clientNonce: `ri${Date.now()}`,
    content: '/tool attach_image {"urls":["https://picsum.photos/seed/reg/320/200.jpg","https://www.gstatic.com/webp/gallery/2.webp"]}',
  });
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    if ((await tail()).slice(before).filter((e) => e.message?.type === "attachment").length >= 2) break;
  }
  const atts = (await tail()).slice(before).filter((e) => e.message?.type === "attachment");
  check("both images attached in one step", atts.length === 2, atts.map((a) => a.message.url.split("/").pop()).join(", ") || "none");
  for (const a of atts) {
    const img = await post("readAttachmentImage", { path: a.message.url });
    check(`${a.message.file_name} has real dimensions`, img?.width > 0 && img?.height > 0, img ? `${img.width}x${img.height}` : "null");
  }
}

console.log("\n4. renaming a bot asks for no permission");
{
  const probe = (await post("createAgent", { name: "RegRename" })).agent;
  const before = ((await post("getAgentTranscript", { id: probe.id, limit: 30 })).entries ?? []).length;
  await post("sendPrompt", { agentId: probe.id, clientNonce: `rr${Date.now()}`, content: '/tool rename_agent {"to":"RegRenamed"}' });
  await sleep(6000);
  const fresh = ((await post("getAgentTranscript", { id: probe.id, limit: 30 })).entries ?? []).slice(before);
  const call = fresh.find((e) => e.kind === "tool-call");
  check("the rename ran straight away", call?.status === "done", `status=${call?.status ?? "no tool-call"}`);
  const rows = await post("listAgents", {});
  const me = (Array.isArray(rows) ? rows : rows.agents).find((a) => a.id === probe.id);
  check("the name changed", me?.name === "RegRenamed", me?.name ?? "?");
  await post("deleteAgents", { ids: [probe.id] });
}

console.log("\n5. the computer pane status is pushed, not polled");
{
  const seen = [];
  const stream = await fetch(`${BASE}/gw/events`, { headers: { accept: "text/event-stream", ...gwHeaders() } });
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
      for (const p of parts) {
        const d = p.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (!d) continue;
        try { const ev = JSON.parse(d); if (ev.channel === "forever-box") seen.push(ev.payload); } catch { /* keepalive */ }
      }
    }
  })();
  const { agent: box } = await post("createAgent", { name: "RegBox" });
  await post("ensureForeverBox", { id: box.id });
  await sleep(2000);
  const mine = seen.filter((f) => f.agentId === box.id);
  check("a forever-box frame was pushed", mine.length > 0, mine.map((f) => f.state).join(" → ") || "none");
  check("it carries agentId and a vncUrl", mine[0]?.agentId === box.id && typeof mine[0]?.vncUrl === "string",
    mine[0] ? `${mine[0].agentId}, vncUrl ${mine[0].vncUrl ? "set" : "MISSING"}` : "-");
  reader.cancel().catch(() => {});
  await post("deleteAgents", { ids: [box.id] });
}

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`);
try { ws?.close(); } catch { /* already closed */ }
process.exit(fail ? 1 : 0);
