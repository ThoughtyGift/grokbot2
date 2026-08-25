/**
 * Không lối mở nào được trỏ đăng nhập sang máy chủ của hãng.
 *
 * Bốn biến môi trường là toàn bộ hợp đồng với client, và `CURSOR_WEBSITE_URL` là cái dễ đặt sai
 * nhất vì **suốt một thời gian dài đặt sai cũng không thấy gì**: hồi `/auth/poll` còn cấp token cho
 * mọi lời gọi thì đăng nhập chỉ là một cái bắt tay giả, mở trang nào cũng xong.
 *
 * Từ 26/08 thì không. Bấm đăng nhập là app mở
 *
 *   {CURSOR_WEBSITE_URL}/loginDeepControl?challenge=…&uuid=…
 *
 * trong trình duyệt. Để `https://cursor.com` ở đó thì hai chuyện xảy ra cùng lúc: trình duyệt mở
 * trang của **hãng** nên đăng nhập không bao giờ xong, và `uuid` + `challenge` của một phiên trên
 * máy người dùng bị giao cho họ.
 *
 * Bài này đọc chính các tệp phát ra cho người dùng, vì đó là thứ chạy trên máy họ — không phải một
 * hằng số nào đó trong mã nguồn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Mọi nơi sinh ra lối mở cho người dùng: hai lối chạy tại chỗ, và hai bộ cài. */
const SOURCES = [
  "infra/scripts/run.ps1",
  "services/grokbot-backend/scripts/setup-templates.mjs",
  "services/grokbot-backend/scripts/setup-exe.mjs",
];

/** Dòng thật sự ĐẶT biến, bỏ qua chú thích — chú thích được phép nhắc tên miền của hãng. */
function assignmentsOf(text: string, name: string): string[] {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("#") && !l.startsWith("//") && !/^REM\b/i.test(l))
    .filter((l) => new RegExp(`(set\\s+"?|export\\s+|\\$env:)${name}\\s*=`, "i").test(l));
}

test("không lối mở nào gửi đăng nhập sang máy chủ của hãng", () => {
  for (const rel of SOURCES) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    const lines = assignmentsOf(text, "CURSOR_WEBSITE_URL");
    assert.ok(lines.length > 0, `${rel} phải đặt CURSOR_WEBSITE_URL — thiếu thì app đẩy sang https://localhost:4443`);
    for (const line of lines) {
      assert.doesNotMatch(line, /cursor\.com/i, `${rel} đang trỏ đăng nhập sang hãng: ${line}`);
    }
  }
});

test("CURSOR_WEBSITE_URL trỏ cùng chỗ với backend", () => {
  // Cùng một giá trị, vì `/loginDeepControl` và `/auth/poll` là hai cửa của CÙNG một backend. Trỏ
  // lệch nhau thì trình duyệt duyệt ở máy chủ này còn app hỏi vòng ở máy chủ kia, và không ai báo lỗi.
  const cases: [string, RegExp][] = [
    ["infra/scripts/run.ps1", /^\$env:CURSOR_WEBSITE_URL\s*=\s*"http:\/\/localhost:\$bff"$/],
    ["services/grokbot-backend/scripts/setup-exe.mjs", /^set "CURSOR_WEBSITE_URL=%BE%"$/],
  ];
  for (const [rel, want] of cases) {
    const [line] = assignmentsOf(readFileSync(join(repoRoot, rel), "utf8"), "CURSOR_WEBSITE_URL");
    assert.match(line, want, `${rel}: phải dùng chính địa chỉ backend`);
  }
});

test("bộ cài đặt đủ cả bốn biến — thiếu cái nào cũng hỏng theo kiểu riêng", () => {
  const text = readFileSync(join(repoRoot, "services/grokbot-backend/scripts/setup-exe.mjs"), "utf8");
  for (const name of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL", "SAND_DISABLE_UPDATES"]) {
    assert.ok(assignmentsOf(text, name).length > 0, `bộ cài thiếu ${name}`);
  }
});
