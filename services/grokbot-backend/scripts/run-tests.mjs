/**
 * Run the test suite against a THROWAWAY store, always.
 *
 * `tsx --test src/**\/*.test.ts` inherits the environment, so with GROKBOT2_SQLITE_FILE unset the
 * suite opens `.data/grokbot.sqlite` — the real one. Several tests create and remove agents, and on
 * 2026-08-23 a run without those variables exported overwrote a live install: five bots and 575
 * transcript entries gone, recovered only because the backend keeps rotating .bak copies.
 *
 * Remembering to export two variables before every run is not a safeguard, it is a habit that fails
 * once. This makes the isolation part of the command, so a bare `pnpm test` cannot reach real data.
 *
 * `GROKBOT2_TEST_STORE=keep` leaves the temp directory behind for inspection after a failure.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "grokbot2-test-"));
const keep = process.env.GROKBOT2_TEST_STORE === "keep";

const args = process.argv.slice(2).length ? process.argv.slice(2) : ["src/**/*.test.ts"];
const child = spawn(
  "npx",
  ["tsx", "--test", ...args.map((a) => `"${a}"`)],
  {
    stdio: "inherit",
    // `npx` is a .cmd shim on Windows and cannot be spawned without one — the same reason the MCP
    // stdio transport needs it. The arguments are quoted above so the shell leaves the glob alone.
    shell: true,
    env: {
      ...process.env,
      GROKBOT2_SQLITE_FILE: join(dir, "test.sqlite"),
      GROKBOT2_STATE_FILE: join(dir, "test.state.json"),
      // Several modules put their files beside the code (.data/mcp, .data/secrets, .data/oauth) and
      // used to ignore the two variables above entirely — which is how a test deleted a REAL OAuth
      // sign-in. This is the variable they all read now.
      GROKBOT2_DATA_DIR: join(dir, "data"),
    },
  },
);

child.on("exit", (code, signal) => {
  if (keep) console.log(`\n[test] store kept at ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
  process.exit(signal ? 1 : (code ?? 1));
});
