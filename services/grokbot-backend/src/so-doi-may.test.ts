/**
 * Sổ kiểm kê đội máy — đếm được "bản vá đã tới máy ai chưa" mà KHÔNG ghi token/URL/IP.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/so-doi-may.test.ts"
 *
 * Bài này chạy **TRƯỚC khi nối dây** — đó là cả lý do `so-doi-may.ts` được viết thuần. §7 vừa ghi
 * đúng luật ấy hôm qua sau ca `epoch-ben`: *"một bài đo cho module thuần thì chạy được TRƯỚC khi nối
 * dây — hãy chạy nó ở đó"*, vì một tính chất viết sai mà để đỏ SAU khi áp thì câu báo sẽ trỏ sang
 * sản phẩm.
 *
 * `GROKBOT2_SO_DOI_MAY_FILE` đặt **vô điều kiện** ngay dưới đây, TRƯỚC `import` — không `??=` theo
 * env của runner. Cùng lý do `may-da-biet.test.ts` chép: `node --test` chạy các file SONG SONG và
 * `dataDir()` dưới `NODE_TEST_CONTEXT` là MỘT thư mục dùng chung, nên env runner chỉ là lưới che
 * `.data` thật, không phải hàng rào giữa các bài. Ở đây nó còn là hàng rào giữa các bài TRONG file:
 * mọi bài dưới đây tự cầm đường dẫn tạm của riêng nó.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAM = mkdtempSync(join(tmpdir(), "gb2-so-doi-may-"));
process.env.GROKBOT2_SO_DOI_MAY_FILE = join(TAM, "so-doi-may.json");

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chuanUa,
  docSo,
  ghiLuot,
  gop,
  khoaHang,
  soDoiMayPath,
  tinhDoiMay,
  TRAN_HANG,
  type Luot,
  type SoDoiMay,
} from "./so-doi-may.js";

/** `User-Agent` NGUYÊN VĂN của launcher thật, chép từ `access.log` ngày 09/09. */
const UA_LAUNCHER = "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.19041.6456";
const UA_LAUNCHER_2 = "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.26100.9168";
const UA_CURL = "curl/8.18.0";

const TRANG = (): SoDoiMay => ({ tu: 1_000, hang: {} });
const luot = (p: Partial<Luot> = {}): Luot => ({
  ua: UA_LAUNCHER,
  ver: "0.43.20260906",
  nen: "windows",
  ma: 200,
  khi: 2_000,
  ...p,
});
const tepMoi = (ten: string) => join(mkdtempSync(join(TAM, `${ten}-`)), "so.json");

// ── 1 · Phép TÁCH: launcher thật khác phép dò của chính mình ───────────────────────────────────
// Đây là tính chất đắt nhất của cả module. Thiếu nó thì 17/17 lượt trong log là của tôi mà trông
// như 17 máy người dùng — đúng bẫy "coverage đếm cả lượt của bài đo", và nó đã xảy ra hôm nay.

test("chuanUa: launcher thật ra đúng đuôi PowerShell và được dán nhãn", () => {
  assert.deepEqual(chuanUa(UA_LAUNCHER), { ua: "PowerShell/5.1.19041.6456", laLauncher: true });
  assert.deepEqual(chuanUa(UA_LAUNCHER_2), { ua: "PowerShell/5.1.26100.9168", laLauncher: true });
});

test("chuanUa: phép dò của mình và trình duyệt KHÔNG bao giờ đội lốt launcher", () => {
  assert.deepEqual(chuanUa(UA_CURL), { ua: "curl/8.18.0", laLauncher: false });
  assert.deepEqual(chuanUa("node"), { ua: "node", laLauncher: false });
  // Trình duyệt gộp về một hàng là đúng ý: trình duyệt không phải launcher.
  assert.deepEqual(
    chuanUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0"),
    { ua: "Mozilla/5.0", laLauncher: false },
  );
  // Không khai gì cũng là một hàng đọc được, không phải một hàng ma.
  assert.deepEqual(chuanUa(""), { ua: "(không khai)", laLauncher: false });
  assert.equal(chuanUa("   ").laLauncher, false);
});

test("chuanUa: chuỗi do người gọi ngoài điều khiển thì bị siết, không thành khoá dài vô hạn", () => {
  const { ua, laLauncher } = chuanUa("X".repeat(500));
  assert.equal(ua.length, 40);
  assert.equal(laLauncher, false);
  // Không ký tự nào phá được khoá `ua|nen|ver`.
  assert.equal(chuanUa("a|b c\nd").ua.includes("|"), false);
});

