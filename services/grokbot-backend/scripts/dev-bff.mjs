/**
 * BFF dev entry after workspace packages are built.
 *
 * `pnpm backend` starts this alongside `@grokbot2/runtime`, `@grokbot2/computer` and
 * `@grokbot2/ops`. When a URL is unset we default it so chat/status/cron go through those
 * processes. Explicit empty (`GROKBOT2_RUNTIME_URL=` / `GROKBOT2_COMPUTER_URL=` /
 * `GROKBOT2_OPS_URL=`) keeps the in-process path for e2e that spawn `tsx src/index.ts`
 * without a second binary.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.GROKBOT2_RUNTIME_URL == null) {
  process.env.GROKBOT2_RUNTIME_URL = "http://127.0.0.1:8789";
}
if (process.env.GROKBOT2_COMPUTER_URL == null) {
  process.env.GROKBOT2_COMPUTER_URL = "http://127.0.0.1:8790";
}
if (process.env.GROKBOT2_OPS_URL == null) {
  process.env.GROKBOT2_OPS_URL = "http://127.0.0.1:8791";
}

const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd,
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
