/**
 * `--verify` phải phân biệt được "đã vá" với "đã vá bằng thân CŨ".
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/patch-than-hien-hanh.test.ts"
 *
 * ── Chuyện xảy ra 08/09 ────────────────────────────────────────────────────────────────────────
 *
 * `patch-client --verify` kết luận "applied" bằng hai dữ kiện: có marker, và không còn neo nào chưa
 * vá. Cả hai đều đúng với một bundle đã vá bằng bản vá của **tuần trước** — vì thân cũ đã nuốt mất
 * neo, nên không còn gì để đếm. Đo trên bản người dùng đang mở (`Programs\Bot Noi Bo 043`): ba bản
 * vá `computer-tab-{ipc,label,permission}` báo XANH trong khi thân của cả ba vẫn đọc
 * `process.env.GROKBOT2_GATEWAY_TOKEN`, tức chưa bao giờ biết tới vé người dùng.
 *
 * Bài này ghim chiều FALSE — chiều mà guard cũ không bao giờ chạm tới ("một guard chỉ đáng tin khi
 * đã thấy nó trả TRUE một lần"; ở đây ngược lại, nó chưa bao giờ được thấy trả FALSE).
 *
 * Ca cuối dùng CHÍNH bản vá đang phát hành thay vì dữ liệu bịa: một phép kiểm chỉ chạy trên ví dụ
 * tự viết thì nó đo cái ví dụ, không đo thứ sẽ chạy trên máy người dùng.
 */
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — máy vá là JS thuần, cố ý không có tầng type: nó chạy bằng `node` trần trên máy
// người dùng, nơi không có tsx lẫn bước dựng.
import { thanHienHanh } from "../../../infra/patches/than-hien-hanh.mjs";
// @ts-expect-error — như trên.
import PATCHES from "../../../infra/patches/computer-tab.mjs";

const banVa = (id: string) => {
  const p = (PATCHES as Array<{ id: string }>).find((x) => x.id === id);
  assert.ok(p, `khong con ban va ten "${id}" — doi ten thi sua ca bai nay`);
  return p as { id: string; variants?: Array<{ version: string; replace: string; marker: string }> };
};

test("thân đúng bản vá hiện tại thì nhận", () => {
  const p = { variants: [{ replace: "/*m*/THAN-MOI", marker: "/*m*/" }] };
  assert.equal(thanHienHanh(p, `truoc /*m*/THAN-MOI sau`), true);
});

test("marker CÒN mà thân là bản CŨ thì KHÔNG nhận — đây là ca guard cũ bỏ lọt", () => {
  const p = { variants: [{ replace: "/*m*/THAN-MOI", marker: "/*m*/" }] };
  // Bundle đã vá từ trước: marker có, neo mất, nhưng thân là bản cũ.
  assert.equal(thanHienHanh(p, `truoc /*m*/THAN-CU sau`), false);
});

test("nhiều biến thể: chỉ cần thân của ĐÚNG bundle này có mặt", () => {
  // Sau khi vá thì không biến thể nào còn khớp neo, nên không có cách nào biết bundle thuộc bản
  // nào — phải hỏi theo TẬP biến thể, ai có thân nằm đó thì bundle thuộc bản ấy.
  const p = {
    variants: [
      { version: "0.29.0", replace: "/*m*/THAN-029", marker: "/*m*/" },
      { version: "0.43.0", replace: "/*m*/THAN-043", marker: "/*m*/" },
    ],
  };
  assert.equal(thanHienHanh(p, "x /*m*/THAN-043 y"), true);
  assert.equal(thanHienHanh(p, "x /*m*/THAN-029 y"), true);
  assert.equal(thanHienHanh(p, "x /*m*/THAN-CU-NAO-DO y"), false);
});

test("bản vá dạng phẳng (không có variants) vẫn đọc được", () => {
  assert.equal(thanHienHanh({ replace: "AAA" }, "zz AAA zz"), true);
  assert.equal(thanHienHanh({ replace: "AAA" }, "zz BBB zz"), false);
});

test("bản vá không khai replace thì không được coi là có thân", () => {
  // Thà đỏ còn hơn xanh giả: một bản vá thiếu `replace` là bản vá viết hỏng, và câu trả lời "có
  // thân hiện hành" cho nó là câu trả lời không dựa trên gì.
  assert.equal(thanHienHanh({ variants: [{ marker: "/*m*/" }] }, "co /*m*/ trong nay"), false);
  assert.equal(thanHienHanh({ replace: "" }, "bat cu gi"), false);
});

test("computer-tab-ipc THẬT: thân đọc vé thì nhận, thân đọc biến môi trường thì không", () => {
  const p = banVa("computer-tab-ipc");
  const v043 = p.variants?.find((x) => x.version === "0.43.0");
  assert.ok(v043, "biến thể 0.43 phải còn — client đang phát hành chạy trên nền ấy");

  // Đúng thứ `--apply` ghi ra: máy vá là split/join thuần chữ nên `replace` nằm nguyên văn.
  assert.equal(thanHienHanh(p, `dau ${v043!.replace} duoi`), true);

  // Thân CŨ, chép nguyên hình dạng đã đo trên bundle 08/09: có marker, đọc env, không biết tới vé.
  const thanCu = `${v043!.marker}getSandMachines:o(async()=>{try{const k=process.env.GROKBOT2_GATEWAY_TOKEN||"";`;
  assert.equal(thanHienHanh(p, thanCu), false,
    "thân cũ mang đúng marker — nếu ca này xanh thì --verify lại mù như trước");
});

test("computer-tab-ve THẬT: bản vá cất vé phải cất vào globalThis", () => {
  // Ghim đường đi, không ghim câu chữ: bảng Computer chỉ đi bằng vé người dùng được khi có ai đó
  // cất vé lúc `buildConnection` đúc ra nó, và ba chỗ đọc đều đọc đúng chỗ ấy.
  const ve = banVa("computer-tab-ve");
  for (const v of ve.variants ?? []) {
    assert.match(v.replace, /globalThis\.__grokbot2_ve\s*=/, `biến thể ${v.version} phải cất vé`);
  }
  for (const id of ["computer-tab-ipc", "computer-tab-label", "computer-tab-permission"]) {
    for (const v of banVa(id).variants ?? []) {
      assert.ok(v.replace.includes("__grokbot2_ve"),
        `${id} biến thể ${v.version} phải ĐỌC vé, không chỉ đọc GROKBOT2_GATEWAY_TOKEN`);
    }
  }
});
