/**
 * Quality benchmark: claude-opus-5 vs gemini-3.7-flash, scored with the BACKEND'S OWN readers.
 *
 * Scoring goes through `parseToolCalls` AND `toolArgs` with each tool's real alias list, because that
 * is the pair chat.ts uses. The first version of this script checked `call.args` — a field that does
 * not exist; `ToolCall` carries a raw `arg` string and the tool applies `toolArgs` itself. Every cell
 * came back "missing argument", which looked like a damning model result and was a bug in the test.
 * Same class of error as the cron tests earlier: when every cell fails, suspect the harness first.
 *
 * Sequential on purpose: an earlier comparison ran six models concurrently on one key and the numbers
 * moved, so concurrency is a confound rather than a speed-up.
 */
import { loadPoolKey, config } from "../src/config.js";
import { streamPool } from "@grokbot2/pool-client";
import { buildSystemPrompt } from "../src/prompt.js";
import { toolProtocol, TOOLS, toolArgs } from "../src/tools.js";
import { parseToolCalls, planBatches, planShape } from "../src/tool-calls.js";
import fs from "node:fs";

const key = loadPoolKey();
const sys = buildSystemPrompt(toolProtocol(), {
  agentName: "Test", boxOn: true, browserOn: true, timeZone: "Asia/Ho_Chi_Minh",
});
const known = (n) => Boolean(TOOLS[n]);
const readOnly = (n) => TOOLS[n]?.needsApproval === false;

/** Copied verbatim from each tool's own `toolArgs(...)` call in tools.ts — aliases included. */
const SPECS = {
  list_dir_v2: [{ name: "target_directory", aliases: ["dir", "path", "directory"] }],
  read_file_v2: [{ name: "target_file", aliases: ["path", "file", "relative_workspace_path"] }],
  run_terminal_command_v2: [{ name: "command", aliases: ["cmd", "shell"] }],
  web_search: [{ name: "search_term", aliases: ["query", "q", "term", "text"] }],
};

const MODELS = ["claude-opus-5", "gemini-3.7-flash"];
const REPS = 2;

const TASKS = [
  { id: "list", ask: "Liet ke file trong thu muc goc cua box.",
    want: { tool: "list_dir_v2", arg: "target_directory" } },
  { id: "read", ask: "Doc file ghi-chu.md trong box va cho toi biet dong dau tien.",
    want: { tool: "read_file_v2", arg: "target_file" } },
  { id: "shell", ask: "Kiem tra dung luong o dia trong box.",
    want: { tool: "run_terminal_command_v2", arg: "command" } },
  { id: "web", ask: "Tim tren web: ty gia USD sang VND hom nay.",
    want: { tool: "web_search", arg: "search_term" } },
  // P5 — the architectural gap: several tools in ONE turn.
  { id: "multi", ask: "Doc CA HAI file ghi-chu.md va loi_ich_doc_sach.md trong box, trong CUNG mot luot.",
    want: { tool: "read_file_v2", minCalls: 2 } },
  // False-positive guard: needs no tool. A spurious call here is a real defect, not caution.
  { id: "notool", ask: "Giai thich ngan gon: khac nhau giua HTTP va HTTPS la gi?",
    want: { noTool: true } },
  // Fabrication guard: unanswerable without a tool.
  { id: "nofab", ask: "Trong thu muc goc cua box co bao nhieu file? Dua vao so lieu thuc te, khong duoc doan.",
    want: { anyTool: true } },
  // Synthesis: the tool result is already in history — judge the prose, not the call.
  { id: "prose", history: [
      { role: "user", content: "Kiem tra dung luong o dia trong box." },
      { role: "assistant", content: 'TOOL_CALL: run_terminal_command_v2({"command":"df -h /"})' },
      { role: "user", content: "TOOL_RESULT run_terminal_command_v2:\nFilesystem  Size  Used Avail Use% Mounted on\n/dev/root    59G   53G  5.9G  91% /" },
    ], ask: "Tom tat cho nguoi khong ky thuat va noi ro co can lam gi khong.",
    // "5.9" is NOT required literally. Both models wrote "khoảng 6GB", i.e. they rounded — which for
    // the non-technical reader this task asks for is better writing, not a dropped figure. The first
    // rubric demanded the raw string and scored good judgement as a defect. Only the headline 91% has
    // to survive intact; free space counts if it appears as 5.9, 5,9 (Vietnamese decimal comma) or ~6GB.
    want: { noTool: true, mustMention: ["91"], mustMentionAny: ["5.9", "5,9", "6GB", "6 GB"] } },
];

