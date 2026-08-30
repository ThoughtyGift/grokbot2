/**
 * `create_routine` gắn routine cho AI.
 *
 *   npx tsx --test services/grokbot-backend/src/routine-target.test.ts
 *
 * Đo 28/08: bot mẹ dựng đội ba con rồi tạo routine cho từng con — tên routine ghi rõ "Kho - …",
 * "CSKH - …" — nhưng cả hai rơi vào BOT MẸ, vì tool cứng `ctx.agentId`. Con bot thật sự phải chạy
 * việc đó thì không có lịch nào; con không liên quan thì ôm hết.
 *
 * App gốc gắn vào từng con: ảnh chụp máy người dùng cho thấy bảng Routines nằm trong panel của
 * chính bot đó — Shopee Kho có "Hàng chờ lấy", Kế toán có "Nhật ký P và L tuần".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.GROKBOT2_ALLOW_WRITE = "1";
const { runWithOwner: as } = await import("./request-context.js");
const { createAgent } = await import("./directory/index.js");
const { TOOLS } = await import("./runtime/tools.js");
const A = await import("./automations.js");

const OWNER = "local|routine@vi-du.vn";

/*
 * Tên bot phải DUY NHẤT mỗi lần chạy.
 *
 * Bài này đặt `GROKBOT2_ALLOW_WRITE=1`, nên bot nó tạo nằm lại trong kho thật. Với tên cố định
 * ("Kho", "Quan ly"), lần chạy thứ hai trở đi có HAI bot cùng tên, và `create_routine` tra theo tên
 * thì khớp cái CŨ — routine rơi vào bot của lần chạy trước.
 *
 * Đo 31/08 khi bài này bỗng đỏ: kho có 5 routine "Hàng chờ lấy", tất cả trên cùng một `agent-1639`
 * từ những lần chạy trước, trong khi bot vừa tạo có 0. Bài test không hỏng vì mã đổi — nó hỏng vì
 * chính nó để lại rác, và rác đủ nhiều thì nó tự cắn mình.
 *
 * Cùng họ với bẫy đã ghi trong bảng theo dõi: "sổ trắng hoá ra không trắng".
 */
const rieng = (ten: string): string => `${ten} ${Math.random().toString(36).slice(2, 8)}`;
const NGUOI_KHAC = "local|nguoi-khac@vi-du.vn";
/*
 * `await` vì `create_routine` nay là async: nó chạy một lượt tự soát trước khi lưu (xem
 * `runtime/auto-review.ts`). Bản cũ gọi đồng bộ và `String(Promise)` cho ra "[object Promise]" —
 * test xanh hay đỏ đều vì lý do sai.
 *
 * Bot trong bài này vừa được tạo nên bản ghi rỗng, và lớp soát cho qua khi không có bối cảnh — nên
 * bộ test không gọi ra mạng.
 */
const goi = async (ctxId: string, spec: unknown) =>
  String(await TOOLS.create_routine!(JSON.stringify(spec), { agentId: ctxId } as never));
const dem = (id: string) => as(OWNER, () => A.getAgentAutomations({ agentId: id, id: id })).length;

test("không nêu agent → routine thuộc về chính người gọi", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Tu lam") }));
  await as(OWNER, () => goi(me.id, { name: "Sáng", prompt: "rà đơn", trigger: "0 8 * * *" }));
  assert.equal(dem(me.id), 1);
});

test("nêu tên đồng đội → routine thuộc về ĐỒNG ĐỘI, không phải người gọi", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Quan ly") }));
  const tenKho = rieng("Kho");
  const kho = as(OWNER, () => createAgent({ name: tenKho }));
  const truoc = dem(me.id);
  await as(OWNER, () => goi(me.id, { name: "Hàng chờ lấy", prompt: "kéo queue", trigger: "0 8,12,17,22 * * *", agent: tenKho }));
  assert.equal(dem(kho.id), 1, "đồng đội phải nhận routine");
  assert.equal(dem(me.id), truoc, "người gọi KHÔNG được ôm thêm routine của người khác");
});

test("bot của người khác → từ chối, không đặt lịch trên hạn mức của họ", async () => {
  const me = as(OWNER, () => createAgent({ name: rieng("Quan ly 2") }));
  const la = as(NGUOI_KHAC, () => createAgent({ name: "Bot nguoi la" }));
  const r = await as(OWNER, () => goi(me.id, { name: "X", prompt: "y", trigger: "0 9 * * *", agent: "Bot nguoi la" }));
  assert.match(r, /không thấy bot/, `phải từ chối, nhận: ${r}`);
  assert.equal(as(NGUOI_KHAC, () => A.getAgentAutomations({ agentId: la.id, id: la.id })).length, 0, "bot người khác không được mọc routine");
});

test("tên không có thật → nói rõ có những bot nào, không im lặng tạo cho mình", async () => {
  const me = as(OWNER, () => createAgent({ name: "Quan ly 3" }));
  const truoc = dem(me.id);
  const r = await as(OWNER, () => goi(me.id, { name: "X", prompt: "y", trigger: "0 9 * * *", agent: "Khong-ton-tai" }));
  assert.match(r, /không thấy bot/);
  assert.equal(dem(me.id), truoc, "từ chối thì KHÔNG được lặng lẽ gắn vào người gọi");
});
