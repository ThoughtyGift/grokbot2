/**
 * Tuỳ chọn MCP theo người — tắt tool và lời dặn riêng.
 *
 *   npx tsx --test services/grokbot-backend/src/mcp-prefs.test.ts
 *
 * Bài quan trọng nhất không phải "lưu rồi đọc lại được", mà là **hai người không đụng nhau**: lời
 * dặn cho server đi thẳng vào lời nhắc hệ thống, nên một kho dùng chung nghĩa là người này nhét
 * được câu chữ vào bot của người kia.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Thư mục kho — phải suy y hệt phần cài đặt, tức đọc `GROKBOT2_DATA_DIR` TRƯỚC.
 *
 * Trước đây dòng này suy đường dẫn từ vị trí module, và đó là một cái bẫy có hai nửa. Phiên trước
 * tôi vá nửa thứ nhất (phần cài đặt) mà để nguyên nửa này, nên kết quả TỆ HƠN lúc chưa vá:
 *
 *   - phần cài đặt ghi vào thư mục tạm mà runner dựng   → đúng
 *   - `sach()` ở đây đi xoá `.data/` THẬT của người dùng → mỗi lần chạy test là một lần xoá
 *   - thư mục tạm không bao giờ được dọn                → rác dồn giữa các bài, và bài
 *     "đọc không được để lại dấu vết gì" đỏ vì đọc trúng rác của bài trước
 *
 * Mười bài đỏ chỉ là triệu chứng; cái mất là dữ liệu. Vá một nửa một cái bẫy thì cái bẫy vẫn còn,
 * chỉ khác là nó không còn báo động nữa.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "mcp-prefs");
const sach = (): void => { try { rmSync(DIR, { recursive: true, force: true }); } catch { /* chưa có */ } };

const { isToolDisabled, disabledToolsOf, toggleToolDisabled, customInstructionsOf, allInstructions, setCustomInstructions } =
  await import("./mcp-prefs.js");

const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";

test("bật/tắt tool: trả trạng thái SAU khi đổi, và đảo được", () => {
  sach();
  // Client vẽ lại theo giá trị trả về; trả `{}` là buộc nó đoán.
  assert.deepEqual(toggleToolDisabled("github", "create_issue", A), { serverId: "github", toolName: "create_issue", disabled: true });
  assert.equal(isToolDisabled("github", "create_issue", A), true);
  assert.deepEqual(toggleToolDisabled("github", "create_issue", A), { serverId: "github", toolName: "create_issue", disabled: false });
  assert.equal(isToolDisabled("github", "create_issue", A), false);
});

test("tắt tool của server này KHÔNG chạm server kia", () => {
  sach();
  toggleToolDisabled("github", "search", A);
  assert.deepEqual(disabledToolsOf("github", A), ["search"]);
  assert.deepEqual(disabledToolsOf("slack", A), []);
  assert.equal(isToolDisabled("slack", "search", A), false, "cùng tên tool, khác server");
});

test("hai người hai kho — tắt tool của A không tắt của B", () => {
  sach();
  toggleToolDisabled("github", "delete_repo", A);
  assert.equal(isToolDisabled("github", "delete_repo", A), true);
  assert.equal(isToolDisabled("github", "delete_repo", B), false);
});

test("lời dặn theo NGƯỜI — đây là câu chữ đi vào lời nhắc hệ thống", () => {
  sach();
  setCustomInstructions("github", "Chỉ đọc, không tạo issue.", A);
  setCustomInstructions("github", "Của người B.", B);
  assert.equal(customInstructionsOf("github", A), "Chỉ đọc, không tạo issue.");
  assert.equal(customInstructionsOf("github", B), "Của người B.");
  // Nếu một ngày kho này thành dùng chung, bài này phải đỏ: nhét chữ vào lời nhắc của người khác
  // là chiếm quyền điều khiển bot của họ, không phải bất tiện nhỏ.
  assert.deepEqual(allInstructions(A), { github: "Chỉ đọc, không tạo issue." });
});

test("chuỗi rỗng là cách nói 'bỏ lời dặn'", () => {
  sach();
  setCustomInstructions("github", "abc", A);
  assert.equal(setCustomInstructions("github", "   ", A).instructions, "");
  assert.equal(customInstructionsOf("github", A), "");
  assert.deepEqual(allInstructions(A), {});
});

test("lời dặn bị cắt ở 2000 ký tự — nó đi vào MỌI lượt chat", () => {
  sach();
  const r = setCustomInstructions("github", "x".repeat(5000), A);
  assert.equal(r.instructions.length, 2000);
});

test("đối số thiếu thì không nổ, không ghi bậy", () => {
  sach();
  assert.deepEqual(toggleToolDisabled("", "x", A), { serverId: "", toolName: "x", disabled: false });
  assert.deepEqual(toggleToolDisabled("s", "", A), { serverId: "s", toolName: "", disabled: false });
  assert.deepEqual(setCustomInstructions("", "abc", A), { serverId: "", instructions: "" });
  assert.deepEqual(allInstructions(A), {});
});

test("dọn", () => { sach(); });
