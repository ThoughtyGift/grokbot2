/**
 * Trang tải — cửa đầu tiên người dùng gặp, và là mảnh 2 trong docs/plan/ship-to-users.md.
 *
 * Hãng đi: website → tải app → đăng nhập → cloud cấp box. Mình đi đúng hình dạng đó nhưng chỉ tới
 * bước hai: trang này phát **bộ cài**, còn app thì người dùng đã có sẵn trên máy (xem README trong
 * gói). Đó là khác biệt thật, và trang nói thẳng ra thay vì che.
 *
 * **Công khai, không qua `checkAuth`** — một trang tải mà đòi token thì không ai tải được. An toàn
 * hôm nay đến từ chỗ khác: BFF nghe `127.0.0.1` (index.ts), nên chưa ai ngoài máy này gọi tới. Khi
 * mở ra ngoài (chặng B3) thì đây là một trong hai route cố ý để mở, cùng `/v1/login`.
 *
 * Không nhận đường dẫn từ người gọi: hai route cố định, đọc hai file cố định. Không có chỗ nào cho
 * `../` chui vào.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");

const LANDING = join(repoRoot, "apps", "grokbot-site", "index.html");
const DIST = join(svcRoot, ".data", "dist");

/** Tên gói phải khớp với scripts/build-setup.mjs — một hằng, không phải hai chỗ đoán nhau. */
export const SETUP_PREFIX = "bot-noi-bo-setup";

/**
 * Đọc lại trang khi file đổi, không phải mỗi request.
 *
 * Sửa CSS rồi F5 mà không thấy gì đổi là kiểu bực mình vô nghĩa; còn đọc lại 20 KB mỗi lần thì
 * lãng phí. `mtimeMs` giải quyết cả hai.
 */
let cached: { mtimeMs: number; html: string } | null = null;

function landingHtml(): string | null {
  try {
    const { mtimeMs } = statSync(LANDING);
    if (!cached || cached.mtimeMs !== mtimeMs) {
      cached = { mtimeMs, html: readFileSync(LANDING, "utf8") };
    }
    return cached.html;
  } catch {
    return null;
  }
}

/** Gói mới nhất trong `.data/dist`, hoặc null khi chưa ai chạy build-setup. */
export function newestSetup(dir = DIST): { name: string; path: string; size: number } | null {
  let best: { name: string; path: string; size: number; mtimeMs: number } | null = null;
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.startsWith(SETUP_PREFIX) || !name.endsWith(".zip")) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!best || st.mtimeMs > best.mtimeMs) best = { name, path, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* biến mất giữa chừng — bỏ qua */ }
  }
  return best ? { name: best.name, path: best.path, size: best.size } : null;
}

/**
 * Trả `true` khi đã trả lời xong, `false` để router đi tiếp.
 *
 * Khi chưa có gói: **503 kèm cách dựng**, không phải 404 trống. Người gặp lỗi này gần như chắc chắn
 * là người đang phát triển, và câu trả lời họ cần là một dòng lệnh.
 */
export async function handleSite(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = url.split("?")[0];

  if (path === "/" || path === "/index.html") {
    const html = landingHtml();
    if (!html) return false;   // chưa có file thì để router trả 404 như cũ
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : html);
    return true;
  }

  if (path === "/download" || path === "/download/") {
    res.writeHead(302, { location: "/download/windows" });
    res.end();
    return true;
  }

  if (path === "/download/windows") {
    const pkg = newestSetup();
    if (!pkg) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "Chưa có gói cài đặt.\n\nDựng bằng:\n  node services/grokbot-backend/scripts/build-setup.mjs\n",
      );
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(pkg.size),
      "content-disposition": `attachment; filename="${pkg.name}"`,
    });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(pkg.path).pipe(res);
    return true;
  }

  return false;
}