async function ask(model, task) {
  const history = [...(task.history ?? []), { role: "user", content: task.ask }];
  let acc = "";
  const t0 = Date.now();
  const r = await streamPool(history, {
    url: config.poolUrl, key, model, system: sys, maxTokens: 700, timeoutMs: 240_000,
  }, (c) => { acc += c; });
  const text = (r.text ?? acc ?? "").trim() || `<<ERROR ${r.error ?? "?"}>>`;
  return { text, ms: Date.now() - t0 };
}

function score(task, text) {
  const calls = parseToolCalls(text, known);
  const w = task.want;
  const notes = [];
  let pass = true;

  if (w.noTool && calls.length) {
    pass = false; notes.push(`goi tool khong can (${calls.map((c) => c.name).join(",")})`);
  }
  if (w.anyTool && !calls.length) { pass = false; notes.push("khong goi tool -> tra loi bang phong doan"); }

  if (w.tool) {
    const hits = calls.filter((c) => c.name === w.tool);
    if (!hits.length) {
      pass = false;
      notes.push(`sai tool: mong ${w.tool}, nhan ${calls.map((c) => c.name).join(",") || "khong co"}`);
    } else {
      if (w.minCalls && hits.length < w.minCalls) {
        pass = false; notes.push(`chi ${hits.length}/${w.minCalls} loi goi trong mot luot`);
      }
      if (w.arg) {
        const got = toolArgs(hits[0].arg, SPECS[w.tool]);
        if (!String(got[w.arg] ?? "").trim()) {
          pass = false; notes.push(`doi so ${w.arg} rong (raw=${JSON.stringify(hits[0].arg.slice(0, 40))})`);
        }
      }
    }
  }
  if (w.mustMention) {
    const missed = w.mustMention.filter((s) => !text.includes(s));
    if (missed.length) { pass = false; notes.push(`bo so lieu tu tool: ${missed.join(",")}`); }
  }
  if (w.mustMentionAny && !w.mustMentionAny.some((s) => text.includes(s))) {
    pass = false; notes.push(`bo han mot so lieu (khong co ${w.mustMentionAny[0]} hay dang lam tron)`);
  }

  const shape = calls.length ? planShape(planBatches(calls, readOnly)) : { calls: 0, batches: 0, widest: 0 };
  return { pass, notes, shape };
}

const out = {};
for (const model of MODELS) {
  out[model] = [];
  for (const task of TASKS) {
    for (let i = 0; i < REPS; i++) {
      const { text, ms } = await ask(model, task);
      const s = score(task, text);
      out[model].push({ task: task.id, rep: i, ms, pass: s.pass, notes: s.notes, shape: s.shape, text });
      console.log(`${model.padEnd(17)} ${task.id.padEnd(7)} r${i} ${s.pass ? "DAT   " : "TRUOT "} ${String(ms).padStart(6)}ms ${s.notes.join(" | ")}`);
    }
  }
}

console.log("\n=== TONG HOP ===");
for (const model of MODELS) {
  const rows = out[model];
  const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);
  const chars = Math.round(rows.reduce((a, r) => a + r.text.length, 0) / rows.length);
  console.log(`${model.padEnd(17)} ${rows.filter((r) => r.pass).length}/${rows.length} dat   ${avg}ms tb   ${chars} ky tu tb`);
  for (const t of TASKS) {
    const rs = rows.filter((r) => r.task === t.id);
    console.log(`   ${t.id.padEnd(7)} ${rs.filter((r) => r.pass).length}/${rs.length}  ${[...new Set(rs.flatMap((r) => r.notes))].slice(0, 2).join(" | ")}`);
  }
}

const dest = "C:/Users/admin/AppData/Local/Temp/claude/c--Users-admin-Desktop-grokbot2/eaada360-f857-4797-9134-91fa41755587/scratchpad/quality-bench.json";
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`\ntoan van -> ${dest}`);
process.exit(0);
