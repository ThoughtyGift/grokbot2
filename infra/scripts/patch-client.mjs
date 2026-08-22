/**
 * Own the patch to the locally installed Grok Bot client — as code, reproducibly.
 *
 * Under the FE-gốc roadmap the stock client IS the production UI, so its patch set is a first-class
 * artifact of this repo (service S13). Before this script the drive-path fix existed only as a hand
 * edit inside `resources/app/`: working, verified, and unreproducible. One app update would have
 * erased it with nothing to rebuild from.
 *
 *   node infra/scripts/patch-client.mjs --verify   # is the install patched, and still correctly?
 *   node infra/scripts/patch-client.mjs --apply    # extract vendor asar → patch → install
 *   node infra/scripts/patch-client.mjs --undo     # back to the vendor bundle
 *   node infra/scripts/patch-client.mjs --status   # paths, fuses, recorded state
 *
 * Load order matters and cost a wrong diagnosis once: Electron searches `app.asar` → `app` →
 * `default_app.asar`. The `OnlyLoadAppFromAsar: DISABLED` fuse only PERMITS the `app/` fallback — it
 * does not prefer it. So `--apply` must also move `app.asar` aside, or the app keeps booting the
 * vendor bundle while every patch sits there looking applied.
 *
 * `--apply` needs `@electron/asar` (fetched via npx on first use) because a full extract also pulls
 * in the `app.asar.unpacked` natives. `--verify` and `--undo` are pure fs and need no network.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, cpSync, mkdtempSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { PATCHES } from "../patches/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const STATE_FILE = join(REPO, "docs", "state", "client-patch-state.json");

const APP_DIR = process.env.GROKBOT2_CLIENT_DIR
  ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Grok Bot");
const RES = join(APP_DIR, "resources");
const ASAR = join(RES, "app.asar");
const ASAR_ASIDE = join(RES, "app.asar.disabled-by-grokbot2");
const APP_UNPACKED = join(RES, "app");

/**
 * `--dry-run` is `--apply` minus the last three steps: it extracts the vendor bundle, applies the
 * patch set, and parses the result, but never touches `resources/app`. That covers every way the
 * apply can actually fail (asar unreadable, occurrence count drifted, patched file not valid JS)
 * while leaving a working install alone — so the pipeline is testable without betting the daily
 * driver on it.
 */
const mode = ["--apply", "--dry-run", "--verify", "--undo", "--status"].find((f) => process.argv.includes(f)) ?? "--status";
const DRY = mode === "--dry-run";
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => console.log(`  FAIL ${m}`);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

/**
 * Which bundle the app will actually boot, by Electron's own search order. Reported rather than
 * inferred, because "the patch is in resources/app" and "the patch is running" are different claims.
 */
const bootSource = () => {
  if (existsSync(ASAR)) return { source: "app.asar (VENDOR)", patched: false };
  if (existsSync(APP_UNPACKED)) return { source: "resources/app (patched)", patched: true };
  return { source: "none — app cannot boot", patched: false };
};

const readState = () => {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return null; }
};

const clientVersion = (root) => {
  try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version; } catch { return null; }
};

/**
 * Electron's fuse wire, read straight out of the exe. Two of these decide whether this whole
 * approach is possible at all, so it is worth reading rather than assuming.
 *
 * Layout after the sentinel: one version byte, one fuse-count byte, then one ASCII CHARACTER per
 * fuse — '0' disabled, '1' enabled, 'r' removed. (Not raw 0/1/2 bytes: this install reads
 * `\x01\t101100011`, i.e. version 1, 9 fuses, "101100011".) Order is FuseV1Options.
 */
const FUSES = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
];
const FUSE_STATE = { 0: "DISABLED", 1: "ENABLED", r: "REMOVED" };
/** The four the roadmap actually reasons about; the rest are noise in `--status`. */
const FUSES_OF_INTEREST = new Set(["RunAsNode", "EnableNodeCliInspectArguments", "EnableEmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar"]);
const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
const readFuses = () => {
  const exe = join(APP_DIR, "Grok Bot.exe");
  if (!existsSync(exe)) return null;
  const buf = readFileSync(exe);
  const at = buf.indexOf(Buffer.from(SENTINEL, "latin1"));
  if (at < 0) return null;
  const base = at + SENTINEL.length;
  const count = buf[base + 1];
  const wire = buf.slice(base + 2, base + 2 + count).toString("latin1");
  const out = {};
  for (let i = 0; i < Math.min(count, FUSES.length); i += 1) out[FUSES[i]] = FUSE_STATE[wire[i]] ?? `?(${wire[i]})`;
  return out;
};

