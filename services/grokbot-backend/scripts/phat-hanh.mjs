/**
 * Phát hành một bản cho app local — CÔNG TẮC duy nhất làm banner "New update available" hiện ra.
 *
 *   node services/grokbot-backend/scripts/phat-hanh.mjs --kenh dogfood
 *   node services/grokbot-backend/scripts/phat-hanh.mjs --kenh stable
 *   node services/grokbot-backend/scripts/phat-hanh.mjs --kenh stable --bo-qua-test   # xem README
 *
 * ── Vì sao lệnh này tồn tại ────────────────────────────────────────────────────────────────────
 *
 * Trước nó, "nghiệm thu xong mới phát hành" là một lời hứa: ai đó nhớ chạy test, nhớ dựng gói, nhớ
 * ghi manifest đúng số. Sớm muộn cũng có lần quên — và khác website, người dùng đã cài rồi thì
 * không "F5 về bản cũ" được; họ phải chờ ta phát hành bản sửa.
 *
 * Ở đây nó là cơ chế: **test đỏ thì từ chối ghi manifest**. Không có cờ nào bỏ qua bước đó ngoài
 * `--bo-qua-test`, và cờ ấy in ra một dòng cảnh báo có tên người chịu trách nhiệm là chính người gõ.
 *
 * ── Thứ tự có lý do ────────────────────────────────────────────────────────────────────────────
 *
 *   test  →  dựng gói  →  băm  →  GHI MANIFEST
 *
 * Ghi manifest là bước CUỐI vì nó là bước duy nhất người dùng nhìn thấy. Mọi bước trước hỏng thì
 * lệnh dừng và không ai biết có chuyện gì xảy ra — đúng như mong muốn.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const argOf = (ten, mac) => { const i = argv.indexOf(ten); return i >= 0 && argv[i + 1] ? argv[i + 1] : mac; };
const KENH = argOf("--kenh", "dogfood");
const BO_QUA_TEST = argv.includes("--bo-qua-test");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const DIST = join(HERE, "..", ".data", "dist");
const MANIFEST = process.env.GROKBOT2_RELEASE_MANIFEST ?? join(HERE, "..", ".data", "phat-hanh.json");

const KENH_HOP_LE = ["stable", "nightly", "dogfood"];
if (!KENH_HOP_LE.includes(KENH)) {
  console.error(`kênh không hợp lệ: "${KENH}". Chọn một trong: ${KENH_HOP_LE.join(", ")}`);
  process.exit(2);
}

const buoc = (n, m) => console.log(`\n[${n}/5] ${m}`);
const chay = (cmd, args) => execFileSync(cmd, args, { cwd: REPO, stdio: "inherit", shell: process.platform === "win32" });

// ── 1 · nghiệm thu ─────────────────────────────────────────────────────────────────────────────
buoc(1, "nghiệm thu: typecheck + toàn bộ test");
if (BO_QUA_TEST) {
  console.log("  ⚠ BỎ QUA TEST theo yêu cầu (--bo-qua-test).");
  console.log("  ⚠ Bản phát hành này chưa được máy nào kiểm. Nếu nó hỏng trên máy người dùng thì");
  console.log("  ⚠ không có gì để đổ lỗi ngoài dòng lệnh vừa gõ.");
} else {
  try {
    chay("pnpm", ["typecheck"]);
    chay("npx", ["tsx", "--test", "services/grokbot-backend/src/*.test.ts"]);
    chay("npx", ["tsx", "--test", "packages/grokbot-proto/src/*.test.ts"]);
  } catch {
    console.error("\n✘ NGHIỆM THU ĐỎ — không ghi manifest, không ai thấy gì.");
    console.error("  Đây là chỗ quy trình làm đúng việc của nó: sửa cho xanh rồi chạy lại.");
    process.exit(1);
  }
  console.log("  ✓ xanh");
}

// ── 2 · dựng gói ───────────────────────────────────────────────────────────────────────────────
buoc(2, "dựng bộ cài");
chay("node", ["services/grokbot-backend/scripts/build-setup.mjs"]);

/**
 * Gói vừa dựng, chọn ĐÚNG như trang tải chọn: mới nhất thắng, loại chỉ phá hoà.
 *
 * Không tự đoán tên file: trang tải và manifest phải chỉ vào CÙNG một gói, nếu không người bấm
 * Install tải một bản khác bản mà trang web phát.
 */
const { newestSetup } = await import(join(REPO, "services/grokbot-backend/src/site.ts").replace(/\\/g, "/"))
  .catch(async () => await import("../src/site.js"));
