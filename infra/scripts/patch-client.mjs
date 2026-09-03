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
import { clientPaths } from "../patches/client-paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const STATE_FILE = join(REPO, "docs", "state", "client-patch-state.json");

// Đường dẫn theo hệ điều hành sống ở ../patches/client-paths.mjs — tách ra để kiểm thử được,
// vì trên Windows không có cách nào chạy thử nhánh macOS ngoài việc giả lập.
const PATHS = clientPaths();
const APP_DIR = PATHS.appDir;
const RES = PATHS.res;
const ASAR = PATHS.asar;
const ASAR_ASIDE = PATHS.asarAside;
const APP_UNPACKED = PATHS.appUnpacked;

if (!PATHS.supported) {
  console.error(`chưa biết client nằm đâu trên ${PATHS.platform}.`);
  console.error("Đặt GROKBOT2_CLIENT_DIR trỏ vào thư mục cài đặt rồi chạy lại.");
  process.exit(2);
}

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

/**
 * Phiên bản GỐC của client (của hãng), không phải phiên bản đã đóng dấu của ta.
 *
 * `--apply` đóng dấu bản phát hành của mình vào `version` (xem `NEN_TANG` bên dưới), nên đọc thẳng
 * `version` sẽ thấy `0.29.20260903` và mọi chốt so-với-bản-ghi sẽ báo "client đã tự cập nhật" sai.
 * `gb2Base` giữ số gốc để những chốt ấy vẫn so đúng thứ chúng định so.
 */
const clientVersion = (root) => {
  try {
    const p = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return p.gb2Base ?? p.version;
  } catch { return null; }
};

/**
 * Số phiên bản mà app sẽ KHAI khi hỏi kênh cập nhật: `<major>.<minor>.<YYYYMMDD>`.
 *
 * Vì sao phải đóng dấu — đo 03/09, và nó suýt lọt: bộ cài của ta **vá lên một client sẵn có**, nó
 * không đổi `version` của client. Nên client mãi mãi khai `0.29.0`, còn manifest thì ghi số của bản
 * phát hành. Kết quả: mọi máy thấy banner, bấm Install, cài xong khai lại `0.29.0`, **thấy banner
 * tiếp** — một vòng lặp làm phiền vĩnh viễn mà không có lỗi nào nổi lên.
 *
 * Giữ `major.minor` của hãng (biết mình đang trên nền 0.29) và thay `patch` bằng ngày phát hành:
 * tăng đơn điệu, không ai phải nhớ bump số, và nhìn là biết bản ấy ra ngày nào.
 */
