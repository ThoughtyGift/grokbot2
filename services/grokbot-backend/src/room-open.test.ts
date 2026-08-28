/**
 * Ai mở được một vòng nói trong phòng.
 *
 *   npx tsx --test services/grokbot-backend/src/room-open.test.ts
 *
 * ── Vì sao ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Lượt E2E 28/08 dựng ra nhóm `Vận Hành Shopee` với 4 thành viên rồi **để đó**: bản ghi phòng 0
 * entry, roster 0 cạnh bot-nhắn-bot. Nguyên nhân không phải model lười — `messageAgent` gửi kèm
 * `fromAgent`, mà fan-out lại tắt khi có `fromAgent`, nên một con bot **không thể mở phòng**.
 *
 * Tôi đã thêm luật "dựng đội xong thì mở phòng bằng việc đầu tiên" vào lời nhắc mà không kiểm
 * runtime có cho phép không. Nó không cho. Bài này khoá lại đúng ranh giới sau khi sửa:
 *
 *   bot NGOÀI phòng nói vào  → mở một vòng (giống hệt người dùng nói)
 *   THÀNH VIÊN nói           → KHÔNG kích hoạt ai (đây mới là chỗ sinh vòng lặp)
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, createGroup } = await import("./directory/index.js");
const { messageAgent } = await import("./runtime/turn.js");
const { transcripts } = await import("./chat/state.js");

const OWNER = "local|phong@vi-du.vn";
const nghi = () => new Promise((r) => setTimeout(r, 60));

/** Đội: 2 thành viên + 1 con đứng ngoài làm người dựng. */
function doi() {
  return as(OWNER, () => {
    const a = createAgent({ name: "Kho", description: "lo tồn kho" });
    const b = createAgent({ name: "Ads", description: "lo quảng cáo" });
    const lead = createAgent({ name: "Lead", description: "dựng đội" });
    const g = createGroup({ name: "Phong Ops", memberAgentIds: [a.id, b.id] });
    return { a, b, lead, g };
  });
}

/** Số entry trong phòng do THÀNH VIÊN đứng tên. */
const luotThanhVien = (groupId: string, memberIds: string[]): number =>
  (transcripts.get(groupId) ?? []).filter((e) => {
    const au = (e as { author?: { id?: string } }).author?.id;
    return au != null && memberIds.includes(au);
  }).length;

test("bot NGOÀI phòng mở được một vòng — thành viên lên tiếng", async () => {
  const { a, b, lead, g } = doi();
  assert.equal((transcripts.get(g.id) ?? []).length, 0, "phòng phải rỗng lúc đầu");
  as(OWNER, () => messageAgent(lead.id, g.id, "Chào cả nhà, việc đầu tiên là gì?"));
  await nghi();
  assert.ok(luotThanhVien(g.id, [a.id, b.id]) > 0,
    "thành viên phải có lượt nói; 0 nghĩa là fan-out vẫn tắt và phòng lại bị bỏ hoang");
});

test("THÀNH VIÊN nói thì KHÔNG kích hoạt các thành viên khác", async () => {
  const { a, b, g } = doi();
  as(OWNER, () => messageAgent(a.id, g.id, "mình xong phần kho rồi"));
  await nghi();
  // Chỉ được có tin của chính `a` đi vào phòng, không có lượt nào của `b`.
  const cuaB = (transcripts.get(g.id) ?? []).filter((e) => (e as { author?: { id?: string } }).author?.id === b.id);
  assert.equal(cuaB.length, 0,
    "thành viên trả lời mà kích hoạt thành viên khác là đúng công thức vòng lặp vô hạn");
});

test("người dùng nói trong phòng vẫn mở vòng như cũ", async () => {
  const { a, b, g } = doi();
  const { sendPrompt } = await import("./runtime/turn.js");
  as(OWNER, () => sendPrompt({ agentId: g.id, content: "cả nhà cho mình xin trạng thái" }));
  await nghi();
  assert.ok(luotThanhVien(g.id, [a.id, b.id]) > 0, "bản vá không được làm hỏng đường của người dùng");
});
