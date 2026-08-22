/**
 * Kill whatever is listening on a port this script owns.
 *
 * The `shell: true` spawns in these e2e scripts give back the SHELL's pid, not the backend's, and
 * that one pid is wrong in both directions:
 *
 *  - taskkill it blindly and, once the shell has exited and Windows has recycled the number, you
 *    kill a stranger — twice in one session that stranger was the BFF on :8788;
 *  - guard against that by skipping when the child has exited, and the grandchild node survives
 *    the script instead. One sweep left ten backends listening on 8794–8807, which then made the
 *    NEXT run fail with "port already in use" — a red that says nothing about the product.
 *
 * The port is the unambiguous handle: each script picks its own, so cleaning up by port cannot
 * reach the BFF, the runtime, the computer or ops. Use it in addition to killing the live tree.
 */
import { spawnSync } from "node:child_process";

/** Production stack — e2e cleanup must never touch these, even if a script passes the wrong port. */
export const CORE_PORTS = Object.freeze([8788, 8789, 8790, 8791]);

/** Pids listening on `port`, from the OS rather than from anything we remembered. */
export function listenersOn(port) {
  if (process.platform !== "win32") {
    const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return [...new Set((r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean))];
  }
  const r = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  const pids = new Set();
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] ?? "";
    // Match the port exactly: `:8794` must not also match `:87940` or a remote `:8794`.
    if (!local.endsWith(`:${port}`)) continue;
    const pid = cols.at(-1);
    if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
  }
  return [...pids];
}

/** Kill the listeners on `port`. Returns the pids it killed. Refuses 8788–8791. */
export function killPort(port) {
  const n = Number(port);
  if (CORE_PORTS.includes(n)) {
    console.error(`kill-port: refusing to kill production port ${n}`);
    return [];
  }
  const pids = listenersOn(n);
  for (const pid of pids) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ } }
  }
  return pids;
}

/**
 * Sweep these ports on every exit path.
 *
 * `process.exit(1)` inside a `try` skips `finally` in Node — that is how e2e spawners leaked
 * orphans on 8792–8817 when the child failed to come up. An `exit` hook still runs.
 */
export function onExitKill(...ports) {
  process.on("exit", () => {
    for (const p of ports) {
      try { killPort(p); } catch { /* nothing to clean */ }
    }
  });
}
