/**
 * Lượt model đọc lại buổi dạy — phần khái quát hoá mà app gốc có còn ta thì không.
 *
 *   npx tsx --test services/grokbot-backend/src/teach-learn.test.ts
 *
 * Ba thứ được khoá ở đây, vì mỗi thứ hỏng theo một kiểu im lặng khác nhau:
 *
 *   stepsForModel   — nếu nó bỏ điều hướng hệ quả giống `stepsToPrompt` thì model không còn cách
 *                     nào biết một cú bấm dẫn tới đâu, và mọi lời khuyên "đi thẳng vào trang" biến
 *                     thành bịa. Hai hàm này CỐ Ý khác nhau.
 *   docKetQuaHoc    — bản ghi thô đã lưu trước rồi. Nhận bừa một câu trả lời hỏng là ghi đè lên
 *                     thứ đang dùng được, và không ai biết cho tới lúc chạy routine.
 *   chuYeuLaBiMat   — chặn quá tay thì mất bài dạy thật; chặn hụt thì lưu một routine toàn `***`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepsForModel, docKetQuaHoc, chuYeuLaBiMat, stepsToPrompt, type Step } from "./teach.js";

type S = Step & { quality?: string };

/** Đúng bản ghi bài 24h.com.vn, sau khi bộ ghi đã bắt được cả bàn phím. */
const t0 = 1_000_000;
const BAI_24H: S[] = [
  { act: "navigate", url: "https://www.google.com/search?q=cu&ei=aZOSav", t: t0 },
  { act: "navigate", url: "https://www.google.com/", t: t0 + 4000 },
  { act: "click", sel: "#ti6dpd", quality: "id", t: t0 + 8000 },
  { act: "fill", sel: "#ti6dpd", value: "24h", quality: "id", t: t0 + 9000 },
  { act: "key", key: "Enter", t: t0 + 9500 },
  { act: "navigate", url: "https://www.google.com/search?q=24h&ei=CpSSar", t: t0 + 10_500 },
  { act: "click", sel: ".zReHs", text: "Tin tức bóng đá, thể thao", quality: "class", t: t0 + 14_000 },
  { act: "navigate", url: "https://www.24h.com.vn/", t: t0 + 15_000 },
  { act: "click", sel: ".d-block", text: "Xôn xao hình ảnh xốp", quality: "class", t: t0 + 19_000 },
  { act: "navigate", url: "https://www.24h.com.vn/tin-tuc/xon-xao-c46a1790607.html", t: t0 + 20_000 },
];

test("bản cho model GIỮ đích đến mà bản cho bot đã bỏ", () => {
  const choBot = stepsToPrompt(BAI_24H);
  const choModel = stepsForModel(BAI_24H);

  // Đích đến là thứ duy nhất cho biết cú bấm `.zReHs` dẫn đi đâu. Bỏ nó là bỏ luôn khả năng
  // rút ngắn đường đi — đúng việc app gốc làm khi nó viết skill đi thẳng vào 24h.com.vn.
  assert.ok(!choBot.includes("24h.com.vn/"), "bản cho bot bỏ điều hướng hệ quả");
  assert.ok(choModel.includes("https://www.24h.com.vn/"), "bản cho model phải giữ:\n" + choModel);
  assert.match(choModel, /trang tự chuyển tới/, "và phải nói rõ đó là hệ quả, kẻo model chép thành bước");
  assert.match(choModel, /nơi tab đang đứng lúc bật ghi/, "kể cả URL sót từ phiên trước cũng được gắn nhãn");
});

test("giá trị đã che không lọt sang model", () => {
  const out = stepsForModel([
    { act: "fill", sel: "#otp", value: "***", masked: true },
    { act: "fill", sel: "#tim", value: "hoá đơn tháng 8" },
  ] as S[]);
  assert.match(out, /giá trị nhạy cảm, đã che/);
  assert.match(out, /"hoá đơn tháng 8"/, "ô thường vẫn phải sang, nếu không model không hiểu việc gì");
});

test("câu trả lời tốt thành routine có tên thật", () => {
  const got = docKetQuaHoc(`\`\`\`json
{"ten":"Đọc tin trên 24h.com.vn",
 "buoc":["mở https://www.24h.com.vn/","bấm bài đầu tiên trên trang chủ","đọc nội dung bài"],
 "ghiChu":"Đi thẳng vào trang chủ thay vì tìm trên Google cho ổn định."}
\`\`\``);
  assert.ok(got, "phải đọc được dù model bọc trong hàng rào ```json");
  assert.equal(got.name, "Đọc tin trên 24h.com.vn");
  assert.match(got.prompt, /1\. mở https:\/\/www\.24h\.com\.vn\//);
  assert.match(got.prompt, /2\. bấm bài đầu tiên trên trang chủ/);
  assert.match(got.prompt, /Ghi chú từ lúc học: Đi thẳng vào trang chủ/);
  assert.match(got.prompt, /DỪNG/, "luật dừng-khi-lệch phải còn, y như bản thô");
});

test("model tự đánh số thì không ra 1. 1.", () => {
  const got = docKetQuaHoc('{"ten":"Xuất báo cáo tuần","buoc":["1. mở bảng điều khiển","2) bấm Xuất"]}');
  assert.ok(got);
  assert.match(got.prompt, /^1\. mở bảng điều khiển$/m);
  assert.match(got.prompt, /^2\. bấm Xuất$/m);
});

test("mọi câu trả lời đáng ngờ đều bị từ chối, vì bản thô đang dùng được", () => {
  const xau: Array<[string, string]> = [
    ["không phải JSON", "xin lỗi, tôi không xem được bản ghi"],
    ["thiếu tên", '{"buoc":["mở trang"]}'],
    ["tên rỗng", '{"ten":"   ","buoc":["mở trang"]}'],
    ["tên vẫn là ngày giờ", '{"ten":"Việc đã dạy — 08-29 08:31","buoc":["mở trang"]}'],
    ["không có bước nào", '{"ten":"Việc gì đó","buoc":[]}'],
    ["bước không phải mảng", '{"ten":"Việc gì đó","buoc":"mở trang"}'],
    ["một bước dài bất thường", `{"ten":"Việc gì đó","buoc":["${"x".repeat(400)}"]}`],
    ["quá nhiều bước", `{"ten":"Việc gì đó","buoc":[${Array(41).fill('"bấm"').join(",")}]}`],
  ];
  for (const [vi, text] of xau) {
    assert.equal(docKetQuaHoc(text), null, `phải từ chối: ${vi}`);
  }
});

test("đăng nhập rồi làm việc thì VẪN lưu — chặn quá tay là mất bài dạy thật", () => {
  const dangNhapRoiLamViec: S[] = [
    { act: "click", sel: "#user" },
    { act: "fill", sel: "#user", value: "an@cty.vn" },
    { act: "click", sel: "#pass" },
    { act: "fill", sel: "#pass", value: "***", masked: true },
    { act: "key", key: "Enter" },
    { act: "click", sel: "#donhang" },
    { act: "click", sel: "#xuat" },
  ];
  assert.equal(chuYeuLaBiMat(dangNhapRoiLamViec), false);
});

test("buổi dạy chỉ có nhập bí mật thì từ chối — routine ấy không chạy lại được", () => {
  assert.equal(chuYeuLaBiMat([
    { act: "fill", sel: "#api_key", value: "***", masked: true },
    { act: "fill", sel: "#secret", value: "***", masked: true },
    { act: "click", sel: "#luu" },
  ] as S[]), true);
});

test("không có gì bị che thì không bao giờ từ chối", () => {
  assert.equal(chuYeuLaBiMat(BAI_24H), false);
});
