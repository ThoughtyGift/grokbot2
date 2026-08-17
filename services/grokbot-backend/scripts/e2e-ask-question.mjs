/**
 * The "Your answer" question card, end to end.
 *
 * This is the surface the original has and the local build did not, and it is the one tool
 * whose whole job is to STOP the turn and wait. So the assertions that matter are about the
 * pause and the resume: does the card appear with a shape the renderer accepts, does the
 * turn actually park, and does the answer flow back into the model's next reply.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The gateway now runs with GROKBOT2_AUTH=enforce, so an unauthenticated call answers 401 and
// the script fails on `undefined.id` two lines later. The spawned backend reads the SAME token
// file rather than minting its own (auth-gate reuses a saved token), so sending it is correct
// and keeps these tests going through the real auth path instead of switching it off.
import { gwHeaders } from "./gw-auth.mjs";

const PORT = 18881;
const root = await mkdtemp(join(tmpdir(), "grokbot-ask-"));
const procs = [];
const killTree = (p) =>
  new Promise((r) => {
    if (!p.pid) return r();
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }).on("close", r);
    else { try { process.kill(-p.pid, "SIGKILL"); } catch { p.kill("SIGKILL"); } r(); }
  });
const stop = async () => { for (const p of procs) await killTree(p); await rm(root, { recursive: true, force: true }); };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => void stop().then(() => process.exit(1)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await fetch(`http://127.0.0.1:${PORT}/gw/health`, { signal: AbortSignal.timeout(1200) });
  console.error(`port ${PORT} already in use`); process.exit(1);
} catch { /* expected */ }

