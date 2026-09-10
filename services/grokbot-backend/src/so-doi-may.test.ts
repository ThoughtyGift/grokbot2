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
  KET_QUA,
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

/**
 * Bộ khoá được ghim bằng một DANH SÁCH CHO PHÉP, không bằng `deepEqual` trên một mẫu.
 *
 * Lý do đổi (10/09, khi thêm `kq`): `kq` là trường TUỲ CHỌN, nên một hàng không có nó vẫn hợp lệ —
 * `deepEqual` trên một mẫu duy nhất sẽ hoặc đỏ oan, hoặc phải chọn đúng cái mẫu CÓ `kq` và thế là
 * ca "không có `kq`" thoát khỏi hàng rào. Danh sách cho phép bắt được cả hai chiều: nó vẫn đỏ khi
 * ai đó thêm `ip`, và nó không quan tâm trường tuỳ chọn có mặt hay không.
 */
const KHOA_CHO_PHEP = ["cuoi", "dau", "kq", "laLauncher", "ma", "n", "nen", "ua", "ver"];

test("hàng trong sổ có ĐÚNG bộ khoá đã định — không token, không URL, không IP", () => {
  const BAT_BUOC = KHOA_CHO_PHEP.filter((k) => k !== "kq");
  for (const [ten, so] of [
    ["không kq", gop(TRANG(), luot())],
    ["có kq", gop(TRANG(), luot({ kq: "cai-hong" }))],
  ] as const) {
    const hang = Object.values(so.hang)[0];
    for (const k of Object.keys(hang)) {
      assert.ok(KHOA_CHO_PHEP.includes(k), `[${ten}] khoá lạ "${k}" — thêm trường vào sổ là một quyết định, không phải một dòng`);
    }
    for (const k of BAT_BUOC) assert.ok(k in hang, `[${ten}] thiếu khoá bắt buộc "${k}"`);
    const chu = JSON.stringify(so).toLowerCase();
    for (const cam of ["token", "\"k\"", "http", "ip", "addr", "secret"]) {
      assert.equal(chu.includes(cam), false, `[${ten}] sổ không được mang "${cam}"`);
    }
  }
});

