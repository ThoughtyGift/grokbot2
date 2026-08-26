#!/usr/bin/env node
/**
 * Box exec daemon — the thing the real Grok Bot box runs on port 1337.
 *
 * Everything the agent's shell and file tools do happens HERE, inside the box, never on
 * the user's own machine. That separation is the whole point: the desktop app is a
 * viewer, the box is the computer.
 *
 *   GROKBOT2_EXEC_TOKEN=<secret> node exec-daemon.mjs [port] [root]
 *
 * Binds 127.0.0.1 only — publish it through the host's existing nginx (with the token)
 * rather than opening a port to the world.
 */
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { readFile, writeFile, readdir, stat, mkdir, rename, unlink } from "node:fs/promises";
// Sổ ghép người dùng đọc/ghi ĐỒNG BỘ, cố ý: nó nằm trên đường cấp tài khoản, và hai request cùng lúc
// đọc-rồi-ghi bất đồng bộ thì cấp trùng một tài khoản cho hai người — hỏng cách ly, không báo gì.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.GROKBOT2_EXEC_PORT ?? 1337);
const ROOT = resolve(process.argv[3] ?? process.env.GROKBOT2_EXEC_ROOT ?? "/root/workspace");
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 60_000;

if (!TOKEN) {
  console.error("refusing to start without GROKBOT2_EXEC_TOKEN");
  process.exit(1);
}

/*
 * ── Tách người dùng theo tài khoản hệ điều hành (chặng 5, tầng 1) ───────────────
 *
 * Hôm nay mọi bot của mọi người chạy dưới cùng một user `box`, cùng đọc một
 * `/home/box/workspace`. Đo được ngày 26/08 bằng `e2e-box-leak.mjs`: **0/6 chỗ kín** — bot của người
 * A đọc, liệt kê, `cat`, và GHI ĐÈ được file của người B.
 *
 * Cách sửa không phải viết thêm kiểm tra trong code này, mà là **để kernel làm việc đó**: mỗi người
 * một tài khoản hệ điều hành, mỗi tài khoản một thư mục 700. Một lỗi trong daemon cũng không mở được
 * file của người khác, vì Linux từ chối.
 *
 * `GROKBOT2_PER_USER` là công tắc, và mặc định TẮT: box đang chạy thật, nên bản này phải bật được
 * sau khi đã đo chứ không đổi hành vi ngay khi cài.
 *
 * Cần trước (bước 0, làm một lần bằng root — xem docs/plan/per-user-on-one-box.md):
 *   groupadd gb2users · useradd -m -g gb2users gb2uNNN · chmod 700 /home/gb2uNNN
 *   /etc/sudoers.d/grokbot2:  box ALL=(%gb2users) NOPASSWD: ALL
 */
const PER_USER = (process.env.GROKBOT2_PER_USER ?? "").trim() === "1";

/**
 * Sổ ghép người dùng grokbot2 → tài khoản hệ điều hành.
 *
 * `/var/lib/grokbot2` chứ không phải `/opt`: daemon chạy dưới `box`, và `/opt` thuộc root — bản đầu
 * đặt ở đó nên lượt cấp tài khoản đầu tiên chết với `EACCES`. Thư mục này phải do `box` sở hữu, mode
 * 700 (bước 0 dựng nó).
 *
 * Không nằm trong home của người dùng nào: nó là sổ của cả hệ, và để trong home ai thì người đó đọc
 * được ai đang dùng tài khoản nào.
 */
const MAP_FILE = process.env.GROKBOT2_USER_MAP ?? "/var/lib/grokbot2/users.json";

/**
 * Tài khoản hệ điều hành của một người — cấp từ dải đã tạo sẵn, ghi vào sổ để lần sau vẫn thế.
 *
 * KHÔNG băm owner ra số: hai người trùng ô băm sẽ dùng chung một tài khoản, và đó là **hỏng cách ly
 * mà không có dấu hiệu nào**. Sổ thì trùng là thấy ngay.
 *
 * Hết dải thì ném lỗi. Không lùi về `box`: lùi về nghĩa là im lặng bỏ cách ly đúng lúc cần nó nhất.
 */
