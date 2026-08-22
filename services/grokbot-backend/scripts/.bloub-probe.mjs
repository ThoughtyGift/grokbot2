import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("https://bloub.vercel.app/", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(2500);

const d = await p.evaluate(() => {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const cs = (el) => getComputedStyle(el);
  const root = cs(document.documentElement);
  const vars = {};
  for (const n of ["--paper", "--ink", "--line", "--muted", "--danger", "--timeline", "--bascule"]) {
    vars[n] = root.getPropertyValue(n).trim();
  }
  const body = cs(document.body);
  const out = {
    vars,
    bodyBg: body.backgroundColor,
    bodyColor: body.color,
    fontFamily: body.fontFamily,
    fontSize: px(body.fontSize),
  };
  // gom mọi phần tử có chữ, thống kê font/size/weight/màu
  const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const fonts = new Map(), sizes = new Map(), weights = new Map(), colors = new Map(), radii = new Map(), shadows = new Map();
  for (const el of document.querySelectorAll("*")) {
    const s = cs(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.children.length === 0 && (el.textContent || "").trim()) {
      tally(fonts, s.fontFamily.split(",")[0].replace(/["']/g, ""));
      tally(sizes, px(s.fontSize));
      tally(weights, s.fontWeight);
      tally(colors, s.color);
    }
    if (s.borderRadius && s.borderRadius !== "0px") tally(radii, s.borderRadius);
    if (s.boxShadow && s.boxShadow !== "none") tally(shadows, s.boxShadow.slice(0, 60));
  }
  const top = (m, n = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k} (${c})`);
  out.fonts = top(fonts);
  out.sizes = top(sizes, 8);
  out.weights = top(weights);
  out.colors = top(colors, 8);
  out.radii = top(radii, 8);
  out.shadows = top(shadows, 4);

  // các khối chính: nhãn nhóm + lưới + nút
  const named = [];
  for (const el of document.querySelectorAll("button,[class]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) continue;
    const s = cs(el);
    const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 22);
    named.push({
      tag: el.tagName.toLowerCase(),
      box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      bg: s.backgroundColor, radius: s.borderRadius, border: s.border,
      pad: `${px(s.paddingTop)} ${px(s.paddingRight)} ${px(s.paddingBottom)} ${px(s.paddingLeft)}`,
      font: `${px(s.fontSize)}/${px(s.lineHeight)} ${s.fontWeight}`,
      gap: s.gap, disp: s.display, cols: s.gridTemplateColumns,
      txt,
    });
  }
  out.blocks = named.slice(0, 60);
  return out;
});

console.log(JSON.stringify({ vars: d.vars, bodyBg: d.bodyBg, bodyColor: d.bodyColor, fontFamily: d.fontFamily, fontSize: d.fontSize }, null, 1));
console.log("\nfonts   ", d.fonts.join(" | "));
console.log("sizes   ", d.sizes.join(" | "));
console.log("weights ", d.weights.join(" | "));
console.log("colors  ", d.colors.join(" | "));
console.log("radii   ", d.radii.join(" | "));
console.log("shadows ", d.shadows.join(" | "));
console.log("\n── khối ──");
for (const x of d.blocks) {
  console.log(`${x.box.padEnd(22)} ${x.tag.padEnd(7)} r=${x.radius.padEnd(10)} bg=${x.bg.padEnd(22)} pad=${x.pad.padEnd(14)} f=${x.font.padEnd(12)} ${x.disp === "grid" ? `cols=${x.cols} gap=${x.gap} ` : ""}"${x.txt}"`);
}
await p.screenshot({ path: ".data/bloub-live.png", fullPage: false });
await b.close();
