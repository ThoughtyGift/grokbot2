/**
 * `category` phải đi được từ `plugin-registry.json` ra tới dây — và đây là một cái bẫy IM LẶNG.
 *
 *   npx tsx --test services/grokbot-backend/src/plugin-category.test.ts
 *
 * Hai chỗ có thể nuốt trường này mà không báo gì:
 *
 *   1. `plugin-catalog.ts` **lọc trắng** danh sách trường — nó dựng một object mới, không sao chép
 *      cả hàng. Thêm `category` vào registry mà quên sửa hàm đó thì registry có, client không thấy.
 *   2. `pluginJson` (bootstrap-plugins.ts) dựng hình cho client. Thiếu trường ở đây thì
 *      **cả pane Plugins sập** — renderer 0.29 gọi `_t(a.category)` không kiểm null, và error
 *      boundary nuốt luôn màn hình. Đo được ngày 28/08 trong app thật.
 *
 * Cả hai đều không có test nào ngoài file này bắt được: cổng hợp đồng đếm tên lệnh, unit test khác
 * gọi hàm, wire test kiểm hình dạng do chính ta chọn.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gb2-cat-"));
const REG = join(dir, "registry.json");
writeFileSync(REG, JSON.stringify({
  plugins: [
    { id: 901, name: "co-nhom", displayName: "Có nhóm", description: "x", category: "Data Analytics" },
    { id: 902, name: "khong-nhom", displayName: "Không nhóm", description: "y" },
    { id: 903, name: "nhom-rong", displayName: "Nhóm rỗng", description: "z", category: "   " },
  ],
}));
process.env.GROKBOT2_PLUGIN_REGISTRY = REG;

const { catalog } = await import("./plugin-catalog.js");
const { listMarketplacePluginsJson } = await import("@grokbot2/proto");

const rows = catalog();
const wire = JSON.parse(listMarketplacePluginsJson(rows)).plugins as Record<string, unknown>[];
const byId = (id: number) => wire.find((p) => String(p.id) === String(id))!;

test("category trong registry SỐNG SÓT qua bộ lọc trắng của catalog", () => {
  const r = rows.find((p) => p.id === 901);
  // Nếu ai đó dựng lại object trong `plugin-catalog.ts` mà quên dòng này, bài này đỏ — chứ không
  // phải người dùng phát hiện bằng cách mở pane và thấy mọi thứ nằm chung một nhóm.
  assert.equal(r?.category, "data analytics", "phải giữ, và phải hạ về chữ thường");
});

test("chữ thường là bắt buộc — 'Design' và 'design' là hai nhóm cùng tên nằm cạnh nhau", () => {
  // Khoá nhóm của renderer là `category:${a.category.toLowerCase()}` còn tiêu đề là `_t(a.category)`,
  // nên hoa/thường lệch nhau sinh ra hai nhóm trông y hệt.
  assert.equal(rows.find((p) => p.id === 901)?.category, "data analytics");
});

test("MỌI mục ra dây đều có category — thiếu một cái là sập cả pane", () => {
  assert.equal(wire.length, 3);
  for (const p of wire) {
    assert.equal(typeof p.category, "string", `mục ${p.id} không có category`);
    assert.notEqual(p.category, "", `mục ${p.id} có category rỗng`);
  }
});

test("không khai / khai rỗng thì rơi về 'featured', không phải undefined", () => {
  assert.equal(byId(902).category, "featured");
  assert.equal(byId(903).category, "featured", "chuỗi toàn khoảng trắng cũng phải rơi về mặc định");
});

test("category khai đúng thì đi thẳng ra dây, không bị mặc định đè", () => {
  assert.equal(byId(901).category, "data analytics");
});
