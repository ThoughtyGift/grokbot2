/**
 * Webhook của routine — `getAutomationWebhookCredential` và cửa nhận.
 *
 *   npx tsx --test services/grokbot-backend/src/automations-webhook.test.ts
 *
 * ── Vì sao từng bài ─────────────────────────────────────────────────────────────────────────────
 *
 * Hình dạng trả về đọc thẳng từ renderer 0.30, nên nó KHÔNG phải lựa chọn của ta:
 *
 *     if (typeof K.url != "string" || K.url.length === 0 || (K.key !== null && typeof K.key != "string")) throw
 *
 * Sai một trong ba điều kiện đó là bảng webhook của client ném, không phải hiện sai — nên chúng
 * được khoá y nguyên.
 *
 * Bài nặng nhất là bài rò khoá. `toClientAutomation` trải `...rec`, nên đặt một bí mật lên bản ghi
 * là mặc định nó đi theo MỌI câu trả lời `getAgentAutomations`/`listAllAutomations` — rộng hơn hẳn
 * cái lệnh dành riêng cho nó, và im lặng. Chỗ gỡ chỉ có một, nên phải có bài giữ nó.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentAutomation, automationWebhookCredential, fireByWebhook,
  toClientAutomation, getAgentAutomations, listAllAutomations,
} from "./automations.js";
import { agents } from "./chat/state.js";

/** Một bot thật trong sổ — `createAgentAutomation` từ chối agent không tồn tại. */
function botThu(id: string): void {
  agents.set(id, {
    id, name: `bot ${id}`, createdAt: Date.now(),
  } as unknown as ReturnType<typeof agents.get> extends infer T ? T & object : never);
}

function taoRoutine(agentId: string): string {
  botThu(agentId);
  const list = createAgentAutomation({ id: agentId, spec: { name: "Việc thử", prompt: "làm gì đó", trigger: "manual" } });
  return list[list.length - 1].id;
}

test("hình dạng trả về đúng thứ renderer chấp nhận", () => {
  const agentId = "wh-agent-1";
  const id = taoRoutine(agentId);
  const cred = automationWebhookCredential({ id: agentId, automationId: id });

  assert.ok(cred, "routine có thật thì phải trả về thông tin");
  assert.equal(typeof cred.url, "string");
  assert.ok(cred.url.length > 0, "url rỗng làm renderer NÉM, không phải hiện trống");
  assert.ok(cred.key !== null && typeof cred.key === "string", "ta đúc ngay nên không bao giờ trả key null");
  assert.match(cred.url, new RegExp(`/hooks/automation/${id}$`));
});

test("hỏi lại thì vẫn đúng khoá đó — không đúc lại mỗi lần", () => {
  const agentId = "wh-agent-2";
  const id = taoRoutine(agentId);
  const a = automationWebhookCredential({ id: agentId, automationId: id });
  const b = automationWebhookCredential({ id: agentId, automationId: id });
  // Client hỏi lại mỗi 2 giây cho tới khi thấy key. Đúc lại mỗi lần thì khoá người dùng vừa dán
  // sang hệ thống khác chết ngay ở lần hỏi kế tiếp.
  assert.equal(a?.key, b?.key);
});

test("khoá KHÔNG đi ra ngoài qua danh sách routine", () => {
  const agentId = "wh-agent-3";
  const id = taoRoutine(agentId);
  const cred = automationWebhookCredential({ id: agentId, automationId: id });
  const khoa = cred?.key ?? "";
  assert.ok(khoa.length > 20);

  const rec = getAgentAutomations({ id: agentId }).find((x) => x.id === id);
  assert.ok(rec, "routine vừa tạo phải có trong sổ");
  assert.ok(rec.webhookKey, "bản ghi trong nhà thì vẫn giữ khoá");

  // …nhưng mọi hình dạng gửi cho client thì không.
  const raOngoai = [
    JSON.stringify(toClientAutomation(rec)),
    JSON.stringify(getAgentAutomations({ id: agentId }).map(toClientAutomation)),
    JSON.stringify(listAllAutomations().map(toClientAutomation)),
  ];
  for (const s of raOngoai) {
    assert.ok(!s.includes(khoa), "khoá webhook lọt vào một câu trả lời gửi cho client");
    assert.ok(!s.includes("webhookKey"), "kể cả tên trường cũng không nên có mặt");
  }
});

test("routine không có thật thì trả null, không đúc khoá cho hư không", () => {
  assert.equal(automationWebhookCredential({ id: "wh-agent-4", automationId: "khong-co" }), null);
});

test("sai khoá thì không bắn, và nói rõ là sai khoá", () => {
  const agentId = "wh-agent-5";
  const id = taoRoutine(agentId);
  automationWebhookCredential({ id: agentId, automationId: id });
  assert.equal(fireByWebhook(id, "khoa-bia-ra"), "sai-khoa");
  assert.equal(fireByWebhook(id, ""), "sai-khoa");
});

test("chưa ai xin khoá thì webhook không mở — không có cửa sau mặc định", () => {
  const agentId = "wh-agent-6";
  const id = taoRoutine(agentId);
  // Cố ý: khoá chỉ tồn tại sau khi có người hỏi. Một routine chưa ai xin khoá thì không có đường
  // gọi từ ngoài, kể cả khi người gọi đoán đúng id.
  assert.equal(fireByWebhook(id, "bat-ky-gi"), "khong-thay");
});

test("routine đang tắt thì không bắn, và phân biệt với sai khoá", () => {
  const agentId = "wh-agent-7";
  const id = taoRoutine(agentId);
  const cred = automationWebhookCredential({ id: agentId, automationId: id });
  assert.ok(cred?.key, "phải xin được khoá trước đã");
  const rec = getAgentAutomations({ id: agentId }).find((x) => x.id === id);
  assert.ok(rec, "routine vừa tạo phải có trong sổ");
  rec.isEnabled = false;
  // Gộp "đang tắt" vào 401 là bắt người ta đi đổi khoá trong khi khoá vẫn đúng.
  assert.equal(fireByWebhook(id, cred.key), "dang-tat");
});
