/**
 * `computer_use` đính bao nhiêu ảnh vào hội thoại — và khi nào thì im.
 *
 *   npx tsx --test services/grokbot-backend/src/anh-man-hinh.test.ts
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * 30/08 người dùng gửi ảnh một bong bóng chat chứa sáu khung màn hình liền nhau và hỏi "tại sao ra
 * nhiều ảnh như này". Tôi đoán sai hai lần trước khi đo:
 *
 *   1. đoán `watch_video` phát 6 tấm — SAI, đo được nó gọi `ctx.attach` đúng MỘT lần, vì contact
 *      sheet đã ghép 6 khung vào một jpg (`tile=3x2 -frames:v 1`);
 *   2. rồi mới tìm ra thủ phạm thật: `computer_use` tự chụp lại sau MỖI hành động không phải
 *      screenshot — sáu thao tác thành sáu tấm.
 *
 * Việc tự chụp không phải thừa: model bấm theo toạ độ, nên bước "nhìn lại" là bước nó sẽ quên nếu
 * không ai chụp hộ. Nhưng ảnh phục vụ HAI người đọc rất khác nhau —
 *
 *   `ctx.see`    → model, và pool chỉ chở MỘT ảnh mỗi request nên chỉ tấm cuối tới nơi;
 *   `ctx.attach` → người, và mỗi tấm nằm lại vĩnh viễn trong bản ghi.
 *
 * — nên đính mọi bước là trả giá bên người để phục vụ một bên model vốn chỉ đọc tấm cuối.
 *
 * ── Luật đo được, không phải cảm tính ───────────────────────────────────────────────────────────
 *
 * Người dùng chọn "bot tự quyết theo việc". Ba luật, mỗi luật một lý do:
 *
 *   · tấm ĐẦU của lượt luôn đính — không có nó thì người không biết bot khởi hành từ đâu;
 *   · hành động HỎNG luôn đính — đúng lúc người cần nhìn nhất;
 *   · còn lại chỉ đính khi màn hình ĐỔI ĐÁNG KỂ so với tấm đã đính gần nhất.
 *
 * "Đáng kể" đo bằng độ dài JPEG. Không phải phép so hoàn hảo, nhưng nó có thật, rẻ, và không cần
 * thêm thư viện giải nén nào: gõ một chữ vào ô tìm kiếm gần như không đổi độ dài; mở một cửa sổ
 * mới thì đổi hẳn. Ngưỡng nằm ở `NGUONG_DOI` để sau này đo lại và chỉnh được bằng số.
 *
 * Và có một chốt chặn: quá `TOI_DA_BO_QUA` bước liên tiếp không đính thì đính một tấm, dù màn hình
 * có vẻ đứng yên — thà thừa một tấm còn hơn để người ngồi nhìn im lặng suốt mười thao tác.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nenDinhAnh, quenManHinh, NGUONG_DOI, TOI_DA_BO_QUA } from "./runtime/anh-man-hinh.js";

/** JPEG giả với độ dài cho trước — chỉ độ dài mới được dùng để so. */
const anh = (n: number): string => "x".repeat(n);

test("tấm đầu của lượt luôn được đính", () => {
  const a = "bot-1";
  quenManHinh(a);
  assert.equal(nenDinhAnh(a, anh(100_000), { ok: true }), true);
});

test("màn hình gần như đứng yên thì không đính thêm", () => {
  const a = "bot-2";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });          // tấm đầu
  // Gõ một chữ: JPEG đổi chưa tới ngưỡng.
  const nhoHonNguong = Math.floor(100_000 * (1 + NGUONG_DOI / 2));
  assert.equal(nenDinhAnh(a, anh(nhoHonNguong), { ok: true }), false);
});

test("màn hình đổi hẳn thì đính", () => {
  const a = "bot-3";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });
  const quaNguong = Math.floor(100_000 * (1 + NGUONG_DOI * 2));
  assert.equal(nenDinhAnh(a, anh(quaNguong), { ok: true }), true);
});

test("hành động hỏng thì luôn đính, kể cả màn hình y hệt", () => {
  const a = "bot-4";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });
  assert.equal(nenDinhAnh(a, anh(100_000), { ok: false }), true, "lỗi là lúc người cần nhìn nhất");
});

test(`bỏ qua quá ${TOI_DA_BO_QUA} bước liên tiếp thì đính một tấm cho người đỡ ngồi nhìn im lặng`, () => {
  const a = "bot-5";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });
  let dinh = 0;
  for (let i = 0; i < TOI_DA_BO_QUA + 1; i++) {
    // Mỗi bước đổi một chút, luôn dưới ngưỡng.
    if (nenDinhAnh(a, anh(100_000 + i), { ok: true })) dinh++;
  }
  assert.equal(dinh, 1, "đúng một tấm phá vỡ chuỗi im lặng");
});

test("so với tấm ĐÃ ĐÍNH gần nhất, không phải tấm liền trước", () => {
  const a = "bot-6";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });
  // Trôi dần từng bước nhỏ: mỗi bước so với bước trước thì không bao giờ đủ ngưỡng, nhưng cộng
  // dồn lại thì màn hình đã đổi hẳn. So với tấm đã đính mới bắt được chuyện đó.
  // Mỗi bước bằng nửa ngưỡng, nên hai bước mới CHẠM ngưỡng và ba bước mới vượt — luật là "vượt",
  // không phải "chạm". Bước thứ ba là bước đầu tiên đáng đính.
  const buoc = Math.floor(100_000 * (NGUONG_DOI / 2));
  assert.equal(nenDinhAnh(a, anh(100_000 + buoc), { ok: true }), false);
  assert.equal(nenDinhAnh(a, anh(100_000 + buoc * 2), { ok: true }), false, "đúng bằng ngưỡng thì chưa");
  assert.equal(nenDinhAnh(a, anh(100_000 + buoc * 3), { ok: true }), true, "cộng dồn đã vượt ngưỡng");
});

test("lượt mới bắt đầu lại từ đầu", () => {
  const a = "bot-7";
  quenManHinh(a);
  nenDinhAnh(a, anh(100_000), { ok: true });
  assert.equal(nenDinhAnh(a, anh(100_000), { ok: true }), false);
  quenManHinh(a);
  assert.equal(nenDinhAnh(a, anh(100_000), { ok: true }), true, "sau khi quên, tấm đầu lại được đính");
});

test("mỗi bot đếm riêng — hai bot dùng máy không đè lên nhau", () => {
  quenManHinh("bot-8a");
  quenManHinh("bot-8b");
  assert.equal(nenDinhAnh("bot-8a", anh(100_000), { ok: true }), true);
  assert.equal(nenDinhAnh("bot-8b", anh(100_000), { ok: true }), true, "bot B vẫn được tấm đầu của nó");
  assert.equal(nenDinhAnh("bot-8a", anh(100_000), { ok: true }), false);
});