const NEN_TANG = (base, stamp) => {
  const [maj = "0", min = "0"] = String(base ?? "0.0.0").split(".");
  return `${maj}.${min}.${stamp}`;
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
  /*
   * Ba trạng thái, không phải hai — và bản trước gộp hai cái cuối thành "lỗi".
   *
   *   asar đã dời sang bên      → đúng ý: `resources/app` thắng thứ tự nạp
   *   KHÔNG có asar nào cả      → **bản tự chứa** (bộ cài "chở cả app" dựng thẳng `resources/app`).
   *                               Không có gì để dời, và cũng không có gì tranh thứ tự nạp.
   *   asar còn nằm cạnh app đã vá → NGUY: app boot bản gốc, im lặng
   *
   * `C:\cai` là ca thứ hai, và bản trước bắt nó đỏ — khiến `run.ps1` từ chối chạy chính bản app
   * đang dùng được.
   */
  if (existsSync(ASAR_ASIDE)) ok("vendor app.asar moved aside");
  else if (!existsSync(join(RES, "app.asar"))) ok("không có app.asar nào — bản tự chứa, không ai tranh thứ tự nạp");
  else fail("app.asar CÒN nằm cạnh resources/app — app sẽ boot bản gốc, im lặng");
  existsSync(ASAR) && fail("app.asar is back in place — it WINS the load order, patches are dead");

  // package.json must stay verbatim: `name` decides userData, so changing it moves the app's
  // entire state directory and the roster appears to vanish.
  try {
    const pkg = JSON.parse(readFileSync(join(APP_UNPACKED, "package.json"), "utf8"));
    pkg.name === "sand" ? ok('package.json name is "sand" (userData intact)') : fail(`package.json name is "${pkg.name}", must be "sand" — userData would move`);
    /*
     * `sandLab` phải còn đó, và đây là chốt duy nhất nhìn thấy nếu nó mất.
     *
     * Không như sáu bản vá kia, khoá này không để lại marker trong một file JS nào, nên vòng kiểm
     * `PATCHES` bên dưới hoàn toàn không biết nó tồn tại. Mất khoá thì `--verify` vẫn xanh trong khi
     * app đã có lại quyền tự cập nhật — đúng loại lỗ im lặng mà thư mục này sinh ra để chặn.
     */
    /*
     * Từ 03/09 chốt NGƯỢC lại: `sandLab` phải VẮNG.
     *
     * Bảo vệ nay nằm ở bản vá `update-feed` (kênh cập nhật trỏ backend của mình), còn `sandLab` thì
     * khoá updater ở nhánh trước nhánh feed nên nó chặn luôn banner của CHÍNH ta. Hai chốt đi cùng
     * nhau: thiếu vá feed là đỏ ở vòng `PATCHES` bên dưới, `sandLab` sót lại là đỏ ở đây. Mất một
     * trong hai là mất cả lớp bảo vệ lẫn tính năng.
     */
    /*
     * …nhưng CHỈ khi bản vá feed thật sự áp được. Trên client không có biến thể `update-feed` (0.20),
     * `sandLab` được GIỮ LẠI có chủ ý — và một `--verify` đỏ ở đó sẽ tố cáo đúng cái quyết định an
     * toàn mà `--apply` vừa đưa ra. Hai bên phải đọc CÙNG một dữ kiện, nếu không chúng sẽ mâu thuẫn
     * nhau trên đúng những máy cũ nhất.
     */
    const feedApDuoc = (() => {
      try {
        return readFileSync(join(APP_UNPACKED, "dist/electron-main/main.cjs"), "utf8")
          .includes("/*grokbot2:update-feed*/");
      } catch { return false; }
    })();
    if (!feedApDuoc) {
      pkg.sandLab === true
        ? ok("sandLab: con day (dung) — client nay khong va duoc update-feed, nen updater phai khoa")
        : fail('client khong co ban va update-feed MA "sandLab" cung mat — app co the tu cai ban cua hang');
    } else {
      pkg.sandLab === undefined
        ? ok("sandLab: vang mat (dung) — updater dung kenh cua minh")
        : fail('package.json con "sandLab" — updater bi khoa, banner cua MINH khong bao gio hien; chay lai --apply');
    }
  } catch { fail("cannot read resources/app/package.json"); }

  for (const p of PATCHES) {
    let seen = false;
    for (const file of targetsOf(p)) {
      const target = join(APP_UNPACKED, file);
      if (!existsSync(target)) continue;
      const src = readFileSync(target, "utf8");
      // Đếm theo TẬP marker, không cộng dồn từng biến thể: hai biến thể của cùng một bản vá dùng
      // chung một chuỗi marker, nên cộng dồn báo "2x" cho một lần vá và con số đó nói sai.
      const markers = [...new Set((p.variants ?? [p]).map((v) => v.marker).filter(Boolean))];
      const marks = markers.reduce((n, m) => n + (src.split(m).length - 1), 0);
      const stale = pickVariant(p, src);
      if (marks > 0 && !stale) ok(`${p.id}: applied (${marks}x marker, 0 unpatched) trong ${file}`);
      else if (stale) fail(`${p.id}: con ${stale.expected} cho CHUA va trong ${file} — chay lai --apply`);
      else continue;
      seen = true;
      const chk = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
      chk.status === 0 ? ok(`${p.id}: ${file} parses`) : fail(`${p.id}: ${file} is not valid JS — ${(chk.stderr || "").split(String.fromCharCode(10))[0]}`);
      break;
    }
    if (!seen) {
      if (p.obsoleteWhenMissing) ok(`${p.id}: khong con trong bundle nay — da thua (${p.obsoleteWhenMissing})`);
      else fail(`${p.id}: khong tim thay dau vet nao trong bundle`);
    }
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
//
// Trước đây chốt này chỉ chạy trên win32 — nghĩa là trên máy Mac nó KHÔNG tồn tại, chứ không phải
// không cần. Giờ mỗi hệ có lệnh kiểm riêng; hệ nào chưa có thì nói thẳng là không kiểm được.
if (!DRY) {
  const probe = PATHS.running;
  if (!probe) {
    console.log(`  note không kiểm được client có đang chạy không trên ${PATHS.platform} — tự đóng app trước.`);
  } else {
    const ps = spawnSync(probe.cmd, probe.args, { encoding: "utf8" });
    if (probe.match.test(ps.stdout ?? "")) {
      console.error("Grok Bot is running — close it first. It holds app.asar open, and a half-finished");
      console.error("apply leaves the vendor asar beside a patched resources/app, which boots vendor silently.");
      process.exit(4);
    }
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

/**
 * Chọn biến thể khớp với bundle đang cầm.
 *
 * Một bản vá bám vào **chuỗi mã đã minify**, và tên rút gọn đổi sau mỗi lần hãng dựng lại. Đo ngày
 * 28/08: không một dấu hiệu nào của 0.20 còn sống trong 0.29 — nhưng **lỗi thì còn**, chỉ là hàm
 * đổi tên (`cOt` → `vht`, và bản dựng mới tự khai `s(vht,"normalizeAttachmentSource")`).
 *
 * Nên mỗi bản vá khai một danh sách `variants`, mỗi biến thể là một phiên bản client. Nhân đôi cả
 * file bản vá cho từng phiên bản là hai chỗ để sửa và hai chỗ để quên; ở đây chỉ có một.
 *
 * Không khớp biến thể nào ⇒ trả `null`, và người gọi phải **dừng đỏ kèm id**, không được vá mò.
 */
function pickVariant(p, src) {
  const list = p.variants ?? [{ ...p, version: p.version ?? "0.20.0" }];
  for (const v of list) {
    const find = v.find ?? p.find;
    const expected = v.expected ?? p.expected;
    if (src.split(find).length - 1 === expected) {
      return { find, expected, replace: v.replace ?? p.replace, marker: v.marker ?? p.marker, version: v.version ?? "?" };
    }
  }
  return null;
}

/** Tên file trong bundle — biến thể được phép trỏ chỗ khác (renderer đổi tên theo băm nội dung). */
function targetsOf(p) {
  const list = p.variants ?? [p];
  return [...new Set(list.map((v) => v.file ?? p.file))];
}

// Patch in staging, and assert the occurrence count BEFORE writing anything. A bundle that no
// longer matches must stop the run with the patch id — never get patched approximately.
for (const p of PATCHES) {
  let done = false;
  for (const file of targetsOf(p)) {
    const target = join(staging, file);
    if (!existsSync(target)) continue;
    const src = readFileSync(target, "utf8");
    const v = pickVariant(p, src);
    if (!v) continue;
    writeFileSync(target, src.split(v.find).join(v.replace));
    const chk = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    if (chk.status !== 0) { console.error(`FAIL ${p.id}: patched ${file} is not valid JS
${chk.stderr}`); process.exit(1); }
    ok(`${p.id}: ${v.expected}x replaced in ${file} (bien the ${v.version})`);
    done = true;
    break;
  }
  if (!done) {
    if (p.obsoleteWhenMissing) { ok(`${p.id}: khong con trong bundle nay — da thua (${p.obsoleteWhenMissing})`); continue; }
    console.error(`FAIL ${p.id}: khong bien the nao khop bundle nay`);
    console.error(`  ${p.summary}`);
    console.error("  The vendor bundle changed. Re-locate the function and add a variant — do not patch blind.");
    process.exit(1);
  }
}

/*
 * `sandLab: true` — chặn tự cập nhật KHÔNG phụ thuộc biến môi trường.
 *
 * Vì sao đây là một bước riêng chứ không phải bản vá thứ bảy trong `PATCHES`: vòng trên chạy
 * `node --check` lên mọi file nó vừa ghi, và `package.json` không phải JS — nó sẽ đỏ ở chính chỗ
 * kiểm an toàn. Và dòng ngay dưới trong `--verify` đã ghi luật "package.json must stay verbatim"
 * vì `name` quyết định thư mục userData; sửa file này bằng find/replace mù là cách làm sai hình
 * dạng. Đọc JSON, đặt đúng một khoá, ghi lại — không đụng khoá nào khác.
 *
 * Cổng thật, trích 02/09 từ `electron-main` 0.30:
 *
 *     aye = yWe.sandLab === true                    // yWe = package.json của chính gói
 *     computeUpdateDisabledReason: n.isLabBuild ? "lab-build" : …   ← KHÔNG đọc process.env
 *
 * Cách cũ (`SAND_DISABLE_UPDATES=1`) chỉ giữ khi app mở qua shortcut của launcher; bấm đúp thẳng
 * vào `.exe` là app tự cập nhật và xoá sạch `resources/app`. Và không đặt toàn cục được vì
 * `CURSOR_API_BASE_URL` bị Cursor IDE thật đọc chung. Khoá này đóng lỗ đó ở MỌI đường mở.
 *
 * Tác dụng phụ đã kê đủ 20 chỗ dùng `isLabBuild` (0 chỗ trong renderer) —
 * xem `docs/reverse/spike-findings.md`. Đáng nhớ nhất: nó cũng tắt bước DỜI GỐC DỮ LIỆU
 * (`route:"unchanged", reason:"lab"`), nên app giữ nguyên gốc đang dùng thay vì tự dời.
 */
{
  const pkgPath = join(staging, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  /*
   * `sandLab` PHẢI vắng mặt — và điều kiện là bản vá `update-feed` đã áp.
   *
   * Cổng cập nhật của client xét theo thứ tự:
   *   envDisabled → isLabBuild → hasDevFeedOverride → …
   * nên `sandLab: true` (isLabBuild) khoá updater ở nhánh TRƯỚC nhánh feed. Còn nó thì banner
   * "New update available" của CHÍNH TA không bao giờ hiện, dù feed chạy đúng đến đâu.
   *
   * Gỡ nó chỉ AN TOÀN sau khi hằng feed đã trỏ backend của mình: lúc ấy updater sống lại nhưng
   * không còn đường nào tới máy chủ hãng. Gỡ khi feed CHƯA vá là mở lại đúng cái bẫy `sandLab` sinh
   * ra để đóng — nên kiểm bằng DẤU VẾT THẬT trên đĩa, không tin vào thứ tự chạy của vòng lặp trên.
   */
  const feedDaVa = readFileSync(join(staging, "dist/electron-main/main.cjs"), "utf8")
    .includes("/*grokbot2:update-feed*/");
  let doiPkg = false;
  if (!feedDaVa) {
    /*
     * Chưa vá được feed ⇒ GIỮ `sandLab`, và **đi tiếp**.
     *
     * Bản đầu của cửa này `process.exit(1)`. Sai, và sai nặng: câu thông báo tự nói "KHONG go
     * sandLab" trong khi hành động lại là *bỏ cả lần cài*. Trên client **0.20** — bản mà
     * `update-feed.mjs` không có biến thể nào — dấu vá không bao giờ xuất hiện, nên bộ cài tải từ
     * website dừng ở bước 3 với "Va client that bai" và người dùng mất luôn cả những bản vá CHẠY
     * ĐƯỢC trên 0.20 (`win-drive-path`, `get-ultra-redirect`). Đo 03/09, ngay sau khi tôi vừa
     * khuyên người dùng "tải lại bộ cài rồi chạy".
     *
     * Gỡ `sandLab` chỉ là mở đường cho BANNER — một tính năng thêm. Giữ nó lại là mất banner, không
     * mất gì khác. Một điều kiện của tính năng thêm không được phép đánh sập cả lần cài.
     */
    ok("update-feed chua ap (client nay khong co bien the) — GIU sandLab, updater van khoa");
    console.log("       Hau qua: khong co banner 'New update available'. Cai dat van hoan tat.");
    console.log("       Muon co banner thi phai len client 0.29+ roi chay lai bo cai.");
  } else if (pkg.sandLab !== undefined) {
    delete pkg.sandLab; doiPkg = true;
    ok("sandLab: da go — updater song lai, va no chi hoi backend cua minh");
  } else {
    ok("sandLab: khong co san trong bundle nay (dung)");
  }

  /*
   * Đóng dấu bản phát hành vào `version` — xem `NEN_TANG` ở đầu file cho lý do đầy đủ.
   *
   * `GROKBOT2_RELEASE_STAMP` do bộ cài truyền vào (nó biết ngày dựng của chính nó). Không có thì
   * lấy ngày hôm nay: một lần vá thủ công trên máy dev vẫn cần một số để khai, và ngày hôm nay là
   * số đúng nhất có thể biết ở đây.
   */
  const stamp = (process.env.GROKBOT2_RELEASE_STAMP ?? new Date().toISOString().slice(0, 10).replace(/-/g, "")).trim();
  if (!/^\d{8}$/.test(stamp)) { console.error(`FAIL GROKBOT2_RELEASE_STAMP phai la YYYYMMDD, nhan duoc: ${stamp}`); process.exit(1); }
  // `gb2Base` ghi MỘT LẦN: lần vá thứ hai không được lấy số đã đóng dấu làm nền.
  if (pkg.gb2Base === undefined) { pkg.gb2Base = pkg.version; doiPkg = true; }
  const moi = NEN_TANG(pkg.gb2Base, stamp);
  if (pkg.version !== moi) { pkg.version = moi; doiPkg = true; }
  ok(`version: ${pkg.gb2Base} → ${moi} (nen ${pkg.gb2Base}, ban phat hanh ${stamp})`);

  if (doiPkg) writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
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