const fuseVerdict = (f) => {
  if (!f) return { fatal: false, notes: ["fuses: could not parse (not fatal, but --apply is unverified)"] };
  const notes = [], fatal = [];
  if (f.OnlyLoadAppFromAsar === "ENABLED") fatal.push("OnlyLoadAppFromAsar=ENABLED → resources/app fallback is BLOCKED");
  if (f.EnableEmbeddedAsarIntegrityValidation === "ENABLED") fatal.push("asar integrity validation=ENABLED → a patched bundle will be rejected");
  for (const [k, v] of Object.entries(f)) if (FUSES_OF_INTEREST.has(k)) notes.push(`fuse ${k} = ${v}`);
  return { fatal: fatal.length > 0, fatalReasons: fatal, notes };
};

// ─────────────────────────────── status ───────────────────────────────

if (mode === "--status") {
  const boot = bootSource();
  const st = readState();
  console.log("=== client patch status ===");
  console.log(`  app dir      : ${APP_DIR}${existsSync(APP_DIR) ? "" : "   (NOT FOUND)"}`);
  console.log(`  boots from   : ${boot.source}`);
  console.log(`  vendor asar  : ${existsSync(ASAR) ? "app.asar (in place)" : existsSync(ASAR_ASIDE) ? "moved aside ✓" : "MISSING"}`);
  console.log(`  patch set    : ${PATCHES.length} — ${PATCHES.map((p) => p.id).join(", ")}`);
  console.log(`  client ver   : ${clientVersion(APP_UNPACKED) ?? "?"}`);
  for (const n of fuseVerdict(readFuses()).notes) console.log(`  ${n}`);
  console.log(st ? `  recorded     : ${st.appliedAt} on client ${st.clientVersion}, asar ${st.vendorAsarSha256}` : "  recorded     : (none — never applied by this script)");
  process.exit(0);
}

// ─────────────────────────────── verify ───────────────────────────────

if (mode === "--verify") {
  console.log("=== verify client patch ===");
  let fails = 0;
  const fail = (m) => { bad(m); fails += 1; };

  if (!existsSync(APP_DIR)) { fail(`app dir not found: ${APP_DIR}`); process.exit(1); }

  const boot = bootSource();
  boot.patched ? ok(`boots from ${boot.source}`) : fail(`boots from ${boot.source} — patches are NOT live`);
  existsSync(ASAR_ASIDE) ? ok("vendor app.asar moved aside") : fail("vendor app.asar not found aside — cannot prove load order");
  existsSync(ASAR) && fail("app.asar is back in place — it WINS the load order, patches are dead");

  // package.json must stay verbatim: `name` decides userData, so changing it moves the app's
  // entire state directory and the roster appears to vanish.
  try {
    const pkg = JSON.parse(readFileSync(join(APP_UNPACKED, "package.json"), "utf8"));
    pkg.name === "sand" ? ok('package.json name is "sand" (userData intact)') : fail(`package.json name is "${pkg.name}", must be "sand" — userData would move`);
  } catch { fail("cannot read resources/app/package.json"); }

  for (const p of PATCHES) {
    const target = join(APP_UNPACKED, p.file);
    if (!existsSync(target)) { fail(`${p.id}: ${p.file} missing`); continue; }
    const src = readFileSync(target, "utf8");
    const marks = p.marker ? src.split(p.marker).length - 1 : 0;
    const stale = src.split(p.find).length - 1;
    if (marks === p.expected && stale === 0) ok(`${p.id}: applied (${marks}× marker, 0 unpatched)`);
    else if (stale > 0) fail(`${p.id}: ${stale} unpatched occurrence(s) still present — re-run --apply`);
    else fail(`${p.id}: marker found ${marks}×, expected ${p.expected}`);

    const chk = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    chk.status === 0 ? ok(`${p.id}: ${p.file} parses`) : fail(`${p.id}: ${p.file} is not valid JS — ${(chk.stderr || "").split("\n")[0]}`);
  }

  const v = fuseVerdict(readFuses());
  if (v.fatal) { for (const r of v.fatalReasons) fail(`FUSE: ${r}`); }
  else ok("fuses still permit the resources/app fallback");

  const st = readState();
  if (!st) console.log("  note  no docs/state/client-patch-state.json — this install was patched by hand, not by --apply");
  else if (st.clientVersion && st.clientVersion !== clientVersion(APP_UNPACKED)) fail(`client version drifted: recorded ${st.clientVersion}, on disk ${clientVersion(APP_UNPACKED)} — app updated, re-run --apply`);

  console.log(fails === 0 ? "\nOK — patch set is live and intact." : `\n${fails} problem(s).`);
  process.exit(fails === 0 ? 0 : 1);
}

