/**
 * Nhóm (7.4.2) — phần thuần của luật phòng chung: ai được kéo ai vào phòng.
 *
 *   npx tsx --test services/grokbot-backend/src/groups.test.ts
 *
 * Đối chiếu app gốc 0.29 (docs/extracted/chat-goc-0.29.md): nhóm là một AgentRecord mang
 * `isGroup` + `memberIds`, author của mỗi lời nói là `{id, name}` của THÀNH VIÊN. Luật lượt nói
 * (tuần tự, bot không kích hoạt bot) nằm trong sendPrompt và kiểm bằng E2E — ở đây chỉ kiểm
 * phần ranh giới sở hữu, vì `memberAgentIds` đến từ client và một id lạ lọt vào là kéo bot
 * của NGƯỜI KHÁC vào phòng của mình.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, createGroup, setGroupMembers } = await import("./directory/index.js");

const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";

const botA1 = as(A, () => createAgent({ name: "Kho" }));
const botA2 = as(A, () => createAgent({ name: "Ads" }));
const botB1 = as(B, () => createAgent({ name: "Cua B" }));

test("tạo nhóm: chỉ nhận thành viên MÌNH sở hữu, id lạ rơi ra ngoài", () => {
  const g = as(A, () => createGroup({ name: "Shopee Ops", memberAgentIds: [botA1.id, botA2.id, botB1.id, "khong-ton-tai"] }));
  assert.equal(g.isGroup, true);
  assert.deepEqual(g.memberIds, [botA1.id, botA2.id], "bot của B và id ma không được vào phòng của A");
});

test("đổi thành viên: người khác gọi vào nhóm không phải của mình thì nhận null", () => {
  const g = as(A, () => createGroup({ name: "Phong A", memberAgentIds: [botA1.id] }));
  assert.equal(as(B, () => setGroupMembers({ id: g.id, memberAgentIds: [botB1.id] })), null);
  // Và danh sách của A không suy suyển.
  assert.deepEqual(g.memberIds, [botA1.id]);
});

test("nhóm không tự chứa chính nó — fan-out sẽ đệ quy vô hạn", () => {
  const g = as(A, () => createGroup({ name: "Vong lap" }));
  const after = as(A, () => setGroupMembers({ id: g.id, memberAgentIds: [g.id, botA1.id] }));
  assert.deepEqual(after?.memberIds, [botA1.id], "id của chính nhóm phải bị loại");
});

test("thành viên trùng chỉ tính một lần — không ai được nói hai lượt", () => {
  const g = as(A, () => createGroup({ name: "Trung", memberAgentIds: [botA1.id, botA1.id, botA2.id] }));
  assert.deepEqual(g.memberIds, [botA1.id, botA2.id]);
});
