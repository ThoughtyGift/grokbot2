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

/*
 * ── Ba việc thêm 06/09: write · spawn · stdin (bảng theo dõi §5 mục 11) ─────────────────────────
 *
 * Hình dạng dây ghim ở đây là thứ ĐỌC từ daemon 0.43 (`local-exec-daemon/main.cjs`), không phải thứ
 * đoán: `parseSandLocalExecRequestFrame` nhận `{kind:"upload", requestId, path, bytesBase64}`;
 * `describeLocalExec` xếp `backgroundShellSpawnArgs` vào `run-command`, `writeShellStdinArgs` vào
 * `send-input`; nhánh upload được mô tả là `write-file` ngay chỗ nhận khung. Đường thật đo bằng cửa
 * `/internal/ops/local-exec` trên máy Windows đang nối — xem bảng theo dõi §2.
 */
import { khungGui, tepDauRaNen } from "./local-exec.js";

test("write đi bằng khung upload riêng, không bọc trong serverMessage", () => {
  const k = khungGui({ kind: "write", path: "C:/Users/admin/ghi-chu.txt", bytesBase64: "eGluIGNow6Bv" }, "may-1", "req-9", "ap-3");
  assert.deepEqual(k, { kind: "upload", requestId: "req-9", path: "C:/Users/admin/ghi-chu.txt", bytesBase64: "eGluIGNow6Bv", approvalId: "ap-3" });
  assert.equal(actionOf({ kind: "write", path: "x", bytesBase64: "" }), "write-file");
  assert.equal(targetOf({ kind: "write", path: "C:/x.txt", bytesBase64: "" }), "C:/x.txt");
});

test("spawn là backgroundShellSpawnArgs; stdin là writeShellStdinArgs{shellId,chars} (daemon chưa có handler — chỉ để đo)", () => {
  const s = khungGui({ kind: "spawn", command: "ping -t 127.0.0.1", cwd: "C:/tmp", description: "giữ mạng" }, "may-1", "req-1");
  assert.equal(s.kind, "exec");
  const sm = s.serverMessage as Record<string, Record<string, unknown>>;
  assert.equal(sm.machineId, "may-1", "daemon so machineId trước khi nhận việc");
  assert.deepEqual(sm.backgroundShellSpawnArgs, {
    command: "ping -t 127.0.0.1", workingDirectory: "C:/tmp", toolCallId: "req-1", description: "giữ mạng",
  });
  assert.equal(actionOf({ kind: "spawn", command: "x" }), "run-command", "daemon xếp lệnh nền vào run-command");
  assert.equal(targetOf({ kind: "spawn", command: "npm run dev" }), "npm run dev");

  const i = khungGui({ kind: "stdin", shellId: 7, chars: "y\n" }, "may-1", "req-2");
  assert.deepEqual((i.serverMessage as Record<string, unknown>).writeShellStdinArgs, { shellId: 7, chars: "y\n" });
  assert.equal(actionOf({ kind: "stdin", shellId: 7, chars: "y\n" }), "send-input");
  // Thẻ quyền hiện CHÍNH chuỗi sẽ gõ — người dùng phải đọc được mình đang cho phép gõ gì.
  assert.equal(targetOf({ kind: "stdin", shellId: 7, chars: "rm -rf x\n" }), "rm -rf x\n");
});

test("tệp đầu ra lệnh nền: <terminalsFolder>/<shellId>.txt, đúng dấu ngăn của máy", () => {
  assert.equal(tepDauRaNen({ terminalsFolder: "C:\\Users\\admin\\terminals" }, 3), "C:\\Users\\admin\\terminals\\3.txt");
  assert.equal(tepDauRaNen({ terminalsFolder: "/Users/an/terminals/" }, 12), "/Users/an/terminals/12.txt");
  // hello cũ không có terminalsFolder thì suy từ localRoot — daemon đặt nó ở `<root>/terminals`.
  assert.equal(tepDauRaNen({ localRoot: "C:\\Users\\admin" }, 1), "C:\\Users\\admin\\terminals\\1.txt");
});

test("không có daemon thì write cũng bỏ cuộc theo timeoutMs với câu rõ", async () => {
  const r = await runOnUserComputer({ kind: "write", path: "C:/Users/admin/x.txt", bytesBase64: "eA==" }, { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /không trả lời/);
});

test("download là khung riêng {kind:'download', path} và mang hành động read-file trên thẻ", () => {
  const k = khungGui({ kind: "download", path: "C:/Users/admin/Desktop/clip.mp4" }, "may-1", "req-5");
  assert.deepEqual(k, { kind: "download", requestId: "req-5", path: "C:/Users/admin/Desktop/clip.mp4" });
  assert.equal(actionOf({ kind: "download", path: "x" }), "read-file");
  assert.equal(targetOf({ kind: "download", path: "C:/x.bin" }), "C:/x.bin");
});
