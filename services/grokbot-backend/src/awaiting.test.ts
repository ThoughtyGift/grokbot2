/**
 * "Waiting for you: …" — chấm vàng trên hàng bot.
 *
 *   npx tsx --test services/grokbot-backend/src/awaiting.test.ts
 *
 * Renderer 0.29 quyết định bằng một dòng (`H4e`):
 *
 *     t.awaitingUserResponse != null ? marker = "blocked" : t.hasUnread && (marker = "unread")
 *
 * Nên trường này phải đi tới FE nguyên vẹn, và phải TẮT khi người dùng đã trả lời. Bài này khoá vế
 * thứ hai — vế dễ quên nhất: đặt một cờ trạng thái thì ai cũng nhớ, xoá nó thì không, và một chấm
 * vàng không bao giờ tắt còn tệ hơn không có chấm nào (nó nói bot đang chặn trong khi nó rảnh).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent, listAgents, setPresence } = await import("./directory/index.js");
const { sendPrompt } = await import("./runtime/turn.js");

const OWNER = "local|cho@vi-du.vn";
const row = (id: string) => as(OWNER, () => listAgents().find((r) => r.id === id));

test("roster chở nguyên hình dạng {reason} FE đọc", () => {
  const a = as(OWNER, () => createAgent({ name: "Cho" }));
  setPresence(a.id, { awaitingUserResponse: { reason: "Đăng nhập Shopee Seller Centre" } });
  const got = row(a.id)?.awaitingUserResponse as { reason?: string } | null;
  assert.equal(got?.reason, "Đăng nhập Shopee Seller Centre");
});

test("người dùng nhắn → chấm vàng TẮT", () => {
  const a = as(OWNER, () => createAgent({ name: "Cho 2" }));
  setPresence(a.id, { awaitingUserResponse: { reason: "đăng nhập giúp mình" } });
  assert.notEqual(row(a.id)?.awaitingUserResponse, null, "dựng bối cảnh: phải đang chờ");
  as(OWNER, () => sendPrompt({ agentId: a.id, content: "xong rồi nhé" }));
  assert.equal(row(a.id)?.awaitingUserResponse, null,
    "trả lời rồi mà chấm vàng còn nguyên thì nó nói dối về trạng thái bot");
});

test("tin từ BOT khác KHÔNG tắt chấm vàng — người mới gỡ được", () => {
  // Bot đang chờ NGƯỜI đăng nhập; một đồng đội nhắn sang không làm việc đó xong hộ.
  const a = as(OWNER, () => createAgent({ name: "Cho 3" }));
  setPresence(a.id, { awaitingUserResponse: { reason: "đăng nhập giúp mình" } });
  as(OWNER, () => sendPrompt({ agentId: a.id, content: "cho mình xin số", fromAgent: { id: "agent-x", name: "Ads" } }));
  assert.notEqual(row(a.id)?.awaitingUserResponse, null);
});