const goi = newestSetup(DIST, "windows");
if (!goi) { console.error("✘ không thấy gói nào trong .data/dist — build-setup chạy hỏng?"); process.exit(1); }
console.log(`  ✓ ${goi.name} (${(goi.size / 1024 / 1024).toFixed(1)} MB)`);

// ── 3 · băm ────────────────────────────────────────────────────────────────────────────────────
buoc(3, "tính sha256");
const sha256hash = createHash("sha256").update(readFileSync(goi.path)).digest("hex");
console.log(`  ✓ ${sha256hash}`);

/**
 * Số phiên bản lấy từ TÊN GÓI, không tự bịa.
 *
 * `build-setup` đặt tên theo ngày (`...-20260903.exe`), và client so phiên bản bằng số nên phải
 * chuyển sang dạng `x.y.z`. Dùng ngày làm phiên bản là có chủ ý: nó tăng đơn điệu, không cần ai nhớ
 * bump số, và nhìn vào là biết bản ấy ra ngày nào.
 */
const ngay = /(\d{8})/.exec(goi.name);
if (!ngay) { console.error(`✘ không đọc được ngày từ tên gói: ${goi.name}`); process.exit(1); }
const stamp = ngay[1];

/*
 * Số phiên bản phải TRÙNG KHÍT thứ client sẽ khai sau khi cài — `<major>.<minor>.<YYYYMMDD>`.
 *
 * Lỗi suýt lọt, đo 03/09: bản đầu tôi đặt version theo ngày (`2026.9.2`) trong khi client khai
 * `0.29.0`. So số thì `2026 > 0` là VĨNH VIỄN — mọi máy thấy banner, cài xong khai lại `0.29.0`,
 * thấy banner tiếp. Một vòng lặp làm phiền không có lỗi nào nổi lên.
 *
 * Nền `major.minor` đọc từ `client-patch-state.json` (bản client của hãng mà bộ vá đang bám), chứ
 * không ghim hằng số ở đây: lên 0.30 thì nền tự đổi theo, không phải nhớ sửa hai chỗ.
 */
const STATE = join(REPO, "docs", "state", "client-patch-state.json");
if (!existsSync(STATE)) {
  console.error(`✘ chưa có ${STATE} — chạy patch-client --apply một lần trước đã.`);
  console.error("  Không có nó thì không biết bộ vá đang bám nền client nào, và số phiên bản sẽ sai.");
  process.exit(1);
}
const nen = JSON.parse(readFileSync(STATE, "utf8")).clientVersion ?? "0.0.0";
const [maj, min] = String(nen).split(".");
const version = `${maj}.${min}.${stamp}`;
console.log(`  nền client: ${nen} → phiên bản phát hành: ${version}`);

// ── 4 · ghi manifest ───────────────────────────────────────────────────────────────────────────
buoc(4, `ghi manifest — kênh ${KENH}`);
const cu = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const base = (process.env.GROKBOT2_PUBLIC_URL ?? "http://localhost:8788").replace(/\/+$/, "");
// `ten` — de launcher luu file tai ve dung duoi roi moi chay. Xem chu thich trong update-feed.ts.
const moi = { ...cu, [KENH]: { version, url: `${base}/download/windows`, sha256hash, ten: goi.name } };
writeFileSync(MANIFEST, `${JSON.stringify(moi, null, 2)}\n`);

console.log(`  ✓ ${MANIFEST}`);

// ── 5 · lên VPS ────────────────────────────────────────────────────────────────────────────────
/*
 * Bước này SINH RA vì thiếu nó thì bốn bước trên không tới được ai.
 *
 * Đo 03/09: manifest và gói nằm trong `.data` của MÁY CHẠY LỆNH, còn `deploy.sh` thì cố ý không đụng
 * `shared/` — vùng giữ dữ liệu người dùng. Hai thứ đều đúng việc của chúng, và đường phát hành đứt ở
 * giữa: VPS chỉ có gói ngày 27/08, không có manifest nào, nên feed trả 204 "không có gì mới" cho mọi
 * máy, mãi mãi. Người dùng máy thứ tư không thấy banner, và không lỗi nào nổi lên ở đâu cả.
 *
 * Thứ tự trong bước này cũng có lý do: GÓI lên trước, MANIFEST lên sau. Manifest là thứ duy nhất
 * người dùng nhìn thấy — đưa nó lên trước gói thì có một khoảng thời gian banner đã hiện mà file tải
 * về vẫn là bản cũ, và sha256 sẽ không khớp.
 */
