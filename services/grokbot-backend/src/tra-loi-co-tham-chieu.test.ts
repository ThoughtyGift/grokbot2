/**
 * Trả lời CÓ THAM CHIẾU — bot nối câu trả lời vào đúng tin người dùng đã bấm reply.
 *
 *   npx tsx --test services/grokbot-backend/src/tra-loi-co-tham-chieu.test.ts
 *
 * ── Vì sao bài này tồn tại ──────────────────────────────────────────────────────────────────────
 *
 * Đo 01/09 trên bản ghi thật: 748 entry, **0 entry của bot** mang `replyTo`. Kiểu dữ liệu có sẵn
 * trường ấy — `send-message` khai báo nó và `native-map.ts` phát nó ra — nhưng không chỗ nào ĐẶT.
 * Đúng họ với bẫy `awaitingUserResponse`: khai báo đủ, phát đủ, không ai gán.
 *
 * Hậu quả nhìn thấy được: app gốc vẽ trích dẫn phía trên MỌI tin trong luồng (ảnh người dùng gửi:
 * cả tin họ lẫn tin bot đều dẫn lại cùng một câu hỏi), còn bot ta trả lời trôi giữa dòng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, transcripts, tail } from "./chat/state.js";
import { sendPrompt } from "./runtime/turn.js";

let dem = 0;
const botThu = (): string => {
  const id = `agent-reply-${(dem += 1)}-${Math.random().toString(36).slice(2, 6)}`;
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
  return id;
};

test("người dùng bấm reply → câu trả lời của bot nối vào ĐÚNG tin đó", () => {
  const a = botThu();
  // Một tin của bot để trả lời vào.
  const goc = { id: "e-goc", kind: "send-message", author: { id: a, name: "bot" },
    message: { type: "text", content: "Muốn nối connector nào?" }, timestampMs: Date.now() };
  tail(a).push(goc as never);

  sendPrompt({ agentId: a, content: "Jira", replyToEntryId: "e-goc" } as never);

  const ds = tail(a);
  const tinNguoi = ds.find((e) => e.kind === "message" && (e as { role?: string }).role === "user");
  const tinBot = ds.filter((e) => e.kind === "send-message" && e.id !== "e-goc");
  assert.ok(tinNguoi, "phải có tin người dùng");
  assert.equal((tinNguoi as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc");
  assert.ok(tinBot.length > 0, "lượt phải dựng một bubble cho bot");
  // Đây là dòng khoá cái đã thiếu suốt: bot cũng phải mang tham chiếu, không chỉ người dùng.
  assert.equal((tinBot[0] as { replyTo?: { entryId: string } }).replyTo?.entryId, "e-goc",
    "bot trả lời vào tin gốc, đúng như app gốc vẽ trích dẫn trên mọi tin trong luồng");
});

test("không bấm reply thì KHÔNG gắn gì — tin thường vẫn là tin thường", () => {
  const a = botThu();
  sendPrompt({ agentId: a, content: "chào" } as never);
  for (const e of tail(a)) {
    assert.equal((e as { replyTo?: unknown }).replyTo, undefined,
      "gắn tham chiếu vào tin không ai trả lời là vẽ thừa một khung trích dẫn rỗng nghĩa");
  }
});

test("id không tra được thì bỏ qua, không mất lượt", () => {
  const a = botThu();
  // Cửa sổ bản ghi FE chỉ 150 entry; một id cũ hơn thế là chuyện bình thường, không phải lỗi.
  sendPrompt({ agentId: a, content: "hỏi tiếp", replyToEntryId: "e-khong-ton-tai" } as never);
  const tinNguoi = tail(a).find((e) => e.kind === "message");
  assert.ok(tinNguoi, "lượt vẫn phải chạy");
  assert.equal((tinNguoi as { replyTo?: unknown }).replyTo, undefined);
});
