/**
 * Lượt NỐI TIẾP (sau widget · bí mật · form · duyệt tool · thử lại) phải bật lại cờ `isRunning`.
 *
 * Đo 06/09 trên VPS (Thợ dựng bot, agent-45): người dùng bấm "Đưa lên Marketplace" lúc 164,1 s, bot viết câu đầu lúc
 * 176,3 s — suốt 12 s ấy roster báo `isRunning:false`, `currentActivity` rỗng: client không quay spinner, còn bài đo
 * `e2e-tho-dung-bot` đọc cờ ấy kết luận "lượt 2 xong sau 8 s" và xoá bot mới đúng lúc bot sắp gọi `share_bot_template`.
 * Gốc: `continueAfterTool`/`continueAfterTools`/nhánh thử-lại gọi thẳng `runTurn`, bỏ qua `startTurn` — nơi duy nhất
 * đặt `isRunning:true`; mà lượt đầu đã `clearPresence` khi đỗ lại chờ widget.
 *
 * Bài này đọc MÃ NGUỒN (như `anh-song-qua-tool.test.ts`) vì `turn.ts` kéo cả pool lẫn box: mỗi chỗ đặt `inflight` cho
 * một lượt nối tiếp phải đi kèm `batLaiCoChay(agentId)` ngay dòng sau.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nguon = readFileSync(new URL("./runtime/turn.ts", import.meta.url), "utf8");

const thanHam = (ten: string): string => {
  const i = nguon.indexOf(`function ${ten}(`);
  assert.ok(i >= 0, `không thấy hàm ${ten}`);
  const j = nguon.indexOf("\nfunction ", i + 1);
  return nguon.slice(i, j < 0 ? undefined : j);
};

test("continueAfterTool và continueAfterTools bật lại cờ chạy ngay sau khi đặt inflight", () => {
  for (const ten of ["continueAfterTool", "continueAfterTools"]) {
    const than = thanHam(ten);
    assert.match(than, /inflight\.set\(agentId, controller\);\s*\n\s*batLaiCoChay\(agentId\);/, `${ten}: thiếu batLaiCoChay sau inflight.set`);
  }
});

test("nhánh thử lại khi model trả JSON thô cũng bật lại cờ chạy", () => {
  assert.match(nguon, /inflight\.set\(agentId, c\); batLaiCoChay\(agentId\);/);
});

test("batLaiCoChay đặt đúng bộ cờ mà startTurn đặt: isRunning + thinking", () => {
  const i = nguon.indexOf("const batLaiCoChay");
  assert.ok(i >= 0, "không thấy batLaiCoChay");
  const doan = nguon.slice(i, i + 400);
  assert.match(doan, /isRunning: true/);
  assert.match(doan, /kind: "thinking"/);
});
