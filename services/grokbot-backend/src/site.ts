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

/**
 * Tên gói phải khớp với scripts/build-setup.mjs — một hằng, không phải hai chỗ đoán nhau.
 *
 * Mỗi hệ **một file duy nhất**, không phải zip: bản zip đầu tiên giải nén ra 6 mục lộn xộn và
 * trông không giống bộ cài nào. Đuôi khác nhau nên cũng không tải nhầm được cho nhau.
 */
export const SETUP_KINDS = {
  // Thứ tự có nghĩa: `.exe` trước vì đó là thứ trông giống một bộ cài thật (icon riêng, gỡ được từ
  // Apps & features). Máy dựng không có Inno Setup thì rơi xuống `.cmd` — vẫn cài được y hệt.
  windows: [
    // Bản CHỞ CẢ APP trước: người tải không cần cài client trước, cũng không cần Node — đúng hình
    // dạng bộ cài của hãng. Dựng bằng `build-setup.mjs --with-app`, không dựng mặc định.
    { prefix: "Bot-Noi-Bo-Setup", ext: ".exe" },
    // Bản 2 MB chỉ cấu hình: dùng khi máy đã có client sẵn.
    { prefix: "Cai-dat-Bot-Noi-Bo-2", ext: ".exe" },
    { prefix: "Cai-dat-Bot-Noi-Bo-win", ext: ".cmd" },
  ],
  mac: [{ prefix: "Cai-dat-Bot-Noi-Bo-mac", ext: ".command" }],
} as const;
export type SetupKind = keyof typeof SETUP_KINDS;

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

/**
 * Gói mới nhất trong `.data/dist`, hoặc null khi chưa ai chạy build-setup.
 *
 * **Độ MỚI thắng trước, loại chỉ để phá hoà.** Bản trước duyệt theo thứ tự loại và trả về ngay khi
 * loại đầu tiên có file — nên một gói CŨ thuộc loại "sang" (bản chở-cả-app) luôn thắng một gói MỚI
 * thuộc loại thường. Đo 03/09: trang tải phát `Bot-Noi-Bo-Setup-20260827.exe` trong khi bản
 * `Cai-dat-Bot-Noi-Bo-20260902.exe` đã nằm cạnh đó — người tải nhận gói thiếu sáu ngày tính năng,
 * trong đó có cả bản vá chặn app tự cập nhật.
 *
 * Đổi lại: một gói cũ hơn không bao giờ được phát chỉ vì nó tiện hơn. Tiện mà cũ thì vẫn là sai
 * phiên bản, và sai phiên bản là thứ người dùng không tự phát hiện được.
 */
export function newestSetup(dir = DIST, kind: SetupKind = "windows"): { name: string; path: string; size: number } | null {
  const uu = SETUP_KINDS[kind];
  let best: { name: string; path: string; size: number; mtimeMs: number; hang: number } | null = null;
  for (const [hang, { prefix, ext }] of uu.entries()) {
    const hit = newestMatching(dir, prefix, ext);
    if (!hit) continue;
    const mtimeMs = statSync(hit.path).mtimeMs;
    // Mới hơn thì thắng; bằng tuổi thì loại đứng trước trong danh sách thắng.
    if (!best || mtimeMs > best.mtimeMs || (mtimeMs === best.mtimeMs && hang < best.hang)) {
      best = { ...hit, mtimeMs, hang };
    }
  }
  return best ? { name: best.name, path: best.path, size: best.size } : null;
}

function newestMatching(dir: string, prefix: string, ext: string): { name: string; path: string; size: number } | null {
  let best: { name: string; path: string; size: number; mtimeMs: number } | null = null;
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(ext)) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      // Hoà mtime là chuyện thật, không phải giả định: hai bản dựng liền nhau rơi vào cùng một
      // mili-giây, và khi đó thứ tự `readdir` quyết định — tức là ngẫu nhiên. Tên có ngày ở trong
      // nên so tên là mốc phụ ổn định.
      const newer = !best
        || st.mtimeMs > best.mtimeMs
        || (st.mtimeMs === best.mtimeMs && name > best.name);
      if (newer) best = { name, path, size: st.size, mtimeMs: st.mtimeMs };
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

  const kind: SetupKind | null =
    path === "/download/windows" ? "windows" : path === "/download/mac" ? "mac" : null;
  if (kind) {
    const pkg = newestSetup(DIST, kind);
    if (!pkg) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        "Chưa có gói cài đặt.\n\nDựng bằng:\n  node services/grokbot-backend/scripts/build-setup.mjs\n",
      );
      return true;
    }
    res.writeHead(200, {
      // Không phải zip nữa: một script cài. `octet-stream` để trình duyệt tải về thay vì mở ra đọc.
      "content-type": "application/octet-stream",
      "content-length": String(pkg.size),
      "content-disposition": `attachment; filename="${pkg.name}"`,
    });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(pkg.path).pipe(res);
    return true;
  }

  return false;
}
