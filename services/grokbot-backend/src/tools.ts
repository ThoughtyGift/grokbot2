/**
 * The agent's tool set, using the real names extracted from the client bundle
 * (`docs/extracted/tool-catalog.json`) so tool cards read the same as the original's.
 *
 * Every tool here runs **inside the box**, never on the machine hosting this backend.
 * With no box configured they fail with a clear message instead of falling back to
 * local execution — a shell tool that silently runs somewhere else is worse than one
 * that does not run.
 */
import { boxCall, boxConfigured } from "./box-exec.js";

export interface ToolSpec {
  /** Real tool name from ClientSideToolV2. */
  name: string;
  /** One line for the model, describing when to use it. */
  summary: string;
  /** Argument format shown to the model. */
  usage: string;
  /** True when the user must approve before it runs (mirrors require_user_approval). */
  needsApproval: boolean;
  run(arg: string): Promise<string>;
}

/**
 * Models quote their arguments — `list_dir_v2(".")` is at least as common as
 * `list_dir_v2(.)`. Passing the quotes through turns the path into `"."` and every call
 * fails with ENOENT, so strip one matching pair.
 */
export function unquote(s: string): string {
  const t = s.trim();
  const pair = (a: string, b: string) => t.length >= 2 && t.startsWith(a) && t.endsWith(b);
  return pair('"', '"') || pair("'", "'") || pair("`", "`") ? t.slice(1, -1).trim() : t;
}

/** Split "a, b, c" into at most `n` parts, leaving the remainder in the last one. */
function parts(arg: string, n: number): string[] {
  const out: string[] = [];
  let rest = unquote(arg);
  while (out.length < n - 1) {
    const i = rest.indexOf(",");
    if (i < 0) break;
    out.push(unquote(rest.slice(0, i)));
    rest = rest.slice(i + 1).trim();
  }
  out.push(unquote(rest));
  return out;
}

const trim = (s: string, max = 6000) => (s.length <= max ? s : `${s.slice(0, max)}\n… (cắt bớt, còn ${s.length - max} ký tự)`);

export const TOOLS: Record<string, ToolSpec> = {
  run_terminal_command_v2: {
    name: "run_terminal_command_v2",
    summary: "Chạy một lệnh shell trong box",
    usage: "run_terminal_command_v2(<lệnh>)",
    needsApproval: true,
    async run(arg) {
      const r = await boxCall<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; truncated: boolean }>(
        "exec", { command: unquote(arg) }
      );
      const bits = [
        `exit=${r.exitCode}${r.timedOut ? " (timeout)" : ""}`,
        r.stdout.trim() ? `stdout:\n${r.stdout.trim()}` : "",
        r.stderr.trim() ? `stderr:\n${r.stderr.trim()}` : "",
      ].filter(Boolean);
      return trim(bits.join("\n"));
    },
  },

  read_file_v2: {
    name: "read_file_v2",
    summary: "Đọc nội dung một file trong box",
    usage: "read_file_v2(<đường dẫn>[, <dòng bắt đầu>, <số dòng>])",
    needsApproval: false,
    async run(arg) {
      const [path, offset, limit] = parts(arg, 3);
      const r = await boxCall<{ path: string; totalLines: number; from: number; to: number; content: string }>("read", {
        target_file: path,
        offset: offset ? Number(offset) - 1 : 0,   // the model counts from 1
        limit: limit ? Number(limit) : undefined,
        enable_line_numbers: true,
      });
      return trim(`${r.path} (dòng ${r.from + 1}-${r.to} / ${r.totalLines})\n${r.content}`);
    },
  },

  list_dir_v2: {
    name: "list_dir_v2",
    summary: "Liệt kê một thư mục trong box",
    usage: "list_dir_v2(<thư mục>)",
    needsApproval: false,
    async run(arg) {
      const r = await boxCall<{ path: string; entries: { name: string; isDir: boolean; size: number | null }[] }>("list", {
        target_directory: unquote(arg) || ".",
      });
      const rows = r.entries.map((e) => `${e.isDir ? "d" : "-"} ${String(e.size ?? "").padStart(9)}  ${e.name}`);
      return trim(`${r.path} (${r.entries.length} mục)\n${rows.join("\n")}`);
    },
  },

  glob_file_search: {
    name: "glob_file_search",
    summary: "Tìm file theo mẫu tên trong box",
    usage: "glob_file_search(<mẫu>[, <thư mục>])",
    needsApproval: false,
    async run(arg) {
      const [pattern, dir] = parts(arg, 2);
      const r = await boxCall<{ path: string; matches: string[] }>("glob", {
        glob_pattern: pattern, target_directory: dir || ".",
      });
      return trim(r.matches.length ? `${r.matches.length} kết quả trong ${r.path}:\n${r.matches.join("\n")}` : `Không khớp "${pattern}" trong ${r.path}`);
    },
  },

  ripgrep_raw_search: {
    name: "ripgrep_raw_search",
    summary: "Tìm nội dung trong file của box",
    usage: "ripgrep_raw_search(<mẫu>[, <thư mục>])",
    needsApproval: false,
    async run(arg) {
      const [pattern, dir] = parts(arg, 2);
      const r = await boxCall<{ path: string; matches: string[] }>("grep", { pattern, path: dir || "." });
      return trim(r.matches.length ? `${r.matches.length} dòng khớp trong ${r.path}:\n${r.matches.join("\n")}` : `Không tìm thấy "${pattern}" trong ${r.path}`);
    },
  },
};

/** Tools the model may request without an approval card. */
export const isAutoApproved = (name: string): boolean => TOOLS[name]?.needsApproval === false;

/**
 * The tool section of the system prompt. It states plainly when no box is attached so
 * the model does not promise shell access it cannot deliver.
 */
export function toolProtocol(): string {
  const lines = Object.values(TOOLS).map((t) => `- ${t.usage} — ${t.summary}`);
  const status = boxConfigured()
    ? "Các công cụ này chạy TRONG box Linux, không phải máy người dùng."
    : "LƯU Ý: hiện chưa nối box, nên mọi công cụ dưới đây sẽ báo lỗi không dùng được. Đừng hứa sẽ chạy lệnh.";
  return (
    "\n\nCÔNG CỤ: khi cần dùng, trả lời DUY NHẤT một dòng đúng dạng " +
    "TOOL_CALL: <tên>(<đối số>) và không nói gì thêm.\n" +
    lines.join("\n") +
    `\n${status}\nKhông cần công cụ thì trả lời bình thường. Sau khi nhận kết quả, trả lời dựa trên kết quả đó.`
  );
}
