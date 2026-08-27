/**
 * Description của bot phải VÀO lời nhắc hệ thống — 7.4.2.
 *
 *   npx tsx --test services/grokbot-backend/src/prompt-persona.test.ts
 *
 * Đo được trong E2E nhóm: bot tên "Kho" mang description "chỉ nói về tồn kho" tự giới thiệu
 * thành trợ lý đa năng — vì description chỉ nằm trong roster, chưa bao giờ tới model. Trong
 * app gốc, Description là ô "What this Bot is for" và là bản SOP bot mẹ viết cho bot con.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildSystemPrompt, contextTier } from "./prompt.js";

test("description xuất hiện trong lời nhắc, sau tên và trước dấu thời gian", () => {
  const p = buildSystemPrompt("", {
    agentName: "Kho",
    description: "Bạn là thủ kho. Chỉ nói về tồn kho.",
    now: new Date("2026-08-28T00:00:00Z"),
  });
  const iName = p.indexOf('"Kho"');
  const iDesc = p.indexOf("Bạn là thủ kho");
  const iTime = p.indexOf("The current time is");
  assert.ok(iDesc > 0, "description phải có mặt");
  assert.ok(iName < iDesc && iDesc < iTime, `thứ tự tên(${iName}) < vai(${iDesc}) < giờ(${iTime})`);
});

test("không có description thì không in khối vai rỗng", () => {
  assert.ok(!contextTier({ agentName: "Kho" }).includes("## Your role"));
  assert.ok(!contextTier({ agentName: "Kho", description: "   " }).includes("## Your role"));
});
