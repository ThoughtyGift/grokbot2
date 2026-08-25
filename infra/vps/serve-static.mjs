/**
 * Máy chủ tĩnh cho VPS — chỉ phát trang tải và file cài. Không phụ thuộc gì.
 *
 * Vì sao KHÔNG dùng `scripts/serve-site.mjs`: cái đó import `src/site.js`, kéo theo cả backend
 * (store, auth, mcp…). Đưa nguyên khối đó lên một VPS đang chạy **foodaymart.vn, admin.halcion.vn,
 * media.halcion.vn, convex** là mang rủi ro vào chỗ không cần. File này đứng một mình: Node thuần,
 * không `node_modules`, không đọc gì ngoài thư mục của chính nó.
 *
 *   node serve-static.mjs            # 0.0.0.0:8099
 *   PORT=8099 DIR=/opt/botnoibo node serve-static.mjs
 *
 * Bố cục thư mục nó cần:
 *   <DIR>/index.html          trang tải
 *   <DIR>/dist/<file>.exe     bộ cài Windows   → /download/windows
 *   <DIR>/dist/<file>.command bộ cài macOS     → /download/mac
 *
 * Ba đường, không hơn. Mọi thứ khác trả 404 — không có `/v1`, không có `/gw`, không có gì để dò.
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, createReadStream, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8099);
const DIR = process.env.DIR ?? new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIST = join(DIR, "dist");

/** File cài mới nhất theo đuôi. Tên có ngày nên khi hoà thời gian thì so tên cho ổn định. */
function newest(ext) {
  if (!existsSync(DIST)) return null;
  let best = null;
  for (const name of readdirSync(DIST)) {
    if (!name.endsWith(ext)) continue;
    const path = join(DIST, name);
    const st = statSync(path);
    if (!best || st.mtimeMs > best.mtimeMs || (st.mtimeMs === best.mtimeMs && name > best.name)) {
      best = { name, path, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
  return best;
}

function sendFile(res, pkg) {
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(pkg.size),
    "content-disposition": `attachment; filename="${pkg.name}"`,
  });
  createReadStream(pkg.path).pipe(res);
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/" || path === "/index.html") {
    try {
      const html = readFileSync(join(DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return res.end(req.method === "HEAD" ? undefined : html);
    } catch {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      return res.end("thieu index.html");
    }
  }

  if (path === "/download" || path === "/download/") {
    res.writeHead(302, { location: "/download/windows" });
    return res.end();
  }

  if (path === "/download/windows" || path === "/download/mac") {
    const pkg = newest(path.endsWith("mac") ? ".command" : ".exe");
    if (!pkg) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      return res.end("chua co bo cai cho he nay");
    }
    if (req.method === "HEAD") { res.writeHead(200, { "content-length": String(pkg.size) }); return res.end(); }
    return sendFile(res, pkg);
  }

  /*
   * Bản CHỞ CẢ APP — sau một đường bí mật, KHÔNG công khai.
   *
   * Bản này mang client của nhà phát hành. Để nó ở một URL ai cũng đoán được là **phân phối phần
   * mềm của họ**; để sau một token 24 ký tự thì nó là "chép sang máy khác của chính mình", đúng thứ
   * `docs/legal.md` cho phép. Token nằm ở tên thư mục: `/opt/botnoibo/full/<token>/*.exe`.
   *
   * `/download/full/<token>` — sai token thì 404 y như mọi đường lạ, không nói "sai token" (nói ra
   * là xác nhận có thứ gì đó ở đây để đoán tiếp).
   */
  const full = /^\/download\/full\/([A-Za-z0-9]{8,64})\/?$/.exec(path);
  if (full) {
    const dir = join(DIR, "full", full[1]);
    const file = existsSync(dir) ? readdirSync(dir).find((n) => n.endsWith(".exe")) : undefined;
    if (file) {
      const st = statSync(join(dir, file));
      if (req.method === "HEAD") { res.writeHead(200, { "content-length": String(st.size) }); return res.end(); }
      return sendFile(res, { name: file, path: join(dir, file), size: st.size });
    }
  }

  // Kiem tra song: de biet dich vu con chay ma khong phai tai ca trang.
  if (path === "/healthz") {
    const win = newest(".exe"), mac = newest(".command");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, windows: win?.name ?? null, mac: mac?.name ?? null }));
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("khong tim thay — may chu nay chi phat trang tai va file cai");
});

server.listen(PORT, "0.0.0.0", () => {
  const win = newest(".exe"), mac = newest(".command");
  console.log(`[site] nghe 0.0.0.0:${PORT} · thu muc ${DIR}`);
  console.log(`[site] windows: ${win ? `${win.name} (${(win.size / 1048576).toFixed(1)} MB)` : "chua co"}`);
  console.log(`[site] macos  : ${mac ? mac.name : "chua co"}`);
});
