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
const { createAgent, createGroup, setGroupMembers, listAgents } = await import("./directory/index.js");

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

test("roster row của nhóm phải mang isGroup + memberIds — summarise từng đè false", () => {
  const g = as(A, () => createGroup({ name: "Row That", memberAgentIds: [botA1.id] }));
  const row = as(A, () => listAgents().find((r) => r.id === g.id));
  // Sidebar vẽ nhóm bằng `n.isGroup` + `rows.find(...).memberIds` — row nói dối là app vẽ sai.
  assert.equal(row?.isGroup, true, JSON.stringify(row));
  assert.deepEqual(row?.memberIds, [botA1.id]);
});

/*
 * ── Gọi tên ai thì người đó nói ────────────────────────────────────────────────────────────────
 *
 * Luật của TA (không phải bản chép của hãng — thuật toán của họ chạy server-side Temporal, xem
 * docs/extracted/0-29-mapping.md §0.3). Bài quan trọng nhất là ca biên chữ: tên "Kho" nằm trong
 * chữ "không" mà tính là được gọi thì cả phòng im, chỉ mình Kho nói — hỏng đúng theo cách khó thấy.
 */
const { namedMembers } = await import("./runtime/turn.js");

const kho = as(A, () => createAgent({ name: "Kho" }));
const ads = as(A, () => createAgent({ name: "Ads" }));
const ketoan = as(A, () => createAgent({ name: "Kế toán" }));
const room = [kho.id, ads.id, ketoan.id];

test("gọi đích danh một người thì chỉ người đó", () => {
  assert.deepEqual(namedMembers("Kho ơi còn bao nhiêu đơn?", room), [kho.id]);
});

test("tên nằm TRONG chữ khác thì KHÔNG tính — 'Kho' trong 'không'", () => {
  assert.deepEqual(namedMembers("không ai trả lời à", room), []);
  assert.deepEqual(namedMembers("khoan đã", room), []);
});

test("gọi nhiều người thì nhiều người nói, giữ thứ tự phòng", () => {
  assert.deepEqual(namedMembers("Ads với Kho vào xem giúp", room), [kho.id, ads.id]);
});

test("tên có dấu và có khoảng trắng vẫn nhận ra", () => {
  assert.deepEqual(namedMembers("Kế toán chốt số giúp mình", room), [ketoan.id]);
});

test("không gọi ai thì rỗng — nghĩa là cả phòng nói", () => {
  assert.deepEqual(namedMembers("chào cả nhà, ai rảnh không", room), []);
});

test("không phân biệt hoa thường, và @tên cũng tính", () => {
  assert.deepEqual(namedMembers("@ads pause giúp", room), [ads.id]);
  assert.deepEqual(namedMembers("KHO ơi", room), [kho.id]);
});