// ── 2 · KHÔNG BAO GIỜ GHI GÌ ──────────────────────────────────────────────────────────────────
// Bài này ghim đúng BỘ KHOÁ của một hàng. Ai thêm `ip`/`k`/`url` sau này thì nó đỏ ở đây, trước
// khi bản ấy đi đâu — hình dạng hàm là thứ bảo đảm, không phải một lời dặn trong chú thích.

test("hàng trong sổ có ĐÚNG bộ khoá đã định — không token, không URL, không IP", () => {
  const so = gop(TRANG(), luot());
  const hang = Object.values(so.hang)[0];
  assert.deepEqual(Object.keys(hang).sort(), ["cuoi", "dau", "laLauncher", "ma", "n", "nen", "ua", "ver"]);
  const chu = JSON.stringify(so).toLowerCase();
  for (const cam of ["token", "\"k\"", "http", "ip", "addr", "secret"]) {
    assert.equal(chu.includes(cam), false, `sổ không được mang "${cam}"`);
  }
});

// ── 3 · Thuần, và khoá theo (máy · nền · bản) ─────────────────────────────────────────────────

test("gop: THUẦN — sổ cũ không bị sửa", () => {
  const cu = TRANG();
  const moi = gop(cu, luot());
  assert.deepEqual(cu.hang, {}, "sổ cũ phải nguyên vẹn");
  assert.equal(Object.keys(moi.hang).length, 1);
});

test("gop: cùng máy hỏi hai lần thì một hàng, n tăng, cửa sổ dau→cuoi nới ra", () => {
  const a = gop(TRANG(), luot({ khi: 5_000 }));
  const b = gop(a, luot({ khi: 9_000, ma: 204 }));
  assert.equal(Object.keys(b.hang).length, 1);
  const h = Object.values(b.hang)[0];
  assert.equal(h.n, 2);
  assert.equal(h.dau, 5_000);
  assert.equal(h.cuoi, 9_000);
  assert.equal(h.ma, 204, "mã phải là mã của lượt GẦN NHẤT");
});

test("gop: cùng máy khai bản KHÁC là một hàng khác — đó là cách đọc được máy đi từ đâu tới đâu", () => {
  const a = gop(TRANG(), luot({ ver: "0.43.20260906" }));
  const b = gop(a, luot({ ver: "0.43.20260909" }));
  assert.equal(Object.keys(b.hang).length, 2);
  assert.ok(b.hang[khoaHang({ ua: "PowerShell/5.1.19041.6456", nen: "windows", ver: "0.43.20260906" })]);
  assert.ok(b.hang[khoaHang({ ua: "PowerShell/5.1.19041.6456", nen: "windows", ver: "0.43.20260909" })]);
});

test("gop: `ver` bịa đặt bị siết, và lượt thiếu giờ vẫn ghi được", () => {
  const so = gop(TRANG(), luot({ ver: "../../etc/passwd", nen: "" }));
  const h = Object.values(so.hang)[0];
  assert.equal(h.ver.includes("/"), false);
  assert.equal(h.nen, "(không khai)");
  const so2 = gop(TRANG(), luot({ khi: Number.NaN }));
  assert.ok(Number.isFinite(Object.values(so2.hang)[0].cuoi), "giờ hỏng thì lấy giờ hiện tại");
});

// ── 4 · Trần, và thứ tự loại ──────────────────────────────────────────────────────────────────

test("gop: trần giữ số hàng, và hàng LAUNCHER được giữ lại trước hàng phép dò", () => {
  let so = TRANG();
  // Một máy thật, hỏi sớm nhất — đúng ứng viên bị loại nếu chỉ xét `cuoi`.
  so = gop(so, luot({ ua: UA_LAUNCHER, ver: "0.43.20260906", khi: 1 }), 3);
  so = gop(so, luot({ ua: UA_CURL, ver: "p1", khi: 10 }), 3);
  so = gop(so, luot({ ua: UA_CURL, ver: "p2", khi: 20 }), 3);
  assert.equal(Object.keys(so.hang).length, 3);
  so = gop(so, luot({ ua: UA_CURL, ver: "p3", khi: 30 }), 3);
  assert.equal(Object.keys(so.hang).length, 3, "trần phải giữ");
  const conLauncher = Object.values(so.hang).filter((h) => h.laLauncher);
  assert.equal(conLauncher.length, 1, "máy thật cũ nhất vẫn phải còn — nó là lý do sổ này tồn tại");
  assert.equal(conLauncher[0].ver, "0.43.20260906");
});

