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
import { bootstrapStatsigJson } from "./feature-gates.js";

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

/*
 * Khối On-Demand (field 13) + cổng `sand_on_demand_settings`.
 *
 * Tag cần nhớ: field 13 message → 0x6a; bên trong 1 bool → 0x08 · 2 bool → 0x10 · 3 bool → 0x18 ·
 * 4 string → 0x22. Bài đo ghim ĐỦ BỐN vì renderer 0.43 (`chunk-usage-pane`, hàm `js`) trả `null`
 * khi thiếu `visible` hoặc `eligible`, và rơi về trang của HÃNG khi thiếu `dashboard_url`.
 */
const TRANG = "https://cinai.app/vi/subscription";

test("không dashboardUrl → không field 13, và cổng on-demand TẮT", async () => {
  const b = await goi({ plan: "free", usage: { used: 1, limit: 10, cycleStartMs: 1, cycleEndMs: 2 } });
  assert.equal(coTag(b, 0x6a), false, "field 13 phải VẮNG khi chưa cấu hình trang");
  const cfg = JSON.parse(JSON.parse(bootstrapStatsigJson("ai-do")).config);
  assert.equal(cfg.feature_gates.sand_on_demand_settings, undefined, "không khai cổng khi không có URL");
});

test("có dashboardUrl → field 13 đủ BỐN trường, visible+eligible true, enabled false", async () => {
  const b = await goi({ plan: "free", dashboardUrl: TRANG, usage: { used: 1, limit: 10, cycleStartMs: 1, cycleEndMs: 2 } });
  const i = b.indexOf(0x6a);
  assert.ok(i > 0, "phải có field 13");
  const trong = b.subarray(i + 2, i + 2 + b[i + 1]);
  assert.deepEqual([...trong.subarray(0, 6)], [0x08, 1, 0x10, 1, 0x18, 0], "visible=1 eligible=1 enabled=0");
  assert.equal(trong[6], 0x22, "trường 4 là chuỗi");
  assert.equal(trong.subarray(8, 8 + trong[7]).toString(), TRANG, "dashboard_url nguyên văn");
});

test("field 13 có mặt ở CẢ BA nhánh khi đã cấu hình trang", async () => {
  for (const ctx of [
    {},
    { plan: "pro" },
    { plan: "free", usage: { used: 1, limit: 10, cycleStartMs: 1, cycleEndMs: 2 } },
  ]) {
    const b = await goi({ ...ctx, dashboardUrl: TRANG });
    assert.equal(coTag(b, 0x6a), true, `nhánh ${JSON.stringify(ctx)} thiếu field 13`);
  }
});

test("cổng on-demand bật ĐÚNG KHI có URL — hai thứ không được rời nhau", async () => {
  const bat = JSON.parse(JSON.parse(bootstrapStatsigJson("ai-do", { sand_on_demand_settings: true })).config);
  assert.equal(bat.feature_gates.sand_on_demand_settings.value, true);
  const tat = JSON.parse(JSON.parse(bootstrapStatsigJson("ai-do", { sand_on_demand_settings: false })).config);
  assert.equal(tat.feature_gates.sand_on_demand_settings.value, false);
});