// ─────────────────────────────── undo ───────────────────────────────

if (mode === "--undo") {
  console.log("=== undo client patch ===");
  if (!existsSync(ASAR) && !existsSync(ASAR_ASIDE)) { console.error("neither app.asar nor the aside copy exists — refusing to touch this install"); process.exit(2); }
  if (existsSync(APP_UNPACKED)) { rmSync(APP_UNPACKED, { recursive: true, force: true }); ok("removed resources/app"); }
  if (!existsSync(ASAR) && existsSync(ASAR_ASIDE)) { renameSync(ASAR_ASIDE, ASAR); ok("restored app.asar"); }
  console.log("\nback on the vendor bundle. Re-run --apply to patch again.");
  process.exit(0);
}

// ─────────────────────────────── apply ───────────────────────────────

console.log(DRY ? "=== DRY RUN (install untouched) ===" : "=== apply client patch ===");
if (!existsSync(APP_DIR)) { console.error(`app dir not found: ${APP_DIR}`); process.exit(2); }

const v = fuseVerdict(readFuses());
if (v.fatal) {
  console.error("this client build does NOT permit patching:");
  for (const r of v.fatalReasons) console.error(`  ${r}`);
  console.error("\nSee ROADMAP.md R2 — if a vendor update did this, the FE-gốc approach is dead and the");
  console.error("fallback is apps/grokbot-web. Do not force it.");
  process.exit(3);
}

// A running client holds the archive open, and every failure mode below starts there.
if (!DRY && process.platform === "win32") {
  const ps = spawnSync("tasklist", ["/FI", "IMAGENAME eq Grok Bot.exe", "/NH"], { encoding: "utf8" });
  if (/Grok Bot\.exe/i.test(ps.stdout ?? "")) {
    console.error("Grok Bot is running — close it first. It holds app.asar open, and a half-finished");
    console.error("apply leaves the vendor asar beside a patched resources/app, which boots vendor silently.");
    process.exit(4);
  }
}

const vendorAsar = existsSync(ASAR) ? ASAR : existsSync(ASAR_ASIDE) ? ASAR_ASIDE : null;
if (!vendorAsar) { console.error("no vendor app.asar found (neither in place nor aside)"); process.exit(2); }
ok(`vendor bundle: ${vendorAsar.replace(RES, "resources")} (${(statSync(vendorAsar).size / 1e6).toFixed(1)} MB, sha ${sha(vendorAsar)})`);

const work = mkdtempSync(join(tmpdir(), "grokbot2-patch-"));
const staging = join(work, "app");

/**
 * Extract from a COPY named exactly `app.asar`, with its `app.asar.unpacked` sidecar beside it.
 *
 * @electron/asar derives the sidecar path from the archive's own filename: given
 * `app.asar.disabled-by-grokbot2` it goes looking for `app.asar.disabled-by-grokbot2.unpacked` and
 * dies on the first unpacked native (`@anysphere/tree-chunk-napi/index.js`). So the recorded recipe
 * — "extract app.asar, it pulls the unpacked natives in for you" — only holds BEFORE the rename that
 * the same recipe requires. Re-extraction after a successful apply hits this every time.
 *
 * Copying rather than renaming in place: the vendor archive is the only way back to a clean client,
 * and a half-finished rename in `resources/` is not a state worth risking to save 48 MB of temp.
 */
const vendorView = join(work, "app.asar");
console.log(`  staging vendor bundle → ${vendorView}`);
cpSync(vendorAsar, vendorView);
const vendorUnpacked = join(RES, "app.asar.unpacked");
if (existsSync(vendorUnpacked)) {
  cpSync(vendorUnpacked, `${vendorView}.unpacked`, { recursive: true });
  ok("staged app.asar.unpacked sidecar (asar resolves it by filename)");
}

console.log(`  extracting → ${staging}`);
// Quoted because `shell: true` re-splits the argv on spaces, and the install path is
// `…\Programs\Grok Bot\…` — unquoted it truncates at "Grok" and fails with ENOENT.
const ex = spawnSync("npx", ["--yes", "@electron/asar", "extract", `"${vendorView}"`, `"${staging}"`], { encoding: "utf8", shell: true, timeout: 600_000 });
if (ex.status !== 0) {
  console.error("asar extract failed:");
  console.error((ex.stderr || ex.stdout || "").trim().split("\n").slice(-8).join("\n"));
  process.exit(2);
}
ok("extracted");

