/**
 * Lượt bị cắt giữa dòng `TOOL_CALL` không được để lại khối JSON thô trước mặt người dùng.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/luot-bi-cat-du-tool-call.test.ts"
 *
 * ── Bug đo được 08/09/2026 ──────────────────────────────────────────────────────────────────────
 *
 * `TOOL_CALL: tên({json})` là giao thức CHỮ của dự án: model viết dòng ấy vào luồng, `parseToolCalls`
 * bóc ra rồi chạy tool. Khi backend nạp lại giữa lượt (13:22:11, đúng 2 giây sau entry `e18296`),
 * luồng đứt giữa từ — khối JSON chưa đóng ngoặc nên bộ bóc không khớp, và nó **nằm lại thành chữ**:
 *
 *     Base xong 4 bảng, giờ mình giao token và ID bảng thật cho hai con bot.
 *     TOOL_CALL: message_agent({"to":["CinAI Lark","CinAI Dashboard"],"content":"…
 *     ⏹ (bị ngắt giữa chừng)
 *
 * Người dùng thấy một khối `app_token` + ID bảng + đường dẫn repo bày ra giữa hội thoại, và tưởng
 * bot hỏng. Bot không hỏng: nó chỉ bị giết đúng lúc đang viết dòng lệnh.
 *
 * `hasIncompleteToolCall` đã biết nhận ra ca này từ trước, nhưng nó trả `boolean` nên không cắt được.
 * Nay có `incompleteToolCallStart` trả CHỖ CẮT, và `migrate()` cắt phần dư ấy trước khi đóng dấu ngắt.
 *
 * Vì sao cắt chứ không giữ: dấu `⏹ (bị ngắt giữa chừng)` đã nói đủ chuyện "lượt này chưa xong", còn
 * khối JSON thô thì không thêm thông tin nào cho người đọc — nó chỉ trông như lỗi. Bằng chứng vẫn
 * còn nguyên trong SQLite của lượt trước khi nạp; đây là đường HIỂN THỊ.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cách ly VÔ ĐIỀU KIỆN trước khi nạp module — `chat/state.ts` gọi `loadState()` và kéo cả kho
// workflows lẫn sổ máy, nên thiếu bước này là bài đo ghi vào `.data` THẬT (bảng theo dõi §7).
const tam = mkdtempSync(join(tmpdir(), "gb2-luot-cat-"));
process.env.GROKBOT2_DATA_DIR = tam;
process.env.GROKBOT2_STATE_FILE = join(tam, "state.json");
process.env.GROKBOT2_SQLITE_FILE = join(tam, "grokbot.sqlite");
process.env.GROKBOT2_WORKFLOWS_FILE = join(tam, "workflows.json");
process.env.GROKBOT2_MAY_DA_BIET_FILE = join(tam, "may-da-biet.json");

const { incompleteToolCallStart } = await import("./tool-calls.js");
const { _migrateForTest: migrate } = await import("./chat/state.js");

// Đúng hình dạng `e18296`: văn xuôi trước, rồi một lời gọi bị cắt giữa chuỗi JSON.
const THAT = 'Base xong 4 bảng, giờ mình giao token và ID bảng thật cho hai con bot.\n\n'
  + 'TOOL_CALL: message_agent({"to":["CinAI Lark","CinAI Dashboard"],"content":"app_token: '
  + 'BYFyb8Fwdazabjs\\n- Model: tblXLlQrzDAIRsOo\\n\\nKhông sửa gì trên h';

const nhan = (noi: string) => ({ kind: "send-message", streaming: true, timestampMs: 1_788_849_729_000, id: "e18296", message: { type: "text", content: noi } });

test("lời gọi đóng ngoặc đủ thì KHÔNG có chỗ nào để cắt", () => {
  assert.equal(incompleteToolCallStart('TOOL_CALL: message_agent({"to":"A","content":"xong"})'), -1);
  assert.equal(incompleteToolCallStart("không có lời gọi nào ở đây"), -1);
  assert.equal(incompleteToolCallStart(""), -1);
});

test("dấu `)` bên trong chuỗi không được coi là đóng ngoặc", () => {
  // Cùng lý do `findArgEnd` phải đếm ngoặc và bỏ qua chuỗi: một `)` trong JS/JSON không kết thúc lời gọi.
  const kin = 'TOOL_CALL: browser_evaluate({"expression":"[...document.querySelectorAll(\'img\')].map(i=>i.src)"})';
  assert.equal(incompleteToolCallStart(kin), -1, "lời gọi này ĐÓNG đủ, chỉ là bên trong có nhiều ngoặc");
  const ho = 'TOOL_CALL: browser_evaluate({"expression":"a.b(c)';
  assert.ok(incompleteToolCallStart(ho) >= 0, "còn đây là lời gọi bị cắt giữa chuỗi");
});

test("cắt đúng chỗ: văn xuôi giữ lại, khối lệnh chưa đóng bị bỏ", () => {
  const cat = incompleteToolCallStart(THAT);
  assert.ok(cat > 0, `phải tìm ra chỗ cắt, nhận: ${cat}`);
  const con = THAT.slice(0, cat).trimEnd();
  assert.equal(con, "Base xong 4 bảng, giờ mình giao token và ID bảng thật cho hai con bot.");
  assert.ok(!con.includes("TOOL_CALL"), "không được còn chữ TOOL_CALL nào");
  assert.ok(!con.includes("app_token"), "không được rò token ra bong bóng");
});

test("lời gọi ĐÃ đóng đứng trước một lời gọi bị cắt: chỉ cắt cái sau", () => {
  const hai = 'xong bước một.\nTOOL_CALL: local_read({"path":"a.json"})\nrồi tới bước hai.\nTOOL_CALL: message_agent({"to":"B","content":"dở';
  const cat = incompleteToolCallStart(hai);
  const con = hai.slice(0, cat);
  assert.ok(con.includes('local_read({"path":"a.json"})'), "lời gọi đã chạy xong phải còn nguyên");
  assert.ok(con.includes("rồi tới bước hai."), "văn xuôi giữa hai lời gọi phải còn");
  assert.ok(!con.includes("message_agent"), "chỉ lời gọi bị cắt mới bị bỏ");
});

test("migrate: entry bị ngắt mất phần dư, GIỮ văn xuôi và dấu ngắt", () => {
  const ra = migrate(nhan(THAT), "New Bot");
  assert.ok(ra, "entry phải sống sót — nó có văn xuôi thật");
  const noi = (ra as { message: { content: string } }).message.content;
  assert.ok(noi.startsWith("Base xong 4 bảng"), noi.slice(0, 60));
  assert.ok(!noi.includes("TOOL_CALL"), "chữ TOOL_CALL thô là thứ bài này sinh ra để chặn");
  assert.ok(noi.includes("⏹ (bị ngắt giữa chừng)"), "vẫn phải nói cho người dùng biết lượt chưa xong");
  assert.equal((ra as { streaming?: boolean }).streaming, false);
});

test("migrate: entry CHỈ có một lời gọi bị cắt thì bị bỏ hẳn", () => {
  // Cắt xong không còn chữ nào — một bong bóng rỗng mang dấu ngắt không nói được gì cho ai.
  const ra = migrate(nhan('TOOL_CALL: message_agent({"to":"B","content":"dở'), "New Bot");
  assert.equal(ra, null);
});

test("migrate: lượt đã xong (không `streaming`) KHÔNG bị chạm tới", () => {
  const nguyen = { kind: "send-message", timestampMs: 1, id: "e1", message: { type: "text", content: THAT } };
  const ra = migrate(nguyen, "New Bot") as { message: { content: string } };
  assert.equal(ra.message.content, THAT, "chỉ lượt BỊ NGẮT mới cắt — entry lành phải về nguyên văn");
});

// Hằng dấu ngắt — viết bằng template literal có xuống dòng thật, đúng như `state.ts`.
const DAU_NGAT = `

⏹ (bị ngắt giữa chừng)`;

test("dọn entry ĐÃ bị đóng dấu ở lần nạp trước (streaming đã false trên đĩa)", () => {
  // Đo 08/09: lần khởi động lại đầu đặt `streaming = false` rồi LƯU, nên nhánh streaming không
  // còn chạm tới `e18296` được nữa — bản sửa mà thiếu nhánh này thì phần dư nằm đó mãi.
  const cu = { kind: "send-message", timestampMs: 1, id: "e18296", message: { type: "text", content: THAT + DAU_NGAT } };
  const ra = migrate(cu, "New Bot") as { message: { content: string } };
  const noi = ra.message.content;
  assert.ok(!noi.includes("TOOL_CALL"), "phần dư phải bị dọn kể cả khi entry đã nguội");
  assert.ok(!noi.includes("app_token"));
  assert.equal(noi.split("⏹").length - 1, 1, "dấu ngắt phải còn ĐÚNG một cái, không nhân đôi");
  assert.ok(noi.startsWith("Base xong 4 bảng"));
});

test("entry đã đóng dấu mà KHÔNG có phần dư thì không bị chạm", () => {
  const lanh = "Mình dừng ở đây nhé." + DAU_NGAT;
  const ra = migrate({ kind: "send-message", timestampMs: 1, id: "e2", message: { type: "text", content: lanh } }, "New Bot") as { message: { content: string } };
  assert.equal(ra.message.content, lanh);
});

test("bot nhắc TOOL_CALL trong lời giải thích, không có dấu ngắt → không bị cắt oan", () => {
  // Điều kiện là DẤU NGẮT chứ không phải "có chữ TOOL_CALL", đúng để tránh ca này.
  const day = 'Cú pháp là TOOL_CALL: local_read({"path":"...  — mình gõ dở cho bạn thấy hình dạng.';
  const ra = migrate({ kind: "send-message", timestampMs: 1, id: "e3", message: { type: "text", content: day } }, "New Bot") as { message: { content: string } };
  assert.equal(ra.message.content, day, "không có dấu ngắt thì đây là văn xuôi, không phải phần dư");
});
