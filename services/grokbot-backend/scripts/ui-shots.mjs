/**
 * Ảnh so **từng vùng** giữa app gốc và FE :5173 — app bên trái, FE bên giữa, chênh lệch bên phải.
 *
 *   node scripts/ui-shots.mjs            # ra .data/ui-shots.html
 *   node scripts/ui-shots.mjs --open     # ghi rồi mở luôn bằng trình duyệt mặc định
 *
 * ── Vì sao phải tự dựng, không dùng tool có sẵn ────────────────────────────────
 *
 * Đã tìm: `sitedrift`, `diffsite`, `Pixel Perfect`, `side-by-side-browser` — tất cả so **hai URL**
 * bằng iframe hoặc webview. App gốc không phải URL: renderer của nó là một trang `file://` sống
 * trong process Electron với preload bridge (`window.desktop`, MessagePort qua
 * `ipcRenderer.on("sand:coordinator-port")`). Trỏ trình duyệt khác vào đúng file đó thì ra cái vỏ
 * chết — không roster, không chat. `chrome-devtools-mcp` (Google) thì nối được vào `:9222` thật,
 * nhưng nó chỉ cấp lại đúng quyền CDP mà script này đang dùng; không thêm gì.
 *
 * Nên đường duy nhất là lấy pixel qua CDP của chính app, rồi ghép. Kỹ thuật chồng ảnh
 * (`mix-blend-mode: difference`) mượn từ mấy tool trên — chỉ pixel trùng nhau mới thành đen.
 *
 * Dùng CHUNG bảng anchor với `ui-diff.mjs`: một bảng ra cả con số lẫn hình. Thêm vùng vào đó là
 * cả hai thước đo đều thấy, không phải sửa hai chỗ.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { ANCHORS } from "./ui-anchors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(resolve(HERE, ".."), ".data", "ui-shots.html");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const URL_FE = arg("--url", "http://127.0.0.1:5173");
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const [W, H] = arg("--size", "1920x1040").split("x").map(Number);

const browser = await chromium.connectOverCDP(CDP);
let appPage = null, bestText = -1;
for (const pg of browser.contexts()[0].pages()) {
  const n = await pg.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
  if (n > bestText) { bestText = n; appPage = pg; }
}
if (!appPage) { console.error("không tìm được renderer trên CDP — app có đang chạy không?"); process.exit(2); }

const own = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const webPage = await own.newPage({ viewport: { width: W, height: H } });

/** Ảnh một phần tử, trả về data URI. `null` khi không có phần tử hoặc nó rỗng. */
async function shot(page, sel) {
  const el = await page.$(sel);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return null;
  // `scale: "css"` để 1px hai bên là cùng một px, không nhân theo devicePixelRatio.
  const buf = await el.screenshot({ scale: "css" }).catch(() => null);
  if (!buf) return null;
  return { uri: `data:image/png;base64,${buf.toString("base64")}`, w: Math.round(box.width), h: Math.round(box.height) };
}

const cdp = await appPage.context().newCDPSession(appPage);
let overridden = false;
const clearOverride = async () => {
  if (!overridden) return;
  overridden = false;
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
};
process.on("exit", () => { if (overridden) console.log("\n! override kích thước có thể còn sót — khởi động lại app nếu cửa sổ lạ"); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { void clearOverride().then(() => process.exit(130)); });

const rows = [];
try {
  await webPage.goto(URL_FE, { waitUntil: "domcontentloaded" });
  await webPage.waitForSelector(".roster .bot", { timeout: 20_000 });
  const n = await webPage.locator(".roster .bot").count();
  let best = 0, bestLen = -1;
  for (let i = 0; i < n; i++) {
    const len = (await webPage.locator(".roster .bot").nth(i).innerText()).length;
    if (len > bestLen) { bestLen = len; best = i; }
  }
  await webPage.locator(".roster .bot").nth(best).click();
  await webPage.waitForTimeout(2000);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  overridden = true;
  await appPage.waitForTimeout(1200);

  for (const a of ANCHORS) {
    if (a.name === "shell") continue; // cả khung hình, không phải một vùng để soi
    const [app, web] = await Promise.all([shot(appPage, a.app), shot(webPage, a.web)]);
    rows.push({ name: a.name, app, web });
    const mark = app && web ? (app.w === web.w && app.h === web.h ? "=" : "≠") : "–";
    console.log(`  ${mark} ${a.name.padEnd(18)} app ${app ? `${app.w}×${app.h}` : "—".padEnd(7)}   FE ${web ? `${web.w}×${web.h}` : "—"}`);
  }
} finally {
  await clearOverride();
  await own.close().catch(() => {});
  // KHÔNG đóng `browser`: đó là app đang chạy của chủ máy.
}

const cell = (s) => (s ? `<img src="${s.uri}" width="${s.w}" height="${s.h}" alt="">` : `<span class=none>không có</span>`);
const html = `<!doctype html><meta charset="utf-8"><title>ui-shots — app vs :5173</title>
<style>
 body{margin:0;background:#101014;color:#eee;font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
 header{padding:16px 20px;border-bottom:1px solid #2a2a32}
 h1{margin:0 0 4px;font-size:15px}
 p{margin:0;color:#9aa}
 table{border-collapse:collapse;width:100%}
 th,td{padding:10px 12px;border-bottom:1px solid #23232b;vertical-align:top}
 th{position:sticky;top:0;background:#16161c;text-align:left;font-weight:600;z-index:1}
 td.n{white-space:nowrap;color:#cbd}
 td.n small{display:block;color:#889}
 img{display:block;max-width:520px;background:#000;image-rendering:pixelated}
 .none{color:#666;font-style:italic}
 /* Chồng ảnh: pixel giống nhau ra ĐEN, khác nhau thì sáng lên. Đúng kỹ thuật của diffsite. */
 .ov{position:relative;background:#000;width:max-content}
 .ov img:last-child{position:absolute;inset:0;mix-blend-mode:difference}
 .warn{color:#f4b}
</style>
<header>
 <h1>app gốc · FE :5173 · chênh lệch</h1>
 <p>${W}×${H} — ép cùng khổ cho cả hai phía. Ô "chênh lệch": <strong>đen là trùng khớp</strong>; chỗ nào sáng lên là chỗ khác nhau.
 Kích thước lệch thì phần thừa cũng sáng, đó là thật chứ không phải nhiễu.</p>
</header>
<table>
 <tr><th>vùng</th><th>app gốc</th><th>FE :5173</th><th>chênh lệch</th></tr>
 ${rows.map((r) => `<tr>
   <td class=n>${r.name}<small>${r.app ? `${r.app.w}×${r.app.h}` : "—"} · ${r.web ? `${r.web.w}×${r.web.h}` : "—"}</small>${
     r.app && r.web && (r.app.w !== r.web.w || r.app.h !== r.web.h) ? `<small class=warn>lệch kích thước</small>` : ""}</td>
   <td>${cell(r.app)}</td>
   <td>${cell(r.web)}</td>
   <td>${r.app && r.web ? `<div class=ov><img src="${r.app.uri}" width="${r.app.w}" height="${r.app.h}" alt=""><img src="${r.web.uri}" width="${r.web.w}" height="${r.web.h}" alt=""></div>` : `<span class=none>thiếu một bên</span>`}</td>
  </tr>`).join("\n")}
</table>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`\n${rows.length} vùng → ${OUT}`);
if (process.argv.includes("--open") && existsSync(OUT)) {
  spawn("cmd", ["/c", "start", "", OUT], { detached: true, stdio: "ignore" }).unref();
}
process.exit(0);
