/**
 * Bí mật của hộp — mỗi bài dưới đây là một cách bí mật rò ra mà không ai thấy.
 *
 *   npx tsx --test src/box-secrets.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Thư mục kho — phải suy y hệt phần cài đặt, tức đọc `GROKBOT2_DATA_DIR` TRƯỚC.
 *
 * Trước đây dòng này suy đường dẫn từ vị trí module, và đó là một cái bẫy có hai nửa. Phiên trước
 * tôi vá nửa thứ nhất (phần cài đặt) mà để nguyên nửa này, nên kết quả TỆ HƠN lúc chưa vá:
 *
 *   - phần cài đặt ghi vào thư mục tạm mà runner dựng   → đúng
 *   - `sach()` ở đây đi xoá `.data/` THẬT của người dùng → mỗi lần chạy test là một lần xoá
 *   - thư mục tạm không bao giờ được dọn                → rác dồn giữa các bài, và bài
 *     "đọc không được để lại dấu vết gì" đỏ vì đọc trúng rác của bài trước
 *
 * Mười bài đỏ chỉ là triệu chứng; cái mất là dữ liệu. Vá một nửa một cái bẫy thì cái bẫy vẫn còn,
 * chỉ khác là nó không còn báo động nữa.
 */
/*
 * KHÔNG có biến cách ly ⇒ TỰ dựng thư mục tạm. Bản trước chỉ đọc env rồi rơi về `.data` thật khi env
 * vắng — tức chạy `npx tsx --test` trần (đúng cách bảng theo dõi §7 từng dặn) là `sach()` xoá kho THẬT
 * của người dùng. Đo 05/09: `.data/bot-templates`, `.data/box-secrets`, `.data/mcp-prefs` đều biến mất
 * sau một lượt chạy bộ test đầy đủ. Một bài test không được có đường nào dẫn tới dữ liệu thật.
 */
if (!process.env.GROKBOT2_DATA_DIR) process.env.GROKBOT2_DATA_DIR = mkdtempSync(join(tmpdir(), "gb2-secrets-"));
const DATA_DIR = process.env.GROKBOT2_DATA_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "box-secrets");
const A = "local|nguoi-a@vi-du.vn";
const B = "local|nguoi-b@vi-du.vn";
const sach = (): void => { try { rmSync(DIR, { recursive: true, force: true }); } catch { /* chưa có */ } };

const { setBoxSecrets, boxSecretsStatus, SECRETS_PRELUDE, BOX_SECRETS_FILE } =
  await import("./box-secrets.js");

test("lưu rồi đọc lại được, và KHÔNG trả về giá trị", async () => {
  sach();
  const st = await setBoxSecrets({ secrets: { SHOPEE_USER: "khanh", SHOPEE_PASS: "bi-mat" } }, A);
  assert.deepEqual(st.names, ["SHOPEE_PASS", "SHOPEE_USER"]);
  assert.equal(st.count, 2);
  // Nếu một ngày ai đó thêm `values` vào đây, bài này phải đỏ: pane chỉ cần biết "đã đặt chưa".
  assert.equal(JSON.stringify(st).includes("bi-mat"), false, "trang thai KHONG duoc mang gia tri");
});

test("hai người hai kho — bí mật của người này không lọt sang người kia", async () => {
  sach();
  await setBoxSecrets({ secrets: { TOKEN: "cua-A" } }, A);
  await setBoxSecrets({ secrets: { KHAC: "cua-B" } }, B);
  assert.deepEqual(boxSecretsStatus(A).names, ["TOKEN"]);
  assert.deepEqual(boxSecretsStatus(B).names, ["KHAC"]);
});

test("gửi từng phần thì TRỘN, không thay cả kho", async () => {
  sach();
  await setBoxSecrets({ secrets: { MOT: "1" } }, A);
  const st = await setBoxSecrets({ secrets: { HAI: "2" } }, A);
  // Client gửi từng phần; một lượt thiếu KHÔNG có nghĩa là "xoá phần còn lại".
  assert.deepEqual(st.names, ["HAI", "MOT"]);
});

test("chuỗi rỗng là cách nói 'bỏ cái này'", async () => {
  sach();
  await setBoxSecrets({ secrets: { BO: "x", GIU: "y" } }, A);
  const st = await setBoxSecrets({ secrets: { BO: "" } }, A);
  assert.deepEqual(st.names, ["GIU"]);
});

test("tên biến độc bị chặn — file này được `source`", async () => {
  sach();
  // File bí mật được nạp bằng `.`, nên một "tên" như dưới đây là thực thi mã tuỳ ý dưới tài khoản
  // của chính người dùng. Đây là kiểm tra an ninh, không phải kiểm tra hình thức.
  const st = await setBoxSecrets({
    secrets: { "X=1; rm -rf ~": "a", "co dau cach": "b", "1BATDAU_BANG_SO": "c", HOP_LE: "d" },
  }, A);
  assert.deepEqual(st.names, ["HOP_LE"]);
});

test("giá trị chỉ nhận chuỗi — số/đối tượng bị bỏ, không ép kiểu", async () => {
  sach();
  const st = await setBoxSecrets({ secrets: { SO: 123, DOI_TUONG: { a: 1 }, CHUOI: "ok" } } as unknown, A);
  assert.deepEqual(st.names, ["CHUOI"]);
});

test("đối số hỏng không làm nổ, chỉ trả trạng thái hiện có", async () => {
  sach();
  await setBoxSecrets({ secrets: { CO: "san" } }, A);
  for (const rac of [null, undefined, {}, { secrets: null }, { secrets: "chuoi" }, 42]) {
    const st = await setBoxSecrets(rac as unknown, A);
    assert.deepEqual(st.names, ["CO"], JSON.stringify(rac));
  }
});

test("tiền tố phải KIỂM file trước khi nạp — nếu không, mọi lệnh của người chưa đặt bí mật chết", () => {
  /*
   * Trong `sh` (dash), `.` là builtin ĐẶC BIỆT: nạp file không tồn tại làm shell thoát ngay, và
   * `|| true` không cứu được. Đo trên hộp thật với bản đầu:
   *
   *     sh -c 'echo BAT-DAU; . $HOME/.grokbot2-secrets.env 2>/dev/null || true; echo KET-THUC'
   *     → chỉ in "BAT-DAU"
   *
   * Nghĩa là mọi lệnh shell của bot chết ở dòng đầu, không chạy gì, không báo gì. Bài này là chỗ
   * giữ để không ai viết lại `. FILE || true` cho gọn.
   */
  assert.ok(SECRETS_PRELUDE.startsWith("[ -r "), `phai kiem truoc khi nap: ${SECRETS_PRELUDE}`);
  assert.ok(!/^\s*\. /.test(SECRETS_PRELUDE), "khong duoc goi `.` vo dieu kien");
  assert.ok(SECRETS_PRELUDE.includes("&& . "));
  assert.ok(SECRETS_PRELUDE.includes("|| true"));
  assert.ok(!SECRETS_PRELUDE.includes("source "), "`source` la cua bash, hop chay sh");
  assert.ok(BOX_SECRETS_FILE.startsWith("$HOME/"), "phải nằm trong home của CHÍNH người đó");
});

test("dọn", () => { sach(); });
