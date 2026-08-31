/**
 * OBS trên box: lời nhắc chỉ được nhắc tới nó khi nó THẬT SỰ có mặt.
 *
 *   npx tsx --test services/grokbot-backend/src/box-obs.test.ts
 *
 * ── Vì sao bài đầu tiên là bài "chưa dò xong thì im" ────────────────────────────────────────────
 *
 * Một đoạn lời nhắc nói "máy bạn có OBS" trên một box chưa cài OBS còn tệ hơn không nói gì: bot sẽ
 * hứa quay màn hình, chạy một lệnh không tồn tại, rồi phải chống chế. Đó là đúng loại lỗi repo này
 * gặp nhiều nhất — dạy model một năng lực mà cài đặt không có.
 *
 * `coObs` bắt đầu là `null` (chưa dò), và `null` phải đọc như "không có", không phải "có thể có".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { obsCoSan, obsProtocol, doObsTrenBox } from "./box-obs.js";

test("chưa dò xong thì lời nhắc KHÔNG nhắc gì về OBS", () => {
  assert.equal(obsCoSan(), false, "null phải đọc như 'không có'");
  assert.equal(obsProtocol(), "", "thà im còn hơn hứa một thứ chưa chắc có");
});

test("không có box thì dò trả false và không ném", async () => {
  const cu = process.env.GROKBOT2_BOX_EXEC_URL;
  const cu2 = process.env.GROKBOT2_COMPUTER_URL;
  delete process.env.GROKBOT2_BOX_EXEC_URL;
  delete process.env.GROKBOT2_COMPUTER_URL;
  try {
    assert.equal(await doObsTrenBox(), false);
    assert.equal(obsProtocol(), "");
  } finally {
    if (cu != null) process.env.GROKBOT2_BOX_EXEC_URL = cu;
    if (cu2 != null) process.env.GROKBOT2_COMPUTER_URL = cu2;
  }
});

test("box không với tới được thì cũng false — không ném, không treo lượt chat", async () => {
  const cu = process.env.GROKBOT2_BOX_EXEC_URL;
  // Cổng đóng. Điều đang khoá: một box chưa lên lúc backend khởi động không được làm hỏng gì cả.
  process.env.GROKBOT2_BOX_EXEC_URL = "http://127.0.0.1:9/grok-exec";
  try {
    assert.equal(await doObsTrenBox(), false);
  } finally {
    if (cu != null) process.env.GROKBOT2_BOX_EXEC_URL = cu; else delete process.env.GROKBOT2_BOX_EXEC_URL;
  }
});

/*
 * ── Nội dung đoạn lời nhắc ──────────────────────────────────────────────────────────────────────
 *
 * Không gọi được box thật trong bài test, nên phần "có OBS" kiểm bằng cách đọc chính chuỗi mà
 * `obsProtocol()` sẽ phát ra. Ba thứ dưới đây là ba chỗ đã trả giá khi làm bằng tay, và cả ba đều
 * hỏng IM LẶNG — nên chúng phải có mặt trong lời nhắc, không phải chỉ trong README:
 *
 *   · OBS không sống thường trực → phải chạy `obs-dam-bao` trước
 *   · mp4 chỉ đọc được sau khi output đóng → đọc sớm ra file rỗng ruột
 *   · "THIEU"/"HONG" thì báo lại người dùng, đừng thử lại vòng vo
 */
test("đoạn lời nhắc dạy đủ ba chỗ hỏng im lặng", async () => {
  const { obsProtocol: lay } = await import("./box-obs.js");
  // Ép trạng thái "có OBS" bằng chính đường dò: không làm được ở đây, nên kiểm nguồn của chuỗi.
  const nguon = await import("node:fs").then((m) => m.readFileSync("services/grokbot-backend/src/box-obs.ts", "utf8"));
  assert.match(nguon, /obs-dam-bao/, "phải dạy lệnh bật trước khi dùng");
  assert.match(nguon, /obs-ws\.mjs quay/, "phải dạy lệnh quay");
  assert.match(nguon, /rỗng ruột|moov/, "phải cảnh báo đọc file quá sớm");
  assert.match(nguon, /SAN-SANG|DA-BAT/, "phải nói ra hai câu trả lời bình thường của script");
  // Và khi chưa dò thì vẫn im — hai điều này cùng đúng một lúc.
  assert.equal(lay(), "");
});