// Patch in staging, and assert the occurrence count BEFORE writing anything. A bundle that no
// longer matches must stop the run with the patch id — never get patched approximately.
for (const p of PATCHES) {
  const target = join(staging, p.file);
  if (!existsSync(target)) { console.error(`FAIL ${p.id}: ${p.file} not in this bundle`); process.exit(1); }
  const src = readFileSync(target, "utf8");
  const found = src.split(p.find).length - 1;
  if (found !== p.expected) {
    console.error(`FAIL ${p.id}: found ${found} occurrence(s), expected ${p.expected}`);
    console.error(`  ${p.summary}`);
    console.error("  The vendor bundle changed. Re-locate the function and update the patch — do not patch blind.");
    process.exit(1);
  }
  const out = src.split(p.find).join(p.replace);
  writeFileSync(target, out);
  const chk = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
  if (chk.status !== 0) { console.error(`FAIL ${p.id}: patched ${p.file} is not valid JS\n${chk.stderr}`); process.exit(1); }
  ok(`${p.id}: ${found}× replaced, ${p.file} parses`);
}

if (DRY) {
  console.log(`\nDRY RUN OK — every patch matched and parsed. resources/app was not touched.`);
  console.log(`  staging kept for inspection: ${staging}`);
  console.log("  to apply for real: node infra/scripts/patch-client.mjs --apply");
  process.exit(0);
}

/**
 * Install order matters, and the first version got it wrong.
 *
 * It copied the patched tree into `resources/app` FIRST and renamed `app.asar` aside second. A
 * clean rebuild hit `EBUSY` on that rename — Windows had not finished releasing the archive the
 * app had mmap'd, seconds after the processes were killed — and the install was left holding BOTH
 * `resources/app` (patched) and `app.asar` (vendor). The asar wins the load order, so the app
 * booted vendor with a patch sitting inertly beside it: working, wrong, and silent. Exactly the
 * failure this script exists to prevent.
 *
 * Now the risky step goes first, against a staged copy so nothing is destroyed if it fails:
 *
 *   1. copy the patched tree to `resources/app.new`   (install untouched)
 *   2. rename `app.asar` aside, retrying the lock     (fails ⇒ only app.new is left over)
 *   3. swap `app.new` into place                      (fails ⇒ put the asar back)
 *
 * Step 2 failing now leaves a bootable vendor install, not a half-patched one.
 */
const APP_NEW = `${APP_UNPACKED}.new`;
if (existsSync(APP_NEW)) rmSync(APP_NEW, { recursive: true, force: true });
cpSync(staging, APP_NEW, { recursive: true });
ok("staged patched tree at resources/app.new");

if (existsSync(ASAR)) {
  // The lock is released asynchronously after the process dies, so a single attempt races it.
  let moved = false;
  for (let i = 0; i < 10 && !moved; i += 1) {
    try { renameSync(ASAR, ASAR_ASIDE); moved = true; }
    catch (e) {
      if (i === 9) {
        rmSync(APP_NEW, { recursive: true, force: true });
        console.error(`
cannot move app.asar aside: ${(e).code ?? e}`);
        console.error("Close Grok Bot and run --apply again. Nothing was changed.");
        process.exit(4);
      }
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},700)"]);   // ~0.7s, no async needed here
    }
  }
  ok("moved app.asar aside (it would win the load order)");
}

try {
  if (existsSync(APP_UNPACKED)) rmSync(APP_UNPACKED, { recursive: true, force: true });
  renameSync(APP_NEW, APP_UNPACKED);
  ok("installed resources/app");
} catch (e) {
  // Put the vendor bundle back rather than leaving an install that cannot boot at all.
  if (!existsSync(ASAR) && existsSync(ASAR_ASIDE)) renameSync(ASAR_ASIDE, ASAR);
  console.error(`
failed to swap resources/app into place: ${e}`);
  console.error("Rolled back to the vendor bundle. Close Grok Bot and run --apply again.");
  process.exit(4);
}

writeFileSync(STATE_FILE, `${JSON.stringify({
  appliedAt: new Date().toISOString(),
  clientVersion: clientVersion(APP_UNPACKED),
  vendorAsarSha256: sha(existsSync(ASAR_ASIDE) ? ASAR_ASIDE : vendorAsar),
  patches: PATCHES.map((p) => ({ id: p.id, file: p.file, expected: p.expected })),
  note: "Written by infra/scripts/patch-client.mjs --apply. Personal install only — never redistribute a patched client (docs/legal.md).",
}, null, 2)}\n`);
ok(`recorded ${STATE_FILE.replace(REPO, ".")}`);

rmSync(work, { recursive: true, force: true });
console.log("\napplied. Verify with: node infra/scripts/patch-client.mjs --verify");
