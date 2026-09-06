/**
 * Nhóm trigger 0.43 (`SandTriggerGroup {type:"group", listeners:[≥2]}`) — nút "Add another" trong panel Routine.
 *
 * App gốc đo 06/09: một routine mang *Every Monday at 8:49 AM · Every day at 12:15 AM*, hàng sự kiện
 * "Updated routine" và bot nói *"giờ là mondays 8:49 hoặc mỗi ngày 00:15"*. Trước bản sửa, nhóm rơi vào
 * `normaliseTrigger` → cảnh báo rồi thành `0 9 * * *`: panel vẫn vẽ hai dòng (spec được trả lại nguyên),
 * nhưng bộ lập lịch chạy 9:00 mỗi ngày và câu nhắc nói "9:00 daily". Các bài dưới ghim đúng ba chỗ ấy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgentAutomation, updateAgentAutomation, toClientAutomation, dueIds, cronsOf, getAgentAutomations,
} from "./automations.js";
import { agents } from "./chat/state.js";

function botThu(id: string): void {
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as unknown as NonNullable<ReturnType<typeof agents.get>>);
}

const NHOM = {
  type: "group",
  listeners: [
    { type: "cron", schedule: "49 8 * * 1" },
    { type: "cron", schedule: "15 0 * * *" },
  ],
};

test("nhóm hai lịch: lịch đầu vào trigger, lịch sau vào extraCrons, mô tả nêu cả hai", () => {
  const agentId = "nhom-agent-1";
  botThu(agentId);
  const list = createAgentAutomation({ id: agentId, spec: { name: "routine-healthcheck", prompt: "kiểm tra", trigger: NHOM } });
  const rec = list[list.length - 1];

  assert.equal(rec.trigger, "49 8 * * 1");
  assert.deepEqual(rec.extraCrons, ["15 0 * * *"]);
  assert.deepEqual(cronsOf(rec), ["49 8 * * 1", "15 0 * * *"]);
  assert.match(rec.triggerDescription, /8:49/);
  assert.match(rec.triggerDescription, /0:15|00:15|12:15/);
  assert.match(rec.triggerDescription, / hoặc /);
});

test("panel nhận lại đúng nhóm để vẽ hai dòng (không phải một cron)", () => {
  const agentId = "nhom-agent-2";
  botThu(agentId);
  const list = createAgentAutomation({ id: agentId, spec: { name: "r", prompt: "p", trigger: NHOM } });
  const view = toClientAutomation(list[list.length - 1]);
  assert.deepEqual(view.trigger, NHOM);
});

test("bộ lập lịch bắn ở lịch THỨ HAI, không chỉ lịch đầu", () => {
  const agentId = "nhom-agent-3";
  botThu(agentId);
  const list = createAgentAutomation({ id: agentId, spec: { name: "r", prompt: "p", trigger: NHOM } });
  const id = list[list.length - 1].id;

  // Thứ ba 00:15 — chỉ lịch thứ hai khớp.
  const thuBa0015 = new Date(2026, 8, 8, 0, 15, 0);
  assert.equal(thuBa0015.getDay(), 2);
  assert.ok(dueIds(thuBa0015).includes(id), "00:15 hằng ngày phải tới hạn");

  const thuHai0849 = new Date(2026, 8, 7, 8, 49, 0);
  assert.equal(thuHai0849.getDay(), 1);
  assert.ok(dueIds(thuHai0849).includes(id), "thứ hai 8:49 phải tới hạn");

  const thuBa0849 = new Date(2026, 8, 8, 8, 49, 0);
  assert.ok(!dueIds(thuBa0849).includes(id), "thứ ba 8:49 không có lịch nào khớp");

  // Trước bản sửa nhóm thành "0 9 * * *": 9:00 phải KHÔNG tới hạn.
  assert.ok(!dueIds(new Date(2026, 8, 8, 9, 0, 0)).includes(id), "9:00 là mặc định cũ, không được bắn");
});

test("sửa nhóm về một cron thì extraCrons và triggerSpec biến mất", () => {
  const agentId = "nhom-agent-4";
  botThu(agentId);
  const list = createAgentAutomation({ id: agentId, spec: { name: "r", prompt: "p", trigger: NHOM } });
  const id = list[list.length - 1].id;

  updateAgentAutomation({ id: agentId, automationId: id, spec: { trigger: "30 7 * * *" } });
  const rec = getAgentAutomations({ id: agentId }).find((r) => r.id === id)!;
  assert.equal(rec.trigger, "30 7 * * *");
  assert.equal(rec.extraCrons, undefined);
  assert.equal(rec.triggerSpec, undefined);
  assert.doesNotMatch(rec.triggerDescription, / hoặc /);
});

test("nhóm trộn lịch + listener Slack: lịch vẫn chạy, mô tả nêu cả Slack", () => {
  const agentId = "nhom-agent-5";
  botThu(agentId);
  const list = createAgentAutomation({
    id: agentId,
    spec: { name: "r", prompt: "p", trigger: { type: "group", listeners: [{ type: "cron", schedule: "0 6 * * *" }, { type: "slack", channel: "#ops" }] } },
  });
  const rec = list[list.length - 1];
  assert.equal(rec.trigger, "0 6 * * *");
  assert.equal(rec.extraCrons, undefined);
  assert.match(rec.triggerDescription, /slack/i);
  assert.match(rec.triggerDescription, / hoặc /);
});
