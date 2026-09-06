/**
 * Bối cảnh cho lớp tự soát phải mang lời NGƯỜI DÙNG — kể cả khi lượt dài đẩy tin ấy khỏi đuôi.
 *
 * Đo 06/09 trên VPS: Thợ dựng bot nhận một tin nêu đủ shop + nhịp chạy, rồi qua ba câu tiến độ + ba tool-call mới gọi
 * `create_routine`. `boiCanhGanNhat` bản cũ lấy 6 entry cuối (toàn tool-call và câu tiến độ) nên người soát không thấy
 * lời người dùng nào và trả *"người dùng chưa đồng ý nhịp chạy"* — 3/4 routine ra thẻ duyệt dù đúng yêu cầu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, transcripts, tail } from "./chat/state.js";
import { boiCanhGanNhat } from "./runtime/tools.js";

const botThu = (id: string): void => {
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
};
let n = 0;
const nguoiDung = (id: string, content: string) => tail(id).push({ id: `e${++n}`, kind: "message", role: "user", content, timestampMs: Date.now() } as never);
const botNoi = (id: string, content: string) => tail(id).push({ id: `e${++n}`, kind: "send-message", author: { id, name: id }, message: { type: "text", content }, timestampMs: Date.now() } as never);
const tool = (id: string, name: string) => tail(id).push({ id: `e${++n}`, kind: "tool-call", toolCallId: `t${n}`, name, rawArgs: "{}", summary: name, status: "done", timestampMs: Date.now() } as never);

test("lượt dựng dài: tin người dùng vẫn đứng đầu bối cảnh dù đã bị 6+ entry đẩy khỏi đuôi", () => {
  const a = "soat-a"; botThu(a);
  nguoiDung(a, "Mình cần bot cho shop Z05R, gom bình luận TikTok, chạy mỗi tối 21h.");
  botNoi(a, "Ok, dựng ngay."); tool(a, "create_agent");
  botNoi(a, "Skill đầu xong."); tool(a, "create_workflow");
  botNoi(a, "Hai skill xong. Giờ đặt nhịp 21h."); tool(a, "create_workflow");
  tool(a, "create_routine");
  const bc = boiCanhGanNhat(a);
  assert.ok(bc.startsWith("NGƯỜI DÙNG: Mình cần bot cho shop Z05R"), bc);
  assert.match(bc, /21h/);
  assert.equal(bc.split("\n").filter((l) => l.startsWith("NGƯỜI DÙNG")).length, 1, "không lặp tin người dùng");
});

test("tool-call không ăn cửa sổ: sáu DÒNG CHỮ gần nhất, không phải sáu entry", () => {
  const a = "soat-b"; botThu(a);
  nguoiDung(a, "câu hỏi");
  for (let i = 1; i <= 4; i++) { botNoi(a, `tiến độ ${i}`); tool(a, "x"); tool(a, "y"); }
  const dong = boiCanhGanNhat(a).split("\n");
  assert.deepEqual(dong, ["NGƯỜI DÙNG: câu hỏi", "BOT: tiến độ 1", "BOT: tiến độ 2", "BOT: tiến độ 3", "BOT: tiến độ 4"]);
});

test("tin người dùng còn trong cửa sổ thì giữ đúng thứ tự, không nhân đôi", () => {
  const a = "soat-c"; botThu(a);
  botNoi(a, "cũ"); nguoiDung(a, "mới"); botNoi(a, "đáp");
  assert.equal(boiCanhGanNhat(a), "BOT: cũ\nNGƯỚI DÙNG: mới\nBOT: đáp".replace("NGƯỚI", "NGƯỜI"));
});

test("bản ghi rỗng → chuỗi rỗng, không ném", () => {
  const a = "soat-d"; botThu(a);
  assert.equal(boiCanhGanNhat(a), "");
});
