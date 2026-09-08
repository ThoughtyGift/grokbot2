/**
 * MỌI kind của `Entry` phải sống sót qua một lần khởi động lại.
 *
 *   npx tsx --test services/grokbot-backend/src/kind-khong-bi-mat.test.ts
 *
 * ── Bug đo được 01/09 ───────────────────────────────────────────────────────────────────────────
 *
 * `migrate()` nạp bản ghi từ đĩa và trả `null` cho bất cứ kind nào không khớp một danh sách trắng.
 * Danh sách đó có ba kind; `Entry` thì có sáu. Nên `user-attachment` (thêm 31/08), `notice` và
 * `event` được ghi đúng vào SQLite rồi biến mất ở lần khởi động kế tiếp:
 *
 *     kind trong SQLite trước khi vá:  send-message 394 · tool-call 275 · message 111 · hết
 *
 * Biểu hiện: một khoảng trống chỗ đáng ra là thumbnail, và bot nói "ảnh chưa tới chỗ mình" — trong
 * khi ảnh có thật và mọi mắt khác của chuỗi đều lành.
 *
 * Bài này so danh sách trắng trong `state.ts` với union `Entry` trong `types.ts`. Thêm một kind mới
 * mà quên `migrate` thì bài đỏ — thay vì dữ liệu lặng lẽ rơi.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const doc = (...p: string[]) => readFileSync(join("services", "grokbot-backend", "src", ...p), "utf8");

test("danh sách trắng của migrate phủ hết union Entry", () => {
  const types = doc("conversation", "types.ts");
  const union = types.slice(types.indexOf("export type Entry ="), types.indexOf("export type AgentActivity"));
  const kinds = [...new Set([...union.matchAll(/\|\s*\(Base & \{ kind: "([a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(kinds.length >= 5, `phải bắt được các kind của Entry, đọc ra: ${kinds.join(", ")}`);

  const state = doc("chat", "state.ts");
  // Cắt tới ĐÚNG biên hàm, không phải một cửa sổ 3000 ký tự: 08/09 hàm dài thêm một nhánh và danh
  // sách trắng rơi ra ngoài cửa sổ ⇒ bài đỏ vì phép ĐO, không vì sản phẩm. Dấu đóng hàm là `}` ở
  // đầu dòng — cùng lối với mọi phép đọc mã khác trong bộ này.
  const dau = state.indexOf("function migrate");
  const cuoi = state.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), dau);
  const migrate = state.slice(dau, cuoi > dau ? cuoi : undefined);
  const thieu = kinds.filter((k) => !migrate.includes(`"${k}"`));
  assert.deepEqual(thieu, [], `migrate() sẽ XOÁ các kind này khi nạp lại: ${thieu.join(", ")}`);
});
