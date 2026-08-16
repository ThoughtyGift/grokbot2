/**
 * Call each box tool directly against a sandbox daemon — no model in the loop.
 *
 * Separates "the tool is broken" from "the model called it oddly"; both were suspected
 * and only one can be true for any given failure.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "direct-token";
const PORT = 18557;
const root = await mkdtemp(join(tmpdir(), "grokbox-direct-"));
await writeFile(join(root, "notes.txt"), "alpha\nbravo\nMAGIC_TOKEN_9137\n");
await mkdir(join(root, "src"), { recursive: true });
await writeFile(join(root, "src", "app.ts"), "export const version = '2.4.1';\n");

process.env.GROKBOT2_BOX_EXEC_URL = `http://127.0.0.1:${PORT}`;
process.env.GROKBOT2_EXEC_TOKEN = TOKEN;

const shell = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe"].find((p) => existsSync(p));
const daemon = spawn(process.execPath, ["infra/vps/exec-daemon.mjs", String(PORT), root], {
  env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN, ...(shell ? { GROKBOT2_EXEC_SHELL: shell } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((r) => daemon.stdout.once("data", r));

const { TOOLS } = await import("../src/tools.ts");

let pass = 0, fail = 0;
const check = async (name, tool, arg, expect) => {
  let out;
  try { out = await TOOLS[tool].run(arg); } catch (e) { out = `THREW: ${e?.message ?? e}`; }
  const ok = expect.test(out);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`);
  if (!ok) console.log(`        arg=${JSON.stringify(arg)}\n        out=${String(out).replace(/\s+/g, " ").slice(0, 160)}`);
};

console.log("bare arguments");
await check("list_dir_v2(.)", "list_dir_v2", ".", /notes\.txt/);
await check("read_file_v2(notes.txt)", "read_file_v2", "notes.txt", /MAGIC_TOKEN_9137/);
await check("glob_file_search(**/*.ts)", "glob_file_search", "**/*.ts", /app\.ts/);
await check("ripgrep_raw_search(MAGIC…)", "ripgrep_raw_search", "MAGIC_TOKEN_9137", /notes\.txt/);

console.log("\nquoted arguments (what the model actually writes)");
await check('list_dir_v2(".")', "list_dir_v2", '"."', /notes\.txt/);
await check('read_file_v2("notes.txt")', "read_file_v2", '"notes.txt"', /MAGIC_TOKEN_9137/);
await check("glob_file_search('**/*.ts')", "glob_file_search", "'**/*.ts'", /app\.ts/);
await check('ripgrep_raw_search("MAGIC…")', "ripgrep_raw_search", '"MAGIC_TOKEN_9137"', /notes\.txt/);

console.log("\nmulti-argument forms");
await check("read_file_v2(notes.txt, 2, 1)", "read_file_v2", "notes.txt, 2, 1", /bravo/);
await check('read_file_v2("notes.txt", 3, 1)', "read_file_v2", '"notes.txt", 3, 1', /MAGIC_TOKEN_9137/);
await check("glob_file_search(*.ts, src)", "glob_file_search", "*.ts, src", /app\.ts/);

daemon.kill();
await rm(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
