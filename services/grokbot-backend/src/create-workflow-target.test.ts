/**
 * `create_workflow{agent}` — gắn skill cho bot KHÁC cùng chủ.
 *
 * Cùng bài học với `routine-target.test.ts` (28/08): tool cứng `ctx.agentId` thì mọi thứ bot mẹ dựng cho bot con rơi
 * vào bot mẹ. Thợ dựng bot (06/09) cần đúng đường này: tạo bot mới rồi gắn 2–4 skill cho NÓ. Ba điều ghim: nhắm theo
 * tên → skill nằm ở bot con, bot mẹ 0; không `agent` → như cũ (chính mình); tên lạ hoặc bot của chủ khác → câu lỗi
 * có chữ "create_agent trước", không ghi đâu cả.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_ALLOW_WRITE = "1";
process.env.GROKBOT2_WORKFLOWS_FILE = join(tmpdir(), `grokbot2-cw-target-test-${process.pid}.json`);
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { TOOLS } = await import("./runtime/tools.js");
const { forAgent, _xoaHet } = await import("./workflows.js");

const OWNER = "local|cw-target@vi-du.vn";
const NGUOI_KHAC = "local|cw-khac@vi-du.vn";
const rieng = (ten: string): string => `${ten} ${Math.random().toString(36).slice(2, 8)}`;
const ctx = (agentId: string) => ({ agentId, note: () => {}, draft: () => {} }) as unknown as Parameters<typeof TOOLS.create_workflow>[1];

test("agent theo tên → skill nằm ở bot con, bot mẹ không có", async () => {
  _xoaHet();
  const me = as(OWNER, () => createAgent({ name: rieng("Thợ") }));
  const con = as(OWNER, () => createAgent({ name: rieng("Shopee CS") }));
  const r = await as(OWNER, () => TOOLS.create_workflow(JSON.stringify({ agent: con.name, name: "Trả lời khách", description: "khi khách hỏi đơn", instructions: "1. đọc đơn {input}\n2. trả lời" }), ctx(me.id)));
  assert.match(String(r), /Đã lưu skill/);
  assert.equal(forAgent({ agentId: con.id }).length, 1);
  assert.equal(forAgent({ agentId: me.id }).length, 0);
});

test("không có agent → ghi cho chính mình như trước", async () => {
  _xoaHet();
  const me = as(OWNER, () => createAgent({ name: rieng("Một mình") }));
  await as(OWNER, () => TOOLS.create_workflow(JSON.stringify({ name: "Việc của tôi", description: "khi cần", instructions: "bước" }), ctx(me.id)));
  assert.equal(forAgent({ agentId: me.id }).length, 1);
});

test("tên lạ hoặc bot của chủ khác → nói rõ, không ghi đâu", async () => {
  _xoaHet();
  const me = as(OWNER, () => createAgent({ name: rieng("Thợ") }));
  const cuaNguoiKhac = as(NGUOI_KHAC, () => createAgent({ name: rieng("Bot người khác") }));
  const r1 = await as(OWNER, () => TOOLS.create_workflow(JSON.stringify({ agent: "không có thật", name: "x", description: "y", instructions: "z" }), ctx(me.id)));
  assert.match(String(r1), /create_agent trước/);
  const r2 = await as(OWNER, () => TOOLS.create_workflow(JSON.stringify({ agent: cuaNguoiKhac.name, name: "x", description: "y", instructions: "z" }), ctx(me.id)));
  assert.match(String(r2), /create_agent trước/);
  assert.equal(forAgent({ agentId: cuaNguoiKhac.id }).length, 0);
  assert.equal(forAgent({ agentId: me.id }).length, 0);
});
