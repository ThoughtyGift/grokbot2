/**
 * "Mảng đang mở" — dữ kiện quyết định bot mời chọn tiếp hay trả lời thẳng.
 *
 *   npx tsx --test services/grokbot-backend/src/ngu-canh-moi-chon.test.ts
 *
 * ── Vì sao đây là một hàm chứ không phải một câu trong lời nhắc ─────────────────────────────────
 *
 * Hai ca parity còn lệch là hai đầu của cùng một cái núm: vặn cho bot mời chọn nhiều hơn thì ca
 * "biết edit video" khá lên và ca "tự đăng ký giúp" hỏng, vặn ngược lại thì ngược lại. Ba vòng sửa
 * luật văn xuôi đều đứng ở 21/23.
 *
 * Đọc bản ghi app gốc thì ranh giới không nằm ở câu chữ mà ở NGỮ CẢNH — case 15 và case 19 gần như
 * cùng một câu ("bạn biết edit video luôn không" / "bạn biết edit video ko") nhưng case 15 là lần
 * đầu chạm mảng video nên app gốc tra catalog rồi mời chọn, còn case 19 thì OBS đã gắn và clip vừa
 * quay xong nên nó trả gọn và đề nghị đúng một bước. Model không đọc được điều đó từ chữ; nó cần
 * biết mình VỪA mời chọn cái gì.
 *
 * Nên bài này khoá phần ĐẾM ĐƯỢC của dữ kiện ấy — có hay không, cách bao nhiêu lượt, đã chọn chưa.
 * Phần "model có dùng dữ kiện đúng cách không" thì chỉ `parity-lap` trả lời được, và nó cần pool.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, transcripts, tail } from "./chat/state.js";
import { nguCanhMoiChon } from "./runtime/turn.js";

let dem = 0;
/** Bot riêng cho mỗi bài — bản ghi dùng chung là chỗ hai bài ăn kết quả của nhau. */
const botThu = (): string => {
  const id = `ngucanh-${(dem += 1)}-${Math.random().toString(36).slice(2, 7)}`;
  agents.set(id, { id, name: `bot ${id}`, createdAt: Date.now() } as never);
  transcripts.set(id, []);
  return id;
};

let ent = 0;
const themWidget = (id: string, prompt: string, respondedValue?: string): void => {
  tail(id).push({
    id: `w${(ent += 1)}`, kind: "send-message", author: { kind: "agent", id, name: "bot" },
    message: { type: "widget", widget: { prompt, options: [{ label: "A" }, { label: "Thôi" }] } },
    timestampMs: Date.now(), ...(respondedValue ? { respondedValue } : {}),
  } as never);
};
const themTinNguoi = (id: string, content: string): void => {
  tail(id).push({
    id: `m${(ent += 1)}`, kind: "message", role: "user", content, timestampMs: Date.now(),
  } as never);
};

test("chưa mời chọn lần nào thì KHÔNG thêm gì vào lời nhắc", () => {
  const a = botThu();
  themTinNguoi(a, "bạn biết edit video luôn không");
  // Lần đầu chạm một mảng: đây đúng là lúc app gốc TRA rồi mời chọn (case 15). Thêm dữ kiện "mảng
  // đang mở" vào đây là bảo bot đừng mời chọn ở chính ca nó phải mời — hỏng đúng đầu núm kia.
  assert.equal(nguCanhMoiChon(a), "", "không có widget nào trước đó thì không có mảng nào đang mở");
});

test("vừa mời chọn xong thì nói rõ là NGAY LƯỢT TRƯỚC, kèm câu đã hỏi", () => {
  const a = botThu();
  themWidget(a, "Làm tiếp cái nào?", "Gắn MCP điều khiển OBS");
  const s = nguCanhMoiChon(a);
  assert.match(s, /Mảng đang mở/);
  assert.match(s, /ngay lượt trước/);
  assert.match(s, /Làm tiếp cái nào\?/, "phải chép lại câu đã hỏi — đó là thứ xác định 'mảng' nào");
  assert.match(s, /Gắn MCP điều khiển OBS/, "và lựa chọn họ đã bấm");
});

test("cách vài lượt thì đếm đúng số lượt của NGƯỜI DÙNG", () => {
  const a = botThu();
  themWidget(a, "Bạn muốn mình làm kiểu nào?");
  themTinNguoi(a, "ok");
  themTinNguoi(a, "cách dùng OSB như nào");
  themTinNguoi(a, "kiểm tra có MCP hay skill repo nào liên quan OBS");
  const s = nguCanhMoiChon(a);
  assert.match(s, /3 lượt trước/);
  assert.match(s, /họ chưa chọn/, "widget bị bỏ qua vẫn là một mảng đã mở");
});

test("mời chọn từ quá lâu thì thôi — mảng cũ không khoá được lượt hiện tại", () => {
  const a = botThu();
  themWidget(a, "Bạn muốn mình gắn Shopee kiểu nào?");
  // 16 entry là cửa sổ hàm nhìn lại. Không có hạn này thì một widget từ đầu hội thoại sẽ cấm bot
  // mời chọn mãi mãi — tức là vặn núm sang đầu kia và hỏng đúng ca 15.
  for (let i = 0; i < 20; i += 1) themTinNguoi(a, `tin ${i}`);
  assert.equal(nguCanhMoiChon(a), "");
});

test("lấy widget GẦN NHẤT khi có nhiều cái", () => {
  const a = botThu();
  themWidget(a, "Câu hỏi cũ?");
  themTinNguoi(a, "ừ");
  themWidget(a, "Câu hỏi mới?");
  const s = nguCanhMoiChon(a);
  assert.match(s, /Câu hỏi mới\?/);
  assert.doesNotMatch(s, /Câu hỏi cũ\?/);
});