if (argv.includes("--len-vps")) {
  buoc(5, "đưa gói + manifest lên VPS");
  const SSH = process.env.GROKBOT2_VPS_SSH ?? "";
  if (!SSH) {
    console.error("✘ --len-vps cần GROKBOT2_VPS_SSH (ví dụ root@103.75.186.63).");
    console.error("  Manifest ĐÃ ghi ở máy này; chạy lại chỉ bước lên VPS bằng scp là đủ.");
    process.exit(1);
  }
  /*
   * Manifest mang địa chỉ `localhost` thì KHÔNG được lên máy chủ công khai.
   *
   * Đo 03/09, và là lỗi tôi tự gây ra trong chính lượt phát hành đầu tiên: manifest cục bộ còn khoá
   * `stable` từ một lần chạy thử trước, ghi khi `GROKBOT2_PUBLIC_URL` chưa đặt — nên nó mang
   * `http://localhost:8788/download/windows` và băm của một gói khác. `scp` chép cả file, nên cái
   * rác ấy lên thẳng production: mọi máy kênh stable sẽ thấy banner, bấm Install, rồi tải từ chính
   * máy mình và băm không khớp. Một tính năng vừa dựng xong đã sai theo kiểu tệ nhất — nó CHẠY.
   *
   * Chặn ở đây chứ không ở bước ghi: ghi manifest localhost là chuyện bình thường khi thử trên máy
   * cá nhân. Thứ không bình thường là ĐEM NÓ LÊN.
   */
  const raRac = Object.entries(JSON.parse(readFileSync(MANIFEST, "utf8")))
    .filter(([, v]) => /\/\/(localhost|127\.0\.0\.1)\b/.test(String(v?.url ?? "")));
  if (raRac.length) {
    console.error(`✘ manifest có ${raRac.length} kênh trỏ localhost: ${raRac.map(([k]) => k).join(", ")}`);
    console.error("  Đưa lên là người dùng thấy banner rồi tải từ chính máy họ. Sửa hoặc xoá khoá đó,");
    console.error("  hoặc phát hành lại kênh ấy với GROKBOT2_PUBLIC_URL đặt đúng.");
    process.exit(1);
  }

  const PORT = process.env.GROKBOT2_VPS_PORT ?? "24700";
  const DATA = process.env.GROKBOT2_VPS_DATA ?? "/opt/grokbot2/shared/data";
  /*
   * Đưa gói của CẢ HAI nền tảng, không chỉ nền tảng dùng cho manifest.
   *
   * Bản đầu chỉ `scp` đúng `goi` — tức gói Windows, vì manifest cần băm của nó. Đo E2E 03/09 bằng
   * chính trình duyệt trên trang tải: `/download/windows` trả gói hôm nay, còn `/download/mac` vẫn
   * trả `...mac-20260827.command` **thiếu bảy ngày**. Không lỗi nào nổi lên, vì trang tải luôn có
   * MỘT gói mac để phát — chỉ là gói cũ. Một đường mà lúc nào cũng "có gì đó" thì không bao giờ
   * kêu; nó chỉ lặng lẽ phát bản sai.
   */
  for (const hang of ["windows", "mac"]) {
    const g = newestSetup(DIST, hang);
    if (!g) { console.log(`  (không có gói ${hang} — bỏ qua)`); continue; }
    chay("scp", ["-P", PORT, "-o", "BatchMode=yes", g.path, `${SSH}:${DATA}/dist/`]);
    console.log(`  ✓ gói ${hang} → ${DATA}/dist/${g.name}`);
  }
  chay("scp", ["-P", PORT, "-o", "BatchMode=yes", MANIFEST, `${SSH}:${DATA}/phat-hanh.json`]);
  console.log(`  ✓ manifest → ${DATA}/phat-hanh.json`);
} else {
  console.log("\n  (chưa lên VPS — thêm --len-vps, hoặc người dùng sẽ không thấy gì)");
}

console.log(`\nĐÃ PHÁT HÀNH  ${version}  →  kênh ${KENH}`);
console.log(`  gói   : ${goi.name}`);
console.log(`  tải ở : ${base}/download/windows`);
console.log(`  băm   : ${sha256hash.slice(0, 16)}…`);
console.log(`\nMáy đang chạy bản CŨ HƠN ${version} sẽ thấy banner ở lần hỏi kế tiếp (~1 giờ).`);
if (KENH === "stable") console.log("Đây là kênh NGƯỜI DÙNG. Muốn thử trước thì phát hành kênh dogfood.");
console.log(`Lùi: sửa "${KENH}".version trong manifest về số cũ, hoặc xoá khoá đó đi.`);
if (statSync(MANIFEST).size > 4096) console.log("  (manifest to bất thường — kiểm lại nội dung)");
