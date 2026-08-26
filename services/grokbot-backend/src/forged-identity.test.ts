/**
 * Không cửa nào được tin `sub` mà người gọi tự khai.
 *
 * Bài này khoá một lỗ đã có thật trên VPS, phát hiện 27/08. Trong bảng `users` của bản cài đang chạy
 * xuất hiện một dòng lạ:
 *
 *     google-oauth2|user_01M04VTMSC6RPVPT20TKXBBBS8   (không mật khẩu)   tạo 22:44 ngày 26/08
 *
 * Backend **chưa từng chạy ngoài `enforce`** (đếm trong journal: 8 lượt khởi động, tất cả `enforce`),
 * nên nó không đến từ một lúc cổng mở. Nó đến từ `userFromToken`: hàm đó chỉ `base64` giải mã phần
 * payload rồi trả về `sub`, **không kiểm chữ ký**. Đo được:
 *
 *     verifyJwt("<header>.<payload>.chu-ky-rac")     → null
 *     userFromToken("<header>.<payload>.chu-ky-rac") → { authId: "google-oauth2|user_TU_BIA" }
 *
 * Và giá trị đó đi thẳng vào `accessVerdict` → `ensureUser`, tức **tạo hẳn một dòng người dùng** cho
 * danh tính bịa. Hàm đã bị xoá; bài này giữ cho nó không mọc lại.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintJwt, verifyJwt, DEFAULT_USER } from "./auth.js";

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Token bịa: header và payload hợp lệ về hình thức, chữ ký là rác. */
function forge(sub: string): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub, email: "ke-gia@vi.du" })}.chu-ky-rac`;
}

test("token bịa chữ ký thì KHÔNG được nhận là ai cả", () => {
  assert.equal(verifyJwt(`Bearer ${forge("google-oauth2|user_TU_BIA")}`), null);
});

test("đổi payload của một token THẬT cũng bị bắt", () => {
  // Kịch bản sát thực tế hơn: lấy token hợp lệ, thay `sub`, giữ nguyên chữ ký cũ.
  const real = mintJwt(DEFAULT_USER);
  const [h, , s] = real.split(".");
  const swapped = Buffer.from(JSON.stringify({ sub: "auth0|ke-gia", email: "" })).toString("base64url");
  assert.equal(verifyJwt(`Bearer ${h}.${swapped}.${s}`), null);
});

test("token thật vẫn qua — bài này không siết nhầm đường đang chạy", () => {
  assert.equal(verifyJwt(`Bearer ${mintJwt(DEFAULT_USER)}`)?.authId, DEFAULT_USER.authId);
});

/*
 * Hai bài dưới đây đọc CHÍNH MÃ NGUỒN, không đọc hành vi.
 *
 * Lý do: lỗ này không phải một nhánh sai, mà là **một hàm thứ hai tồn tại song song** với hàm đúng.
 * Kiểm hành vi của `verifyJwt` không bao giờ phát hiện được điều đó — hàm kia vẫn đúng như nó được
 * viết. Thứ cần khoá là *sự tồn tại của một nguồn danh tính thứ hai*.
 */
test("không có nguồn danh tính thứ hai nào đọc `sub` mà bỏ qua chữ ký", () => {
  const auth = readFileSync(join(srcDir, "auth.ts"), "utf8");
  const decodeOnly = auth
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
    .filter((l) => /base64url|JSON\.parse\(Buffer\.from/.test(l));

  // `verifyJwt` được phép giải mã — nhưng chỉ SAU khi nó đã so chữ ký. Không hàm nào khác được.
  const verifyBody = auth.slice(auth.indexOf("export function verifyJwt"), auth.indexOf("const CINAPI_COOKIE"));
  for (const line of decodeOnly) {
    const insideVerify = verifyBody.includes(line);
    const insideMint = /b64url\(JSON\.stringify/.test(line);
    assert.ok(insideVerify || insideMint,
      `dòng này giải mã token ngoài verifyJwt — một nguồn danh tính thứ hai: ${line.trim()}`);
  }
});

test("index.ts lấy danh tính RPC bằng verifyJwt, không phải hàm chỉ giải mã", () => {
  const idx = readFileSync(join(srcDir, "index.ts"), "utf8");
  assert.match(idx, /const rpcUser = verifyJwt\(/,
    "rpcUser phải đến từ verifyJwt — nó chảy thẳng vào ensureUser và tạo dòng người dùng thật");
  const code = idx.split(/\r?\n/).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
  assert.ok(!code.some((l) => l.includes("userFromToken")),
    "userFromToken đã bị xoá ngày 27/08 — đừng gọi lại nó");
});