test("gop: hàng vừa ghi không bị loại ngay trong chính lượt ghi nó", () => {
  let so = TRANG();
  for (let i = 0; i < 5; i++) so = gop(so, luot({ ua: UA_CURL, ver: `p${i}`, khi: 100 + i }), 2);
  assert.equal(Object.keys(so.hang).length, 2);
  assert.ok(Object.values(so.hang).some((h) => h.ver === "p4"), "lượt cuối phải có mặt trong sổ");
});

test("TRAN_HANG là một con số, không phải vô hạn", () => {
  assert.ok(Number.isInteger(TRAN_HANG) && TRAN_HANG > 0 && TRAN_HANG <= 1000);
});

// ── 5 · Cổng để đặt GROKBOT2_CHECKOUT_URL ─────────────────────────────────────────────────────

test("tinhDoiMay: đếm theo lượt GẦN NHẤT của mỗi máy, không phải 'từng khai'", () => {
  let so = TRANG();
  // Máy 1 lên bản mới rồi bị cài đè về bản cũ ⇒ KHÔNG được tính là "đã tới".
  so = gop(so, luot({ ua: UA_LAUNCHER, ver: "0.43.20260909", khi: 1_000 }));
  so = gop(so, luot({ ua: UA_LAUNCHER, ver: "0.43.20260906", khi: 2_000 }));
  // Máy 2 đang ở bản mới.
  so = gop(so, luot({ ua: UA_LAUNCHER_2, ver: "0.43.20260909", khi: 1_500, ma: 204 }));
  // Phép dò của tôi khai bản mới cũng không được tính là một máy.
  so = gop(so, luot({ ua: UA_CURL, ver: "0.43.20260909", khi: 3_000 }));

  const t = tinhDoiMay(so, "0.43.20260909");
  assert.equal(t.tong, 2, "hai máy thật");
  assert.equal(t.daToi, 1, "chỉ máy 2 đang ở bản mới");
  assert.equal(t.khongPhaiLauncher, 1, "hàng phép dò vẫn đếm được — 0 máy thật phải khác sổ hỏng");
  assert.equal(t.may[0].ua, "PowerShell/5.1.19041.6456", "mới nhất trước");
  assert.equal(t.may[0].ver, "0.43.20260906");
});

test("tinhDoiMay: sổ trắng trả 0 chứ không ném, và 0 kèm được cửa sổ `tu`", () => {
  const t = tinhDoiMay(TRANG(), "0.43.20260909");
  assert.deepEqual({ daToi: t.daToi, tong: t.tong, may: t.may }, { daToi: 0, tong: 0, may: [] });
  assert.equal(TRANG().tu, 1_000, "một con số đếm luôn phải có cửa sổ");
});

// ── 6 · Hai hàm chạm đĩa: fail-open, cửa feed không được chết vì sổ ───────────────────────────

test("soDoiMayPath: env thắng, đúng quy ước của manifestPath()", () => {
  assert.equal(soDoiMayPath(), join(TAM, "so-doi-may.json"));
});

test("docSo: tệp vắng là sổ TRẮNG, không ném", () => {
  const so = docSo(join(TAM, "chua-ton-tai", "so.json"), 7_777);
  assert.deepEqual(so, { tu: 7_777, hang: {} });
});

test("docSo: tệp HỎNG là sổ trắng, không ném — sổ không được là lý do feed đứng", () => {
  const tep = tepMoi("hong");
  writeFileSync(tep, "{ khong phai json");
  assert.deepEqual(docSo(tep, 8_888), { tu: 8_888, hang: {} });
  writeFileSync(tep, JSON.stringify({ tu: "hôm qua", hang: null }));
  assert.deepEqual(docSo(tep, 9_999), { tu: 9_999, hang: {} });
});

test("ghiLuot: ghi rồi đọc lại ra đúng sổ, và lượt thứ hai cộng vào lượt thứ nhất", () => {
  const tep = tepMoi("ghi");
  const a = ghiLuot(tep, luot({ khi: 4_000 }));
  assert.ok(a, "lượt đầu phải ghi được");
  assert.equal(Object.values(a.hang)[0].n, 1);

  ghiLuot(tep, luot({ khi: 6_000, ma: 204 }));
  const lai = docSo(tep);
  const h = Object.values(lai.hang)[0];
  assert.equal(h.n, 2);
  assert.equal(h.cuoi, 6_000);
  assert.equal(lai.tu, 4_000, "`tu` phải là lúc sổ bắt đầu, không phải lúc đọc");
});

test("ghiLuot: KHÔNG BAO GIỜ ném — đường ghi không được cũng chỉ trả null", () => {
  const khongGhiDuoc = join(TAM, "khong-co-thu-muc-nay", "sau-nua", "so.json");
  assert.equal(ghiLuot(khongGhiDuoc, luot()), null);
});
