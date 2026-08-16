/**
 * Build our system prompt from the original's, which ships in the box host bundle
 * (see docs/agent-brain.md — it is NOT server-side only, that was the earlier mistake).
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
  150, 151, 152, 153,                 // autonomy (154 = subagents)
  156, 157, 158, 159, 160, 161, 162,  // initiative
];

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

  // "box" is internal vocabulary in the original too; keep the user-facing wording.
  [/\bthe box\b/g, "the computer"],

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
