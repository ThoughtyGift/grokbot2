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
import { isMcpConfigured, listMcpResources, readMcpResource } from "./mcp.js";

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

/**
 * Split "a, b, c" into at most `n` parts, leaving the remainder in the last one.
 *
 * Each part is unquoted, the whole argument is NOT. Unquoting up front looked harmless for
 * one-argument calls but silently mangled every multi-argument one: `"a.md", "text"` starts
 * and ends with a quote, so the outer pair came off and the first part became `a.md"` — which
 * is how a file called `bao-cao.md"`, trailing quote included, ended up on the box.
 */
function parts(arg: string, n: number): string[] {
  const out: string[] = [];
  let rest = arg.trim();
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

/**
 * File contents arrive through a `name(arg)` call, not JSON, so a model writing markdown
 * types `\n` and means a newline. Left as-is the whole document lands on one line with
 * visible backslashes — a file that is technically written and practically useless.
 */
function unescapeText(s: string): string {
  return s.replace(/\\(n|r|t|"|'|\\)/g, (_, c) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c);
}

/**
 * One argument, named — for EVERY tool, not just the file ones (P5-3).
 *
 * The `TOOL_CALL: name(arg)` convention carries a single string, so each tool used to chop that
 * string up itself: `parts(arg, 3)`, `unquote(arg)`, `unescapeText(...)`. Three workarounds, each
 * for a real observed failure — a quoted path becoming ENOENT, `"a.md", "text"` splitting wrongly
 * once the content contains a comma, `\n` arriving as two visible characters. Positional parsing
 * cannot be made correct; it can only be made less wrong.
 *
 * So JSON is the primary form now, everywhere, and positional stays as the fallback. Not deleted:
 * models still write the positional form, and removing it would break calls that work today.
 *
 * ── The names are the ORIGINAL's ─────────────────────────────────────────────
 *
 * Taken from docs/extracted/tool-catalog.json rather than invented, because a model that knows the
 * original writes ITS names — and three of ours did not match:
 *
 *   edit_file_v2   relative_workspace_path / contents_after_edit   (we used path / content)
 *   delete_file    relative_workspace_path                          (positional only)
 *   web_search     search_term                                      (positional only)
 *
 * `fileArgs` mapped `o[k] ?? o[k.replace(/_/g,"")]`, so a model sending
 * `{"relative_workspace_path":"n.md","contents_after_edit":"x"}` — exactly what the original
 * accepts — got two empty strings and the reply "Thiếu đường dẫn." Silent, and blamed on the model.
 *
 * Aliases keep our shorter names working, so nothing that worked before stops.
 */
export interface ArgSpec {
  /** Canonical name: the original's, where the catalog has one. */
  name: string;
  /** Other spellings a model may reach for, ours included. */
  aliases?: string[];
}

/**
 * Read `raw` as JSON when it looks like an object, else positionally in `spec` order.
 *
 * Values are stringified: every consumer here passes them to the box as strings, and a number that
 * silently becomes `"[object Object]"` is worse than one converted honestly.
 */
export function toolArgs(raw: string, spec: ArgSpec[]): Record<string, string> {
  const t = raw.trim();
  const out: Record<string, string> = {};
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object" && !Array.isArray(o)) {
        for (const { name, aliases } of spec) {
          // Canonical first, then aliases, then the underscore-free spelling — the order matters
          // only when a model sends two of them, and preferring the catalog name is the right bias.
          const candidates = [name, ...(aliases ?? []), name.replace(/_/g, "")];
          const hit = candidates.find((k) => o[k] !== undefined && o[k] !== null);
          const v = hit === undefined ? "" : o[hit];
          out[name] = typeof v === "string" ? v : String(v);
        }
        return out;                       // JSON already carries real newlines
      }
    } catch { /* not JSON after all — fall through */ }
  }
  const p = parts(t, spec.length);
  spec.forEach(({ name }, i) => { out[name] = unescapeText(p[i] ?? ""); });
  return out;
}

