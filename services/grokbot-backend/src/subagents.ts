/**
 * Subagents — a nested agent loop with its own prompt, its own tool allowlist and its own
 * model, dispatched by the `task_v2` tool.
 *
 * This is how the original actually uses the browser: the browser tools are not called from
 * the main turn, they are handed to a `browserUse` subagent (see
 * `docs/extracted/subagent-prompts.md`). The reminders and allowlists below are the original's,
 * verbatim — that is the whole point of having extracted them.
 *
 * What is deliberately NOT copied: the original's subagents are stateful and resumable, run in
 * parallel with the main turn, and report through `CheckSubagent`/`MessageSubagent`. Ours runs
 * to completion and returns its final text. A half-built resume protocol would be worse than
 * an honest synchronous one, and the parent turn already knows how to wait.
 */
import { callPool, type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";

/** What a subagent may use, and what it is told it is. */
export interface SubagentType {
  /** Tool names it may call — a prefix match, so "browser_" covers the whole set. */
  allow: string[];
  /** System reminder, verbatim from the original where one exists. */
  prompt: string;
  /** The original pins a model per subagent type; fall back to the configured one. */
  model?: string;
  /** Shown on the tool card while it runs. */
  label: string;
}

export const SUBAGENT_TYPES: Record<string, SubagentType> = {
  // BROWSER_USE_SUBAGENT_CONFIG: AGENT_ONLY, defaultModelIds ["claude-4.5-sonnet"].
  browserUse: {
    allow: ["browser_"],
    label: "duyệt web",
    model: process.env.GROKBOT2_SUBAGENT_MODEL,
    prompt:
      "Enter BROWSER USE mode. Use the provided browser tools to interact with web pages.\n\n" +
      "Important: Every browser tool call automatically returns a screenshot of the current " +
      "page state. You do NOT need to use the browser_take_screenshot tool explicitly - it " +
      "would be redundant since you already receive screenshots after each action.",
  },
  // EXPLORE_SUBAGENT_PROMPT, trimmed of its Cursor/codebase framing — ours reads the box.
  explore: {
    allow: ["read_file_v2", "list_dir_v2", "glob_file_search", "ripgrep_raw_search"],
    label: "tìm trong box",
    prompt:
      "You are a file search specialist. You excel at thoroughly navigating and exploring a " +
      "filesystem.\n\nYour strengths:\n- Rapidly finding files using glob patterns\n" +
      "- Searching code and text with powerful regex patterns\n- Reading and analyzing file contents\n\n" +
      "Guidelines:\n- Return file paths as absolute paths in your final response\n" +
      "- For clear communication, avoid using emojis\n" +
      "- Communicate your final report directly as a regular message\n\n" +
      "NOTE: You are meant to be a fast agent that returns output as quickly as possible.\n\n" +
      "Complete the user's search request efficiently and report your findings clearly.",
  },
  // SHELL_SUBAGENT_PROMPT, verbatim.
  shell: {
    allow: ["run_terminal_command_v2"],
    label: "chạy lệnh",
    prompt:
      "You are a command execution specialist. Your role is to execute shell commands " +
      "efficiently and safely.\n\nGuidelines:\n- Execute commands precisely as instructed\n" +
      "- For git operations, follow git safety protocols\n" +
      "- Report command output clearly and concisely\n" +
      "- If a command fails, explain the error and suggest solutions\n" +
      "- Use command chaining (&&) for dependent operations\n" +
      "- Quote paths with spaces properly\n- For clear communication, avoid using emojis\n\n" +
      "Complete the requested operations efficiently.",
  },
};

/** A runaway subagent burns pool quota silently, so cap the loop rather than trusting it to stop. */
const MAX_STEPS = 8;

export interface SubagentDeps {
  /** Run one tool by name and return its text result. */
  runTool(name: string, arg: string): Promise<string>;
  /** Report a step to the user as it happens; the original keeps the user posted too. */
  onStep(text: string): void;
}

const TOOL_CALL = /TOOL_CALL:\s*([A-Za-z_][\w-]*)\s*\((.*?)\)\s*$/s;

/**
 * Run one subagent to completion and return its final report.
 *
 * The loop is the same TOOL_CALL convention the main turn uses, because the pool has no native
 * tool calling — the difference is the restricted tool list and the borrowed system prompt.
 */
export async function runSubagent(
  typeName: string,
  task: string,
  tools: string[],
  deps: SubagentDeps,
): Promise<string> {
  const type = SUBAGENT_TYPES[typeName];
  if (!type) return `(không có subagent kiểu "${typeName}"; có: ${Object.keys(SUBAGENT_TYPES).join(", ")})`;

  const allowed = tools.filter((n) => type.allow.some((a) => (a.endsWith("_") ? n.startsWith(a) : n === a)));
  if (allowed.length === 0) return `(subagent ${typeName} không có công cụ nào khả dụng — kiểm tra box/browser đã cấu hình chưa)`;

  const key = loadPoolKey();
  if (!key) return "(chưa có pool key)";

  const system =
    type.prompt +
    "\n\nCÔNG CỤ: trả lời DUY NHẤT một dòng `TOOL_CALL: <tên>(<đối số>)` khi cần dùng công cụ. " +
    `Công cụ: ${allowed.join(", ")}. ` +
    "Khi đã đủ thông tin, trả lời bằng văn bản thường — đó là báo cáo cuối cùng của bạn.";

  const history: PoolMessage[] = [{ role: "user", content: task }];
  const opts = { url: config.poolUrl, key, model: type.model ?? config.model, system };

  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await callPool(history, opts);
    if (!r.ok) return `(subagent lỗi: ${r.error})`;
    const text = (r.text ?? "").trim();
    if (!text) return "(subagent không trả lời)";

    const m = TOOL_CALL.exec(text);
    if (!m) return text;                       // no tool wanted → this is the report

    const [, name = "", arg = ""] = m;
    if (!allowed.includes(name.toLowerCase())) {
      history.push({ role: "assistant", content: text });
      history.push({ role: "user", content: `Công cụ "${name}" không khả dụng. Chỉ dùng: ${allowed.join(", ")}.` });
      continue;
    }
    deps.onStep(`${type.label}: ${name}(${arg.slice(0, 80)})`);
    const result = await deps.runTool(name.toLowerCase(), arg.trim());
    history.push({ role: "assistant", content: text });
    history.push({ role: "user", content: `Kết quả ${name}:\n${result}` });
  }
  return `(subagent dừng sau ${MAX_STEPS} bước — nhiệm vụ có thể quá rộng)`;
}
