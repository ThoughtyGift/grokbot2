/**
 * Launcher của bộ cài quyết định người dùng có BAO GIỜ thấy banner cập nhật không.
 *
 *   npx tsx --test services/grokbot-backend/src/launcher-cap-nhat.test.ts
 *
 * Một dòng `set "SAND_DISABLE_UPDATES=1"` đứng đầu thứ tự cổng của client
 * (`envDisabled → isLabBuild → hasDevFeedOverride → isPackaged`), nên nó thắng mọi thứ khác — kể cả
 * một bản vá feed đã ăn. Đo 03/09 trên MÁY THỨ TƯ của người dùng: Settings → Updates hiện đúng chữ
 * *"Updates are disabled by SAND_DISABLE_UPDATES"*, phiên bản 0.20.0, không banner nào.
 *
 * Nhưng bỏ dòng ấy một cách vô điều kiện thì tệ hơn hẳn: client chưa vá feed sẽ hỏi
 * `api2.cursor.sh`, tải bản của hãng, cài đè và **xoá sạch bộ vá**. Nên nó phải phụ thuộc đúng một
 * dữ kiện — bản app đang đóng gói đã vá `update-feed` chưa — và hướng hỏng phải là GIỮ khoá.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — script .mjs thuần, không có khai báo kiểu; đây là chỗ duy nhất TS chạm vào nó.
import { startBundled, coVaUpdateFeed } from "../scripts/setup-exe.mjs";

const KHOA = /^set "SAND_DISABLE_UPDATES=1"$/m;

/** Dựng một cây cài giả, có hoặc không có dấu vá. */
function dungApp(coVa: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "gb2-launcher-"));
  const dir = join(root, "resources", "app", "dist", "electron-main");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.cjs"), coVa ? 'var X="http://be"/*grokbot2:update-feed*/' : 'var X="https://api2.cursor.sh/updates"');
  return root;
}

test("app ĐÃ vá update-feed ⇒ launcher KHÔNG khoá cập nhật", () => {
  const root = dungApp(true);
  try {
    assert.equal(coVaUpdateFeed(root), true);
    assert.doesNotMatch(startBundled(!coVaUpdateFeed(root)), KHOA, "còn khoá thì banner không bao giờ hiện");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("app CHƯA vá ⇒ launcher PHẢI khoá — không thì app tự cài đè bản của hãng", () => {
  const root = dungApp(false);
  try {
    assert.equal(coVaUpdateFeed(root), false);
    assert.match(startBundled(!coVaUpdateFeed(root)), KHOA);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("không đọc được app thì coi như CHƯA vá — hướng hỏng là giữ khoá", () => {
  // Mất banner còn hơn mất bộ vá. Một bộ cài dựng từ thư mục lạ không được im lặng mở cửa tự cập nhật.
  assert.equal(coVaUpdateFeed(join(tmpdir(), "khong-ton-tai-gb2")), false);
  assert.match(startBundled(true), KHOA);
});

test("bốn biến hợp đồng với client vẫn còn đủ trong cả hai nhánh", () => {
  // Bỏ sót một biến thì hỏng theo một kiểu riêng, và cả bốn đều im lặng. Xem chú thích trong launcher.
  for (const khoa of [true, false]) {
    const l = startBundled(khoa);
    for (const bien of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL"]) {
      assert.match(l, new RegExp(`set "${bien}=`), `${bien} (khoa=${khoa})`);
    }
  }
});