const backend = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: "services/grokbot-backend", shell: true,
  env: { ...process.env, PORT: String(PORT), GROKBOT2_STATE_FILE: join(root, "state.json"), TSX_DISABLE_CACHE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
procs.push(backend);
for (let i = 0; i < 60; i += 1) {
  try { await fetch(`http://127.0.0.1:${PORT}/gw/health`); break; } catch { await wait(500); }
}

const gw = (m, b = {}) =>
  fetch(`http://127.0.0.1:${PORT}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) }).then((r) => r.json());

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 200)}`}`);
};
const textOf = (e) => (e.kind === "message" ? e.content : e.message?.content ?? "");
const entries = (id) => gw("getAgentTranscriptTail", { id, limit: 200 }).then((r) => r.entries ?? []);
const widgetOf = (list) => [...list].reverse().find((e) => e.kind === "send-message" && e.message?.type === "widget");

// ── 1. the model raises a card on a genuinely ambiguous request ───────────────
console.log("model-driven");
const a1 = (await gw("createAgent", { name: "AskProbe" })).agent;
await gw("sendPrompt", {
  agentId: a1.id,
  content: "Mình muốn đặt vé. Bạn hãy dùng công cụ ask_question để hỏi mình chọn phương tiện nào (máy bay, tàu hoả, xe khách) rồi dừng lại chờ mình trả lời.",
});

let w;
for (let i = 0; i < 40 && !w; i += 1) { await wait(1500); w = widgetOf(await entries(a1.id)); }
check("a question card appears", Boolean(w), JSON.stringify((await entries(a1.id)).map((e) => e.kind)));

if (w) {
  const wd = w.message.widget;
  check("prompt is non-empty", typeof wd.prompt === "string" && wd.prompt.trim().length > 0, JSON.stringify(wd));
  check("has at least one option", Array.isArray(wd.options) && wd.options.length >= 1, JSON.stringify(wd.options));
  check("options do not exceed the client's cap of 6", wd.options.length <= 6, `got ${wd.options.length}`);
  check("every option has a label", wd.options.every((o) => typeof o.label === "string" && o.label), JSON.stringify(wd.options));
  check("card starts unanswered", w.respondedValue == null && w.widgetDismissed !== true);
  console.log(`      prompt : ${wd.prompt}`);
  console.log(`      options: ${wd.options.map((o) => o.label).join(" | ")}`);

  // The turn must be PARKED: no further assistant text until the user answers.
  const before = (await entries(a1.id)).filter((e) => e.kind === "send-message" && e.message?.type === "text").length;
  await wait(6000);
  const after = (await entries(a1.id)).filter((e) => e.kind === "send-message" && e.message?.type === "text").length;
  check("turn parks instead of carrying on", after === before, `text bubbles ${before} -> ${after}`);

  // ── 2. answering resumes the turn and the answer is used ───────────────────
  console.log("\nanswering");
  const choice = w.message.widget.options[1] ?? w.message.widget.options[0];
  const value = choice.value ?? choice.label;
  const res = await gw("respondToWidget", { agentId: a1.id, entryId: w.id, value });
  check("respondToWidget returns the updated record, not {}", res && typeof res === "object" && Object.keys(res).length > 0, JSON.stringify(res));

  let resolved, reply;
  for (let i = 0; i < 40; i += 1) {
    await wait(1500);
    const list = await entries(a1.id);
    resolved = list.find((e) => e.id === w.id);
    const idx = list.findIndex((e) => e.id === w.id);
    // Exclude the 🔧 echo bubble. Without this the test finds the echo — which happens to
    // contain the option labels in its JSON — and "reply reflects the choice" passes for
    // entirely the wrong reason while the turn may not have resumed at all.
    reply = list.slice(idx + 1).reverse()
      .find((e) => e.kind === "send-message" && e.message?.type === "text" && textOf(e).trim() &&
                   !e.streaming && !textOf(e).startsWith("🔧 "));
    if (resolved?.respondedValue != null && reply) break;
  }
  check("card records the answer on the ENTRY", resolved?.respondedValue === value, `respondedValue=${resolved?.respondedValue}`);
  check("the turn resumes with a reply", Boolean(reply), "no reply after answering");
  if (reply) {
    const t = textOf(reply);
    console.log(`      chose  : ${value}`);
    console.log(`      reply  : ${t.replace(/\s+/g, " ").slice(0, 150)}`);
    // Match on the LABEL the user saw, not the machine value. The old ruler regex-tested the
    // raw value ("tau_hoa") against a natural-language reply, so it could only pass if the model
    // parroted an internal identifier — the one thing the prompt tells it not to do. It failed on
    // "Bạn muốn đặt vé tàu hỏa", which reflects the choice perfectly.
    const flat = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
    const label = choice.label ?? value;
    check("reply reflects the choice", flat(t).includes(flat(label)) || flat(t).includes(flat(value)),
      `looked for "${label}" in: ${t.slice(0, 90)}`);
  }
}

// ── 3. malformed specs must not produce a blank card ─────────────────────────
console.log("\nmalformed input is rejected, not rendered blank");
const a2 = (await gw("createAgent", { name: "AskEdge" })).agent;
const raw = (spec) => gw("sendPrompt", { agentId: a2.id, content: `/tool ask_question ${spec}` });
for (const [name, spec] of [
  ["no options", '{"prompt":"Chọn gì?"}'],
  ["empty prompt", '{"prompt":"","options":[{"label":"A"}]}'],
  ["not json", "hello"],
]) {
  await raw(spec);
  await wait(2500);
  const bad = (await entries(a2.id)).find((e) => e.kind === "send-message" && e.message?.type === "widget" &&
    (!e.message.widget.prompt?.trim() || !(e.message.widget.options ?? []).length));
  check(`${name}: no invalid card created`, !bad, JSON.stringify(bad?.message?.widget));
}

// ── 4. the six-option cap, exercised directly ────────────────────────────────
// The model happened to offer three, so the cap was never actually tested above; a card
// that silently fails to render is the exact failure this guards against.
console.log("\nsix-option cap");
const a3 = (await gw("createAgent", { name: "AskCap" })).agent;
const eight = Array.from({ length: 8 }, (_, i) => ({ label: `Lựa chọn ${i + 1}` }));
await gw("sendPrompt", { agentId: a3.id, content: `/tool ask_question ${JSON.stringify({ prompt: "Chọn một", options: eight })}` });
let capped;
for (let i = 0; i < 20 && !capped; i += 1) { await wait(1200); capped = widgetOf(await entries(a3.id)); }
check("a card is still created", Boolean(capped));
check("eight options are trimmed to six", capped?.message?.widget?.options?.length === 6, `got ${capped?.message?.widget?.options?.length}`);
check("the kept options are the first six", capped?.message?.widget?.options?.[5]?.label === "Lựa chọn 6", JSON.stringify(capped?.message?.widget?.options?.map((o) => o.label)));

console.log(`\n${pass} passed, ${fail} failed`);
await stop();
process.exit(fail ? 1 : 0);
