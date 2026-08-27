/**
 * Cổng tính năng — khoá chặt hình dạng mà client thật sự đọc được.
 *
 * Mỗi khẳng định dưới đây tương ứng một dòng trong bản dựng của client; sai một cái là nút
 * "Teach a task" lại biến mất mà không có lỗi nào ở đâu cả (đúng như trước bản vá này).
 *
 *   npx tsx --test src/feature-gates.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statsigBootstrapConfig, bootstrapStatsigJson } from "./feature-gates.js";
import { bootstrapJsonResponses } from "./bootstrap.js";

const parse = (userId = "u1"): Record<string, any> => JSON.parse(statsigBootstrapConfig(userId, 1_700_000_000_000));

test("thân trả về có khoá `config` — thứ mà bản cũ thiếu", () => {
  const body = JSON.parse(bootstrapStatsigJson("u1")) as Record<string, unknown>;
  assert.equal(typeof body.config, "string", "thiếu `config` thì client bỏ qua cả gói");
});

test("BootstrapStatsig nằm trong bảng JSON, không rơi vào nhánh mặc định", () => {
  assert.ok(Object.hasOwn(bootstrapJsonResponses, "BootstrapStatsig"));
  const body = JSON.parse(bootstrapJsonResponses.BootstrapStatsig({ user: null })) as Record<string, unknown>;
  assert.equal(typeof body.config, "string");
});

test("cổng Teach bật, và bật bằng TÊN TRẦN", () => {
  const cfg = parse();
  // V1InitializeContainer tra `values.feature_gates[name]` trước khi thử tên băm.
  assert.equal(cfg.feature_gates.sand_teach_by_demonstration.value, true);
});

test("không khai `response_format` — có khai `init-v2` là tên trần hết tác dụng", () => {
  assert.ok(!("response_format" in parse()), "V2 đòi tên đã băm sẵn");
});

test("`has_updates` và `time` phải qua được cửa `setValues`", () => {
  const cfg = parse();
  assert.equal(cfg.has_updates, true, "false thì SDK bỏ nguyên gói");
  assert.ok(cfg.time > 0, "time nhỏ hơn mốc hiện có thì gói bị bỏ");
});

test("`user.userID` nằm trong chính chuỗi config", () => {
  // Tiến trình chính dựng StatsigUser bằng `JSON.parse(config).user ?? {}`.
  assert.equal(parse("nguoi-a").user.userID, "nguoi-a");
});

test("GROKBOT2_FEATURE_GATES mở thêm và đóng lại được", () => {
  const truoc = process.env.GROKBOT2_FEATURE_GATES;
  try {
    process.env.GROKBOT2_FEATURE_GATES = "sand_global_search=1, sand_teach_by_demonstration=0";
    const cfg = parse();
    assert.equal(cfg.feature_gates.sand_global_search.value, true);
    assert.equal(cfg.feature_gates.sand_teach_by_demonstration.value, false, "biến môi trường phải đè được mặc định");
  } finally {
    if (truoc === undefined) delete process.env.GROKBOT2_FEATURE_GATES;
    else process.env.GROKBOT2_FEATURE_GATES = truoc;
  }
});
