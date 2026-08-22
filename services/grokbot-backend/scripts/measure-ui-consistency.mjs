/**
 * Đo mức KHÔNG ĐỒNG NHẤT của FE `:5173` — bằng số, không bằng cảm giác.
 *
 *   node scripts/measure-ui-consistency.mjs
 *
 * Vì sao cần: "giao diện chưa đồng nhất" là một nhận xét đúng nhưng không sửa được trực tiếp. Sửa
 * được là khi biết *cụ thể* có bao nhiêu biến thể của cùng một thứ: mấy chiều cao nút, mấy bán kính
 * bo, mấy cỡ chữ, mấy màu nền — và cái nào chỉ dùng một lần (dấu hiệu của việc dựng lẻ, không theo
 * hệ). Bảng này chính là danh sách việc phải gộp.
 *
 * Hai phần:
 *   · TĨNH  — quét CSS: màu/khoảng cách viết cứng thay vì dùng token trong `:root`
 *   · ĐỘNG  — mở trang thật, đọc computed style của mọi control, gom theo giá trị
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const CSS = join(REPO, "apps", "grokbot-web", "src", "style.css");
const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";

// ── phần tĩnh ────────────────────────────────────────────────────────────────
const css = readFileSync(CSS, "utf8");
const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const tokens = [...rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));
const body = css.slice(css.indexOf("}", css.indexOf(":root")));
const hardColors = [...body.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\boklch\([^)]*\)/gi)].map((m) => m[0]);
const byColor = new Map();
for (const c of hardColors) byColor.set(c.toLowerCase(), (byColor.get(c.toLowerCase()) ?? 0) + 1);

console.log(`── token trong :root (${tokens.length}) ──`);
console.log(`  ${tokens.map((t) => t.name).join(" · ")}`);
console.log(`\n── màu viết cứng ngoài :root (${byColor.size} giá trị khác nhau, ${hardColors.length} lần dùng) ──`);
for (const [c, n] of [...byColor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(3)}×  ${c}`);
}

/*
 * Số đáng đo là TỈ LỆ DÙNG TOKEN, không phải "có bao nhiêu giá trị khác nhau".
 *
 * Bản đầu đếm mọi giá trị khác nhau là một dấu hiệu xấu — nên avatar 64×64 (số đo thật ở app gốc)
 * và checkbox 16px cũng bị tính là "không đồng nhất". Một phép đo mà làm đúng theo nó thì sản phẩm
 * sai thì tệ hơn không đo. Đa dạng có chủ ý là bình thường; điều không bình thường là cùng một ý
 * được viết bằng ba giá trị cứng ở ba chỗ.
 */
const DECL = /([a-z-]+)\s*:\s*([^;{}]+);/g;
const WATCH = new Set(["border-radius", "font-size", "color", "background", "background-color", "height", "transition-duration"]);
const adoption = new Map();
for (const m of body.matchAll(DECL)) {
  const prop = m[1].trim(), val = m[2].trim();
  if (!WATCH.has(prop)) continue;
  const usesToken = val.includes("var(--");
  if (!adoption.has(prop)) adoption.set(prop, { token: 0, literal: 0, worst: new Map() });
  const a = adoption.get(prop);
  if (usesToken) a.token++;
  else { a.literal++; a.worst.set(val, (a.worst.get(val) ?? 0) + 1); }
}
console.log(`
── dùng token hay viết cứng (trong style.css) ──`);
let tk = 0, lt = 0;
for (const [prop, a] of [...adoption.entries()].sort((x, y) => y[1].literal - x[1].literal)) {
  tk += a.token; lt += a.literal;
  const top = [...a.worst.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([v, n]) => `${v}×${n}`).join(" · ");
  console.log(`  ${prop.padEnd(20)} token ${String(a.token).padStart(3)} · cứng ${String(a.literal).padStart(3)}${top ? `   hay gặp: ${top}` : ""}`);
}
console.log(`  ${"TỔNG".padEnd(20)} token ${tk} · cứng ${lt}  → ${Math.round((tk / (tk + lt)) * 100)}% dùng token`);

// ── phần động// ── phần động ────────────────────────────────────────────────────────────────
const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error(`\nkhông lấy được /v1/session từ ${API} — bỏ phần động`); process.exit(2); }

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
await page.addInitScript((t) => {
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", "host@local");
}, tok);
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".sidebar", { timeout: 15_000 });
await page.waitForTimeout(1200);

const controls = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, input, textarea, label.attach, [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    const cls = typeof el.className === "string" ? el.className.split(" ").filter(Boolean)[0] ?? el.tagName.toLowerCase() : el.tagName.toLowerCase();
    out.push({
      who: cls,
      h: Math.round(r.height),
      radius: cs.borderRadius,
      font: cs.fontSize,
      weight: cs.fontWeight,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth === "0px" ? "none" : `${cs.borderTopWidth} ${cs.borderTopColor}`,
      padX: cs.paddingLeft,
      transition: cs.transitionDuration,
    });
  }
  return out;
});

const tally = (key) => {
  const m = new Map();
  for (const c of controls) {
    const v = String(c[key]);
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(c.who);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};

let lonely = 0;
for (const key of ["h", "radius", "font", "weight", "bg", "border", "transition"]) {
  const rows = tally(key);
  const singles = rows.filter(([, who]) => who.length === 1);
  lonely += singles.length;
  console.log(`\n── ${key}: ${rows.length} giá trị khác nhau trên ${controls.length} control ──`);
  for (const [v, who] of rows.slice(0, 8)) {
    const uniq = [...new Set(who)];
    console.log(`  ${String(who.length).padStart(3)}×  ${v.padEnd(26)} ${uniq.slice(0, 5).join(", ")}${uniq.length > 5 ? ` (+${uniq.length - 5})` : ""}`);
  }
  if (singles.length) console.log(`      ↳ ${singles.length} giá trị chỉ dùng ĐÚNG MỘT lần: ${singles.map(([v, w]) => `${w[0]}=${v}`).slice(0, 6).join(" · ")}`);
}

console.log(`\n${controls.length} control · ${lonely} giá trị "chỉ dùng một lần" trên 7 thuộc tính`);
console.log("Càng nhiều giá trị dùng một lần thì càng là dựng lẻ, không theo hệ — đó là danh sách việc phải gộp.");
await browser.close();
process.exit(0);
