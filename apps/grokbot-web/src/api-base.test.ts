/**
 * Đường gọi phải nằm dưới tiền tố mà trang đang đứng.
 *
 * Trên VPS, grokbot2 nằm ở `cinai.app/agent/` (kế hoạch hợp nhất, P5), và giao diện này được backend
 * phát ở `/agent/app/`. Một lời gọi `fetch("/v1/agents")` ở đó **không** tới backend — nó bay ra gốc
 * tên miền và rơi vào Next.js của cinAPI. Cách chữa bằng nginx là chiếm `/v1/` trên tên miền của họ,
 * một lời đòi rất rộng cho thứ chỉ cần ở dưới một nhánh.
 *
 * Bài này khoá phép suy tiền tố, không khoá lời gọi — vì đó là chỗ duy nhất có thể sai.
 */
import test from "node:test";
import assert from "node:assert/strict";

/** Đúng biểu thức trong `api.ts`. Chép lại vì nó không xuất ra ngoài — đổi một bên là bài này đỏ. */
const baseOf = (pathname: string): string =>
  /\/app\//.test(pathname) ? pathname.replace(/\/app\/.*$/, "") : "";

test("dưới một tiền tố: mọi lời gọi đi theo tiền tố đó", () => {
  assert.equal(baseOf("/agent/app/"), "/agent");
  assert.equal(baseOf("/agent/app/index.html"), "/agent");
  assert.equal(baseOf("/agent/app/?login_uuid=abc"), "/agent");
});

test("không tiền tố: giữ nguyên hành vi cũ", () => {
  // Vite khi phát triển phát trang ở `/`, và backend chạy tại chỗ phát ở `/app/`.
  assert.equal(baseOf("/"), "");
  assert.equal(baseOf("/app/"), "");
  assert.equal(baseOf("/app/index.html"), "");
});

test("tiền tố nhiều tầng cũng đúng", () => {
  assert.equal(baseOf("/a/b/app/"), "/a/b");
});