function osUserFor(owner) {
  const key = String(owner ?? "").trim();
  if (!key) throw new Error("per-user mode: request carried no owner");

  let map = {};
  try { map = JSON.parse(readFileSync(MAP_FILE, "utf8")); } catch { /* sổ chưa có */ }
  if (map[key]) return map[key];

  const taken = new Set(Object.values(map));
  const free = (process.env.GROKBOT2_USER_POOL ?? "gb2u001,gb2u002,gb2u003,gb2u004,gb2u005")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .find((u) => !taken.has(u));
  if (!free) throw new Error(`per-user mode: pool exhausted (${taken.size} in use) — create more gb2u* accounts`);

  map[key] = free;
  writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`);
  console.error(`[exec-daemon] owner ${key} -> ${free}`);
  return free;
}

/**
 * Ai đang gọi, cho suốt một request — không phải truyền qua 13 handler.
 *
 * Cùng khuôn với `request-context.ts` ở backend, và cùng lý do: thêm một tham số `owner` vào mọi
 * handler thì chỗ nào quên truyền sẽ **im lặng rơi về mặc định**, tức im lặng bỏ cách ly. Kho theo
 * request thì chỗ quên là chỗ nổ.
 */
const ctx = new AsyncLocalStorage();

/** Thư mục gốc của request hiện tại: của riêng người gọi khi bật tách, còn không thì ROOT chung. */
const rootOf = () => ctx.getStore()?.root ?? ROOT;

/** Tài khoản hệ điều hành phải chạy dưới, hoặc `null` khi chưa bật tách. */
const userOf = () => ctx.getStore()?.user ?? null;

/**
 * Keep every path inside the request's root. A traversal check on the *resolved* path is the only
 * one that holds — checking the raw string lets `a/../../etc` through.
 *
 * Khi bật tách, gốc này là `/home/gb2uNNN/workspace` — nên phép chặn đi-ngang sẵn có tự thành phép
 * chặn giữa người với người, không phải thêm luật mới.
 */
function safePath(p) {
  const root = rootOf();
  const abs = isAbsolute(p ?? "") ? resolve(p) : resolve(root, p ?? ".");
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${p}`);
  return abs;
}

const clip = (s) =>
  s.length <= MAX_OUTPUT ? { text: s, truncated: false } : { text: s.slice(0, MAX_OUTPUT), truncated: true };

// The box is Linux, so /bin/bash is the right default; the override exists purely so the
// protocol test can exercise the shell path on a dev machine.
const SHELL = process.env.GROKBOT2_EXEC_SHELL ?? "/bin/bash";

/** Run through bash so pipes and globs behave as the model expects. */
/**
 * Chạy lệnh dưới tài khoản hệ điều hành nào — `null` là dưới chính daemon, như trước.
 *
 * `sudo -n`: không bao giờ hỏi mật khẩu. Không có quyền thì thất bại NGAY và thấy được, chứ không
 * treo chờ một dấu nhắc mà không ai gõ vào được.
 */
const asUser = (user, command) =>
  user ? ["sudo", ["-n", "-u", user, SHELL, "-lc", command]] : [SHELL, ["-lc", command]];

const sh = (command, cwd, timeout, user = null) =>
  new Promise((res) => {
    const [bin, argv] = asUser(user, command);
    execFile(bin, argv, { cwd, timeout, maxBuffer: MAX_OUTPUT * 2, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const out = clip(String(stdout ?? ""));
        const errOut = clip(String(stderr ?? ""));
        res({
          stdout: out.text, stderr: errOut.text,
          truncated: out.truncated || errOut.truncated,
          exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          timedOut: Boolean(err && err.killed),
        });
      });
  });

