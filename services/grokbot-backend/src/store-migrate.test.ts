/**
 * Di chú phải chạy **kể cả khi sổ đã bị một lượt đọc mở trước**.
 *
 * Đây là cái bẫy đã âm thầm ăn mất cột `token_version` của chặng 2 trên bản cài thật:
 *
 *   `index.ts` gọi `enableWriting()` ở dòng 13 với ý "mọi module nạp sau đó đều ghi được". Nhưng ESM
 *   **nâng toàn bộ `import` lên chạy trước mọi câu lệnh**, mà `host-settings.ts` và `chat/state.ts`
 *   gọi `loadState()` ngay ở cấp module. Nên sổ mở dưới danh nghĩa tiến trình ĐỌC, `getDb` bỏ qua
 *   migration đúng như nó được bảo, rồi nhớ luôn kết nối đó — migration không bao giờ chạy nữa.
 *
 * Không có lỗi nào hiện ra suốt từ đó: chỉ tới ngày 26/08, khi `/oauth/token` cần đọc `token_version`
 * để làm mới token, mới lộ ra là `/v1/logout` chưa từng thu hồi được gì.
 *
 * Bài này dựng lại đúng thứ tự đó — đọc trước, ghi sau — trên một sổ tạm.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const columnsOf = (file: string): string[] => {
  const db = new DatabaseSync(file);
  try { return (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name); }
  finally { db.close(); }
};

test("một lượt đọc mở sổ trước KHÔNG làm mất di chú của người ghi", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grokbot2-mig-"));
  const file = join(dir, "grokbot.sqlite");
  const prev = process.env.GROKBOT2_SQLITE_FILE;
  process.env.GROKBOT2_SQLITE_FILE = file;
  // Windows không xoá được file đang mở, nên phải trả kết nối lại trước khi dọn thư mục tạm.
  let closeStore: (() => void) | null = null;
  try {
    // Nạp sạch một bản `store` mới, để trạng thái mô-đun (`db`, `writingEnabled`) không dính bài khác.
    const store = await import(`./store.js?migrate-test=${Date.now()}`) as typeof import("./store.js");
    closeStore = store._resetForTest;

    // 1. Sổ chưa có → lượt đọc đầu tiên vẫn phải dựng bảng (không có gì để đọc thì phải tạo).
    store.loadState();
    assert.ok(columnsOf(file).includes("auth_id"), "sổ mới phải được dựng bảng dù người mở là lượt đọc");

    // 2. Bỏ cột đi, giả lập một sổ cũ hơn bản code hiện tại.
    const raw = new DatabaseSync(file);
    raw.exec("ALTER TABLE users DROP COLUMN token_version");
    raw.close();
    assert.ok(!columnsOf(file).includes("token_version"), "đã dựng lại được cảnh sổ cũ");

    // 3. Đúng thứ tự của `index.ts`: một lượt ĐỌC chạm sổ trước, rồi mới `enableWriting()`.
    store.loadState();
    store.enableWriting();

    assert.ok(
      columnsOf(file).includes("token_version"),
      "người ghi phải dựng schema kể cả khi kết nối đã mở sẵn từ lượt đọc",
    );
  } finally {
    closeStore?.();
    if (prev === undefined) delete process.env.GROKBOT2_SQLITE_FILE;
    else process.env.GROKBOT2_SQLITE_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
