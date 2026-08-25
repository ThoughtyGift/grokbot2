/**
 * Client nằm ở đâu trên từng hệ — infra/patches/client-paths.mjs.
 *
 *   npx tsx --test services/grokbot-backend/src/client-paths.test.ts
 *
 * Đây là phần **không thể thử tay** được: máy đang phát triển là Windows, nên nhánh macOS chỉ có
 * bài kiểm mới chạm tới. Và sai ở đây thì hỏng theo kiểu tệ nhất — bộ vá ghi vào một thư mục không
 * ai đọc, `--verify` báo xanh, còn app vẫn boot bản gốc.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Module JS thuần ngoài phạm vi tsconfig của service — khai báo hình dạng ngay tại đây thay vì
// thêm một file .d.ts cho một hàm. `any` bị cấm trong repo, nên nói rõ kiểu trả về.
interface ClientPaths {
  platform: string; supported: boolean; appDir: string; res: string;
  asar: string; asarAside: string; appUnpacked: string;
  running: { cmd: string; args: string[]; match: RegExp } | null;
}
const mod = await import("../../../infra/patches/client-paths.mjs" as string) as {
  clientPaths: (opts?: { platform?: string; env?: Record<string, string | undefined> }) => ClientPaths;
  ASIDE_NAME: string;
};
const { clientPaths, ASIDE_NAME } = mod;

test("macOS: resources nằm trong bó .app, không phải cạnh nó", () => {
  const p = clientPaths({ platform: "darwin", env: {} });
  assert.equal(p.appDir, "/Applications/Grok Bot.app");
  assert.match(p.res.replace(/\\/g, "/"), /\/Applications\/Grok Bot\.app\/Contents\/Resources$/);
  assert.match(p.asar.replace(/\\/g, "/"), /Contents\/Resources\/app\.asar$/);
  assert.equal(p.supported, true);
});

test("Windows: dưới LOCALAPPDATA, resources nằm cạnh", () => {
  const p = clientPaths({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" } });
  assert.match(p.res.replace(/\\/g, "/"), /AppData\/Local\/Programs\/Grok Bot\/resources$/);
  assert.equal(p.supported, true);
});

test("GROKBOT2_CLIENT_DIR thắng mặc định trên mọi hệ", () => {
  const mac = clientPaths({ platform: "darwin", env: { GROKBOT2_CLIENT_DIR: "/tmp/Thu.app" } });
  assert.match(mac.res.replace(/\\/g, "/"), /^\/tmp\/Thu\.app\/Contents\/Resources$/);
  const win = clientPaths({ platform: "win32", env: { GROKBOT2_CLIENT_DIR: "D:\\thu" } });
  assert.match(win.res.replace(/\\/g, "/"), /^D:\/thu\/resources$/);
});

test("Linux không đoán bừa một đường dẫn không có thật", () => {
  const bare = clientPaths({ platform: "linux", env: {} });
  assert.equal(bare.supported, false, "không có bản Linux nào để đoán");
  const forced = clientPaths({ platform: "linux", env: { GROKBOT2_CLIENT_DIR: "/opt/gb" } });
  assert.equal(forced.supported, true, "ghi đè bằng tay thì cho phép thử");
});

test("mỗi hệ có cách hỏi 'app đang chạy chưa' — và hệ lạ trả null, không phải false", () => {
  assert.equal(clientPaths({ platform: "win32", env: {} }).running?.cmd, "tasklist");
  assert.equal(clientPaths({ platform: "darwin", env: {} }).running?.cmd, "pgrep");
  // null = KHÔNG BIẾT. Người gọi phải nói ra điều đó, không được coi như "không chạy" —
  // vá đè lên một client đang mở là cách chắc chắn nhất để hỏng nửa chừng.
  assert.equal(clientPaths({ platform: "freebsd", env: { GROKBOT2_CLIENT_DIR: "/x" } }).running, null);
});

test("tên file dời sang một bên giống nhau ở mọi hệ", () => {
  assert.equal(ASIDE_NAME, "app.asar.disabled-by-grokbot2");
  for (const platform of ["win32", "darwin"]) {
    assert.ok(clientPaths({ platform, env: { LOCALAPPDATA: "C:\\x" } }).asarAside.endsWith(ASIDE_NAME));
  }
});
