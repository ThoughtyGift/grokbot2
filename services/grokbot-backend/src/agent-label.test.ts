/**
 * Ô "Label" trong Settings của bot — app gốc gọi trường này là `title`.
 *
 *   npx tsx --test services/grokbot-backend/src/agent-label.test.ts
 *
 * Renderer chỉ DỰNG ô đó khi trường tồn tại: `mq(t) = !t.isGroup && t.title !== void 0`, còn ô nhập
 * lấy `initialValue: n.title` với placeholder "Research, marketing, admin" (`Pqtvzz`). Đặt hai ảnh
 * Settings cạnh nhau thấy ngay: app gốc có Name / Label / Description, ta chỉ có Name / Description.
 *
 * Nên bài này khoá đúng một điều dễ làm hỏng: roster phải mang `title` KỂ CẢ khi rỗng. Bỏ trống
 * (`undefined`) là ô biến mất — tức đúng tình trạng cũ, chỉ khác là ta tưởng đã làm.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, createGroup, listAgents, updateAgent } = await import("./directory/index.js");

const OWNER = "local|label@vi-du.vn";
const row = (id: string) => as(OWNER, () => listAgents().find((r) => r.id === id));

test("bot mới có title = chuỗi rỗng, KHÔNG phải undefined", () => {
  const a = as(OWNER, () => createAgent({ name: "Chua dat label" }));
  const r = row(a.id) as { title?: unknown } | undefined;
  assert.equal(typeof r?.title, "string",
    "undefined làm renderer ẩn hẳn ô Label — đúng tình trạng cũ");
  assert.equal(r?.title, "");
});

test("đặt được Label và đọc lại qua roster", () => {
  const a = as(OWNER, () => createAgent({ name: "Co label" }));
  as(OWNER, () => updateAgent({ id: a.id, title: "Research, marketing, admin" }));
  assert.equal((row(a.id) as { title?: string } | undefined)?.title, "Research, marketing, admin");
});

test("client gửi kèm trong profile cũng nhận", () => {
  // Client 0.29 gói name/description vào `profile`; Label đi cùng đường đó.
  const a = as(OWNER, () => createAgent({ name: "Qua profile" }));
  as(OWNER, () => updateAgent({ id: a.id, profile: { title: "Ops" } }));
  assert.equal((row(a.id) as { title?: string } | undefined)?.title, "Ops");
});

test("sửa Label KHÔNG đụng tên hay mô tả", () => {
  const a = as(OWNER, () => createAgent({ name: "Giu nguyen", description: "mô tả gốc" }));
  as(OWNER, () => updateAgent({ id: a.id, title: "X" }));
  const r = row(a.id) as { name?: string; description?: string } | undefined;
  assert.equal(r?.name, "Giu nguyen");
  assert.equal(r?.description, "mô tả gốc");
});

test("NHÓM cũng mang title — renderer tự ẩn ô bằng !isGroup, backend không cần đoán hộ", () => {
  const m = as(OWNER, () => createAgent({ name: "Thanh vien" }));
  const g = as(OWNER, () => createGroup({ name: "Phong", memberAgentIds: [m.id] }));
  assert.equal(typeof (row(g.id) as { title?: unknown } | undefined)?.title, "string");
});
