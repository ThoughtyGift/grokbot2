/**
 * Kho skill — và luật quan trọng nhất: mọi lệnh ĐỔI phải trả CẢ DANH SÁCH.
 *
 *   npx tsx --test services/grokbot-backend/src/workflows.test.ts
 *
 * ── Vì sao bài đầu tiên là bài "tạo xong phải thấy ngay" ────────────────────────────────────────
 *
 * FE lưu phản hồi của lệnh đổi làm danh sách mới thay vì hỏi lại. Nên một `create` trả `{ok:true}`
 * — hay trả danh sách của SAI bot — hiện ra trên màn hình đúng như "tạo xong rồi biến mất". Bản
 * trước của repo này đã trả `[]` cho cả năm lệnh, và menu `/` trống suốt mà không ai thấy sai ở
 * đâu, vì mọi lệnh đều "thành công".
 *
 * Shape phần tử thì đo từ chính client (31/08): `name` và `description` lên màn hình, `title` và
 * `body` bị bỏ qua. Bài dưới khoá hai field đó có mặt và không rỗng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { create, update, remove, setEnabled, forAgent, listAll, byId, _xoaHet } from "./workflows.js";

const bot = (n: string) => `agent-wf-${n}`;

test("tạo xong thì có mặt NGAY trong danh sách trả về", () => {
  _xoaHet();
  const ds = create({ agentId: bot("a"), name: "Đặt hàng Shopee", description: "Khi cần mua lại đơn cũ", instructions: "Bước 1..." });
  assert.equal(ds.length, 1, "lệnh tạo phải trả CẢ danh sách, không phải {ok:true}");
  assert.equal(ds[0].name, "Đặt hàng Shopee");
  assert.equal(ds[0].description, "Khi cần mua lại đơn cũ");
  assert.equal(ds[0].source, "workflow", "renderer lọc 'Yours → Private' đúng chuỗi này");
});

test("mỗi bot chỉ thấy skill của mình", () => {
  _xoaHet();
  create({ agentId: bot("a"), name: "của A" });
  create({ agentId: bot("b"), name: "của B" });
  assert.deepEqual(forAgent({ agentId: bot("a") }).map((w) => w.name), ["của A"]);
  assert.deepEqual(forAgent({ agentId: bot("b") }).map((w) => w.name), ["của B"]);
  assert.equal(listAll().length, 2, "skillsCatalog không hỏi theo bot — nó thấy cả hai");
});

test("tên trống thì đặt tạm, KHÔNG vứt buổi dạy đi", () => {
  _xoaHet();
  // Lệnh này đến từ cả client lẫn `desktop_teach_stop`. Mất trắng một buổi dạy vì thiếu cái tên là
  // kết cục tệ nhất trong các kết cục.
  const ds = create({ agentId: bot("a"), instructions: "các bước đã ghi được" });
  assert.equal(ds.length, 1);
  assert.ok(ds[0].name.trim().length > 0, "phải có tên nào đó để còn bấm được trong menu");
  assert.equal(ds[0].instructions, "các bước đã ghi được");
});

test("sửa một field không xoá các field khác", () => {
  _xoaHet();
  const [w] = create({ agentId: bot("a"), name: "cũ", description: "mô tả cũ", instructions: "ruột cũ" });
  const ds = update({ workflowId: w.id, name: "mới" });
  assert.equal(ds[0].name, "mới");
  assert.equal(ds[0].description, "mô tả cũ", "client gửi patch, không gửi cả bản ghi");
  assert.equal(ds[0].instructions, "ruột cũ");
});

test("xoá trả về danh sách của ĐÚNG bot vừa mất một mục", () => {
  _xoaHet();
  const [w] = create({ agentId: bot("a"), name: "một" });
  create({ agentId: bot("a"), name: "hai" });
  // Client hay gửi `{id: <id của workflow>}` trần. Lọc theo id đó thì ra rỗng, và màn hình sẽ hiểu
  // là MỌI skill vừa biến mất — không phải một cái.
  const ds = remove({ id: w.id });
  assert.deepEqual(ds.map((x) => x.name), ["hai"]);
  assert.equal(byId(w.id), null);
});

test("sửa một id không tồn tại thì không ném, không tạo mới", () => {
  _xoaHet();
  create({ agentId: bot("a"), name: "một" });
  const ds = update({ workflowId: "wf-khong-co", agentId: bot("a"), name: "ma" });
  assert.deepEqual(ds.map((x) => x.name), ["một"]);
});

test("tắt rồi bật lại giữ nguyên nội dung", () => {
  _xoaHet();
  const [w] = create({ agentId: bot("a"), name: "một", instructions: "ruột" });
  assert.equal(setEnabled({ workflowId: w.id, enabled: false })[0].enabled, false);
  const lai = setEnabled({ workflowId: w.id, enabled: true })[0];
  assert.equal(lai.enabled, true);
  assert.equal(lai.instructions, "ruột");
});

test("mới sửa nằm trên đầu — menu `/` đọc theo thứ tự này", () => {
  _xoaHet();
  const [a] = create({ agentId: bot("a"), name: "cũ" });
  create({ agentId: bot("a"), name: "mới hơn" });
  update({ workflowId: a.id, description: "vừa đụng vào" });
  assert.equal(forAgent({ agentId: bot("a") })[0].name, "cũ");
});
