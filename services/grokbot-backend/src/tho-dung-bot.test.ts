/**
 * Skill "Dựng bot mới" của Thợ dựng bot — ghim những gì model phải đọc được, và phép "đảm bảo có skill" không đẻ bản lặp.
 *
 * Bài học lặp lại từ `create_routine` (28/08) và vòng 5 parity: model chỉ làm được thứ nằm trong VĂN BẢN gửi đi. Nên
 * bài này kiểm chính văn bản: đủ 5 tool, có `"agent"` ở chỗ gắn skill/routine cho bot khác, đủ 9 nhóm Marketplace,
 * và luật "mọi chuỗi phải có chữ" (validator client 0.43 — bảng theo dõi §7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_WORKFLOWS_FILE = join(tmpdir(), `grokbot2-tho-dung-bot-test-${process.pid}.json`);
const { NOI_DUNG_SKILL, MO_TA_SKILL, TEN_SKILL, SOP_THO, MO_TA_THO, dungSkillDungBot } = await import("./tho-dung-bot.js");
const { forAgent, _xoaHet, update } = await import("./workflows.js");
const { CATEGORIES } = await import("./marketplace.js");

test("skill nêu đủ 5 tool và nhắm bot MỚI bằng \"agent\" ở skill lẫn routine", () => {
  for (const t of ["create_agent", "create_workflow", "create_routine", "share_bot_template", "publish_bot_listing", "ask_question"]) {
    assert.ok(NOI_DUNG_SKILL.includes(t), `thiếu ${t}`);
  }
  assert.match(NOI_DUNG_SKILL, /create_workflow\(\{"agent":/);
  assert.match(NOI_DUNG_SKILL, /create_routine\(\{"agent":/);
  assert.match(NOI_DUNG_SKILL, /share_bot_template\(\{"agent":/);
});

test("skill chép đủ 9 nhóm Marketplace đúng khoá renderer biết", () => {
  for (const c of CATEGORIES) assert.ok(NOI_DUNG_SKILL.includes(c), `thiếu nhóm ${c}`);
});

test("luật validator client: mọi chuỗi phải có chữ; không quá ba câu hỏi; không sao chép bot người khác", () => {
  assert.match(NOI_DUNG_SKILL, /phải có chữ/);
  assert.match(NOI_DUNG_SKILL, /BA câu/);
  assert.match(NOI_DUNG_SKILL, /Không sao chép/);
  assert.match(SOP_THO, /không sao chép/i);
  assert.ok(MO_TA_THO.length > 40 && MO_TA_SKILL.length > 10, "mô tả của chính Thợ cũng phải đủ chữ để lên Marketplace");
});

test("dungSkillDungBot: tạo một lần, gọi lại không đẻ bản hai, bản lệch được nâng tại chỗ", () => {
  _xoaHet();
  const a = dungSkillDungBot("tho-1");
  assert.equal(a.name, TEN_SKILL);
  assert.equal(a.source, "workflow", "skill này phải vào menu / — khác skill teach (managed)");
  const b = dungSkillDungBot("tho-1");
  assert.equal(b.id, a.id);
  assert.equal(forAgent({ agentId: "tho-1" }).length, 1);
  // bản cũ lệch nội dung (như sau khi sửa skill trong mã) → cùng id, nội dung mới
  update({ workflowId: a.id, agentId: "tho-1", instructions: "cũ" });
  const c = dungSkillDungBot("tho-1");
  assert.equal(c.id, a.id);
  assert.equal(c.instructions, NOI_DUNG_SKILL);
  _xoaHet();
});
