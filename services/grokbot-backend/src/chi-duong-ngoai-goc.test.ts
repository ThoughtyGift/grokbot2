/**
 * Tệp ngoài `localRoot`: câu báo lỗi phải NÊU ĐƯỜNG ĐI, và chỉ nêu cho ĐỌC.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/chi-duong-ngoai-goc.test.ts"
 *
 * Đo 08/09/2026: `local_read` lên `D:\111\…\model_response.json` → *"Path is outside the allowed
 * local-exec root and was refused"*; CÙNG tệp qua `local_shell` → exit 0, 86.182 byte. Cửa shell mở,
 * chỉ cửa file-op đóng — nên câu "bị chặn" trơn là câu bỏ sót một sự thật.
 *
 * Bài trên hàm thuần đo HÀNH VI; bài cuối đọc MÃ vì `tools.ts` kéo pool + box nên không nạp được
 * (bảng theo dõi §7) — và thứ cần ghim ở đó là một điều PHỦ ĐỊNH: `local_write` không được chỉ đường.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { chiDuongKhiNgoaiGoc, CAU_CHI_DUONG, NGOAI_GOC } from "./runtime/chi-duong-ngoai-goc.js";

/** Nguyên văn câu daemon trả về, chép từ lượt đo qua cửa ops. */
const CAU_DAEMON = "Path is outside the allowed local-exec root and was refused: "
  + String.fromCharCode(68, 58, 92) + "111" + String.fromCharCode(92) + "Desktop"
  + String.fromCharCode(92) + "runway-workflows-5c286efc" + String.fromCharCode(92) + "model_response.json";

test("ca ngoài gốc: giữ nguyên câu daemon và NỐI thêm đường đi", () => {
  const ra = chiDuongKhiNgoaiGoc(CAU_DAEMON);
  assert.ok(ra.startsWith(CAU_DAEMON), "câu gốc là bằng chứng — không được viết lại");
  assert.ok(ra.includes("local_shell"), "phải nêu đúng tên tool đi được");
  assert.ok(ra.includes(CAU_CHI_DUONG), "nối đúng câu chỉ đường");
});

test("câu chỉ đường nói rõ người dùng VẪN được hỏi — không mời đi tắt qua quyền", () => {
  // Nếu câu này mất, model có thể đọc thành "shell là đường vòng khỏi phép duyệt".
  assert.ok(/thẻ|quyền/.test(CAU_CHI_DUONG), CAU_CHI_DUONG);
});

test("mọi lỗi KHÁC về nguyên văn, không mọc thêm chữ nào", () => {
  for (const loi of [
    "File is 120.3 MiB which exceeds the 100 MiB limit",
    "Máy tính của bạn đang không kết nối.",
    "",
  ]) assert.equal(chiDuongKhiNgoaiGoc(loi), loi);
});

test("khớp theo MẢNH chuỗi, vì phần sau là đường dẫn của người dùng", () => {
  // Đường dẫn khác nhau ở mỗi lượt nên không khớp cả câu được.
  assert.ok(chiDuongKhiNgoaiGoc(`Path is ${NGOAI_GOC} and was refused: E:${String.fromCharCode(92)}x`).includes("local_shell"));
});

test("local_read chỉ đường ở CẢ hai nhánh lỗi, local_write thì KHÔNG", () => {
  const src = readFileSync(new URL("./runtime/tools.ts", import.meta.url), "utf8");

  const dau = src.indexOf("TOOLS.local_read");
  assert.ok(dau > 0, "không thấy local_read");
  const cuoi = src.indexOf("TOOLS.", dau + 10);
  const than = src.slice(dau, cuoi > dau ? cuoi : undefined);
  assert.equal((than.match(/chiDuongKhiNgoaiGoc\(/g) ?? []).length, 2,
    "local_read có hai nhánh trả lỗi (`!r.ok` và `invalidFile`) — cả hai phải chỉ đường");

  const dauW = src.indexOf("TOOLS.local_write");
  assert.ok(dauW > 0, "không thấy local_write");
  const cuoiW = src.indexOf("TOOLS.", dauW + 10);
  const thanW = src.slice(dauW, cuoiW > dauW ? cuoiW : undefined);
  assert.ok(!thanW.includes("chiDuongKhiNgoaiGoc"),
    "GHI ra ngoài localRoot không được chỉ đường: đi vòng một hàng rào ghi là quyết định của chủ dự án");
});
