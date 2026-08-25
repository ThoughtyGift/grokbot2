/**
 * Đóng gói bộ cài mà trang tải phát ra — mảnh 2 của docs/plan/ship-to-users.md.
 *
 *   node services/grokbot-backend/scripts/build-setup.mjs
 *   → .data/dist/Cai-dat-Bot-Noi-Bo-win-<ngày>.cmd
 *   → .data/dist/Cai-dat-Bot-Noi-Bo-mac-<ngày>.command
 *
 * **Một file, không phải một thư mục.** Bản đầu phát ra zip 6 mục (`patches/`, `scripts/`, ba file
 * lạ) — giải nén xong trông không giống bộ cài nào cả. Giờ bộ vá được esbuild gộp thành một file
 * rồi nhúng thẳng vào script cài dưới dạng base64: tải một file, bấm, xong.
 *
 * Gói vẫn KHÔNG chứa app. Người dùng tự cài client từ nhà phát hành của nó — đúng ranh giới
 * docs/legal.md đặt ra. Việc của gói là ba thứ tay chân: vá, tạo lối mở mang bốn biến, ghi địa chỉ
 * backend.
 *
 * Vì sao chưa phải `.exe`: `iexpress` — thứ duy nhất có sẵn trên Windows — không gói được thư mục
 * con, và **treo khi chạy không giao diện** (đã thử, hết 3 phút không ra file). Một `.exe` thật có
 * icon riêng cần Inno Setup hoặc NSIS: `winget install JRSoftware.InnoSetup`, rồi thay chỗ này.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { b64, winInstaller, winStart, macInstaller, macStart } from "./setup-templates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");
const DIST = join(svcRoot, ".data", "dist");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

/**
 * esbuild nằm trong store của pnpm, không có trên PATH. Dò theo tên gói thay vì ghi cứng số phiên
 * bản — nâng phiên bản mà quên sửa chỗ này thì bản dựng gãy vào một ngày ngẫu nhiên.
 */
function esbuildBin() {
  const store = join(repoRoot, "node_modules", ".pnpm");
  const all = readdirSync(store).filter((n) => n.startsWith("@esbuild+"));
  for (const d of all.sort().reverse()) {
    const platform = d.slice("@esbuild+".length).split("@")[0];   // vd "win32-x64"
    const base = join(store, d, "node_modules", "@esbuild", platform);
    for (const exe of ["esbuild.exe", join("bin", "esbuild")]) {
      if (existsSync(join(base, exe))) return join(base, exe);
    }
  }
  return null;
}

/**
 * Bộ vá gồm 6 file `.mjs` nối nhau bằng `import`. Nhúng cả 6 thì script cài phải dựng lại cây thư
 * mục lúc chạy; gộp thành một file thì chỉ còn đúng một khối base64 để bung ra.
 */
function bundlePatchClient() {
  const bin = esbuildBin();
  if (!bin) {
    console.error("Không thấy esbuild trong node_modules/.pnpm — chạy `pnpm install` trước.");
    process.exit(1);
  }
  const out = join(tmpdir(), `grokbot2-patch-bundle-${process.pid}.mjs`);
  execFileSync(bin, [
    join(repoRoot, "infra", "scripts", "patch-client.mjs"),
    "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`,
  ], { stdio: "pipe" });
  const src = readFileSync(out, "utf8");
  rmSync(out, { force: true });
  return src;
}

// ── dựng ─────────────────────────────────────────────────────────────────────
mkdirSync(DIST, { recursive: true });

const patchB64 = b64(bundlePatchClient());
const built = [
  { name: `Cai-dat-Bot-Noi-Bo-win-${stamp}.cmd`, body: winInstaller({ patchB64, startB64: b64(winStart) }) },
  { name: `Cai-dat-Bot-Noi-Bo-mac-${stamp}.command`, body: macInstaller({ patchB64, startB64: b64(macStart) }) },
];

// Gói cũ ở lại thì trang tải sẽ phát bản cũ hơn — dọn trước khi ghi bản mới.
for (const old of readdirSync(DIST)) {
  if (/^(bot-noi-bo-setup|Cai-dat-Bot-Noi-Bo)/.test(old)) rmSync(join(DIST, old), { recursive: true, force: true });
}
rmSync(join(DIST, "staging-win"), { recursive: true, force: true });
rmSync(join(DIST, "staging-mac"), { recursive: true, force: true });

for (const { name, body } of built) {
  const path = join(DIST, name);
  // cmd cần CRLF; bash thì không được dính CR nào.
  writeFileSync(path, name.endsWith(".cmd") ? body.replace(/\r?\n/g, "\r\n") : body.replace(/\r/g, ""), "utf8");
  console.log(`✓ ${path}  (${(statSync(path).size / 1024).toFixed(1)} KB)`);
}
console.log("  Thử: curl -sI http://localhost:8788/download/windows · /download/mac");
console.log("  Chạy thử an toàn: GROKBOT2_SETUP_DRYRUN=1 → bung ra rồi dừng, không vá, không mở app.");