/** Kept as a thin shim so existing call sites read unchanged. */
const fileArgs = (arg: string, keys: string[]): Record<string, string> =>
  toolArgs(arg, keys.map((name) => ({ name })));

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
    summary: "Chạy một lệnh shell trên máy tính của bạn",
    usage: 'run_terminal_command_v2({"command":"<lệnh>"})  ·  hoặc run_terminal_command_v2(<lệnh>)',
    needsApproval: true,
    async run(arg) {
      const { command } = toolArgs(arg, [{ name: "command", aliases: ["cmd", "shell"] }]);
      const r = await boxCall<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; truncated: boolean }>(
        "exec", { command }
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
    summary: "Đọc nội dung một file trên máy tính của bạn",
    usage: 'read_file_v2({"target_file":"<đường dẫn>","offset":<dòng bắt đầu>,"limit":<số dòng>})  ·  hoặc read_file_v2(<đường dẫn>[, <dòng>, <số dòng>])',
    needsApproval: false,
    async run(arg) {
      const { target_file: path, offset, limit } = toolArgs(arg, [
        { name: "target_file", aliases: ["path", "file", "relative_workspace_path"] },
        { name: "offset", aliases: ["from", "start", "line"] },
        { name: "limit", aliases: ["count", "lines"] },
      ]);
      const r = await boxCall<{ path: string; totalLines: number; from: number; to: number; content: string }>("read", {
        target_file: path,
        offset: offset ? Number(offset) - 1 : 0,   // the model counts from 1
        limit: limit ? Number(limit) : undefined,
        enable_line_numbers: true,
      });
      return trim(`${r.path} (dòng ${r.from + 1}-${r.to} / ${r.totalLines})\n${r.content}`);
    },
  },

  /**
   * Writing files. Names come from the catalog rather than being invented: the original's
   * `edit_file_v2` takes `relative_workspace_path` + `contents_after_edit` (a whole-file
   * write) and `edit_file` takes `old_string`/`new_string` (a targeted one). Keeping both
   * matters — resending a large file to change one line is how a careful edit turns into
   * an accidental truncation.
   *
   * Both require approval. The read-only tools above do not; a write does.
   */
  edit_file_v2: {
    name: "edit_file_v2",
    summary: "Ghi (tạo hoặc thay toàn bộ) một file trên máy tính của bạn",
    usage: 'edit_file_v2({"relative_workspace_path":"<đường dẫn>","contents_after_edit":"<toàn bộ nội dung mới>"})',
    needsApproval: true,
    async run(arg) {
      // The original's names are canonical; ours stay as aliases so calls that worked still do.
      const { relative_workspace_path: path, contents_after_edit: content } = toolArgs(arg, [
        { name: "relative_workspace_path", aliases: ["path", "target_file", "file"] },
        { name: "contents_after_edit", aliases: ["content", "contents", "text"] },
      ]);
      if (!path) return "Thiếu đường dẫn.";
      const r = await boxCall<{ path: string; bytes: number }>("write", { target_file: path, content });
      return `Đã ghi ${r.path} (${r.bytes} byte).`;
    },
  },

  edit_file: {
    name: "edit_file",
    summary: "Sửa một đoạn trong file có sẵn, không cần gửi lại cả file",
    usage: 'edit_file({"relative_workspace_path":"<đường dẫn>","old_string":"<đoạn cũ>","new_string":"<đoạn mới>"})',
    needsApproval: true,
    async run(arg) {
      const { relative_workspace_path: path, old_string: oldString, new_string: newString } = toolArgs(arg, [
        { name: "relative_workspace_path", aliases: ["path", "target_file", "file"] },
        { name: "old_string", aliases: ["old", "find"] },
        { name: "new_string", aliases: ["new", "replace"] },
      ]);
      if (!path || !oldString) return 'Cần: edit_file({"path":…,"old_string":…,"new_string":…}).';
      const r = await boxCall<{ path: string; replaced: number; bytes: number }>("replace", {
        target_file: path, find: oldString, replace: newString ?? "",
      });
      return `Đã sửa ${r.path} (${r.replaced} chỗ, còn ${r.bytes} byte).`;
    },
  },

  delete_file: {
    name: "delete_file",
    summary: "Xoá một file trên máy tính của bạn",
    usage: 'delete_file({"relative_workspace_path":"<đường dẫn>"})  ·  hoặc delete_file(<đường dẫn>)',
    needsApproval: true,
    async run(arg) {
      const { relative_workspace_path: target } = toolArgs(arg, [
        { name: "relative_workspace_path", aliases: ["path", "target_file", "file"] },
      ]);
      const r = await boxCall<{ path: string }>("remove", { target_file: target });
      return `Đã xoá ${r.path}.`;
    },
  },

  list_dir_v2: {
    name: "list_dir_v2",
    summary: "Liệt kê cây thư mục trên máy tính của bạn",
    usage: 'list_dir_v2({"target_directory":"<thư mục>","depth":<độ sâu>})  ·  hoặc list_dir_v2(<thư mục>[, <độ sâu>])',
    needsApproval: false,
    async run(arg) {
      // `depth` is ours: the original's list_dir_v2 has target_directory + ignore_globs and no
      // depth at all. Kept because the tree renderer needs a bound, and named plainly rather than
      // dressed up as a catalog parameter.
      const { target_directory: dir, depth } = toolArgs(arg, [
        { name: "target_directory", aliases: ["dir", "path", "directory"] },
        { name: "depth", aliases: ["levels", "maxDepth"] },
      ]);
      const r = await boxCall<{ directory_tree_root: TreeNode }>("list", {
        target_directory: dir || ".",
        depth: depth ? Number(depth) : 2,
      });
      return trim(renderTree(r.directory_tree_root));
    },
  },

  glob_file_search: {
    name: "glob_file_search",
    summary: "Tìm file theo mẫu tên trên máy tính của bạn",
    usage: 'glob_file_search({"glob_pattern":"<mẫu>","target_directory":"<thư mục>"})  ·  hoặc glob_file_search(<mẫu>[, <thư mục>])',
    needsApproval: false,
    async run(arg) {
      // ⚠ Positional order here is OURS, and it is the reverse of the catalog's field order:
      // the original declares target_directory as field 1 and glob_pattern as field 2. Our `usage`
      // has always said pattern-first, so the positional form stays pattern-first — changing it now
      // would break every call a model makes from reading that line. The JSON form removes the
      // ambiguity entirely, which is the strongest argument for P5-3 in this file.
      const { glob_pattern: pattern, target_directory: dir } = toolArgs(arg, [
        { name: "glob_pattern", aliases: ["pattern", "glob"] },
        { name: "target_directory", aliases: ["dir", "path", "directory"] },
      ]);
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
    usage: 'web_search({"search_term":"<từ khoá>"})  ·  hoặc web_search(<từ khoá>)',
    needsApproval: false,
    alwaysAvailable: true,
    async run(arg) {
      const { search_term: term } = toolArgs(arg, [
        { name: "search_term", aliases: ["query", "q", "term", "text"] },
      ]);
      const r = await webSearch(term);
      if (r.rejected) return "Cần từ khoá tìm kiếm.";
      if (!r.references.length) return `Không tìm thấy kết quả cho "${term}".`;
      return trim(r.references.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.chunk ? `\n   ${x.chunk}` : ""}`).join("\n"));
    },
  },

  web_fetch: {
    name: "web_fetch",
    summary: "Đọc nội dung một trang web",
    usage: 'web_fetch({"url":"<url>"})  ·  hoặc web_fetch(<url>)',
    needsApproval: false,
    alwaysAvailable: true,
    async run(arg) {
      const { url } = toolArgs(arg, [{ name: "url", aliases: ["link", "href", "target"] }]);
      const r = await webFetch(url);
      // A thin page sets `error` AND keeps what little it got: hiding the fragment would make
      // the model refetch to see it, and showing it without the warning is what let it treat a
      // bare page title as "I have read this site".
      if (r.error) return `Không đọc được ${r.url}: ${r.error}${r.markdown.trim() ? `\n\nPhần lấy được:\n${r.markdown.trim()}` : ""}`;
      return trim(`${r.url}\n\n${r.markdown}`);
    },
  },

  ripgrep_raw_search: {
    name: "ripgrep_raw_search",
    summary: "Tìm nội dung trong file trên máy tính của bạn",
    usage: 'ripgrep_raw_search({"pattern":"<mẫu>","path":"<thư mục>"})  ·  hoặc ripgrep_raw_search(<mẫu>[, <thư mục>])',
    needsApproval: false,
    async run(arg) {
      // These two ARE the catalog's names and its field order, so JSON and positional agree.
      const { pattern, path: dir } = toolArgs(arg, [
        { name: "pattern", aliases: ["query", "regex", "text"] },
        { name: "path", aliases: ["dir", "directory", "target_directory"] },
      ]);
      const r = await boxCall<{ path: string; matches: string[] }>("grep", { pattern, path: dir || "." });
      return trim(r.matches.length ? `${r.matches.length} dòng khớp trong ${r.path}:\n${r.matches.join("\n")}` : `Không tìm thấy "${pattern}" trong ${r.path}`);
    },
  },
};

/**
 * MCP resources — registered here rather than in chat.ts, and that is deliberate.
 *
 * chat.ts already folds this registry in (`for (const [name, spec] of Object.entries(availableTools()))`),
 * so a tool added here needs no edit to a 2,000-line file that is currently mid-change. Same reach,
 * far less risk.
 *
 * Only offered when `.mcp.json` declares a server. Advertising a tool that cannot run teaches the
 * model to keep reaching for it — the argument the browser tools already make in chat.ts.
 * `alwaysAvailable` because these need no box: MCP servers are local child processes.
 */
if (isMcpConfigured()) {
  TOOLS.list_mcp_resources = {
    name: "list_mcp_resources",
    summary: "Liệt kê resource (tài liệu, file, bản ghi) của các server MCP đã nối",
    usage: 'list_mcp_resources(<tên server>)  ·  bỏ trống để xem tất cả',
    needsApproval: false,
    alwaysAvailable: true,
    run: (arg) => listMcpResources(arg),
  };
  TOOLS.read_mcp_resource = {
    name: "read_mcp_resource",
    summary: "Đọc nội dung một resource MCP theo URI",
    usage: 'read_mcp_resource({"server":"<tên>","uri":"<uri>"})',
    needsApproval: false,
    alwaysAvailable: true,
    run: (arg) => readMcpResource(arg),
  };
}

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
    ? // "box" is internal jargon. The original is explicit: to the user it is always "my computer",
    // never a "box" — and the model repeats whatever word the tool list uses. It called itself
    // a "Linux Box" in a live reply because every summary here said box.
    "Công cụ shell/file/tìm-kiếm-file chạy trên MÁY TÍNH của bạn (một máy Linux riêng), " +
      "không phải máy của người dùng. Khi nói với người dùng, gọi nó là \"máy tính của mình\", đừng gọi là \"box\"."
    : "Hiện chưa nối máy tính, nên bạn CHỈ có các công cụ web ở trên: không chạy được lệnh shell, " +
      "không đọc file. Đừng hứa làm những việc đó.";
  return (
    // KEEP "DUY NHẤT một dòng" until chat.ts runs the multi-call parser.
    //
    // This sentence is what caps the agent at one tool per turn, i.e. the exact thing P5 exists to
    // fix, and lifting it is a two-line change here. It was lifted, measured, and put back, because
    // the executor is not ready: chat.ts:1061 still matches with
    // `/TOOL_CALL:\s*([A-Za-z_][\w-]*)\s*\((.*?)\)\s*$/s` — one call, anchored to the END of the
    // reply. Given two TOOL_CALL lines, the lazy group runs from the FIRST `(` to the LAST `)`, so
    // the argument becomes the second call's text as well. Measured live against the box: `arg=""`
    // and `tool error: ENOENT ... open '/home/b`, then the turn looped into five tool-calls and
    // ended on an approval card. Emitting more calls than the executor can read is worse than
    // emitting one.
    //
    // With the cap lifted, both models produce exactly what P5 wants — 2 calls, 1 batch, width 2,
    // 6/6 attempts (gemini 7.8-11.4s, opus-5 2.8-4.6s). So P5's model-side blocker is this sentence
    // and nothing else. Order of work: wire `parseToolCalls` + `planBatches` into chat.ts FIRST,
    // then delete this comment and lift the cap.
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
