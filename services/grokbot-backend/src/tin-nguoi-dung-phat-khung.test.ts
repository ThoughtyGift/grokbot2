/**
 * Tin NGƯỜI DÙNG cũng phải phát khung SSE — thiếu nó, bong bóng của họ treo "Failed to send".
 *
 * Đo 08/09/2026, bot thử riêng, `sendPrompt` trả `200 {accepted:true, entryId:"e18262"}` và bản ghi có đủ hai entry,
 * nhưng SSE chỉ phát khung cho entry của BOT (`e18263`, seq 3) — **không khung nào cho `e18262`**. Mọi chỗ đăng entry
 * khác trong `turn.ts` đều gọi `onUpdate` ngay sau khi push; riêng entry của người dùng thì không.
 *
 * Vì sao im suốt nhiều tháng rồi bật lên: khi khung `transcript` CHƯA mang `ordered`, client coi mỗi khung là tiếng gõ
 * cửa rồi tự đi tải lại cả đuôi bản ghi — nên nó gặp entry của chính mình ở lượt tải kế và ghép được
 * `clientNonce`. Từ 06/09/2026 khung mang `ordered` (§6 mục 29) thì client áp `entry` thẳng và THÔI tải đuôi, và đường
 * ghép duy nhất ấy mất. Trên máy chủ dự án: ba hàng `nonce:<uuid>` treo trong pane, bot trả lời đủ mà màn hình đứng từ
 * 11:31, tải lại renderer lẫn bấm sang bot khác đều không cứu.
 *
 * `acceptance` KHÔNG phải đường thay thế: nó chờ composer hỏi lại, mà client 0.43 không gọi lệnh nào để hỏi — trong
 * `coverage.calls` lệnh duy nhất mang chữ "prompt" là `sendPrompt`. Đúng họ bẫy "trường có trong hợp đồng ≠ trường có
 * người ĐỌC": một cơ chế dựng cho không ai.
 *
 * Đọc MÃ NGUỒN như `luot-noi-tiep-bat-co-chay.test.ts`: `turn.ts` kéo cả pool lẫn box nên bài đo không được nạp nó.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nguon = readFileSync(new URL("./runtime/turn.ts", import.meta.url), "utf8");

test("entry của người dùng được push, rồi có onUpdate trước khối acceptance", () => {
  const iPush = nguon.indexOf("if (!args.silent) t.push(userEntry);");
  assert.ok(iPush >= 0, "không thấy chỗ push entry người dùng");
  const iAcc = nguon.indexOf("acceptance.set(args.clientNonce", iPush);
  assert.ok(iAcc > iPush, "không thấy khối acceptance sau chỗ push");

  const giua = nguon.slice(iPush, iAcc);
  assert.match(giua, /onUpdate\(agentId\)/,
    "giữa chỗ push entry người dùng và khối acceptance KHÔNG có onUpdate — khung SSE cho tin của họ sẽ không bao giờ đi");
});

test("khung chỉ phát khi bản ghi THẬT mọc thêm — `silent` không được đẻ khung", () => {
  const iPush = nguon.indexOf("if (!args.silent) t.push(userEntry);");
  const iAcc = nguon.indexOf("acceptance.set(args.clientNonce", iPush);
  const giua = nguon.slice(iPush, iAcc);
  const dong = giua.split("\n").find((l) => l.includes("onUpdate(agentId)"));
  assert.ok(dong, "không thấy dòng onUpdate");
  // `silent` là lời nhắc tới model mà bản ghi không mọc câu nào đứng tên người dùng: phát khung cho một entry
  // không tồn tại sẽ đẩy client tới entry CŨ và tiêu một số thứ tự cho không gì.
  assert.match(dong!, /!args\.silent/, "onUpdate phải bị chặn khi args.silent");
  assert.match(dong!, /t\.length\s*>/, "onUpdate phải kèm điều kiện bản ghi thật dài ra");
});

test("mốc so sánh: mọi chỗ đăng entry khác trong turn.ts đều gọi onUpdate", () => {
  // Ghim tính chất chung, để lần sau thêm một chỗ push mà quên onUpdate thì có một bài đo nói ra.
  const soPush = (nguon.match(/\bt\.push\(|tail\(agentId\)\.push\(|tail\(parentAgentId\)\.push\(/g) ?? []).length;
  const soUpdate = (nguon.match(/onUpdate\(/g) ?? []).length;
  assert.ok(soUpdate >= 10, `chỉ thấy ${soUpdate} lời gọi onUpdate — quá ít so với ${soPush} chỗ push`);
});
