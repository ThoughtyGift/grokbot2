/**
 * Gate hook for the client patch set (roadmap F1+).
 *
 * Thin on purpose: `infra/scripts/patch-client.mjs --verify` is the single implementation, and the
 * gate spawns scripts from this directory with plain node. Duplicating the checks here is how the
 * two would drift.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const r = spawnSync(process.execPath, [join(REPO, "infra", "scripts", "patch-client.mjs"), "--verify"], { encoding: "utf8" });
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
process.exit(r.status ?? 1);
