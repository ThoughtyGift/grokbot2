/**
 * Bốn nút từng chết lặng trên thẻ: Gửi / Bỏ bản nháp, và Gửi / Bỏ biểu mẫu.
 *
 *   npx tsx --test services/grokbot-backend/src/draft-form.test.ts
 *
 * Vì sao có bài này: client 0.29 vẽ thẻ nháp (`case"email-draft":` trong renderer) và backend này
 * CÓ phát thẻ đó (`email_draft`/`slack_draft`), nhưng hai nút trên thẻ gọi vào `sendDraft` /
 * `discardDraft` — hai lệnh gateway không có. Router trả 404 mềm, nên bấm không ra gì và không ai
 * biết. Bài này khoá lại cả bốn, kèm hai điều dễ làm sai:
 *
 *   - `sendDraft` KHÔNG được trả thành công: máy chủ này không có đường gửi thư nào.
 *   - `submitUserForm` KHÔNG được ghi giá trị người dùng gõ vào bản ghi hội thoại — đó có thể là
 *     mật khẩu hoặc khoá API, và bản ghi thì sống mãi.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { sendDraft, discardDraft, submitUserForm, dismissUserForm } = await import("./runtime/turn.js");
const { transcripts, nextEntryId, authorOf } = await import("./chat/state.js");

const OWNER = "local|nguoi-a@vi-du.vn";

/** Đặt một thẻ nháp vào hội thoại, trả về {agentId, entryId}. */
function putDraft(): { agentId: string; entryId: string } {
  const a = as(OWNER, () => createAgent({ name: "Thu ky" }));
  const id = nextEntryId();
  transcripts.get(a.id)?.push({
    id, kind: "send-message", author: authorOf(a.id), timestampMs: Date.now(),
    message: { type: "email-draft", draft: { to: ["ai@do.vn"], subject: "Chào", body: "Nội dung" } },
  });
  return { agentId: a.id, entryId: id };
}

test("Bỏ bản nháp: thẻ biến mất khỏi hội thoại", () => {
  const { agentId, entryId } = putDraft();
  assert.equal(discardDraft({ entryId, agentId }).ok, true);
  assert.equal(transcripts.get(agentId)?.some((e) => e.id === entryId), false, "thẻ phải mất");
});

test("Bỏ bản nháp: id không tồn tại thì trả ok:false, không nổ", () => {
  const { agentId } = putDraft();
  assert.equal(discardDraft({ entryId: "khong-co", agentId }).ok, false);
});

test("Bỏ bản nháp chỉ đụng THẺ NHÁP — không xoá nhầm entry khác", () => {
  const a = as(OWNER, () => createAgent({ name: "Khac" }));
  const id = nextEntryId();
  transcripts.get(a.id)?.push({ id, kind: "message", role: "user", content: "tin thường", timestampMs: Date.now() });
  assert.equal(discardDraft({ entryId: id, agentId: a.id }).ok, false);
  assert.equal(transcripts.get(a.id)?.some((e) => e.id === id), true, "tin thường phải còn nguyên");
});

test("Gửi bản nháp: TỪ CHỐI, và nói rõ vì sao — không có đường gửi nào", () => {
  const { agentId, entryId } = putDraft();
  const r = sendDraft({ entryId, agentId });
  // Nếu một ngày ai đó cho cái này trả ok:true mà chưa nối hộp thư, bài này phải đỏ: nói "đã gửi"
  // khi chưa gửi là lời nói dối đúng chỗ người dùng tin nhất.
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NO_TRANSPORT");
  assert.match(r.message, /Chưa gửi được/);
  // Bản nháp phải CÒN lại để người dùng copy đi gửi tay.
  assert.equal(transcripts.get(agentId)?.some((e) => e.id === entryId), true, "nháp không được mất khi gửi hụt");
  // Và người dùng phải thấy lý do trong hội thoại, không phải im lặng.
  const last = transcripts.get(agentId)?.at(-1);
  assert.equal(last?.kind === "send-message" && last.message.type === "text", true);
});

test("Biểu mẫu: KHÔNG ghi giá trị người dùng gõ vào bản ghi — chỉ ghi tên ô", () => {
  const a = as(OWNER, () => createAgent({ name: "Form" }));
  const id = nextEntryId();
  transcripts.get(a.id)?.push({
    id, kind: "send-message", author: authorOf(a.id), timestampMs: Date.now(),
    message: { type: "text", content: "(chỗ của thẻ form)" },
  });
  submitUserForm({ entryId: id, agentId: a.id, values: { PARTNER_ID: "123", PARTNER_KEY: "sieu-bi-mat" } });
  const dump = JSON.stringify(transcripts.get(a.id));
  assert.equal(dump.includes("sieu-bi-mat"), false, "giá trị bí mật KHÔNG được nằm trong transcript");
  assert.equal(dump.includes("PARTNER_KEY"), true, "tên ô thì được, để người dùng biết đã điền gì");
});

test("Biểu mẫu: không có entry thì trả null, không phải 404 hay {}", () => {
  const a = as(OWNER, () => createAgent({ name: "Trong" }));
  assert.equal(submitUserForm({ entryId: "khong-co", agentId: a.id }), null);
  assert.equal(dismissUserForm({ entryId: "khong-co", agentId: a.id }), null);
});

test("Bỏ biểu mẫu: đánh dấu đã bỏ trên chính entry", () => {
  const a = as(OWNER, () => createAgent({ name: "Bo" }));
  const id = nextEntryId();
  transcripts.get(a.id)?.push({
    id, kind: "send-message", author: authorOf(a.id), timestampMs: Date.now(),
    message: { type: "text", content: "x" },
  });
  const e = dismissUserForm({ entryId: id, agentId: a.id, mode: "dismissed" });
  assert.equal(e?.kind === "send-message" && e.widgetDismissed, true);
});
