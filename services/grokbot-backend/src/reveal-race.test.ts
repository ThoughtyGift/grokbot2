/**
 * Hiện dần KHÔNG được ghi đè chữ mà lượt tool vừa đặt lại.
 *
 *   npx tsx --test services/grokbot-backend/src/reveal-race.test.ts
 *
 * ── Lỗi có thật, đo ngày 2026-08-29 ─────────────────────────────────────────────────────────────
 *
 * Một bong bóng chat hiện nguyên `TOOL_CALL: edit_file_v2({…7,6 KB JSON…})` cho người dùng đọc, và
 * nó đã CHỐT (`streaming=false`) nên không tự sửa nữa. Bản ghi đo được: 7919 ký tự, trong đó 7672
 * là lời gọi thô.
 *
 * Không phải lỗi bộ bóc — chạy `parseToolCalls` trên đúng văn bản ấy trả về 1 lời gọi, ngoặc cân
 * đối, `hasIncompleteToolCall` = false. Là một CUỘC ĐUA:
 *
 *   reveal(bubble, r.text)     nhịp đầu chạy ngay, ~23 nhịp còn lại rải trong ~1 giây
 *   setText(bubble, spoken)    lượt tool gỡ `TOOL_CALL: …` ra khỏi chữ hiển thị
 *   nhịp cuối của reveal       setText(target, full) — GHI LẠI TOÀN VĂN, rồi streaming=false
 *
 * Chỉ `reveal` mới ghi toàn văn kèm `streaming=false`, nên nó là bên ghi cuối cùng.
 *
 * ── Vì sao đo bằng đồng hồ giả ──────────────────────────────────────────────────────────────────
 *
 * Đây là lỗi theo THỜI GIAN. Đọc mã thì lần trước đã đọc qua nó rồi — `reveal` trông hoàn toàn
 * bình thường khi đọc một mình. Chỉ khi cho nhịp muộn nổ sau lúc gỡ thì nó mới lộ ra.
 *
 * Bài thứ hai cố ý dựng lại ĐÚNG lỗi cũ (không gọi `stopReveal`) để chứng minh đồng hồ giả thật sự
 * chạm tới đường đó — một bài test không thể hỏng thì không chứng minh được gì.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { reveal, stopReveal } from "./runtime/turn.js";
import type { Entry } from "./conversation/types.js";

/**
 * Cho MỌI nhịp còn lại nổ hết.
 *
 * `mock.timers.tick(120_000)` một phát KHÔNG đủ: `reveal` tự lên lịch nhịp kế bên trong nhịp hiện
 * tại, và đồng hồ giả của Node không chạy tiếp chuỗi sinh ra GIỮA một lần tick. Bản đầu của bài này
 * tick một phát rồi xanh — xanh rỗng, vì chuỗi mới đi được một nhịp. Chỉ phát hiện ra nhờ bài
 * "dựng lại lỗi cũ" bên dưới ĐỎ: nó đáng lẽ phải thấy toàn văn mà chỉ thấy một phần.
 */
const choChay = (): void => { for (let i = 0; i < 60; i += 1) mock.timers.tick(50); };

/** Đọc/ghi chữ qua đúng nhánh của union, không ép kiểu — `Entry` còn có nhánh `tool-call` không có `message`. */
const chu = (e: Entry): string => (e.kind === "send-message" && e.message.type === "text" ? e.message.content : "");
const datChu = (e: Entry, v: string): void => {
  if (e.kind === "send-message" && e.message.type === "text") e.message.content = v;
};
/** `streaming` cũng chỉ có ở nhánh `send-message`. */
const chot = (e: Entry): void => { if (e.kind === "send-message") e.streaming = false; };

const bongBong = (): Entry => ({
  id: "e-thu", kind: "send-message", author: { id: "a", name: "bot" },
  message: { type: "text", content: "" }, timestampMs: 0, streaming: true,
} as Entry);

/** Đủ dài để `reveal` phải chia nhiều nhịp thay vì xong ngay ở nhịp đầu. */
const TOAN_VAN = `Mình gộp ba bản SOP lại nhé.\n\nTOOL_CALL: edit_file_v2({"path":"sop.md","body":"${"x ".repeat(400)}"})`;
const LOI_KE = "Mình gộp ba bản SOP lại nhé.";

test("dừng hiện dần rồi thì nhịp muộn không được ghi đè", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const e = bongBong();
    reveal(e, TOAN_VAN, "agent-thu");
    const dangDo = chu(e);
    assert.ok(dangDo.length > 0, "nhịp đầu phải chạy ngay");
    assert.ok(dangDo.length < TOAN_VAN.length, "và mới hiện được một phần");

    // Đúng thứ tự lượt tool làm: dừng hiện dần, rồi đặt lại chữ đã gỡ lời gọi.
    stopReveal(e);
    datChu(e, LOI_KE);
    chot(e);

    choChay();   // cho mọi nhịp còn lại nổ hết

    assert.equal(chu(e), LOI_KE,
      "nhịp muộn đã ghi đè lên chữ lượt tool vừa đặt");
    assert.ok(!chu(e).includes("TOOL_CALL:"),
      "và lời gọi thô lọt lại vào bong bóng chat");
  } finally {
    mock.timers.reset();
  }
});

test("KHÔNG dừng thì nó ghi lại toàn văn — đúng đường đã gây lỗi", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const e = bongBong();
    reveal(e, TOAN_VAN, "agent-thu");
    datChu(e, LOI_KE);   // gỡ mà quên dừng
    chot(e);

    choChay();

    // Đây là hành vi CŨ, dựng lại để chứng minh bài trên thật sự đo đúng đường đó.
    assert.equal(chu(e), TOAN_VAN);
    assert.ok(chu(e).includes("TOOL_CALL:"));
  } finally {
    mock.timers.reset();
  }
});

test("một lượt reveal mới huỷ lượt cũ, không để hai chuỗi cùng ghi", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const e = bongBong();
    reveal(e, `${"cu ".repeat(500)}`, "agent-thu");
    reveal(e, `${"moi ".repeat(500)}`, "agent-thu");
    choChay();
    const cuoi = chu(e);
    assert.ok(cuoi.startsWith("moi"), `lượt cũ vẫn còn ghi: ${cuoi.slice(0, 40)}`);
    assert.ok(!cuoi.includes("cu "), "hai chuỗi trộn vào nhau");
  } finally {
    mock.timers.reset();
  }
});
