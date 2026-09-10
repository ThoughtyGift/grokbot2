/**
 * Bài đo cho tên hiển thị người tạo.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs src/ten-nguoi-tao.test.ts
 *
 * Module thuần, không chạm đĩa, không nạp kho nào — nên bài này chạy được TRƯỚC khi nối dây, và
 * chạy được cả khi `bot-templates.ts` đang hỏng.
 *
 * Bài đáng giá nhất ở đây KHÔNG phải bài ghim `cinapi|` (một nhánh đã biết thì dễ). Nó là bài
 * *"hình dạng THỨ BA"*: một bảng những tài khoản chưa ai thấy bao giờ, và điều được đòi là đầu ra
 * **BẰNG đúng hằng số** — không phải "không chứa id", mà là không có gì của đầu vào đi ra được cả.
 * Đó là phép ghim đúng cái đã hỏng: một nhánh mặc định cho đi qua.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ownerDisplayNameOf, TEN_AN_DANH, TRAN_TEN } from "./ten-nguoi-tao.js";

/** Đúng hình dạng đo được trên sản xuất 10/09 (24 ký tự hex), không phải id thật của ai. */
const ID_CINAPI = "cinapi|0123456789abcdef01234567";

test("địa chỉ thư → phần trước @; ba hình dạng bài đo khác đang ghim", () => {
  assert.equal(ownerDisplayNameOf("local|nguoi-a@vi-du.vn"), "nguoi-a");
  assert.equal(ownerDisplayNameOf("local|nguoi-b@vi-du.vn"), "nguoi-b");
  assert.equal(ownerDisplayNameOf("local|có-dấu@ví-dụ.vn"), "có-dấu", "tên tiếng Việt có dấu phải qua được");
  assert.equal(ownerDisplayNameOf("local|a.b+c@x.co.uk"), "a.b+c", "dấu chấm/cộng trong tên thư là hợp lệ");
  assert.equal(ownerDisplayNameOf("nguoi-a@vi-du.vn"), "nguoi-a", "không tiền tố vẫn đọc được");
});

test("id cinai KHÔNG bao giờ đi ra dây — đây là thứ đã rò 4 lần/trang trên 10 trang công khai", () => {
  const ra = ownerDisplayNameOf(ID_CINAPI);
  assert.equal(ra, TEN_AN_DANH);
  assert.ok(!ra.includes("0123456789abcdef01234567"), "id thô lọt vào tên hiển thị");
  // Chặt hơn: không một khúc 6 ký tự nào của id được có mặt trong đầu ra.
  const id = ID_CINAPI.slice("cinapi|".length);
  for (let i = 0; i + 6 <= id.length; i++) {
    assert.ok(!ra.includes(id.slice(i, i + 6)), `khúc "${id.slice(i, i + 6)}" của id lọt ra`);
  }
});

test("hình dạng THỨ BA: mọi tài khoản không phải thư → BẰNG đúng hằng số, không suy gì từ đầu vào", () => {
  const la = [
    ID_CINAPI,
    "auth0|grokbot2-user",
    "auth0|507f1f77bcf86cd799439011",
    "google-oauth2|103547991597142817347",
    "oidc|okta|00u1a2b3c4d5e6f7g8h9",
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "sso|CONTOSO\\nguoi.dung",
    "8f14e45f-ceea-467a-9c0f-1e0a6b3c9d2e",
    "cinapi|",
    "cinapi|co|gach",
    "|",
    "||",
    "",
    "   ",
    "local|",
    "local|@vi-du.vn",     // không có phần trước @
    "local|123@vi-du.vn",  // toàn số ⇒ không phải một cái tên
    "local|a@b",           // miền không có chấm
    "local|a@.vn",         // chấm ở đầu miền
    "local|a@vn.",         // chấm ở cuối miền
  ];
  for (const ai of la) {
    assert.equal(ownerDisplayNameOf(ai), TEN_AN_DANH, `"${ai}" phải ra đúng hằng số, không suy gì`);
  }
});

test("không ném với đầu vào rác — hàm này chạy trên đường vẽ trang công khai", () => {
  for (const ai of [undefined, null, 123, {}, []] as unknown as string[]) {
    assert.doesNotThrow(() => ownerDisplayNameOf(ai));
  }
  assert.equal(ownerDisplayNameOf(undefined as unknown as string), TEN_AN_DANH);
});

test("tên dài bị cắt ở trần — một thẻ Marketplace không phải chỗ dựng chuỗi tuỳ ý", () => {
  const dai = "n".repeat(TRAN_TEN + 40);
  const ra = ownerDisplayNameOf(`local|${dai}@vi-du.vn`);
  assert.equal(ra.length, TRAN_TEN);
  assert.equal(ra, "n".repeat(TRAN_TEN));
});

test("khoảng trắng thừa hai đầu không đổi kết quả", () => {
  assert.equal(ownerDisplayNameOf("  local|nguoi-a@vi-du.vn  "), "nguoi-a");
  assert.equal(ownerDisplayNameOf("local| nguoi-a @vi-du.vn"), "nguoi-a");
});
