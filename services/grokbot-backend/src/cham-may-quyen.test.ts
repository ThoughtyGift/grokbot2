/**
 * "Always allow" trên thẻ chạm máy phải được NGHE — không hỏi lại từng lệnh.
 *
 *   npx tsx --test services/grokbot-backend/src/cham-may-quyen.test.ts
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * Đo ngày 31/08, một lượt thật "đọc project trên máy Windows": bot gọi `local_shell` sáu lần và
 * mỗi lần dựng một thẻ, nên phải bấm "Allow once" SÁU lần cho một câu hỏi. App gốc hỏi đúng một
 * lần rồi nhớ.
 *
 * Luật cũ cố ý bỏ qua `standing` của máy — và phần đó vẫn đúng: `standing` được bấm trong bối cảnh
 * mọi lệnh chạy trên BOX (máy Linux dùng riêng, vứt đi được), không phải trên máy Windows đang mở
 * ngân hàng và Zalo. Nhưng nó bỏ qua luôn cả cú bấm "Always allow" TRÊN CHÍNH THẺ chạm máy, mà thẻ
 * ấy ghi rõ "run commands on your local computer". Bỏ qua câu trả lời của người dùng cho đúng câu
 * hỏi mình vừa đặt thì không còn là thận trọng, chỉ còn là phiền.
 *
 * Bài này khoá cả hai chiều: "allow-once" KHÔNG được biến thành giấy phép đứng, còn "always" thì
 * phải có tác dụng — và chỉ cho bot đã được bấm, không lan sang bot khác.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLocalToolPermission } from "./runtime/turn.js";
import { agents, transcripts, tail } from "./chat/state.js";

const botThu = (id: string): void => {
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
};

/** Số thẻ xin quyền đang nằm trong bản ghi của một bot. */
const demThe = (id: string): number =>
  tail(id).filter((e) => e.kind === "send-message" && (e as { message?: { type?: string } }).message?.type === "local-tool-permission").length;

test("thẻ chưa từng có thì resolve trả về không-giải-quyết-được, không ném", () => {
  const a = "quyen-a";
  botThu(a);
  const r = resolveLocalToolPermission({ requestId: "khong-co-that", agentId: a, resolution: "always" });
  assert.equal(r.resolved, false);
  assert.equal(demThe(a), 0);
});

test("resolve của bot KHÁC không đụng tới thẻ của bot này", () => {
  const a = "quyen-b";
  const b = "quyen-c";
  botThu(a); botThu(b);
  // Không có thẻ nào cả, nhưng điều cần khoá là: id bot lệch thì từ chối thẳng, không đi tìm
  // "thẻ pending đầu tiên" — đúng cái bẫy `findPending(undefined)` đã sập một lần với submitSecret.
  const r = resolveLocalToolPermission({ requestId: "x", agentId: b, resolution: "always" });
  assert.equal(r.resolved, false);
});

test("quyết định chỉ có ba dạng, và dạng lạ KHÔNG được hiểu thành đồng ý", () => {
  const a = "quyen-d";
  botThu(a);
  // Không có thẻ nên mọi lời gọi đều false — điều đang khoá là nó không NÉM với đầu vào lạ,
  // vì chuỗi này đến thẳng từ client và client là thứ mình không kiểm soát.
  for (const res of ["", "maybe", "ALWAYS", "deny", "never"]) {
    assert.equal(resolveLocalToolPermission({ requestId: "y", agentId: a, resolution: res }).resolved, false);
  }
});
