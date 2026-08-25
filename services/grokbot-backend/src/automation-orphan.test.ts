/**
 * A routine must not fire into a bot that no longer exists.
 *
 * Found by looking, not by reasoning: four routines were live on this install and none of their bots
 * were in the roster — `agent-256`, `258`, `275`, `276` are all gone. One of them carries the cron
 * `0 9 * * *`, so once a day it sent a prompt into a conversation nobody could read and spent a pool
 * call doing it. `bindAutomationCleanup` is supposed to drop routines with their agent, and these
 * predate it; the scheduler should not depend on that having worked.
 *
 * The routine is NOT deleted here. A lookup that misses once — a restore still in flight, a rename
 * in progress — must not destroy somebody's routine; the run is recorded as failed so the panel can
 * say why, and a human decides whether it should go.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.GROKBOT2_DATA_DIR ?? join(import.meta.dirname, "..", ".data");

let automations: typeof import("./automations.js");
let state: typeof import("./chat/state.js");
let chat: typeof import("./chat.js");

before(async () => {
  state = await import("./chat/state.js");
  chat = await import("./chat.js");
  automations = await import("./automations.js");
});

after(() => {
  // The suite runs against a throwaway store (scripts/run-tests.mjs); this is belt and braces.
  try { rmSync(join(DATA, "orphan-test"), { recursive: true, force: true }); } catch { /* nothing to clean */ }
});

test("agentExists tells the truth about a bot that was never created", () => {
  assert.equal(state.agentExists("agent-does-not-exist"), false);
});

test("firing a routine whose bot is gone records a failed run and sends nothing", () => {
  const created = automations.createAgentAutomation({
    id: "agent-gone-forever",
    spec: { name: "Mồ côi", prompt: "việc gì đó", trigger: "0 9 * * *" },
  });
  const routine = created[created.length - 1];
  assert.ok(routine, "the routine is created even for an unknown agent — that is not this fix");

  // fireById returns true because the ROUTINE exists; what matters is what it did.
  assert.equal(automations.fireById(routine.id, "manual"), true);

  const after = automations.listAllAutomations().find((r) => r.id === routine.id);
  assert.equal(after?.runs[0]?.status, "failed", "the panel has to be able to say why nothing happened");
  assert.ok(after, "and the routine itself is left alone, not deleted behind the user's back");
});

test("a routine on a bot that exists still fires normally", () => {
  const agent = chat.createAgent({ name: "Có thật" });
  assert.equal(state.agentExists(agent.id), true);

  const created = automations.createAgentAutomation({
    id: agent.id,
    spec: { name: "Bình thường", prompt: "chào", trigger: "0 9 * * *" },
  });
  const routine = created[created.length - 1];
  assert.equal(automations.fireById(routine.id, "manual"), true);

  const after = automations.listAllAutomations().find((r) => r.id === routine.id);
  assert.notEqual(after?.runs[0]?.status, "failed", "this is the path the guard must not break");
});

/**
 * Trigger phi-cron phải sống sót qua lúc lưu.
 *
 * Đây là lỗi im lặng nhất từng gặp ở phần routine: người dùng chọn "Slack message" trong menu
 * "When to run", điền kênh và từ khoá, bấm lưu — và cái routine đó chạy **9 giờ sáng mỗi ngày**.
 * Không có lỗi nào hiện ra, chỉ có một dòng "9:00 daily" ở chỗ đáng lẽ ghi "khi có tin nhắn Slack".
 *
 * Hậu quả thứ hai còn kín hơn: `listenerPlatform` đọc chuỗi trigger để biết routine nghe nền tảng
 * nào. Bị hạ cấp thành cron thì không routine nào khớp Slack hay GitHub, nên hai receiver đang chạy
 * ở tiến trình ops có nhận webhook cũng không đánh thức được ai.
 */
test("trigger Slack không bị hạ cấp thành cron", () => {
  const before = automations.listAllAutomations().length;
  const rows = automations.createAgentAutomation({
    id: "agent-trigger-test",
    spec: {
      name: "slack-thu", prompt: "trả lời", isEnabled: true,
      trigger: { type: "slack", channel: "#general", match: "message", keyword: "hoá đơn", bySelf: false },
    },
  });
  const rec = rows[rows.length - 1];
  assert.equal(rec.trigger, "slack", "chuỗi trigger phải mang tên nền tảng, vì listenerPlatform đọc nó");
  assert.equal(rec.triggerSpec?.channel, "#general", "kênh người dùng chọn phải còn nguyên");
  assert.equal(rec.triggerSpec?.keyword, "hoá đơn");
  assert.match(rec.triggerDescription, /Slack/, `mô tả phải nói Slack, nhận "${rec.triggerDescription}"`);
  assert.ok(!/9:00|daily/.test(rec.triggerDescription), "và tuyệt đối không được là một lịch cron");

  // Client mở lại routine thì phải thấy đúng lựa chọn cũ, không phải các ô lọc trống.
  const client = automations.toClientAutomation(rec) as { trigger: Record<string, unknown> };
  assert.equal(client.trigger.type, "slack");
  assert.equal(client.trigger.channel, "#general");

  automations.deleteAgentAutomation({ agentId: "agent-trigger-test", automationId: rec.id });
  assert.equal(automations.listAllAutomations().length, before);
});

test("lịch cron vẫn đi đúng đường cũ", () => {
  const rows = automations.createAgentAutomation({
    id: "agent-trigger-test",
    spec: { name: "cron-thu", prompt: "chạy", trigger: { type: "cron", schedule: "30 7 * * *" } },
  });
  const rec = rows[rows.length - 1];
  assert.equal(rec.trigger, "30 7 * * *");
  assert.equal(rec.triggerSpec, undefined, "cron không cần bản sao có cấu trúc");
  assert.match(rec.triggerDescription, /7:30/);
  automations.deleteAgentAutomation({ agentId: "agent-trigger-test", automationId: rec.id });
});

/**
 * Payload THẬT của client, bắt được bằng cách tự bấm "Slack message" trong app rồi đọc lại đối số
 * mà nó gửi xuống `/gw/api/createAgentAutomation`:
 *
 *   {"name":"…","prompt":"…","isEnabled":true,
 *    "trigger":{"type":"slack","channel":"#thu-nghiem","match":{"kind":"keyword","keyword":"hoa don"}}}
 *
 * Hai điều nó bác bỏ: trigger KHÔNG đi qua RPC nào của hãng mà đi thẳng đường `/gw` cục bộ, và
 * `match` là một object chứ không phải chuỗi như hình dạng tôi tự dựng lúc đầu.
 */
test("payload Slack thật của client được giữ nguyên, kể cả từ khoá lồng trong match", () => {
  const rows = automations.createAgentAutomation({
    id: "agent-trigger-test",
    spec: {
      name: "THU-slack-that", prompt: "kiểm tra", isEnabled: true,
      trigger: { type: "slack", channel: "#thu-nghiem", match: { kind: "keyword", keyword: "hoa don" } },
    },
  });
  const rec = rows[rows.length - 1];
  assert.equal(rec.trigger, "slack");
  assert.equal((rec.triggerSpec?.match as { keyword?: string })?.keyword, "hoa don",
    "từ khoá nằm trong match, và phải sống sót nguyên vẹn");
  assert.match(rec.triggerDescription, /#thu-nghiem/);
  assert.match(rec.triggerDescription, /hoa don/,
    `mô tả phải nêu từ khoá; bản đầu đọc sai chỗ nên im lặng bỏ mất nó — nhận "${rec.triggerDescription}"`);
  automations.deleteAgentAutomation({ agentId: "agent-trigger-test", automationId: rec.id });
});
