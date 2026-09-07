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

// ── Ba khoá, không phải một ────────────────────────────────────────────────────────────────────
//
// Ba bài trên ghim thứ RENDERER đọc (`!= null` là đủ). Ba bài dưới ghim thứ MÁY KIỂM đọc: schema
// 0.43 `SandAgentAwaitingState` đòi `required:["reason","since","tabId"]` + `additionalProperties:
// false`, và coordinator coi reply trượt schema là LỆNH HỎNG — nên thiếu `since` là sidebar không
// vẽ được, dù HTTP 200 và dù chấm vàng đúng. Đo 07/09 trên hai bot thật của người dùng.
//
// Vì sao bài này đáng có: lỗi chỉ hiện khi CÓ bot đang chờ, nên `kiem-reply-0-43` xanh 29/29 hôm
// 06/09 mà không chứng minh gì. Một bài đo chỉ chạy qua nhánh có dữ liệu mới nói được điều gì.

const { agents } = await import("./chat/state.js");

test("setPresence tự hoàn thiện đủ ba khoá — schema 0.43 đòi since và tabId", () => {
  const a = as(OWNER, () => createAgent({ name: "Cho 4" }));
  const truoc = Date.now();
  setPresence(a.id, { awaitingUserResponse: { reason: "Mở file nào trước?" } });
  const got = row(a.id)?.awaitingUserResponse as Record<string, unknown> | null;
  assert.deepEqual(Object.keys(got ?? {}).sort(), ["reason", "since", "tabId"]);
  assert.equal(got?.reason, "Mở file nào trước?");
  assert.equal(typeof got?.since, "number");
  assert.ok((got?.since as number) >= truoc, "since là giờ ĐẶT, không phải một hằng số");
  assert.equal(got?.tabId, "", "không có tab thì để rỗng — bịa một id là bịa dữ liệu");
});

test("mốc chờ ĐỨNG YÊN qua nhiều lượt đọc roster", () => {
  // Tính lại lúc đọc thì mỗi nhịp client hỏi roster là mốc nhảy về hiện tại, và "chờ 2 tiếng" của
  // người dùng vĩnh viễn hiện thành "vừa xong".
  const a = as(OWNER, () => createAgent({ name: "Cho 5" }));
  setPresence(a.id, { awaitingUserResponse: { reason: "Đọc file nào trước?" } });
  const lan1 = (row(a.id)?.awaitingUserResponse as { since: number }).since;
  const lan2 = (row(a.id)?.awaitingUserResponse as { since: number }).since;
  assert.equal(lan1, lan2);
});

test("bản ghi CŨ trên đĩa chỉ có {reason} vẫn ra dây đủ ba khoá", () => {
  // Bản ghi ghi trước 07/09 không tự sửa cho tới lần `setPresence` kế tiếp — mà lần kế tiếp của một
  // bot đang đứng chờ có thể là ngày mai. Nên cửa DÂY phải hoàn thiện lại, và mốc lấy `updatedAt`.
  const a = as(OWNER, () => createAgent({ name: "Cho 6" }));
  const rec = agents.get(a.id) as unknown as Record<string, unknown>;
  rec.awaitingUserResponse = { reason: "câu hỏi từ hôm qua" };   // cố ý bỏ qua setPresence
  const r = row(a.id);
  const got = r?.awaitingUserResponse as Record<string, unknown> | null;
  assert.deepEqual(Object.keys(got ?? {}).sort(), ["reason", "since", "tabId"]);
  assert.equal(got?.since, r?.updatedAt, "mốc suy từ entry cuối, không phải Date.now()");
  assert.equal(got?.tabId, "");
});

test("không chờ ai thì vẫn là null — nhánh còn lại của anyOf", () => {
  const a = as(OWNER, () => createAgent({ name: "Cho 7" }));
  assert.equal(row(a.id)?.awaitingUserResponse, null,
    "hoàn thiện khoá không được biến 'không chờ' thành một object rỗng");
});
