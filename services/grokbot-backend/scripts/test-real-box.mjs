/**
 * The tools against the REAL box, over the public route.
 *
 * Everything before this ran against a daemon on the dev machine, which proves the
 * protocol but not the deployment: TLS, the nginx hop, the token, and the fact that the
 * shell is a real Linux one and not Git Bash pretending.
 *
 *   GROKBOT2_BOX_EXEC_URL=… GROKBOT2_EXEC_TOKEN=… node test-real-box.mjs
 */
import { TOOLS } from "../src/tools.ts";
import { boxConfigured } from "../src/box-exec.ts";

if (!boxConfigured()) {
  console.error("GROKBOT2_BOX_EXEC_URL is not set — nothing to test against");
  process.exit(1);
}

let pass = 0, fail = 0;
const check = async (name, tool, arg, want) => {
  let out;
  try { out = await TOOLS[tool].run(arg); } catch (e) { out = `THREW: ${e?.message ?? e}`; }
  const ok = want(out);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`);
  console.log(`        ${String(out).replace(/\s+/g, " ").slice(0, 130)}`);
};

console.log("shell — proves this is a real Linux box, not the dev machine");
await check("uname says Linux", "run_terminal_command_v2", "uname -s", (o) => /Linux/.test(o));
await check("exit code travels back", "run_terminal_command_v2", "exit 7", (o) => /exit=7/.test(o));
await check("stderr travels back", "run_terminal_command_v2", "echo boom >&2", (o) => /boom/.test(o));
await check("pipes work", "run_terminal_command_v2", "printf 'a\\nb\\nc\\n' | wc -l", (o) => /\b3\b/.test(o));
await check("it is the box, not this laptop", "run_terminal_command_v2", "hostname", (o) => /cs-linux/.test(o));
await check("the box desktop is attached", "run_terminal_command_v2", "echo $DISPLAY", (o) => /:77/.test(o));

console.log("\nfiles");
await check("writes then reads back", "run_terminal_command_v2", "echo REAL_BOX_9137 > probe.txt && cat probe.txt", (o) => /REAL_BOX_9137/.test(o));
await check("read_file_v2 sees it", "read_file_v2", "probe.txt", (o) => /REAL_BOX_9137/.test(o));
// Assert the SHAPE, not the deployment path: this hardcoded `/grok-workspace/` and broke the
// moment the box's workspace moved, reporting a path change as a tool regression.
await check("list_dir_v2 returns a tree", "list_dir_v2", ".", (o) => /workspace\/?\s/.test(o) && /probe\.txt/.test(o));
await check("ripgrep finds content", "ripgrep_raw_search", "REAL_BOX_9137", (o) => /probe\.txt/.test(o));
await check("glob finds by name", "glob_file_search", "*.txt", (o) => /probe\.txt/.test(o));

console.log("\nsandbox holds over the public route");
await check("cannot escape upward", "read_file_v2", "../../etc/passwd", (o) => /escapes root|không|error/i.test(o));
await check("cannot list outside root", "list_dir_v2", "/etc", (o) => /escapes root|không|error/i.test(o));

console.log("\ncleanup");
await check("removes the probe file", "run_terminal_command_v2", "rm -f probe.txt && ls probe.txt 2>&1 || echo gone", (o) => /gone|No such/.test(o));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
