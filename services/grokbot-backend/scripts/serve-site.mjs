/**
 * Máy chủ TĨNH chỉ phát trang tải + file cài — để máy khác tải app về.
 *
 * Vì sao không dùng thẳng backend chính: backend nghe `127.0.0.1` (cố ý, chặng 4 chưa mở), và nó
 * mang **dữ liệu + agent + mọi route `/v1`,`/gw`**. Phơi nguyên cái đó ra mạng để người ta tải một
 * file là mở quá rộng. Máy chủ này chỉ biết đúng ba đường — `/`, `/download/windows`, `/download/mac`
 * — dùng lại `handleSite` của site.ts, nên không có cửa nào khác để lọt vào.
 *
 *   node scripts/serve-site.mjs                 # 0.0.0.0:8080 — máy cùng LAN tải được
 *   PORT=9000 node scripts/serve-site.mjs       # đổi cổng
 *   HOST=127.0.0.1 node scripts/serve-site.mjs  # chỉ localhost (thử tại chỗ)
 *
 * File cài lấy từ `.data/dist` — chạy `build-setup.mjs --with-app` trước để có bản chở app 118 MB.
 *
 * Đưa lên VPS + tên miền: xem docs/plan/publish-download-site.md.
 */
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { handleSite, newestSetup } from "../src/site.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  try {
    if (await handleSite(url, req, res)) return;
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`loi: ${(e).message}`);
    return;
  }
  // Không phải trang tải hay file cài → 404. KHÔNG có route nào khác, đó là điểm mạnh của nó.
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("khong tim thay — may chu nay chi phat trang tai va file cai");
});

server.listen(PORT, HOST, () => {
  const win = newestSetup(undefined, "windows");
  const mac = newestSetup(undefined, "mac");
  const ips = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  console.log(`[serve-site] nghe trên ${HOST}:${PORT}`);
  console.log(`  bản cài Windows: ${win ? `${win.name} (${(win.size / 1048576).toFixed(0)} MB)` : "CHƯA CÓ — chạy build-setup.mjs --with-app"}`);
  console.log(`  bản cài macOS  : ${mac ? mac.name : "chưa có"}`);
  if (HOST === "0.0.0.0" && ips.length) {
    console.log(`  máy khác cùng LAN mở:`);
    for (const ip of ips) console.log(`     http://${ip}:${PORT}/`);
  }
});
