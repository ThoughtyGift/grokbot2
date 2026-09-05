/**
 * Icon mặc định của bot khớp renderer 0.43 (avatar-mac-dinh.ts).
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs src/avatar-mac-dinh.test.ts
 *
 * Giá trị mong đợi lấy bằng cách chạy NGUYÊN VĂN các hàm `$ee · WRe · KRe · XRe · ZRe · mR · x2` trích từ
 * `index-Df98_wE4.js` (06/09), không phải bằng bản chép của ta — nên bài này đỏ là bản chép sai, không phải bảng sai.
 * `agent-984` = New Bot: sidebar client vẽ viên thuốc cam (`tablet`/`orange`) — đúng cặp ghim ở đây; thẻ mẫu trước đây vẽ
 * tròn xanh vì rơi về hằng "blob"/"blue".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_ALLOW_WRITE = "1";
// Thư mục RIÊNG vô điều kiện — `node --test` chạy song song nhiều tiến trình chung env, và `bot-templates.test.ts` xoá cả kho mẫu (site-bot.test.ts kể).
process.env.GROKBOT2_DATA_DIR = mkdtempSync(join(tmpdir(), "gb2-avatar-"));
process.env.GROKBOT2_STATE_FILE = join(process.env.GROKBOT2_DATA_DIR, "state.json");
process.env.GROKBOT2_WORKFLOWS_FILE = join(process.env.GROKBOT2_DATA_DIR, "workflows.json");

const { avatarCuaBot, hinhSuyTuId, mauSuyTuId } = await import("./avatar-mac-dinh.js");

test("suy hình + màu từ id đúng như renderer 0.43 (5 id ghim từ mã gốc)", () => {
  const ghim: Array<[string, string, string]> = [
    ["agent-984", "tablet", "orange"],
    ["agent-1", "blob", "red"],
    ["agent-256", "tablet", "magenta"],
    ["9d813973-e895-415f-91a7-dd79a9061edb", "hex", "brown"],
    ["agent-1010", "tablet", "blue"],
  ];
  for (const [id, shape, color] of ghim) {
    assert.equal(hinhSuyTuId(id), shape, `hình của ${id}`);
    assert.equal(mauSuyTuId(id), color, `màu của ${id}`);
    assert.deepEqual(avatarCuaBot({ id }), { shape, color });
  }
});

test("giá trị đã lưu và hợp lệ thắng; giá trị lạ thì suy như client (Sp/Af)", () => {
  assert.deepEqual(avatarCuaBot({ id: "agent-984", avatarShape: "teardrop", avatarColor: "red" }), { shape: "teardrop", color: "red" });
  assert.deepEqual(avatarCuaBot({ id: "agent-984", avatarShape: "hinh-la", avatarColor: 7 }), { shape: "tablet", color: "orange" });
  assert.equal(avatarCuaBot({ id: "agent-984", avatarColor: "black" }).color, "black", "black hợp lệ khi LƯU, chỉ không bao giờ được SUY");
});

test("màu suy không bao giờ là black; hình suy nằm trong 8 hình của w2", () => {
  const hinh8 = new Set(["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"]);
  for (let i = 0; i < 300; i++) {
    const a = avatarCuaBot({ id: `agent-${i}` });
    assert.notEqual(a.color, "black");
    assert.ok(hinh8.has(a.shape), a.shape);
  }
});

test("mẫu bot của bot KHÔNG lưu icon mang đúng icon client vẽ, không phải blob/blue", async () => {
  const { runWithOwner: as } = await import("./request-context.js");
  const { createAgent } = await import("./directory/index.js");
  const T = await import("./bot-templates.js");
  T.bindTemplateSources({ skills: () => [], routines: () => [], memory: async () => [], plugins: () => [],
    restoreSkill: () => {}, restoreRoutine: () => {}, restoreMemory: async () => {} });
  const A = "local|nguoi-a@vi-du.vn";
  const bot = as(A, () => createAgent({ name: "Bot không chọn icon", description: "đo icon" }));
  assert.equal((bot as { avatarShape?: unknown }).avatarShape, undefined, "tiền đề: bản ghi không lưu hình");
  const mong = avatarCuaBot({ id: bot.id });
  const nhap = (await as(A, () => T.stageTemplateForAgent(bot.id, { description: "đo icon" }, A)))!;
  assert.deepEqual([nhap.staged?.avatarShape, nhap.staged?.avatarColor], [mong.shape, mong.color], "bản chờ");
  assert.deepEqual([nhap.avatarShape, nhap.avatarColor], [mong.shape, mong.color], "đầu bảng (nháp theo bản chờ)");
  const the = T.shareCardOf(nhap);
  assert.deepEqual([the.avatarShape, the.avatarColor], [mong.shape, mong.color], "thẻ trong transcript");
  const v = T.toWireView(nhap, nhap.staged?.version);
  assert.deepEqual([v.avatarShape, v.avatarColor], [mong.shape, mong.color], "hộp View Details");
});
