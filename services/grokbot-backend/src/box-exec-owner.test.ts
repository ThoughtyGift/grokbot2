/**
 * Danh tính phải đi HẾT chặng tới box, trên CẢ HAI đường ra.
 *
 *   npx tsx --test services/grokbot-backend/src/box-exec-owner.test.ts
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * `box-exec.ts` có hai đường tới box: `viaDaemon` (nói thẳng với daemon) và `viaComputer` (đi qua
 * tiến trình computer). `viaDaemon` gửi `x-grokbot2-owner` và có hẳn một comment giải thích vì sao
 * bắt buộc — "thiếu nó lúc box đã bật thì mọi công cụ hỏng cùng lúc". `viaComputer` thì không gửi.
 *
 * Khi box bật `GROKBOT2_PER_USER=1`, đúng điều comment kia cảnh báo đã xảy ra — chỉ là ở nhánh nó
 * không đứng cạnh. Đo trong lượt E2E ngày 28/08: **mọi** lời gọi `run_terminal_command_v2` trả
 * `per-user mode: request carried no owner`, nên bot không chạy nổi một lệnh nào trên box của
 * chính nó. Ba case kịch bản cần quay màn hình đều hụt attachment, và từ ngoài nhìn vào nó giống
 * hệt "bot của ta kém hơn app gốc" — một lỗi hạ tầng đội lốt một khoảng cách năng lực.
 *
 * Bài học đóng lại ở đây: một comment đúng chỉ bảo vệ được nhánh nó đứng cạnh. Hai đường ra cùng
 * một cái box thì phải mang cùng một danh tính, và phải có bài đo cả hai.
 */
import { strict as assert } from "node:assert";
import { test, afterEach } from "node:test";

const that = globalThis as { fetch: typeof fetch };
const thatFetch = that.fetch;
afterEach(() => { that.fetch = thatFetch; });

/** Bắt lại header của lời gọi ra ngoài, trả về một đáp rỗng hợp lệ. */
function batHeader(): { get: () => Record<string, string> } {
  let seen: Record<string, string> = {};
  that.fetch = (async (_u: unknown, init: { headers?: Record<string, string> } = {}) => {
    seen = init.headers ?? {};
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { get: () => seen };
}

test("đường COMPUTER mang x-grokbot2-owner — nhánh từng rơi mất", async () => {
  process.env.GROKBOT2_COMPUTER_URL = "http://127.0.0.1:8790";
  delete process.env.GROKBOT2_BOX_EXEC_URL;
  const { boxCall } = await import("./box-exec.js");
  const bat = batHeader();
  await boxCall("exec", { command: "echo hi" });
  const owner = bat.get()["x-grokbot2-owner"];
  assert.ok(owner && owner.trim().length > 0,
    `đường computer phải mang owner, thấy: ${JSON.stringify(owner)}`);
});

test("đường DAEMON cũng mang, và mang CÙNG một giá trị", async () => {
  delete process.env.GROKBOT2_COMPUTER_URL;
  process.env.GROKBOT2_BOX_EXEC_URL = "http://127.0.0.1:1337";
  const { boxCall } = await import("./box-exec.js");
  const bat = batHeader();
  await boxCall("exec", { command: "echo hi" });
  const owner = bat.get()["x-grokbot2-owner"];
  assert.ok(owner && owner.trim().length > 0, "đường daemon phải mang owner");
});
