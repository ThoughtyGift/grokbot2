/**
 * Trang "chưa dựng" nói với AI — và vì sao chuyện đó không phải chi tiết trang trí.
 *
 *   npx tsx --test services/grokbot-backend/src/web-app-chua-dung.test.ts
 *
 * Ngày 03/09 một người dùng tải app từ `cinai.app/agent`, cài lên MÁY THỨ TƯ, bấm Đăng nhập, và
 * nhận nguyên văn: *"Giao diện web chưa được dựng — Chạy `pnpm --filter @grokbot2/web build`"*.
 * Họ không có kho mã, không có pnpm, và câu đó không nói được cho họ điều gì trừ việc có thứ gì đó
 * hỏng. Nguyên nhân gốc nằm ở `deploy.sh` (chỉ build `packages/*`), nhưng cái *người dùng chạm vào*
 * là câu chữ này.
 *
 * Bài dưới khoá đúng một điều: hai chỗ chạy khác nhau thì nói khác nhau, và bản công khai KHÔNG
 * được nhắc tới lệnh dev.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chuaDungHtml } from "./web-app.js";

const voi = <T>(giaTri: string | undefined, f: () => T): T => {
  const cu = process.env.GROKBOT2_PUBLIC_PATH;
  if (giaTri == null) delete process.env.GROKBOT2_PUBLIC_PATH;
  else process.env.GROKBOT2_PUBLIC_PATH = giaTri;
  try { return f(); } finally {
    if (cu != null) process.env.GROKBOT2_PUBLIC_PATH = cu; else delete process.env.GROKBOT2_PUBLIC_PATH;
  }
};

test("máy cá nhân: vẫn chỉ đúng lệnh cần chạy", () => {
  const h = voi(undefined, chuaDungHtml);
  assert.match(h, /pnpm --filter @grokbot2\/web build/);
});

test("máy chủ công khai: KHÔNG nhắc lệnh dev, và nói rõ lỗi thuộc phía mình", () => {
  const h = voi("/agent", chuaDungHtml);
  assert.doesNotMatch(h, /pnpm/, "người dùng cuối không có pnpm — câu này chỉ làm họ hoang mang");
  assert.doesNotMatch(h, /grokbot2/, "đừng phơi tên gói nội bộ ra trang công khai");
  assert.match(h, /phía chúng tôi/, "phải nói rõ không phải lỗi máy của họ");
});

test("khoảng trắng thừa trong PUBLIC_PATH vẫn tính là công khai", () => {
  // `.trim()` — vì một biến môi trường đặt tay rất hay dính dấu cách, và ở đây nó quyết định
  // người dùng cuối đọc được câu nào.
  assert.doesNotMatch(voi("  /agent  ", chuaDungHtml), /pnpm/);
});
