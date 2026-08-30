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
 * Có Inno Setup thì dựng thêm một `.exe` thật (icon riêng, gỡ được từ Apps & features) —
 * `winget install JRSoftware.InnoSetup`. Không có thì bỏ qua, bản `.cmd` vẫn chạy: một công cụ tuỳ
 * chọn không được phép chặn bản dựng.
 *
 * `iexpress` — thứ duy nhất có sẵn sẵn trên Windows — đã thử và bỏ: không gói được thư mục con, và
 * treo 3 phút không ra file khi chạy không giao diện.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { b64, winInstaller, winStart, macInstaller, macStart } from "./setup-templates.mjs";
import { buildExe, buildFullExe, buildZip, isccPath } from "./setup-exe.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");
const DIST = join(svcRoot, ".data", "dist");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

/**
 * Địa chỉ backend điền sẵn trong bộ cài.
 *
 * `GROKBOT2_PUBLIC_BACKEND` là thứ máy chủ công khai đã biết về chính nó (nginx đứng trước, xem
 * `GROKBOT2_PUBLIC_PATH`). Dựng gói trên VPS mà không khai biến này thì gói phát ra cho cả thiên
 * hạ mang mặc định `localhost:8788` — đo được ngày 27/08: máy thứ ba tải về, bấm Enter cho qua,
 * và app trỏ vào chính nó. Trên máy cá nhân không khai gì thì mặc định cũ vẫn đúng.
 */
const beMacDinh = (() => {
  /*
   * MỘT tên biến cho cả hai loại gói. `setup-exe.mjs` đã dùng `GROKBOT2_PUBLIC_BACKEND` từ trước
   * cho bản `.exe`; đặt thêm một tên nữa cho bản `.cmd` là tạo ra hai chỗ để quên, và người quên
   * chỉ biết khi một máy nào đó ngoài kia trỏ vào chính nó. Ưu tiên tên cũ, chấp nhận tên mới.
   */
  const raw = (process.env.GROKBOT2_PUBLIC_BACKEND ?? process.env.GROKBOT2_PUBLIC_URL
    ?? "http://localhost:8788").trim() || "http://localhost:8788";
  /*
   * **Giữ gạch chéo cuối.** Client nối đường dẫn TƯƠNG ĐỐI vào địa chỉ này, và
   * `new URL("aiserver.v1.X/Y", "https://cinai.app/agent")` cho ra
   * `https://cinai.app/aiserver.v1.X/Y` — rơi khỏi nhánh `/agent`. Thêm một gạch chéo thì nó ở
   * lại đúng chỗ. Hiện nginx bắt hộ cả hai dạng (đo 27/08: cùng trả 200), nhưng sống nhờ luật
   * bắt-tất của nginx là một chỗ sẽ gãy im lặng vào ngày ai đó dọn cấu hình.
   */
  return raw.replace(/\/+$/, "") + "/";
})();

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

const patchSource = bundlePatchClient();
const patchB64 = b64(patchSource);
const built = [
  { name: `Cai-dat-Bot-Noi-Bo-win-${stamp}.cmd`, body: winInstaller({ patchB64, startB64: b64(winStart), beMacDinh }) },
  { name: `Cai-dat-Bot-Noi-Bo-mac-${stamp}.command`, body: macInstaller({ patchB64, startB64: b64(macStart), beMacDinh }) },
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
const exe = buildExe({
  distDir: DIST,
  stagingDir: join(DIST, "staging-exe"),
  patchSrc: patchSource,
  startSrc: winStart,
  version: stamp.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3"),
  outName: `Cai-dat-Bot-Noi-Bo-${stamp}`,
});
if (exe) {
  console.log(`✓ ${exe}  (${(statSync(exe).size / 1024).toFixed(1)} KB)  ← trang tải phát cái này`);
  rmSync(join(DIST, "staging-exe"), { recursive: true, force: true });
} else {
  console.log(`  (chưa có Inno Setup nên không dựng .exe — trang tải phát bản .cmd. ISCC: ${isccPath() ?? "không thấy"})`);
}
/*
 * `--with-app` — bản CHỞ CẢ ỨNG DỤNG (~490 MB nén xuống còn khoảng một nửa).
 *
 * Không dựng theo mặc định vì nó mất vài phút và ra một file rất to. Dựng khi cần thử trên máy khác:
 * bản này KHÔNG đòi client cài trước, cũng KHÔNG đòi Node — đúng hình dạng bộ cài của hãng.
 */
if (process.argv.includes("--with-app")) {
  const appSrc = process.env.GROKBOT2_CLIENT_DIR
    ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Grok Bot");
  console.log(`  đang nén cây app từ ${appSrc} — mất vài phút…`);
  const full = buildFullExe({
    distDir: DIST,
    stagingDir: join(DIST, "staging-full"),
    appSrc,
    version: stamp.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3"),
    outName: `Bot-Noi-Bo-Setup-${stamp}`,
  });
  if (full) {
    console.log(`✓ ${full}  (${(statSync(full).size / 1048576).toFixed(0)} MB)  ← chở cả app`);
    rmSync(join(DIST, "staging-full"), { recursive: true, force: true });
    console.log("  Gói này chứa client của nhà phát hành: dùng cho máy của chính bạn, đừng phát ra ngoài.");
  } else {
    console.log("  không dựng được bản chở app (thiếu Inno Setup hoặc thiếu cây app).");
  }
}

/*
 * `--zip` — bản giải nén, không cần bộ cài.
 *
 * Lý do thực tế: bộ cài `.exe` chưa ký số nên SmartScreen chặn "Windows protected your PC" trên máy
 * lạ (đo được 26/08 trên máy thứ hai của chủ máy). Giải nén rồi chạy `.cmd` thì không qua cửa đó.
 */
if (process.argv.includes("--zip")) {
  const appSrc = process.env.GROKBOT2_CLIENT_DIR
    ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Grok Bot");
  console.log(`  đang nén ZIP từ ${appSrc} — vài phút…`);
  const zip = buildZip({
    distDir: DIST,
    stagingDir: join(DIST, "staging-zip"),
    appSrc,
    outName: `Bot-Noi-Bo-${stamp}`,
  });
  if (zip) console.log(`✓ ${zip}  (${(statSync(zip).size / 1048576).toFixed(0)} MB)  ← giải nén là chạy`);
  else console.log("  không dựng được ZIP.");
}

console.log("  Thử: curl -sI http://localhost:8788/download/windows · /download/mac");
console.log("  Chạy thử an toàn: GROKBOT2_SETUP_DRYRUN=1 → bung ra rồi dừng, không vá, không mở app.");