// Hàng rào trên chỉ blunt khi TỪ ĐIỂN cũng sạch: một từ chứa "token" sẽ làm phép cấm ấy đỏ, và cách
// chữa sai là nới phép cấm. 10/09 `thieu-token` đã bị đổi thành `thieu-giay` đúng vì lý do này.
test("từ điển kết quả không chứa chữ nào mà chính hàng rào chống rò đang cấm", () => {
  for (const t of KET_QUA) {
    for (const cam of ["token", "http", "addr", "secret"]) {
      assert.equal(t.includes(cam), false, `từ "${t}" mang "${cam}" ⇒ nó sẽ buộc phải nới hàng rào chống rò`);
    }
    assert.match(t, /^[a-z0-9-]+$/, `"${t}" phải khớp regex launcher đọc lại từ vệt bánh mì`);
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

// ── 6 · `kq` — kết quả lượt tự cập nhật TRƯỚC đó, do launcher khai ────────────────────────────
//
// Vì sao trường này có (đo 10/09): khối tự cập nhật có TÁM cửa `exit 0` và không cửa nào phân biệt
// được với "không có gì mới". Máy `26100.9168` tải 106 MB hai lần rồi vẫn ở bản cũ, im lặng, và
// không nơi nào ghi lại. Giá trị đến từ CLIENT nên nó phải đi qua một từ điển ĐÓNG — mấy bài dưới
// ghim đúng tính chất ấy, chứ không ghim danh sách từ (danh sách sẽ dài ra, tính chất thì không).

test("kq ngoài từ điển bị BỎ — sổ không phải cái ống từ máy người dùng", () => {
  for (const bay of ["'; DROP", "cai-hong-bịa", "x".repeat(500), "<script>", "http://a.b", "", "  "]) {
    const so = gop(TRANG(), luot({ kq: bay }));
    assert.equal(Object.values(so.hang)[0].kq, undefined, `"${bay.slice(0, 20)}" không được vào sổ`);
  }
  const chu = JSON.stringify(gop(TRANG(), luot({ kq: "http://ke-la.test/x" })));
  assert.equal(chu.includes("ke-la"), false, "chuỗi bịa không được lọt vào sổ dưới bất kỳ hình nào");
});

test("mọi từ TRONG từ điển đều vào được sổ — hàng rào không được chặt tới mức chặn cả ca thật", () => {
  for (const t of KET_QUA) {
    assert.equal(Object.values(gop(TRANG(), luot({ kq: t })).hang)[0].kq, t, `từ hợp lệ "${t}" bị chặn`);
  }
});

test("kq VẮNG thì không xoá cái đã biết — launcher cũ không được bôi mất chẩn đoán của bản mới", () => {
  const a = gop(TRANG(), luot({ kq: "cai-hong" }));
  assert.equal(Object.values(a.hang)[0].kq, "cai-hong");
  const b = gop(a, luot()); // launcher cũ: không gửi `kq`
  assert.equal(Object.values(b.hang)[0].kq, "cai-hong", "vắng ≠ xoá");
  const c = gop(b, luot({ kq: "khong-lai-mot-tu-bia" }));
  assert.equal(Object.values(c.hang)[0].kq, "cai-hong", "từ bịa cũng không được xoá");
});

test("kq MỚI đè kq cũ — cái đáng đọc là lần gần nhất, không phải lần đầu", () => {
  const a = gop(TRANG(), luot({ kq: "bam-lech" }));
  const b = gop(a, luot({ kq: "cai-xong" }));
  assert.equal(Object.values(b.hang)[0].kq, "cai-xong");
  assert.equal(Object.values(b.hang)[0].n, 2, "vẫn là một hàng, đếm lên 2");
});

test("tinhDoiMay: `0 / 4` thành một CHẨN ĐOÁN — đếm máy chưa tới theo lý do", () => {
  let so = TRANG();
  // Một máy thử rồi trượt ở bộ cài; một máy chưa bao giờ khai (app không đóng nên launcher không chạy).
  so = gop(so, luot({ ua: UA_LAUNCHER_2, ver: "0.29.20260903", kq: "cai-hong", khi: 5_000 }));
  so = gop(so, luot({ ua: UA_LAUNCHER, ver: "0.43.20260905", khi: 6_000 }));
  // Và một phép dò của chính bài đo — nó không được lọt vào phép đếm máy.
  so = gop(so, luot({ ua: UA_CURL, ver: "0.43.20260909", khi: 7_000 }));

  const t = tinhDoiMay(so, "0.43.20260909");
  assert.equal(t.daToi, 0, "không máy THẬT nào ở bản đang phát");
  assert.equal(t.tong, 2);
  assert.deepEqual(t.lyDoChuaToi, { "cai-hong": 1, "(chưa khai)": 1 },
    "hai máy chưa tới vì HAI lý do khác hẳn nhau — đó là cả điểm của trường này");
  assert.equal(t.may.find((m) => m.ua.includes("26100"))?.kq, "cai-hong");
  assert.equal(t.may.find((m) => m.ua.includes("19041"))?.kq, undefined);
});

test("máy ĐÃ tới bản đang phát không nằm trong bảng lý do", () => {
  const so = gop(TRANG(), luot({ ua: UA_LAUNCHER, ver: "0.43.20260909", kq: "cai-xong", khi: 9_000 }));
  const t = tinhDoiMay(so, "0.43.20260909");
  assert.equal(t.daToi, 1);
  assert.deepEqual(t.lyDoChuaToi, {}, "đã tới rồi thì không có lý do gì để kể");
});

// ── 7 · Từ điển và LAUNCHER không được trôi khỏi nhau ─────────────────────────────────────────
//
// Từ điển sống ở đây, còn chỗ SINH RA các từ ấy là hai khuôn launcher. Đó đúng là hình dạng §7 đã
// trả giá ba lần — *"một danh sách sống ở HAI nơi thì cái mình đọc luôn là cái cũ"* — nên nó phải
// có một bài nối hai đầu. Và bài này đọc **BẢN ĐÃ RENDER**, không đọc mã khuôn: `\B` từng biến mất
// giữa khuôn và đầu ra suốt nhiều gói đã phát, và mã khuôn trông đúng ở cả hai lỗi ấy.

// @ts-expect-error — script .mjs thuần, không có khai báo kiểu.
const { startBundled } = await import("../scripts/setup-exe.mjs");
// @ts-expect-error — như trên.
const { winStart } = await import("../scripts/setup-templates.mjs");

const KHOI = (s: string) => s.slice(s.indexOf("powershell -NoProfile"));

/**
 * `bi-chan` là từ DUY NHẤT không do PowerShell ghi, và đó là toàn bộ lý do nó tồn tại: ca nó mô tả
 * là *"tiến trình PowerShell ấy đã bị giết"*, nên một chỗ ghi nằm bên trong nó sẽ câm đúng lúc cần
 * nói. Đo 11/09: Defender chấm điểm cả dòng lệnh của pha 1 và giết `powershell` ngay ở
 * `CreateProcess` — cmd in *"Access is denied."*, `errorlevel` 5, và cả tám cửa `exit 0` của mục 52
 * im cùng lúc. Nên nó được ghim RIÊNG, ở đúng hình cmd, và ghim cả chiều PHỦ ĐỊNH.
 */
const CMD_GHI: readonly string[] = ["bi-chan"];

test("mọi từ trong từ điển đều có chỗ GHI trong launcher — không cửa nào còn câm", () => {
  const hai = { "chở-app": KHOI(startBundled() as string), "cấu-hình": KHOI(winStart as string) };
  for (const [ten, s] of Object.entries(hai)) {
    // `thieu-giay` chỉ có ở bản chở-app: bản cấu hình không có cửa token nào để mà thiếu.
    const can = KET_QUA.filter((t) => (ten === "cấu-hình" ? t !== "thieu-giay" : true));
    for (const t of can) {
      if (CMD_GHI.includes(t)) {
        assert.ok(s.includes(`kq=${t} ma=%GB2MA%`), `[${ten}] từ "${t}" phải do CMD ghi — PowerShell lúc ấy không còn ở đó`);
        assert.ok(!s.includes(`'${t}'`), `[${ten}] "${t}" không được ghi từ TRONG PowerShell: chỗ đó chính là chỗ bị giết`);
        continue;
      }
      assert.ok(s.includes(`'${t}'`), `[${ten}] từ "${t}" không có chỗ nào ghi ra — một cửa câm nữa`);
    }
  }
});

test("launcher gửi kq của lượt TRƯỚC lên feed, và đọc nó bằng đúng regex từ điển chịu được", () => {
  for (const [ten, s] of Object.entries({ "chở-app": KHOI(startBundled() as string), "cấu-hình": KHOI(winStart as string) })) {
    assert.ok(s.includes("'&kq='+[uri]::EscapeDataString($kqCu)"), `[${ten}] phải gửi kq lên feed, đã escape`);
    assert.ok(s.includes("'kq=([a-z0-9-]+)'"), `[${ten}] phải đọc lại kq từ vệt bánh mì`);
    assert.ok(s.includes(".cap-nhat-cuoi.txt"), `[${ten}] phải có vệt bánh mì trên máy`);
    assert.ok(s.includes("-Wait -PassThru"), `[${ten}] pha 2 phải ĐỌC mã thoát của bộ cài`);
  }
});

test("không còn cửa `exit 0` nào trong pha 1 mà không ghi lý do", () => {
  for (const [ten, s] of Object.entries({ "chở-app": KHOI(startBundled() as string), "cấu-hình": KHOI(winStart as string) })) {
    for (const dong of s.split(/\r?\n/)) {
      if (!dong.includes("exit 0")) continue;
      // Đúng MỘT ngoại lệ, và nó là chủ ý: nhánh tiết chế 24h không ghi gì, vì ghi là bôi mất
      // chẩn đoán của lượt trước. Nó nhận ra được bằng `TotalHours`.
      if (dong.includes("TotalHours")) continue;
      assert.ok(/G [$']/.test(dong), `[${ten}] cửa câm: ${dong.trim().slice(0, 90)}`);
    }
  }
});
