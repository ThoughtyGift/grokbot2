/**
 * Build our system prompt from the original's, which ships in the box host bundle
 * (see docs/reverse/agent-brain.md — it is NOT server-side only, that was the earlier mistake).
 *
 *   node scripts/build-prompt.mjs [docs/extracted/subagent-prompts.json] [src/prompt-base.ts]
 *
 * This is a PORT, not a copy, because one thing is inverted between the two architectures:
 *
 *   original : plain assistant text is a private scratchpad; `SendMessage` is the only channel
 *              that reaches the user.
 *   ours     : the model's plain text IS the visible message — it streams straight into the
 *              bubble — and there is no SendMessage tool at all.
 *
 * Copying those sections verbatim would teach the model to write inner monologue into the
 * user's chat and to call a tool that does not exist. So the whole "SendMessage is your only
 * voice" chapter is dropped and every remaining mention is rewritten to plain "reply".
 *
 * Sections about surfaces we do not have (cloud agents, Task subagents, connectors, plugins,
 * Cursor Origin, threaded replies, ExternalShell) are dropped whole rather than half-adapted:
 * a prompt that describes a tool the model cannot call is worse than silence about it.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath = "docs/extracted/subagent-prompts.json", outPath = "src/prompt-base.ts"] = process.argv;
const data = JSON.parse(readFileSync(inPath, "utf8"));
const segments = data.prompts.find((p) => p.name === "buildSandBaseSystemPrompt")?.segments;
if (!segments) { console.error("buildSandBaseSystemPrompt not found — re-run extract-prompts.mjs"); process.exit(1); }

/**
 * Segment indices to keep, by chapter. Indices are stable for a given app build; re-check them
 * after an app update by running extract-prompts.mjs and reading the segment list.
 */
const KEEP = [
  0,                                  // identity
  2, 3, 4, 6, 7, 8,                   // how a turn works (5 = surface picking, names tools we lack)
  23, 24, 25, 26, 27, 28, 29, 30, 31, // reply first, then keep the user posted
  33, 34, 35, 36, 37, 38, 39, 40,     // tone
  42, 43, 44, 45, 46, 47, 48, 49, 50, // reply length and shape
  52, 53, 57,                         // showing your work (54-56 = host file:// + cloud agents)
  61, 62,                             // never fabricate data
  64, 65, 66, 67, 68, 69, 70,         // asking for decisions — this is our ask_question widget
  // Reaching services with no connector. Held back on the first pass because it names
  // surfaces we lacked; `request_box_help`, subagents and the box's own Chrome all exist now,
  // so it describes what actually happens. 109/110/115 stay out — they are about connectors
  // and SearchPlugins, which we still do not have.
  106, 107, 108, 111, 112, 113, 114,
  82,                                 // the web is for looking things up — we have web_search/web_fetch
  // Found by auditing KEEP against the segments (scripts/audit-keep.mjs), not by memory. All
  // four describe surfaces we DO have and were dropped with the rest of "Where you work",
  // which is mostly about the user's own machine:
  //   83  MCP: read the schema first, re-read it when a call goes quiet, never double-fire
  //       a mutation. We have get_mcp_tools / call_mcp_tool.
  //   84  the computer vs the desktop — ONE shared machine, a PER-AGENT desktop and browser
  //       window. This is the architecture the computer pane implements; the original states
  //       it outright, including "never claim each agent has its own machine".
  //   85  the escalation ladder: what you already have → MCP → the web → the signed-in
  //       browser → the desktop → hand it back to the user. Every rung exists here.
  //   126 sample the channel before drafting in someone's voice — we have the draft cards.
  83, 84, 85, 126,
  94, 95,                             // delegating to a subagent — task_v2 exists now
  // 118 is dropped, not kept: it tells the model to Read a runbook at
  // ${SAND_BOX_DEBUGGING_REFERENCE_PATH} on the box. That file does not exist here, and after
  // the ${…} strip the sentence reads "lives on your box at — Read it", pointing at nothing.
  // Same reason the app-UI map (121-123) is out.
  117, 119,                           // debugging the computer, and staying audible while you do
  150, 151, 152, 153, 154,            // autonomy, including "blocked on the user"
  156, 157, 158, 159, 160, 161, 162,  // initiative
  164, 166, 170, 171, 172, 174,       // when your own action needs approval — we have the card
];

/**
 * Chapters deliberately left out, so the next reader does not have to re-derive it:
 *
 *   14  SendMessage as the only voice   — inverted here; see the header
 *   32  cloud agents, connectors, Cursor Origin, the user's own machine, threaded replies,
 *       video subagents, plugin management — surfaces this backend does not have
 *   4   `block_until_ms` background commands — run_terminal_command_v2 has no background mode
 *   3   CheckSubagent / MessageSubagent — ours runs to completion, there is nothing to poll
 *
 * Re-check this list whenever a capability lands. Three chapters came back once subagents,
 * MCP and the approval card existed, and they were only found by auditing, not by memory.
 */

/**
 * Rewrites applied in order. Each exists because the original phrasing names something we do
 * not have; the aim is to keep its meaning and cadence, not to paraphrase it away.
 */
