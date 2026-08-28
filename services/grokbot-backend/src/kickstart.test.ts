/**
 * Lời tự giới thiệu lúc tạo bot — và cái bẫy `=== false`.
 *
 *   npx tsx --test services/grokbot-backend/src/kickstart.test.ts
 *
 * Client 0.29 gỡ trạng thái "đang chờ tin đầu" bằng đúng phép so sánh này:
 *
 *     R?.isIntroductionInFlight === false && ( … clearAwaitingFirstMessage(N) )
 *
 * Không phải falsy — **đúng bằng `false`**. `kickstartAgent` từng chỉ `rec.unread = false; return rec`,
 * tức trả record không mang trường đó, nên `undefined === false` sai và trạng thái chờ không bao giờ
 * gỡ: mọi bot mới kẹt vĩnh viễn trong "awaiting first message". Không lỗi, không log — chỉ một cái
 * spinner không tắt.
 *
 * Nên bài này khoá CẢ HAI vế, và vế `false` quan trọng ngang vế `true`: trả `true` rồi không mở lượt
 * nào cũng treo client y hệt, chỉ khác cái cớ.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, kickstartAgent } = await import("./directory/index.js");
const { transcripts, nextEntryId, authorOf } = await import("./chat/state.js");
await import("./runtime/turn.js");   // nạp để `bindIntroduce` chạy

const OWNER = "local|kickstart@vi-du.vn";

test("bot mới, bản ghi trống → isIntroductionInFlight === true", () => {
  const a = as(OWNER, () => createAgent({ name: "Kho", description: "Lo tồn kho" }));
  const r = as(OWNER, () => kickstartAgent({ id: a.id }));
  assert.equal(r?.isIntroductionInFlight, true);
});

test("lời giới thiệu KHÔNG để lại tin đứng tên người dùng", () => {
  // Bản ghi là của người dùng và nó sống mãi. Một câu "hãy tự giới thiệu" đứng tên họ là lời họ
  // chưa từng nói — đó là lý do `sendPrompt` có cờ `silent`.
  const a = as(OWNER, () => createAgent({ name: "Sach", description: "abc" }));
  as(OWNER, () => kickstartAgent({ id: a.id }));
  const cuaNguoi = (transcripts.get(a.id) ?? []).filter((e) => e.kind === "message" && e.role === "user");
  assert.equal(cuaNguoi.length, 0, `bản ghi mọc ${cuaNguoi.length} tin người dùng`);
});

test("bản ghi đã có nội dung → false, KHÔNG chèn lời chào vào giữa câu chuyện", () => {
  const a = as(OWNER, () => createAgent({ name: "Dang noi" }));
  transcripts.get(a.id)?.push({
    id: nextEntryId(), kind: "message", role: "user", content: "chào bạn", timestampMs: Date.now(),
  } as never);
  const truoc = (transcripts.get(a.id) ?? []).length;
  const r = as(OWNER, () => kickstartAgent({ id: a.id }));
  assert.equal(r?.isIntroductionInFlight, false, "phải là false ĐÚNG KIỂU để client rời trạng thái chờ");
  assert.equal((transcripts.get(a.id) ?? []).length, truoc, "không được đụng vào bản ghi đang có");
});

test("trường phải là boolean thật, không phải undefined — đây là cả cái bug", () => {
  const a = as(OWNER, () => createAgent({ name: "Kieu" }));
  const r = as(OWNER, () => kickstartAgent({ id: a.id }));
  assert.equal(typeof r?.isIntroductionInFlight, "boolean",
    "undefined === false là SAI, và client sẽ chờ mãi");
});

test("bot không tồn tại / không thuộc mình → null, không nổ", () => {
  assert.equal(as(OWNER, () => kickstartAgent({ id: "khong-co" })), null);
  assert.equal(as(OWNER, () => kickstartAgent({})), null);
  const cua_nguoi_khac = as("local|ai-do@vi-du.vn", () => createAgent({ name: "Rieng" }));
  assert.equal(as(OWNER, () => kickstartAgent({ id: cua_nguoi_khac.id })), null);
});
