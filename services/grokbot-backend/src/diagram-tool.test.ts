/**
 * `create_diagram` — vẽ sơ đồ bằng đúng đường app gốc vẽ.
 *
 *   npx tsx --test services/grokbot-backend/src/diagram-tool.test.ts
 *
 * Trích từ bundle 0.29: KHÔNG có message type "diagram" (0 hit), nhưng có `mermaid.core-*.js` và
 * các lớp `mermaid-figure` / `mermaid-error` / `mermaid-expand`. Tức sơ đồ = khối ```mermaid trong
 * một bong bóng text thường. Bài này khoá đúng ba thứ dễ hỏng:
 *
 *   1. Model hay tự gói sẵn ```mermaid — bọc thêm lần nữa thành khối lồng khối, và client vẽ ra
 *      `mermaid-error` chứ không phải hình.
 *   2. Cú pháp không phải mermaid thì phải bị chặn TẠI ĐÂY, kèm lời nhắc, chứ không đẩy xuống
 *      client rồi hiện lỗi đỏ trước mặt người dùng.
 *   3. Khối phát ra phải mở đúng bằng ```mermaid — sai từ khoá là mất hẳn hình.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { runToolForTest } = await import("./runtime/turn.js");
const { transcripts } = await import("./chat/state.js");

const OWNER = "local|nguoi-a@vi-du.vn";
const FENCE = "```";

/** Chạy tool rồi trả về chữ của bong bóng cuối cùng. */
async function draw(spec: unknown): Promise<{ result: string; bubble: string }> {
  const a = as(OWNER, () => createAgent({ name: "Ve" }));
  const result = await runToolForTest(a.id, "create_diagram", typeof spec === "string" ? spec : JSON.stringify(spec));
  const last = transcripts.get(a.id)?.at(-1);
  const bubble = last?.kind === "send-message" && last.message.type === "text" ? last.message.content : "";
  return { result, bubble };
}

test("vẽ được: phát ra khối mermaid đúng cú pháp", async () => {
  const { result, bubble } = await draw({ code: "flowchart TD\n  A[Bắt đầu] --> B[Xong]" });
  assert.match(result, /đã vẽ sơ đồ/);
  assert.ok(bubble.startsWith(`${FENCE}mermaid`), `khối phải mở bằng ${FENCE}mermaid: ${bubble.slice(0, 40)}`);
  assert.match(bubble, /flowchart TD/);
  assert.ok(bubble.trimEnd().endsWith(FENCE), "khối phải đóng lại");
});

test("model gói sẵn ```mermaid thì KHÔNG bọc thành khối lồng khối", async () => {
  const { bubble } = await draw({ code: `${FENCE}mermaid\nflowchart LR\n  A --> B\n${FENCE}` });
  // Đúng hai lần xuất hiện: mở và đóng. Ba trở lên nghĩa là đã lồng.
  assert.equal(bubble.split(FENCE).length - 1, 2, `khối bị lồng: ${bubble}`);
  assert.match(bubble, /flowchart LR/);
});

test("tiêu đề đứng trước khối, không chui vào trong", async () => {
  const { bubble } = await draw({ title: "Luồng đặt hàng", code: "flowchart TD\n  A --> B" });
  assert.ok(bubble.indexOf("Luồng đặt hàng") < bubble.indexOf(`${FENCE}mermaid`), "tiêu đề phải ở ngoài khối");
});

test("cú pháp không phải mermaid bị chặn TẠI ĐÂY, kèm lời nhắc", async () => {
  const { result, bubble } = await draw({ code: "vẽ giúp mình cái sơ đồ bán hàng" });
  assert.match(result, /dòng đầu phải là loại sơ đồ mermaid/);
  // Không được phát bong bóng nào: đẩy xuống client là hiện lỗi đỏ trước mặt người dùng.
  assert.equal(bubble.includes("mermaid"), false);
});

test("rỗng thì nhắc cách dùng, không nổ", async () => {
  const { result } = await draw({ code: "   " });
  assert.match(result, /create_diagram cần/);
});

test("nhận cả chuỗi trần lẫn khoá thay thế", async () => {
  assert.match((await draw("sequenceDiagram\n  A->>B: hi")).result, /đã vẽ sơ đồ/);
  assert.match((await draw({ mermaid: "pie title Thị phần\n  \"A\" : 60" })).result, /đã vẽ sơ đồ/);
});

test("mọi loại sơ đồ mermaid thường dùng đều qua", async () => {
  for (const head of ["graph TD", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt", "mindmap", "timeline"]) {
    const { result } = await draw({ code: `${head}\n  A --> B` });
    assert.match(result, /đã vẽ sơ đồ/, `bị chặn oan: ${head}`);
  }
});