const REPLACEMENTS = [
  // The runtime flag is off for us: no cloud agents.
  [/\$\{cloudAgentsEnabled \? "([^"]*)" : "([^"]*)"\}/g, "$2"],
  [/\$\{[^}]*\}/g, ""],

  // SendMessage → an ordinary reply.
  [/a plain text SendMessage/g, "a plain text reply"],
  [/That opening acknowledgement must be a text SendMessage/g, "That opening acknowledgement must be plain text"],
  [/inside SendMessage/g, "in a reply"],
  [/in a SendMessage/g, "in your reply"],
  [/separate SendMessage calls/g, "separate messages"],
  [/first SendMessage/g, "first reply"],
  [/a quick SendMessage/g, "a quick reply"],
  [/without a SendMessage/g, "without a reply"],
  [/no SendMessage needed/g, "no reply needed"],
  [/SendMessage the actual output/g, "send the actual output"],
  [/\bSendMessage\b/g, "reply"],

  // We have reactions in the UI, but the model cannot emit one — drop the guidance.
  [/ The ReactToMessage tapback \(a single emoji reaction on the user's own message\) is separate, and fine on the same rare, mirror-the-user terms\./g, ""],
  [/ The one exception is a bare emoji tapback: when a ReactToMessage reaction is the whole response \(a reply would be overkill\), that reaction is the turn — send it alone, no reply needed\./g, ""],
  [/\bReactToMessage\b/g, "a reaction"],

  // Tool names inside the chapters re-added from "Where you work" (83-85, 126).
  [/\bGetMcpTools\b/g, "get_mcp_tools"],
  [/\bCallMcpTool\b/g, "call_mcp_tool"],
  // No AuthenticateMcpServer here: MCP servers are configured in .mcp.json, so an auth error
  // is the user's to fix. Keep the surrounding advice, drop the tool that does not exist.
  [/For auth\/needsAuth errors, call AuthenticateMcpServer instead of refetching — if auth stays stuck, ask the user for help rather than reaching the service through the browser — and/g,
   "For auth errors, say so and ask the user to fix the server's credentials rather than reaching the service through the browser, and"],
  [/\bWebSearch, WebFetch\b/g, "web_search, web_fetch"],
  [/\(Read \/ Shell \/ CopyToBox \/ CopyFromBox act on it\)/g, "(read_file_v2 / run_terminal_command_v2 act on it)"],
  // We have no access to the user's own machine, so the sentence contrasting the two
  // filesystems has nothing to contrast with.
  [/ It is a separate filesystem from the user's own computer where ExternalRead and ExternalShell run, which you call "your computer"\./g, ""],
  [/files on the box/g, "files on the computer"],

  // Cross-references to chapters we do not include would point at nothing.
  [/ \(see "The box desktop" for which type\)/g, ""],
  [/ See "The box desktop" for how delegation and sign-in handoffs work\./g, ""],
  // The original's tool names for the box shell and file reads; ours come from the catalog.
  [/use Shell for commands, and use Read for files/g, "use run_terminal_command_v2 for commands, and read_file_v2 for files"],
  [/\brun `gh auth login`\)/g, "run `gh auth login` through run_terminal_command_v2)"],

  // "box" is internal vocabulary in the original too; keep the user-facing wording.
  //
  // `the box` alone was not enough. The model introduced itself as running on a "Linux Box" in
  // a live reply, because these other forms survived — and it repeats whatever word it is
  // given. The one deliberate exception is the sentence that TEACHES the rule ("internally that
  // computer is called the box … never a box"), which has to keep the word to make sense.
  [/\bThe box has\b/g, "The computer has"],
  [/\bthe box desktop\b/g, "the computer's desktop"],
  [/\bon the box\b/g, "on that computer"],
  [/\bthe box's\b/g, "the computer's"],
  [/\bthe box\b/g, "the computer"],
  [/\bBox logins\b/g, "Logins on that computer"],
  [/\blocal\/box file\b/g, "local file"],
  [/\byour web\/box tools\b/g, "your web and file tools"],
  [/\bbox tools\b/g, "file tools"],
  [/"The box desktop"/g, '"the computer\'s desktop"'],

  // Tidy up what the substitutions leave behind.
  // Resolving the cloud-agents flag to its "off" branch leaves "a widget, or attachment".
  [/a widget, or attachment never counts as it/g, "a widget or an attachment never counts as it"],
  [/[ \t]{2,}/g, " "],
  [/ +([.,;:])/g, "$1"],
];

const chapters = KEEP.map((i) => {
  let text = segments[i] ?? "";
  for (const [pattern, into] of REPLACEMENTS) text = text.replace(pattern, into);
  return text.trim();
}).filter((t) => t.length > 0);

const body = chapters.join("\n\n");

const leftovers = [...body.matchAll(/SendMessage|ReactToMessage|ExternalShell|cloud agent|CheckSubagent|MessageSubagent|\$\{/g)].map((m) => m[0]);
if (leftovers.length) console.warn(`warning: ${leftovers.length} unported mention(s): ${[...new Set(leftovers)].join(", ")}`);

const out = `/**
 * The original Grok Bot system prompt, ported to this backend.
 *
 * GENERATED by scripts/build-prompt.mjs — do not edit by hand; edit the KEEP list or the
 * REPLACEMENTS there and regenerate. ${chapters.length} of ${segments.length} chapters kept.
 *
 * The dropped chapters describe surfaces we do not have (cloud agents, Task subagents,
 * connectors, plugins, Cursor Origin, threaded replies) and, most importantly, the original's
 * "SendMessage is your only voice" model — which is inverted here: our plain text IS what the
 * user sees. See the header of the generator for why that could not be copied.
 */
export const BASE_SYSTEM_PROMPT = ${JSON.stringify(body)};
`;
writeFileSync(outPath, out);
console.log(`kept ${chapters.length}/${segments.length} chapters · ${body.length} chars (~${Math.round(body.length / 4)} tokens)`);
console.log(`→ ${outPath}`);
