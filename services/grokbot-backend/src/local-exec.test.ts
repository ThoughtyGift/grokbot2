/**
 * Chạy việc trên máy THẬT của người dùng — phần kiểm được mà không cần daemon.
 *
 *   npx tsx --test services/grokbot-backend/src/local-exec.test.ts
 *
 * ── Ranh giới của bài này ───────────────────────────────────────────────────────────────────────
 *
 * Đường ống thật đã đo bằng tay, trên máy Windows thật, qua backend đang chạy:
 *
 *     hostname -> stdout "DESKTOP-7D2FJG8\r\n", exitCode 0, cwd "C:\Users\admin"
 *     read C:/Windows/... -> "Path is outside the allowed local-exec root and was refused"
 *
 * Không lặp lại được ở đây: hàng đợi `local-exec` nằm trong bộ nhớ tiến trình máy chủ, và daemon
 * treo long-poll vào CHÍNH tiến trình đó. Một tiến trình test dựng hàng đợi thứ hai, rỗng.
 *
 * Nên bài này khoá đúng những gì kiểm được mà không nói dối: ánh xạ sang thẻ quyền, và hành vi khi
 * KHÔNG có máy nào nối — vốn là đường mà người dùng gặp thường xuyên nhất.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionOf, targetOf, connectedMachine, connectedMachines, findMachine, userComputerConnected, runOnUserComputer } from "./local-exec.js";

test("mỗi việc ánh xạ sang đúng hành động của thẻ xin quyền", () => {
  // Khớp `describeLocalExec` trong daemon: shell -> run-command, read -> read-file, ls -> list-directory.
  assert.equal(actionOf({ kind: "shell", command: "hostname" }), "run-command");
  assert.equal(actionOf({ kind: "read", path: "C:/x.txt" }), "read-file");
  assert.equal(actionOf({ kind: "ls", path: "C:/" }), "list-directory");
});

test("thẻ quyền hiện đúng thứ người dùng cần đọc để quyết định", () => {
  // Với lệnh thì là CHÍNH lệnh đó — không phải tên tool, không phải một câu tóm tắt.
  assert.equal(targetOf({ kind: "shell", command: "Remove-Item -Recurse C:/Users/admin/x" }),
    "Remove-Item -Recurse C:/Users/admin/x");
  assert.equal(targetOf({ kind: "read", path: "C:/Users/admin/.ssh/id_rsa" }), "C:/Users/admin/.ssh/id_rsa");
});

test("không máy nào nối thì danh sách rỗng và tìm theo tên trả null", () => {
  // Bảng Settings → Computer đọc danh sách này. Trả một máy đã rớt là vẽ ra một máy không nhận việc.
  assert.deepEqual(connectedMachines(), []);
  assert.equal(findMachine("Admin-PC"), null);
  assert.equal(findMachine(""), null);
});

test("không máy nào nối thì `connectedMachine` trả null, không trả bản ghi cũ", () => {
  // Quan trọng: sau khi daemon rớt, một `label` còn sót lại đọc y như đang nối. Bản ghi máy bị gỡ
  // ngay trong `res.on("close")` của luồng SSE, nên danh sách không bao giờ giữ một máy đã đi.
  assert.equal(userComputerConnected(), false);
  assert.equal(connectedMachine(), null);
});

test("chỉ định một máy không nối thì DỪNG, không im lặng rơi sang máy khác", async () => {
  /*
   * Đây là lỗi tệ nhất của phần nhiều máy, vì nó KHÔNG lộ ra từ kết quả.
   *
   * Người dùng bảo "chạy trên Admin-PC"; nếu Admin-PC không nối mà ta lặng lẽ gửi sang
   * DESKTOP-7D2FJG8 thì lệnh chạy xong, trả về stdout hợp lệ, và không ai biết nó chạy nhầm máy.
   */
  const r = await runOnUserComputer({ kind: "shell", command: "hostname" }, { machineId: "Admin-PC" });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /Admin-PC/, "phải nhắc tên máy đã yêu cầu");
  assert.match(String(r.error), /không (thấy|máy nào)/, "và nói rõ là không tìm thấy, không phải lỗi lệnh");
});

test("không có daemon thì trả lỗi rõ ràng, KHÔNG treo mãi", async () => {
  // Nếu hàm này treo thì cả lượt của bot treo theo, và người dùng chỉ thấy con bot đứng im.
  const t0 = Date.now();
  const r = await runOnUserComputer({ kind: "shell", command: "hostname" }, { timeoutMs: 300 });
  const troi = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.match(String(r.error), /không trả lời/);
  assert.ok(troi < 5_000, `phải bỏ cuộc theo timeoutMs, nhưng mất ${troi}ms`);
});
