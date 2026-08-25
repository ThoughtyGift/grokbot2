/**
 * Việc chạy nền — xem tasks.ts.
 *
 * Phần gọi model phải chạy thật nên kiểm bằng tay; chỗ ghim ở đây là **sổ tác vụ**, vì mọi sai sót
 * của nó đều làm model hiểu nhầm trạng thái công việc: một mã không tồn tại mà im lặng bỏ qua sẽ
 * khiến model tưởng việc đó đã chạy xong, và một việc còn đang chạy mà báo là xong thì nó đi tiếp
 * dựa trên kết quả chưa có.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTask, awaitTasks, tasksOf, runningCount, forgetFinishedTasks, resetTasks, taskById } from "./tasks.js";

const later = (ms: number, v: string) => () => new Promise<string>((r) => setTimeout(() => r(v), ms));

test("giao hai việc nền rồi thu cả hai bằng một lần chờ", async () => {
  resetTasks();
  const a = startTask("bot", "việc A", "làm A", later(30, "xong A"));
  const b = startTask("bot", "việc B", "làm B", later(60, "xong B"));
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(runningCount("bot"), 2);

  const out = await awaitTasks([(a as { id: string }).id, (b as { id: string }).id]);
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results.map((t) => t.result).sort(), ["xong A", "xong B"]);
  assert.equal(out.missing.length, 0);
  assert.equal(out.stillRunning.length, 0);
  assert.equal(runningCount("bot"), 0);
});

/** `missing_task_ids` có trong hợp đồng của hãng, và đây là lý do: im lặng là nói dối. */
test("hỏi một mã không có thì nói thẳng, không lặng lẽ trả danh sách ngắn hơn", async () => {
  resetTasks();
  const a = startTask("bot", "việc A", "làm A", later(10, "xong A")) as { id: string };
  const out = await awaitTasks([a.id, "task-khong-co-that"]);
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.missing, ["task-khong-co-that"]);
});

test("hết giờ chờ thì báo việc nào còn chạy, không coi là xong", async () => {
  resetTasks();
  const slow = startTask("bot", "việc chậm", "làm lâu", later(5000, "muộn")) as { id: string };
  const out = await awaitTasks([slow.id], 80);
  assert.equal(out.results.length, 0);
  assert.deepEqual(out.stillRunning, [slow.id]);
  assert.equal(taskById(slow.id)?.status, "running");
});

test("việc hỏng được ghi là hỏng, và không làm sập tiến trình", async () => {
  resetTasks();
  const bad = startTask("bot", "việc hỏng", "ném lỗi", () => Promise.reject(new Error("vỡ"))) as { id: string };
  const out = await awaitTasks([bad.id]);
  assert.equal(out.results[0].status, "error");
  assert.match(out.results[0].result ?? "", /vỡ/);
});

/** Trần việc nền là hàng rào chi phí: mỗi việc là một chuỗi gọi model chạy khi không ai nhìn. */
test("quá trần thì từ chối kèm lý do đọc được", async () => {
  resetTasks();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(startTask("bot", `v${i}`, "x", later(300, "ok")));
  const over = startTask("bot", "thừa", "x", later(10, "ok"));
  assert.ok("error" in over && /await_task/.test(over.error),
    "lời từ chối phải nói cách gỡ, không chỉ nói không");
  await awaitTasks(ids.map((t) => (t as { id: string }).id));
});

test("mỗi bot có sổ riêng", async () => {
  resetTasks();
  startTask("bot-1", "của bot 1", "x", later(10, "a"));
  startTask("bot-2", "của bot 2", "x", later(10, "b"));
  assert.equal(tasksOf("bot-1").length, 1);
  assert.equal(tasksOf("bot-2").length, 1);
  await awaitTasks(tasksOf("bot-1").concat(tasksOf("bot-2")).map((t) => t.id));
});

test("việc xong lâu rồi thì dọn, việc đang chạy thì không", async () => {
  resetTasks();
  const done = startTask("bot", "xong", "x", later(10, "ok")) as { id: string };
  const busy = startTask("bot", "còn chạy", "x", later(5000, "muộn")) as { id: string };
  await awaitTasks([done.id], 500);
  const n = forgetFinishedTasks(0, Date.now() + 1000);
  assert.equal(n, 1, "chỉ dọn việc đã kết thúc");
  assert.equal(taskById(done.id), undefined);
  assert.ok(taskById(busy.id), "việc đang chạy phải còn nguyên trong sổ");
});
