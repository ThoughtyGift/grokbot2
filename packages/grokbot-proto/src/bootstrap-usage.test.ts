/**
 * GetSandUsageStatus — ba nhánh, khoá bằng BYTE vì client kiểm bằng schema proto.
 *
 * Tag cần nhớ (field<<3 | wire): field 3 double → 0x19 · field 15 string → 0x7a ·
 * field 1/2 message → 0x0a/0x12. Nhánh "billing tắt" phải giữ NGUYÊN byte stub lịch sử
 * (`20 00 38 01 40 01 58 00`) — đổi nó là đổi hành vi của mọi bản cài chưa bật billing.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bootstrapResponses, type RpcCtx } from "./bootstrap.js";

const goi = async (ctx: Partial<RpcCtx>): Promise<Buffer> =>
  Buffer.from(await bootstrapResponses.GetSandUsageStatus({ user: null, ...ctx } as RpcCtx));

const coTag = (b: Buffer, tag: number): boolean => b.includes(tag); // đủ cho các tag một-byte ở đây

test("billing tắt (không plan, không usage) → đúng stub lịch sử, byte không đổi", async () => {
  const b = await goi({});
  assert.equal(b.toString("hex"), "2000380140015800");
});

test("plan không trần (pro): không usage_percent, không Timestamp, có nhãn plan", async () => {
  const b = await goi({ plan: "pro" });
  assert.equal(coTag(b, 0x19), false, "field 3 (double %) phải VẮNG để FE ẩn thanh");
  assert.equal(b.includes(Buffer.from([0x7a, 3, 0x70, 0x72, 0x6f])), true, 'field 15 = "pro"');
  assert.equal(b[0] === 0x0a, false, "không current_period_start khi không có chu kỳ");
});

test("plan có trần (free): đủ %, hai mốc chu kỳ, và % đúng số học", async () => {
  const b = await goi({
    plan: "free",
    usage: { used: 25_000, limit: 100_000, cycleStartMs: 1_700_000_000_000, cycleEndMs: 1_702_592_000_000 },
  });
  assert.equal(b[0], 0x0a, "mở đầu bằng field 1 (Timestamp)");
  const i = b.indexOf(0x19);
  assert.ok(i > 0, "phải có field 3 double");
  assert.equal(b.readDoubleLE(i + 1), 25, "25.000/100.000 = 25%");
  assert.ok(b.includes(Buffer.from([0x7a, 4])), 'field 15 = "free"');
});

test("free VƯỢT trần: % > 100 giữ nguyên (FE tự kẹp), has_available_usage = false", async () => {
  const b = await goi({
    plan: "free",
    usage: { used: 250_000, limit: 100_000, cycleStartMs: 1, cycleEndMs: 2 },
  });
  const i = b.indexOf(0x19);
  assert.equal(b.readDoubleLE(i + 1), 250);
  // field 7 bool: tag 0x38. Sau tag là 0x00 (hết usage khả dụng).
  const j = b.indexOf(0x38);
  assert.equal(b[j + 1], 0, "used ≥ limit thì has_available_usage phải là false");
});
