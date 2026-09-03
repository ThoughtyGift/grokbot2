/**
 * Launcher của bộ cài CÔNG KHAI — đường mà người dùng thật đi.
 *
 *   npx tsx --test services/grokbot-backend/src/launcher-cong-khai.test.ts
 *
 * Có hai launcher, và sáng 03/09 tôi chỉ sửa MỘT. `setup-exe.mjs` (bản chở-cả-app) nhận cửa điều
 * kiện, còn `setup-templates.mjs` (bản 44 KB mà `cinai.app/agent` phát ra) vẫn đặt cứng
 * `SAND_DISABLE_UPDATES=1` — tức toàn bộ việc dựng kênh cập nhật hôm nay không tới được đúng những
 * người tải từ website. Tôi phát hiện bằng cách BUNG chính bộ cài đã dựng ra đọc, không bằng cách
 * đọc mã: khối launcher nằm trong file cài dưới dạng base64, nên grep trên mã nguồn thấy một chỗ mà
 * sản phẩm có hai.
 *
 * Bài này khoá cả hai mặt: không có dòng đặt CỨNG, và có nhánh điều kiện thật.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — script .mjs thuần, không có khai báo kiểu.
import { winStart, macStart } from "../scripts/setup-templates.mjs";

const KHOA_CUNG_WIN = /^set "SAND_DISABLE_UPDATES=1"$/m;
const KHOA_CUNG_MAC = /^export SAND_DISABLE_UPDATES=1$/m;

test("Windows: KHÔNG đặt cứng khoá cập nhật", () => {
  assert.doesNotMatch(winStart as string, KHOA_CUNG_WIN,
    "đặt cứng thì người tải từ website không bao giờ thấy banner — biến này đứng đầu thứ tự cổng của client");
});

test("Windows: có nhánh điều kiện dựa vào dấu vá update-feed", () => {
  const s = winStart as string;
  assert.match(s, /findstr \/c:"grokbot2:update-feed"/, "phải kiểm dấu vá LÚC CHẠY — lúc dựng gói chưa biết client của người ta");
  assert.match(s, /if errorlevel 1 \(/, "không có nhánh thì phép kiểm vô nghĩa");
  assert.match(s, /set "SAND_DISABLE_UPDATES=1"/, "nhánh CHƯA vá vẫn phải khoá, nếu không app tự cài đè bản của hãng");
  // Suy ra từ %APP%: hai đường dẫn viết tay ở hai dòng là hai đường dẫn sẽ lệch nhau.
  assert.match(s, /for %%I in \("%APP%"\) do set "APPDIR=/);
});

test("macOS: cùng luật, khác vỏ", () => {
  const s = macStart as string;
  assert.doesNotMatch(s, KHOA_CUNG_MAC);
  assert.match(s, /grep -q "grokbot2:update-feed"/);
  assert.match(s, /export SAND_DISABLE_UPDATES=1/, "nhánh chưa vá vẫn khoá");
});

test("bốn biến hợp đồng với client còn đủ trong cả hai launcher", () => {
  for (const [ten, s] of [["win", winStart as string], ["mac", macStart as string]] as const) {
    for (const bien of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL"]) {
      assert.match(s, new RegExp(bien), `${bien} thiếu trong launcher ${ten}`);
    }
  }
});
