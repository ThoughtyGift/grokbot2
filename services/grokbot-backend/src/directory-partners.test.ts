/**
 * `conversationPartnerIds` — cạnh LIỀN trong đồ thị bot của app.
 *
 *   npx tsx --test services/grokbot-backend/src/directory-partners.test.ts
 *
 * App 0.29 vẽ một đồ thị bot và tự mô tả bằng lời của nó:
 *
 *     "Bots and groups, linked by who has messaged whom (solid) and group membership (dashed)."
 *
 * Cạnh đứt lấy từ `memberIds`, cạnh liền lấy từ trường này. Backend ta hardcode `[]`, nên đồ thị
 * nói rằng chưa con bot nào từng nhắn cho con nào — sai mà trông y như dữ liệu thật.
 *
 * Bài này khoá lại ba điều, và điều thứ ba là chỗ dễ làm hỏng nhất khi ai đó tối ưu về sau.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, listAgents, deleteAgents } = await import("./directory/index.js");
const { transcripts, nextEntryId, authorOf } = await import("./chat/state.js");

const OWNER = "local|do-thi@vi-du.vn";
const rowOf = (id: string) => listAgents().find((r) => r.id === id);

/** Một tin bot→bot trong bản ghi của `from`, mang `toAgent`. */
function nhan(fromId: string, to: { id: string; name: string }): void {
  transcripts.get(fromId)?.push({
    id: nextEntryId(), kind: "message", role: "assistant", content: "gửi bạn nhé",
    timestampMs: Date.now(), author: authorOf(fromId),
    toAgent: { id: to.id, name: to.name, kind: "agent" },
  } as never);
}

test("bot đã nhắn cho bot khác thì hiện thành cạnh liền", () => {
  const a = as(OWNER, () => createAgent({ name: "Kho" }));
  const b = as(OWNER, () => createAgent({ name: "Ads" }));
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [], "chưa nhắn thì chưa có cạnh");
  nhan(a.id, b);
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [b.id]);
});

test("nhắn mười lần vẫn MỘT cạnh — đồ thị không được vẽ chồng", () => {
  const a = as(OWNER, () => createAgent({ name: "Kho2" }));
  const b = as(OWNER, () => createAgent({ name: "Ads2" }));
  for (let i = 0; i < 10; i += 1) nhan(a.id, b);
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [b.id]);
});

test("bot đã bị xoá KHÔNG để lại cạnh trỏ vào hư không", () => {
  // App cho bấm vào một node để mở nó ("Click a node to open it"). Một cạnh trỏ tới bot đã xoá là
  // một cú bấm mở ra trang trống — nên phải lọc theo roster hiện tại, không chỉ theo bản ghi cũ.
  const a = as(OWNER, () => createAgent({ name: "Con lai" }));
  const b = as(OWNER, () => createAgent({ name: "Se bi xoa" }));
  nhan(a.id, b);
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [b.id]);
  as(OWNER, () => deleteAgents({ id: b.id }));
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [],
    "bot đã xoá phải biến mất khỏi đồ thị");
});

test("nhớ tạm phải hết hạn khi bản ghi dài thêm", () => {
  // Nhớ tạm khoá theo ĐỘ DÀI bản ghi. Nếu ai đó đổi sang khoá theo agentId thôi, bài này đỏ:
  // cạnh thứ hai sẽ không bao giờ xuất hiện.
  const a = as(OWNER, () => createAgent({ name: "Nho tam" }));
  const b = as(OWNER, () => createAgent({ name: "Ban 1" }));
  const c = as(OWNER, () => createAgent({ name: "Ban 2" }));
  nhan(a.id, b);
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [b.id]);
  nhan(a.id, c);
  assert.deepEqual(as(OWNER, () => rowOf(a.id))?.conversationPartnerIds, [b.id, c.id],
    "cạnh mới phải hiện ngay, nhớ tạm không được giữ đáp án cũ");
});
