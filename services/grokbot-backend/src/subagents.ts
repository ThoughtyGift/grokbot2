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

/**
 * The model every subagent runs on.
 *
 * Was hardcoded `"gemini-2.5-flash"`. Measured against this install's pool 2026-08-21:
 *
 *   gemini-3.7-flash   aborted after 45s      (the config default — equally dead here)
 *   gemini-2.5-flash   502 after 38s          (Cloudflare's gateway-timeout page)
 *   claude-opus-5      ok in 6.6s             (what config.model actually is)
 *
 * So every subagent failed on every pool call while the main turn worked, and the failure read as
 * "pool bad response (502)" — which looks like an outage and is not one. Defaulting to
 * `config.model` means a subagent uses whatever model this install has proven it can reach;
 * `GROKBOT2_SUBAGENT_MODEL` still overrides it for anyone who wants a cheaper one.
 */
const SUBAGENT_MODEL = process.env.GROKBOT2_SUBAGENT_MODEL ?? config.model;

export const SUBAGENT_TYPES: Record<string, SubagentType> = {
  /**
   * The original pins `claude-4.5-sonnet` here (BROWSER_USE_SUBAGENT_CONFIG, AGENT_ONLY).
   * **That choice does not transfer to this pool**, and copying it silently breaks the
   * subagent. Measured, same prompt and task, counting whether the model ever emits a
   * TOOL_CALL:
   *
   *   gemini-2.5-flash   1 call  → "Tiêu đề trang là Example Domain."   ✅
   *   grok-4.5           1 call  → correct                              ✅
   *   gemini-3.7-flash   0       → HTTP 200 with an empty body
   *   sonnet             0       → "I can't access URLs"
   *   haiku              0       → same refusal
   *
   * The Claude models reach us through the pool's Claude Code CLI, which carries its own
   * agent identity and tool set, so it overrides a text-convention tool protocol and answers
   * that it has no browser. Models served as plain completions follow the convention.
   */
  browserUse: {
    allow: ["browser_"],
    label: "duyệt web",
    model: SUBAGENT_MODEL,
    prompt:
      "Enter BROWSER USE mode. Use the provided browser tools to interact with web pages.\n\n" +
      "Important: Every browser tool call automatically returns a screenshot of the current " +
      "page state. You do NOT need to use the browser_take_screenshot tool explicitly - it " +
      "would be redundant since you already receive screenshots after each action.",
  },
  /**
   * The stock host offers `pastConversationExplorer` (gated by
   * `includePastConversationExplorerSubagent` in host-main.cjs). Its own description is explicit
   * about when to reach for it: "MUST USE for any question about agent behavior, failures,
   * patterns, or user work history. Trigger immediately when user asks: 'what have you been
   * failing at', 'what are your problems'".
   *
   * The host's version reads an `_index.json` on the box, filtering `status="FINISHED"` and
   * `source="team"` — a structure this install does not have. So the capability is the same and
   * the data source is ours: `search_conversations` over the transcripts we already store.
   */
  /**
   * `media_review` — một trong 12 `SubagentType` của 0.29 (`{no:5,name:"media_review"}`), và là
   * loại duy nhất trong số đó ta còn thiếu mà hợp với sản phẩm này.
   *
   * Việc của nó: soi thứ đã có trên máy — ảnh chụp màn hình, PDF, clip — rồi trả về nhận xét bằng
   * chữ. Khác `watch_video` ở chỗ đó là MỘT tool cho MỘT clip; đây là một lượt riêng có thể mở
   * nhiều file và so chúng với nhau, mà không đốt cửa sổ ngữ cảnh của hội thoại chính.
   *
   * Cho phép đúng những tool để NHÌN và ĐỌC, không có tool ghi: một con soi file không có lý do gì
   * để sửa file. `attach_image` nằm trong danh sách vì nó là đường duy nhất đưa một tấm ảnh ra
   * trước mắt model (xem `ctx.see`).
   */
  mediaReview: {
    model: SUBAGENT_MODEL,
    allow: ["watch_video", "attach_image", "attach_file", "read_file_v2", "list_dir_v2", "glob_file_search"],
    label: "soi ảnh/video/tài liệu",
    prompt:
      "You review media that already exists on this computer — screenshots, photos, PDFs, video " +
      "files — and report what is actually in them.\n\n" +
      "Guidelines:\n" +
      "- LOOK before judging. watch_video puts a grid of frames plus duration and audio level in " +
      "front of you; attach_image does the same for a picture. Never describe a file you have not " +
      "opened.\n" +
      "- Report what you SEE, not what the filename suggests. A clip called demo-final.mp4 can be " +
      "twenty seconds of black, and saying so is the whole point of this job.\n" +
      "- Be specific and falsifiable: colours, text on screen, how long, whether there is sound, " +
      "which frame something appears in.\n" +
      "- If a file will not open or is empty, say that plainly rather than guessing its contents.\n" +
      "- Answer as a regular message, no emojis.",
  },
  pastConversationExplorer: {
    model: SUBAGENT_MODEL,
    allow: ["search_conversations"],
    label: "tra hội thoại cũ",
    prompt:
      "You investigate this assistant's own history across past conversations with the user.\n\n" +
      "Use search_conversations to find evidence. It searches every OTHER bot's transcript — " +
      "messages, replies and tool calls — and returns the bot name, a timestamp, an entry id " +
      "and a snippet around each match.\n\n" +
      "Guidelines:\n" +
      "- Search several phrasings before concluding nothing exists: the user's words and the " +
      "words in the transcript rarely match exactly.\n" +
      "- Report what the transcripts SAY, with the bot name and date. Never generalise beyond " +
      "the snippets you actually retrieved.\n" +
      "- If the search comes back empty, say so plainly. An invented pattern is worse than " +
      "\"nothing in the history covers that\".\n" +
      "- Answer as a regular message, no emojis.",
  },

  // EXPLORE_SUBAGENT_PROMPT, trimmed of its Cursor/codebase framing — ours reads the box.
  explore: {
    model: SUBAGENT_MODEL,
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
    model: SUBAGENT_MODEL,
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
/**
 * Clean a subagent's final answer before it becomes a tool result the user reads.
 *
 * Measured 2026-08-21: `pastConversationExplorer` returned
 *
 *     TOOL_CALL: search_conversations({"query": "…"})
 *     Human: Kết quả search_conversations:
 *     2 kết quả cho "…"
 *
 * The model wrote the tool line AND its own "Human:" continuation in one completion. `TOOL_CALL`
 * did not match that shape, so the loop took the whole thing for a report and handed the user the
 * protocol — the same defect class as an aborted turn leaving a raw TOOL_CALL bubble.
 *
 * Cut at the first machine marker and keep what precedes it. When nothing readable precedes it,
 * say the run produced no report rather than printing the transcript: an empty answer that names
 * itself beats a confusing one that looks like output.
 */
function asReport(text: string): string {
  const cut = text.search(/(^|\n)\s*(TOOL_CALL:|Human:|Assistant:)/);
  const spoken = (cut >= 0 ? text.slice(0, cut) : text).trim();
  if (spoken) return spoken;
  // Nothing before the marker: surface the tool output the model was quoting, if any, else say so.
  const quoted = text.replace(/^[\s\S]*?(Human:|Assistant:)\s*/, "").trim();
  return quoted || "(subagent không đưa ra báo cáo — chỉ phát ra dòng giao thức)";
}

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

  // Wording matters more than it looks. A softer "you may use these tools" makes a capable
  // model answer "I don't have browser access" and stop — it trusts its own priors over the
  // list. Stating plainly that the host executes the line, and that the tools are REAL, is
  // what the main loop does, and it is what makes this convention work.
  const system =
    type.prompt +
    "\n\nCÔNG CỤ (có thật, do hệ thống thực thi — KHÔNG phải mô phỏng): " +
    `${allowed.join(", ")}.\n` +
    "Khi cần dùng, trả lời DUY NHẤT một dòng `TOOL_CALL: <tên>(<đối số JSON>)` và không nói gì thêm. " +
    "Hệ thống sẽ chạy nó và gửi kết quả lại cho bạn ở lượt sau. " +
    "Đừng nói rằng bạn không truy cập được internet hay không có công cụ — bạn có, thông qua đúng cơ chế này. " +
    "Khi đã đủ thông tin, trả lời bằng văn bản thường — đó là báo cáo cuối cùng của bạn.";

  const history: PoolMessage[] = [{ role: "user", content: task }];
  const opts = { url: config.poolUrl, key, model: type.model ?? config.model, system };

  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await callPool(history, opts);
    if (!r.ok) return `(subagent lỗi: ${r.error})`;
    const text = (r.text ?? "").trim();
    // An empty 200 is almost always the model refusing this system prompt rather than a
    // transport fault, so name the model — that is the thing worth changing.
    if (!text) return `(subagent không trả lời — model "${opts.model}" trả rỗng cho prompt của kiểu "${typeName}")`;

    const m = TOOL_CALL.exec(text);
    if (!m) return asReport(text);             // no tool wanted → this is the report

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
