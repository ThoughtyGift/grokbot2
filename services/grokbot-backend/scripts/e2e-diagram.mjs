/**
 * Does a mermaid code fence render as a diagram, with no tool at all?
 *
 * `create_diagram` is one of the 27 catalog tools we lack, and its proto is a single field
 * (`CreateDiagramParams { content }`). But the renderer already bundles `mermaid.core-*.js` and
 * dispatches on the code-fence language:
 *
 *   if (c === "mermaid") { return <mwn code={u} fallback={x}/> }
 *
 * If that path works, the "missing tool" is a prompt line, not a tool — so this measures before
 * anything gets built. A drawn diagram means an <svg> inside the transcript that was not there
 * before; the fence text alone proves nothing, since unrendered markdown also contains it.
 *
 *   node scripts/e2e-diagram.mjs
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

const NAME = `Diagram ${new Date().toISOString().slice(11, 19)}`;
const bot = (await post("createAgent", { name: NAME })).agent;
let opened = false;
for (let i = 0; i < 14 && !opened; i++) {
  await sleep(1000);
  const r = await appEval(`(() => {
    const h = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(NAME)});
    if (!h.length) return "no";
    let n = h[0]; for (let i = 0; i < 6 && n; i++) { n.click(); n = n.parentElement; }
    return "yes";
  })()`);
  if (r === "yes") { await sleep(1500); opened = true; }
}
// "Create Routine" was the old proof that the conversation opened, and it is not proof: the right
// rail can be collapsed, and then a perfectly open conversation reads as closed — which is how
// this test failed on a working app. The real evidence comes later, when the reply's own words
// have to appear on screen, so the click is best-effort here.
check("the sidebar row was clickable", opened, opened ? NAME : "row never appeared");
if (!opened) { console.log("\nkhong thay dong bot trong sidebar — dung lai."); process.exit(1); }

// Count only diagram-shaped SVGs: the chrome is full of icon <svg>s, and counting those would
// make this pass before anything was drawn.
const diagramSvgs = () => appEval(`[...document.querySelectorAll('svg')].filter(s => (s.getAttribute('id')||'').includes('mermaid') || (s.getAttribute('aria-roledescription')||'') !== '' || s.querySelectorAll('g').length >= 3).length`);
const before = await diagramSvgs();

console.log("\n1. the model is asked for a diagram");
await post("sendPrompt", {
  agentId: bot.id, clientNonce: `dg${Date.now()}`,
  content: "Ve so do quy trinh 3 buoc: Nhan yeu cau -> Xu ly -> Tra ket qua. Dung khoi code mermaid (```mermaid) va khong giai thich gi them.",
});
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const last = ((await post("getAgentTranscript", { id: bot.id, limit: 6 })).entries ?? []).at(-1);
  if (String(last?.message?.content ?? "").length > 0 && last?.streaming === false) break;
}
await sleep(5000);

const reply = String(((await post("getAgentTranscript", { id: bot.id, limit: 6 })).entries ?? []).at(-1)?.message?.content ?? "");
check("the model wrote a mermaid fence", /```mermaid/.test(reply), reply.replace(/\n/g, " ").slice(0, 80));

// Confirm the app is showing THIS conversation before judging what it drew. Without it, a
// diagram rendered in a conversation nobody opened reads as a failure — and the reverse.
const wordsOf = (x) => x.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
const onScreen = new Set(wordsOf(String(await appEval("document.body.innerText"))));
const label = wordsOf(reply).filter((w) => !["mermaid", "graph", "flowchart"].includes(w));
const shownFrac = label.filter((w) => onScreen.has(w)).length / Math.max(1, label.length);
check("the app is showing this conversation", shownFrac > 0.4,
  `${Math.round(shownFrac * 100)}% of the reply's words are on screen`);

console.log("\n2. the app draws it");
// Poll. The mermaid renderer is a lazily-imported chunk whose Suspense fallback is the plain code
// block, so a single read five seconds after the turn ends catches the fallback and reports a
// working feature as broken — which is exactly what happened the first time this ran.
// Poll longer, and probe cheaply. Mermaid is a lazily-imported chunk that renders off the main
// thread's idle time; a 30-second window reported 0 for a diagram that the user could see on
// screen minutes later, and hammering `document.body.innerText` every 1.5s was competing with
// the very render being waited on. The identifiers are right — `sand-mermaid-1` with
// aria-roledescription `flowchart-v2` — the patience was not.
let after = before, mermaidSvg = 0;
for (let i = 0; i < 60; i++) {
  await sleep(3000);
  mermaidSvg = await appEval(`[...document.querySelectorAll('svg')].filter(s => (s.id||'').includes('mermaid') || (s.getAttribute('aria-roledescription')||'') !== '').length`);
  after = await diagramSvgs();
  if (mermaidSvg > 0) break;
}
check("a mermaid svg appeared", mermaidSvg > 0, `${before} → ${after} diagram-shaped, ${mermaidSvg} identified as mermaid`);
check("it is drawn inside the transcript",
  Boolean(await appEval(`(() => { const s=[...document.querySelectorAll('svg')].find(s=>(s.id||'').includes('mermaid')||(s.getAttribute('aria-roledescription')||'')!==''); return s ? Boolean(s.closest('[class*="transcript"],[class*="chat"],[class*="message"]')) : false; })()`)),
  "not in the sidebar or a preview");
// A real render replaces the `language-mermaid` code block. Searching body text for "```mermaid"
// is NOT the test: the sidebar preview shows raw markdown and matches even when the diagram drew.
check("the code-block fallback was replaced",
  (await appEval(`document.querySelectorAll('.language-mermaid, [class*="language-mermaid"]').length`)) === 0,
  "no language-mermaid block left in the DOM");

console.log(`\n${pass} passed, ${fail} failed`);
try { ws?.close(); } catch { /* already closed */ }
process.exit(fail ? 1 : 0);
