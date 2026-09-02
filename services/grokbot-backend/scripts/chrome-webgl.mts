/**
 * Đảm bảo Chrome CỦA MÌNH (có WebGL) đang chạy trên box, rồi ĐO xem nó có WebGL thật không.
 *
 *   npx tsx --env-file=.env services/grokbot-backend/scripts/chrome-webgl.mts
 *   npx tsx --env-file=.env services/grokbot-backend/scripts/chrome-webgl.mts --chi-do
 *
 * Vì sao một script riêng thay vì gọi tay: `chrome-dam-bao.sh` sống trên box, nhưng thứ quyết định
 * "đã được chưa" là **WebGL có bật không** — và đó là một phép đo phải chạy TRONG trình duyệt đó.
 * Bật xong mà không đo thì y hệt lần trước: cổng mở, `webgl2 KHÔNG`, và không ai biết.
 *
 * Đo qua `document.title` + `/json/list` thay vì WebSocket: cổng mới chưa nằm trong hầm ssh, nên
 * endpoint HTTP của CDP là đường duy nhất đọc được kết quả JS từ đây. Mẹo này ghi trong
 * `infra/box/README.md`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { boxCall, boxConfigured } from "../src/box-exec.js";

const CHI_DO = process.argv.includes("--chi-do");
const CONG = process.env.CHROME_CDP_PORT ?? "9224";
const HERE = dirname(fileURLToPath(import.meta.url));

if (!boxConfigured()) { console.error("box chưa cấu hình — thiếu biến môi trường"); process.exit(2); }

const chay = async (command: string) => {
  const r = await boxCall<{ stdout?: string; stderr?: string; exitCode?: number }>("exec", { command });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), code: r.exitCode ?? 0 };
};

// ── 1 · chở script lên box rồi chạy ────────────────────────────────────────────────────────────
if (!CHI_DO) {
  const sh = readFileSync(join(HERE, "..", "..", "..", "infra", "box", "chrome-dam-bao.sh"), "utf8");
  // Gốc của `write` là workspace — mọi đường ngoài đó bị từ chối ("path escapes root").
  await boxCall("write", { target_file: "chrome-dam-bao.sh", content: sh });
  const r = await chay(`chmod +x ~/workspace/chrome-dam-bao.sh && CHROME_CDP_PORT=${CONG} sh ~/workspace/chrome-dam-bao.sh`);
  console.log(`đảm bảo: ${r.out || "(rỗng)"}`);
  if (r.code !== 0) { console.error(`\nKHÔNG BẬT ĐƯỢC (exit ${r.code}) — dừng, không đo tiếp.`); process.exit(1); }
}

// ── 2 · đo WebGL bên trong chính trình duyệt đó ────────────────────────────────────────────────
const HTML = `<!doctype html><title>dang-do</title><body>x</body><script>
(function(){
  var ra = [];
  ["webgl","webgl2"].forEach(function(k){
    try { var g = document.createElement("canvas").getContext(k); ra.push(k+"="+(g?"CO":"KHONG")); }
    catch (e) { ra.push(k+"=loi"); }
  });
  document.title = "KETQUA " + ra.join(" ");
})();
</script>`;
await boxCall("write", { target_file: "do-webgl.html", content: HTML });

const nha = await chay(
  `curl -s --max-time 8 -X PUT "http://127.0.0.1:${CONG}/json/new?file:///$HOME/workspace/do-webgl.html" > /dev/null; sleep 3; `
  + `curl -s --max-time 8 "http://127.0.0.1:${CONG}/json/list" | grep -o '"title": "KETQUA[^"]*"' | head -1`,
);
console.log(`đo: ${nha.out || "(không đọc được title — trang chưa chạy?)"}`);

const co = /webgl2=CO/.test(nha.out);
console.log(co
  ? `\n✔ Chrome trên cổng ${CONG} CÓ WebGL2 — trỏ GROKBOT2_BROWSER_CDP vào http://127.0.0.1:${CONG}`
  : `\n✘ chưa có WebGL2 trên cổng ${CONG} — ĐỪNG đổi GROKBOT2_BROWSER_CDP, sẽ mất cả trình duyệt đang dùng được`);
process.exit(co ? 0 : 1);
