/**
 * Phát bản build của `apps/grokbot-web` tại `/app/`.
 *
 * Vì sao backend phải phát nó: app desktop mở `CURSOR_WEBSITE_URL/loginDeepControl` để đăng nhập, và
 * `CURSOR_WEBSITE_URL` trỏ vào **gốc của backend**. Còn giao diện đăng nhập thì đã có sẵn từ trước
 * trong `apps/grokbot-web` (email + mật khẩu + tạo tài khoản + đăng xuất). Trước đây hai thứ đó ở
 * hai nơi không gặp nhau: FE chỉ sống trên Vite `:5173`, mà backend thì không phát gì ngoài trang tải.
 *
 * Nên thay vì dựng một form đăng nhập thứ hai, backend phát chính bản build đó và `/loginDeepControl`
 * chuyển hướng vào nó. Một giao diện, một chỗ để sửa.
 *
 * Chỉ phát khi đã `pnpm --filter @grokbot2/web build`. Chưa build thì nói thẳng ra là chưa build,
 * chứ không trả trang trắng — trang trắng là kiểu hỏng tốn nhiều thời gian nhất để đoán.
 */
import type { ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST = process.env.GROKBOT2_WEB_DIST ?? join(repoRoot, "apps", "grokbot-web", "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Bản build có sẵn chưa — dùng cho trang chẩn đoán và cho `/loginDeepControl`. */
export function webAppBuilt(): boolean {
  return existsSync(join(DIST, "index.html"));
}

/**
 * `GET /app/...` — trả file trong bản build.
 *
 * Đường nào không phải file thì trả `index.html`: đây là ứng dụng một trang, và `/app/xyz` phải để
 * cho router phía trong nó xử lý chứ không phải 404 ở đây.
 */
export function handleWebApp(url: string, res: ServerResponse): boolean {
  if (!url.startsWith("/app")) return false;

  if (!webAppBuilt()) {
    res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
    res.end("<h1>Giao diện web chưa được dựng</h1>"
      + "<p>Chạy <code>pnpm --filter @grokbot2/web build</code> rồi tải lại trang.</p>");
    return true;
  }

  const path = new URL(url, "http://x").pathname.slice("/app".length) || "/";
  /*
   * Chặn `..` TRƯỚC khi ghép đường dẫn.
   *
   * `/app/../../.env` mà ghép thẳng thì `join` sẽ vui vẻ đi ra ngoài `dist` — và cửa này là cửa công
   * khai duy nhất phát file từ đĩa. `normalize` gom `..` lại để kiểm được, rồi vẫn kiểm lần nữa là
   * kết quả có còn nằm trong `dist` không.
   */
  const wanted = normalize(join(DIST, normalize(path)));
  const inside = wanted === DIST || wanted.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep);
  const hit = inside && existsSync(wanted) && statSync(wanted).isFile();

  /*
   * Dự phòng `index.html` chỉ dành cho **đường đi lại**, không dành cho file.
   *
   * Đây là ứng dụng một trang, nên `/app/xyz` phải để router bên trong nó xử lý — đúng. Nhưng nếu
   * dự phòng cho cả những đường có phần mở rộng thì một file thiếu cũng trả 200: `/app/favicon.ico`
   * phát ra `index.html` **dán nhãn `image/x-icon`**. Trình duyệt không vẽ được, và không ai biết là
   * file đó không tồn tại — kiểu hỏng đắt nhất, vì nó trông như đã chạy.
   */
  const looksLikeFile = extname(path) !== "";
  if (!hit && looksLikeFile) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("không có file này trong bản dựng giao diện");
    return true;
  }

  const file = hit ? wanted : join(DIST, "index.html");
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Tài nguyên có mã băm trong tên nên đóng băng được; `index.html` thì không, vì nó là thứ trỏ tới
  // mã băm mới sau mỗi lần dựng lại.
  const caching = file.endsWith("index.html")
    ? { "cache-control": "no-cache" }
    : { "cache-control": "public, max-age=31536000, immutable" };
  res.writeHead(200, { "content-type": type, ...caching });
  createReadStream(file).pipe(res);
  return true;
}
