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
import { webSearch, webFetch } from "./web.js";

export interface ToolSpec {
  /** Real tool name from ClientSideToolV2. */
  name: string;
  /** One line for the model, describing when to use it. */
  summary: string;
  /** Argument format shown to the model. */
  usage: string;
  /** True when the user must approve before it runs (mirrors require_user_approval). */
  needsApproval: boolean;
  /** Offered even with no box attached — the tool does not run inside one. */
  alwaysAvailable?: boolean;
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

/** Mirrors `ListDirV2Result.DirectoryTreeNode`. */
export interface TreeNode {
  abs_path: string;
  children_dirs: TreeNode[];
  children_files: { name: string; size?: number }[];
  children_were_processed: boolean;
  num_files: number;
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * Render the tree as indented text.
 *
 * The model reads this, not JSON: nesting shown by indentation costs a fraction of the
 * tokens of the equivalent object, and unexplored branches must stay visible or the agent
 * concludes a directory is empty when it was only truncated.
 */
export function renderTree(node: TreeNode | undefined, indent = "", isRoot = true): string {
  if (!node) return "(không có dữ liệu)";
  const lines: string[] = [];
  if (isRoot) lines.push(`${node.abs_path}/`);
  for (const d of node.children_dirs ?? []) {
    const explored = d.children_were_processed;
    lines.push(`${indent}  ${baseName(d.abs_path)}/${explored ? "" : "  …chưa mở"}`);
    if (explored) {
      const sub = renderTree(d, `${indent}  `, false);
      if (sub.trim()) lines.push(sub);
    }
  }
  for (const f of node.children_files ?? []) {
    lines.push(`${indent}  ${f.name}${typeof f.size === "number" ? `  ${f.size}B` : ""}`);
  }
  if (!node.children_were_processed && isRoot) lines.push(`${indent}  (danh sách bị cắt bớt)`);
  return lines.join("\n");
}

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
    summary: "Liệt kê cây thư mục trong box",
    usage: "list_dir_v2(<thư mục>[, <độ sâu>])",
    needsApproval: false,
    async run(arg) {
      const [dir, depth] = parts(arg, 2);
      const r = await boxCall<{ directory_tree_root: TreeNode }>("list", {
        target_directory: dir || ".",
        depth: depth ? Number(depth) : 2,
      });
      return trim(renderTree(r.directory_tree_root));
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

  // The two tools in the original's set that need neither a box nor an API key, so unlike
  // the box tools they are always offered.
  web_search: {
    name: "web_search",
    summary: "Tìm kiếm trên web",
    usage: "web_search(<từ khoá>)",
    needsApproval: false,
    alwaysAvailable: true,
    async run(arg) {
      const r = await webSearch(unquote(arg));
      if (r.rejected) return "Cần từ khoá tìm kiếm.";
      if (!r.references.length) return `Không tìm thấy kết quả cho "${unquote(arg)}".`;
      return trim(r.references.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.chunk ? `\n   ${x.chunk}` : ""}`).join("\n"));
    },
  },

  web_fetch: {
    name: "web_fetch",
    summary: "Đọc nội dung một trang web",
    usage: "web_fetch(<url>)",
    needsApproval: false,
    alwaysAvailable: true,
    async run(arg) {
      const r = await webFetch(unquote(arg));
      if (r.error) return `Không đọc được ${r.url}: ${r.error}`;
      return trim(`${r.url}\n\n${r.markdown}`);
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
  // Only advertise what can actually run. Listing a shell tool that will fail teaches the
  // model to keep reaching for it — and, worse, to promise the user a command it cannot run.
  const available = availableTools();
  const lines = Object.values(available).map((t) => `- ${t.usage} — ${t.summary}`);
  const note = boxConfigured()
    ? "Công cụ shell/file/tìm-kiếm-file chạy TRONG box Linux, không phải máy người dùng."
    : "Hiện chưa nối box, nên bạn CHỈ có các công cụ web ở trên: không chạy được lệnh shell, " +
      "không đọc file. Đừng hứa làm những việc đó.";
  return (
    "\n\nCÔNG CỤ: khi cần dùng, trả lời DUY NHẤT một dòng đúng dạng " +
    "TOOL_CALL: <tên>(<đối số>) và không nói gì thêm.\n" +
    lines.join("\n") +
    `\n${note}\nKhông cần công cụ thì trả lời bình thường. Sau khi nhận kết quả, trả lời dựa trên kết quả đó.`
  );
}

/** The tools this install can actually run right now. */
export function availableTools(): Record<string, ToolSpec> {
  const on = boxConfigured();
  return Object.fromEntries(Object.entries(TOOLS).filter(([, t]) => on || t.alwaysAvailable));
}
