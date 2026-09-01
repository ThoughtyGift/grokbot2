/**
 * Ảnh người dùng gửi phải sống qua các bước tool của cùng một lượt.
 *
 *   npx tsx --test services/grokbot-backend/src/anh-song-qua-tool.test.ts
 *
 * ── Bug đo được 01/09 ───────────────────────────────────────────────────────────────────────────
 *
 * Người dùng kéo một sơ đồ vào khung chat. Bot trả lời: "Tin nhắn tới chỗ mình trống, không có ảnh
 * nào hiện ra cả", kèm một câu về `/tmp/oc-img-…`. Ảnh vẫn hiện trong hội thoại, và gửi thẳng cùng
 * tấm ấy lên pool thì model mô tả đúng nội dung — nên kho ảnh và đường truyền đều lành.
 *
 * Chỗ hỏng là vòng đời: `runTurn` nhận `image` ở bước đầu; `continueAfterTool` chỉ truyền ảnh do
 * TOOL tạo. Model gọi đúng một tool là ảnh người dùng biến mất khỏi mọi bước sau.
 *
 * Bài này khoá hai chiều: ảnh còn trong lượt, và KHÔNG rò sang lượt kế.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const nguon = readFileSync(join("services", "grokbot-backend", "src", "runtime", "turn.ts"), "utf8");

test("có kho ảnh riêng cho lượt, tách khỏi ảnh do tool tạo", () => {
  // `pendingVision` là ảnh TOOL vừa chụp/trích; `anhCuaLuot` là ảnh NGƯỜI DÙNG đính vào.
  // Trộn hai thứ vào một Map là mất một trong hai, và bug ở trên chính là mất cái thứ hai.
  assert.match(nguon, /const anhCuaLuot = new Map<string, string>\(\)/);
  assert.match(nguon, /const pendingVision = new Map<string, string>\(\)/);
});

test("bước sau tool dùng ảnh tool TRƯỚC, rồi mới tới ảnh người dùng", () => {
  // Thứ tự quan trọng: model vừa xin nhìn một ảnh thì phải thấy đúng ảnh đó, không phải ảnh cũ.
  assert.match(nguon, /pendingVision\.get\(agentId\) \?\? anhCuaLuot\.get\(agentId\)/);
});

test("lượt kết thúc thì QUÊN ảnh — không rò sang lượt sau", () => {
  // Giữ lại thì lượt sau trả lời về một tấm ảnh người dùng không hề nhắc tới.
  assert.match(nguon, /anhCuaLuot\.delete\(agentId\)/);
  const iClear = nguon.indexOf("const clearPresence");
  const iDelete = nguon.indexOf("anhCuaLuot.delete(agentId)", iClear);
  assert.ok(iClear >= 0 && iDelete > iClear && iDelete - iClear < 400,
    "phải xoá ngay trong clearPresence — đó là chỗ MỌI đường thoát của lượt đi qua");
});
