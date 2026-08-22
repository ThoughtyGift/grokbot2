/**
 * Đo hình học THẲNG TRÊN ẢNH CHỤP — dùng khi app gốc không mở cổng gỡ lỗi.
 *
 *   node scripts/measure-shot.mjs <ảnh.png> [--x 43] [--w 88] [--bg 10]
 *
 * Vì sao cần: `x-ray` và `ui-diff` đọc DOM thật qua CDP `:9222`, chính xác tuyệt đối — nhưng chỉ
 * chạy được khi app mở bằng launcher F2. Khi chủ máy mở app kiểu thường thì không còn cổng đó, và
 * cách duy nhất còn lại là ảnh. Đọc ảnh bằng mắt thì ra "trông bé hơn"; đọc bằng máy thì ra
 * "40×40 tại y=63, cách nhau 58px" — sửa được.
 *
 * Cách làm: nạp ảnh vào canvas trong trình duyệt (không thêm thư viện nào), quét một DẢI DỌC, và
 * gom các đoạn liên tiếp có pixel sáng hơn nền thành từng khối.
 *
 *   --x   tâm dải cần quét theo chiều ngang (mặc định 43: rail của app gốc)
 *   --w   bề rộng dải
 *   --bg  ngưỡng: pixel sáng hơn nền bao nhiêu thì tính là có hình
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) { console.error("thiếu đường dẫn ảnh.\n  node scripts/measure-shot.mjs <ảnh.png> [--x 43] [--w 88]"); process.exit(2); }
const abs = resolve(file);
if (!existsSync(abs)) { console.error(`không thấy ${abs}`); process.exit(2); }
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const X = arg("--x", 43), W = arg("--w", 88), BG = arg("--bg", 12);

/*
 * Nạp ảnh bằng data URL, không bằng `file://`.
 *
 * Trang `about:blank` không được phép đọc `file://` — `img.decode()` ném EncodingError, một thông
 * báo không hề nhắc tới nguyên nhân thật là chính sách nguồn gốc.
 */
const ext = abs.toLowerCase().endsWith(".jpg") || abs.toLowerCase().endsWith(".jpeg") ? "jpeg" : "png";
const dataUrl = `data:image/${ext};base64,${readFileSync(abs).toString("base64")}`;

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage();
const out = await page.evaluate(async ({ url, X, W, BG }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const x0 = Math.max(0, Math.round(X - W / 2)), w = Math.min(W, c.width - x0);
  const data = ctx.getImageData(x0, 0, w, c.height).data;

  // Nền = giá trị sáng hay gặp nhất trong dải. Không giả định "nền là đen": ảnh có thể là theme sáng.
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    hist.set(v, (hist.get(v) ?? 0) + 1);
  }
  const bg = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  for (let y = 0; y < c.height; y++) {
    let lit = 0, minX = w, maxX = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
      if (Math.abs(v - bg) > BG) { lit++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    rows.push({ lit, minX, maxX });
  }
  const blocks = [];
  let start = -1;
  for (let y = 0; y <= c.height; y++) {
    const on = y < c.height && rows[y].lit >= 3;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const seg = rows.slice(start, y);
      const left = Math.min(...seg.map((r) => r.minX));
      const right = Math.max(...seg.map((r) => r.maxX));
      blocks.push({ top: start, h: y - start, left: x0 + left, w: right - left + 1 });
      start = -1;
    }
  }
  return { size: `${c.width}x${c.height}`, bg, strip: `${x0}..${x0 + w}`, blocks: blocks.filter((b) => b.h >= 6) };
}, { url: dataUrl, X, W, BG });

console.log(`ảnh ${out.size} · dải x ${out.strip} · mức nền ${out.bg}`);
console.log(`\n── khối tìm được (${out.blocks.length}) ──`);
let prev = null;
for (const b of out.blocks) {
  const gap = prev ? `  cách khối trên ${b.top - (prev.top + prev.h)}px · tâm cách tâm ${Math.round(b.top + b.h / 2) - Math.round(prev.top + prev.h / 2)}px` : "";
  console.log(`  y=${String(b.top).padStart(4)}  ${String(b.w).padStart(3)}x${String(b.h).padStart(3)}  x=${b.left}${gap}`);
  prev = b;
}
await browser.close();
process.exit(0);
