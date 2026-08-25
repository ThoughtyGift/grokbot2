/**
 * Việc chạy nền — `task` và `await_task` trong danh mục của bản gốc.
 *
 * Bên mình đã có `task_v2`: giao một việc cho subagent và **đứng chờ**. Thứ còn thiếu là nửa kia —
 * giao ba việc cùng lúc rồi thu kết quả sau. Hợp đồng của hãng nói rõ điều đó: `TaskParams` có cờ
 * `async`, và `TaskResult` là `oneof { completed_task_result | async_task_result }` — chạy xong thì
 * trả kết quả, chạy nền thì trả một cái mã. `AwaitTaskParams` nhận `ids` (số nhiều) và `AwaitTaskResult`
 * trả về `task_results` **cùng với** `missing_task_ids`.
 *
 * `missing_task_ids` là chi tiết đáng chép lại: hỏi một mã không tồn tại phải được nói thẳng, chứ
 * không lặng lẽ trả về danh sách ngắn hơn. Model đếm kết quả để biết việc nào xong, và một danh
 * sách thiếu không lời giải thích khiến nó tưởng việc đó đã chạy.
 */
export interface BackgroundTask {
  id: string;
  agentId: string;
  title: string;
  description: string;
  status: "running" | "done" | "error";
  result?: string;
  startedAtMs: number;
  finishedAtMs?: number;
}

/** Trần việc nền mỗi bot. Mỗi việc là một chuỗi gọi model, nên thả nổi là đốt hạn mức lúc không ai nhìn. */
const MAX_RUNNING = Number(process.env.GROKBOT2_MAX_BACKGROUND_TASKS ?? 4);
/** `await_task` chờ tối đa chừng này rồi báo cái nào còn chạy — treo vô hạn thì lượt chết luôn. */
const AWAIT_TIMEOUT_MS = Number(process.env.GROKBOT2_AWAIT_TASK_MS ?? 300_000);

const tasks = new Map<string, BackgroundTask>();
const running = new Map<string, Promise<string>>();
let seq = 1;

export const taskById = (id: string): BackgroundTask | undefined => tasks.get(id);
export const tasksOf = (agentId: string): BackgroundTask[] =>
  [...tasks.values()].filter((t) => t.agentId === agentId).sort((a, b) => a.startedAtMs - b.startedAtMs);
export const runningCount = (agentId: string): number =>
  tasksOf(agentId).filter((t) => t.status === "running").length;

/**
 * Bắt đầu một việc nền.
 *
 * `run` được gọi ngay và promise của nó giữ lại; lỗi bị bắt tại đây chứ không để nổi lên thành
 * unhandled rejection — một việc nền hỏng không được phép giết cả tiến trình máy chủ.
 */
export function startTask(
  agentId: string,
  title: string,
  description: string,
  run: () => Promise<string>,
  onFinish?: (t: BackgroundTask) => void,
): BackgroundTask | { error: string } {
  if (runningCount(agentId) >= MAX_RUNNING) {
    return { error: `đang có ${MAX_RUNNING} việc nền chạy rồi — chờ bớt bằng await_task trước khi giao thêm` };
  }
  const t: BackgroundTask = {
    id: `task-${seq++}`, agentId, title, description,
    status: "running", startedAtMs: Date.now(),
  };
  tasks.set(t.id, t);
  const p = run().then(
    (out) => { t.status = "done"; t.result = out; t.finishedAtMs = Date.now(); onFinish?.(t); return out; },
    (e: Error) => {
      t.status = "error"; t.result = `lỗi: ${e.message}`; t.finishedAtMs = Date.now();
      onFinish?.(t);
      return t.result;
    },
  );
  running.set(t.id, p);
  return t;
}

export interface AwaitOutcome {
  results: BackgroundTask[];
  /** Mã không có trong sổ — trả về đúng như `missing_task_ids` của hãng. */
  missing: string[];
  /** Hết giờ mà vẫn chạy. Nói ra thay vì im lặng coi như xong. */
  stillRunning: string[];
}

export async function awaitTasks(ids: string[], timeoutMs = AWAIT_TIMEOUT_MS): Promise<AwaitOutcome> {
  const missing = ids.filter((id) => !tasks.has(id));
  const known = ids.filter((id) => tasks.has(id));
  const waits = known.map((id) => running.get(id)).filter(Boolean) as Promise<string>[];

  if (waits.length) {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((res) => { timer = setTimeout(res, timeoutMs); timer.unref?.(); });
    await Promise.race([Promise.allSettled(waits), deadline]);
    if (timer) clearTimeout(timer);
  }

  const results = known.map((id) => tasks.get(id)!).filter((t) => t.status !== "running");
  const stillRunning = known.filter((id) => tasks.get(id)!.status === "running");
  return { results, missing, stillRunning };
}

/** Dọn việc đã xong quá lâu, để sổ không phình mãi trong một tiến trình chạy nhiều ngày. */
export function forgetFinishedTasks(olderThanMs = 3_600_000, nowMs = Date.now()): number {
  let n = 0;
  for (const [id, t] of tasks) {
    if (t.status === "running") continue;
    if (nowMs - (t.finishedAtMs ?? t.startedAtMs) < olderThanMs) continue;
    tasks.delete(id); running.delete(id); n += 1;
  }
  return n;
}

/** Chỉ dùng trong test: xoá sạch sổ giữa các bài. */
export function resetTasks(): void { tasks.clear(); running.clear(); seq = 1; }