/**
 * Memory lives OUTSIDE the sandbox root.
 *
 * The original describes `/home/box` as holding "your profile, memory, routines" — separate
 * from the scratch space in `/workspace`. Keeping it out of the tool-visible root means a
 * stray `rm -rf *` in the workspace cannot wipe what the agent has learned, and the agent
 * cannot reach another agent's memory by path.
 */
const MEMORY_DIR = process.env.GROKBOT2_MEMORY_DIR ?? "/root/grok-memory";

/** Keys become filenames, so anything that is not a plain identifier is rejected. */
function memoryFile(key) {
  const k = String(key ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) throw new Error(`invalid memory key: ${key}`);
  return join(MEMORY_DIR, `${k}.json`);
}

const handlers = {
  async memoryLoad({ key }) {
    try {
      return { entries: JSON.parse(await readFile(memoryFile(key), "utf8")) };
    } catch (e) {
      if (e?.code === "ENOENT") return { entries: [] };   // nothing learned yet is not an error
      throw e;
    }
  },

  async memorySave({ key, entries }) {
    if (!Array.isArray(entries)) throw new Error("entries must be an array");
    const file = memoryFile(key);
    await mkdir(MEMORY_DIR, { recursive: true });
    // Write then rename: a crash mid-write must not leave truncated memory behind.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(entries, null, 1));
    await rename(tmp, file);
    return { saved: entries.length, path: file };
  },

  async health() {
    const { stdout } = await sh("uname -a; echo; df -h / | tail -1", rootOf(), 10_000, userOf());
    return {
      ok: true, root: rootOf(), display: process.env.DISPLAY ?? null, info: stdout.trim(),
      // Nói rõ đang chạy dưới tài khoản nào: một lần `health` là biết tách đã bật thật hay chưa,
      // thay vì đoán từ hành vi.
      osUser: userOf() ?? "(chung)", perUser: PER_USER,
    };
  },

  // run_terminal_command_v2
  async exec({ command, cwd, timeoutMs }) {
    if (typeof command !== "string" || !command.trim()) throw new Error("command required");
    return sh(command, safePath(cwd ?? "."), Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT, 300_000), userOf());
  },

  /**
   * edit_file_v2 — write a file whole.
   *
   * Same tmp+rename as memorySave: a crash mid-write must not leave a half-written file where
   * a complete one used to be. `safePath` keeps it inside ROOT, so this cannot touch the rest
   * of the host even though the daemon runs as root.
   */
  async write({ target_file, path, content }) {
    const abs = safePath(target_file ?? path);
    if (typeof content !== "string") throw new Error("content required");
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, abs);
    return { path: abs, bytes: Buffer.byteLength(content) };
  },

  /**
   * str_replace — targeted edit without resending the whole file.
   *
   * Refuses when `find` is absent or ambiguous rather than guessing which occurrence was
   * meant: a silent wrong-instance edit is far worse than a failed call.
   */
  async replace({ target_file, path, find, replace: to, all }) {
    const abs = safePath(target_file ?? path);
    if (typeof find !== "string" || find === "") throw new Error("find required");
    if (typeof to !== "string") throw new Error("replace required");
    const raw = await readFile(abs, "utf8");
    const count = raw.split(find).length - 1;
    if (count === 0) throw new Error(`find not present in ${abs}`);
    if (count > 1 && all !== true) throw new Error(`find matches ${count} times in ${abs}; pass all:true or use a longer, unique find`);
    const next = all === true ? raw.split(find).join(to) : raw.replace(find, to);
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, next);
    await rename(tmp, abs);
    return { path: abs, replaced: all === true ? count : 1, bytes: Buffer.byteLength(next) };
  },

  /**
   * Raw bytes, for the desktop's attachment preview.
   *
   * Mirrors the original's `readAttachmentChunk({path, offset, length}) → {totalSize,
   * bytesBase64}`: the client probes with `length: 0` to learn the size before deciding
   * whether to fetch at all, so a zero length must return the size and no bytes rather
   * than an error.
   */
  async readBytes({ target_file, path, offset, length }) {
    const abs = safePath(target_file ?? path);
    const info = await stat(abs);
    if (!info.isFile()) throw new Error(`not a file: ${abs}`);
    const totalSize = info.size;
    const from = Math.max(0, Number(offset) || 0);
    const want = Number(length) || 0;
    if (want <= 0 || from >= totalSize) return { path: abs, totalSize, bytesBase64: "" };
    const buf = await readFile(abs);
    return { path: abs, totalSize, bytesBase64: buf.subarray(from, from + want).toString("base64") };
  },

  // delete_file
  async remove({ target_file, path }) {
    const abs = safePath(target_file ?? path);
    await unlink(abs);
    return { path: abs, deleted: true };
  },

  // read_file_v2 — offset/limit are LINE based, matching the tool's params
  async read({ target_file, path, offset, limit, chars_limit, enable_line_numbers }) {
    const abs = safePath(target_file ?? path);
    const raw = await readFile(abs, "utf8");
    const lines = raw.split("\n");
    const from = Math.max(0, Number(offset) || 0);
    const to = limit ? from + Number(limit) : lines.length;
    let body = lines.slice(from, to);
    if (enable_line_numbers) body = body.map((l, i) => `${String(from + i + 1).padStart(6)}\t${l}`);
    const text = body.join("\n");
    const capped = chars_limit ? text.slice(0, Number(chars_limit)) : text;
    return { path: abs, totalLines: lines.length, from, to: Math.min(to, lines.length), content: clip(capped).text };
  },

  /**
   * list_dir_v2 — a TREE, matching `ListDirV2Result.directory_tree_root`.
   *
   * The original returns nested `DirectoryTreeNode { abs_path, children_dirs,
   * children_files, children_were_processed, num_files }`, not a flat listing. A flat list
   * costs an extra round trip per level, which is how an agent burns its turns walking a
   * project one directory at a time.
   */
  async list({ target_directory, path, ignore_globs, depth }) {
    const abs = safePath(target_directory ?? path ?? ".");
    const ignores = (ignore_globs ?? []).map(
      (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`),
    );
    const skip = (name) => name === ".git" || name === "node_modules" || ignores.some((re) => re.test(name));
    const maxDepth = Math.min(Number(depth) || 2, 5);
    let budget = 2000;   // total nodes, so a huge tree cannot wedge the daemon

    const walk = async (dir, level) => {
      const node = { abs_path: dir, children_dirs: [], children_files: [], children_were_processed: true, num_files: 0 };
      let names;
      try { names = await readdir(dir); } catch { node.children_were_processed = false; return node; }
      for (const name of names.sort()) {
        if (skip(name) || budget <= 0) { if (budget <= 0) node.children_were_processed = false; continue; }
        budget -= 1;
        let s;
        try { s = await stat(join(dir, name)); } catch { continue; }
        if (s.isDirectory()) {
          if (level < maxDepth) node.children_dirs.push(await walk(join(dir, name), level + 1));
          else node.children_dirs.push({ abs_path: join(dir, name), children_dirs: [], children_files: [], children_were_processed: false, num_files: 0 });
        } else {
          node.children_files.push({ name, size: s.size, modifiedMs: s.mtimeMs });
          node.num_files += 1;
        }
      }
      return node;
    };

    return { directory_tree_root: await walk(abs, 0) };
  },

  // glob_file_search — delegate to the shell so the box's own globbing applies
  async glob({ target_directory, glob_pattern }) {
    const dir = safePath(target_directory ?? ".");
    // Models write `**/*.ts`. `find -name` matches the basename only and never sees a
    // slash, so that pattern silently returns nothing; strip the recursive prefix and
    // switch to -path when a real slash remains.
    const raw = String(glob_pattern ?? "*").replace(/'/g, "");
    const stripped = raw.replace(/^(\*\*\/)+/, "");
    const test = stripped.includes("/") ? `-path '*/${stripped}'` : `-name '${stripped}'`;
    const { stdout } = await sh(`find . -name .git -prune -o -type f ${test} -print | head -500`, dir, 30_000);
    return { path: dir, pattern: stripped, matches: stdout.split("\n").filter(Boolean) };
  },

  // ripgrep_raw_search — rg when present, grep -r otherwise
  async grep({ pattern, path, glob, output_mode, context_before, context_after, case_insensitive }) {
    const dir = safePath(path ?? ".");
    const q = String(pattern ?? "").replace(/'/g, "'\\''");
    const flags = [
      case_insensitive ? "-i" : "",
      output_mode === "files_with_matches" ? "-l" : "-n",
      context_before ? `-B ${Number(context_before)}` : "",
      context_after ? `-A ${Number(context_after)}` : "",
      glob ? `--glob '${String(glob).replace(/'/g, "")}'` : "",
    ].filter(Boolean).join(" ");
    const rg = `rg ${flags} -- '${q}' . | head -300`;
    const fallback = `grep -rn ${case_insensitive ? "-i" : ""} -- '${q}' . | head -300`;
    const { stdout, stderr, exitCode } = await sh(`command -v rg >/dev/null && ${rg} || ${fallback}`, dir, 60_000);
    return { path: dir, matches: stdout.split("\n").filter(Boolean), stderr, exitCode };
  },
};

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "unauthorized" });

  const name = (req.url ?? "").replace(/^\/+|\?.*$/g, "");
  const fn = handlers[name];
  if (!fn) return send(404, { error: `unknown op: ${name}`, ops: Object.keys(handlers) });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let args = {};
    try { if (chunks.length) args = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* keep {} */ }
    // GROKBOT2_EXEC_LOG shows exactly what arrived. Worth having: an argument mangled
    // on the way in looks identical to a tool that simply found nothing.
    if (process.env.GROKBOT2_EXEC_LOG) console.error(`[exec-daemon] ${name} ${JSON.stringify(args).slice(0, 300)}`);
    try {
      /*
       * Ai đang gọi — backend gửi trong header `x-grokbot2-owner`.
       *
       * Header chứ không phải một trường trong thân: thân là **tham số của công cụ**, do model điền.
       * Nhét danh tính vào đó thì một ngày nào đó model sẽ điền nó — và "tự chọn mình là ai" đúng là
       * thứ tầng này tồn tại để ngăn.
       */
      if (!PER_USER) { send(200, await fn(args)); return; }

      const user = osUserFor(req.headers["x-grokbot2-owner"]);
      const root = join("/home", user, "workspace");
      // Tạo gốc DƯỚI DANH NGHĨA người đó, để thư mục thuộc về họ chứ không thuộc `box`. `mkdir -p`
      // nên gọi lại bao nhiêu lần cũng được.
      const made = await sh(`mkdir -p ${JSON.stringify(root)} && chmod 700 ${JSON.stringify(root)}`, "/", 10_000, user);
      if (made.exitCode !== 0) throw new Error(`không tạo được gốc của ${user}: ${made.stderr.trim() || made.stdout.trim()}`);
      send(200, await ctx.run({ user, root }, () => fn(args)));
    } catch (e) {
      if (process.env.GROKBOT2_EXEC_LOG) console.error(`[exec-daemon] ${name} ERROR ${String(e?.message ?? e).slice(0, 200)}`);
      send(200, { error: String(e?.message ?? e) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[exec-daemon] listening on 127.0.0.1:${PORT}, root=${ROOT}`);
  console.log(`[exec-daemon] ops: ${Object.keys(handlers).join(", ")}`);
});
