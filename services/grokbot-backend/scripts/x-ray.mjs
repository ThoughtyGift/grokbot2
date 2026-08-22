/**
 * X-quang app gốc — bóc tách tương tác và animation bằng cách ĐO, không đọc bundle.
 *
 *   node scripts/x-ray.mjs                 # chỉ đọc: kiểm kê control, dò chỗ kéo được, đo hover
 *   node scripts/x-ray.mjs --probe-clicks  # thêm: bấm các control trong danh sách AN TOÀN, so trước/sau
 *
 * ── Vì sao script này tồn tại ─────────────────────────────────────────────────
 *
 * Câu hỏi cần trả lời trước khi clone FE: *bấm cái gì thì hiện cái gì, và nó chuyển động ra sao*.
 * Đọc bundle minify để suy ra thì đúng là làm tù mù. Ở đây làm ngược lại: liệt kê control thật,
 * bấm rồi ĐO layout trước/sau, và lấy mẫu hình học ~60 lần/giây trong lúc chuyển để rút ra thời
 * lượng thật.
 *
 * ── Luật an toàn ──────────────────────────────────────────────────────────────
 *
 * Đây là app THẬT của chủ máy, có hội thoại thật. Nên:
 *   · mặc định KHÔNG bấm gì (`--probe-clicks` mới bấm),
 *   · chỉ bấm control khớp `SAFE` — mở/đóng panel, gập sidebar, mở settings,
 *   · từ chối mọi nhãn khớp `NEVER` (gửi, xoá, đăng xuất, chạy…) kể cả khi nó cũng khớp `SAFE`,
 *   · sau mỗi lần bấm thì bấm lại/Escape để trả về trạng thái cũ, và báo nếu không trả về được.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(resolve(HERE, "..", "..", ".."), "docs", "extracted", "ui-xray.json");
const CDP = process.env.GROKBOT2_CDP ?? "http://127.0.0.1:9222";
const PROBE = process.argv.includes("--probe-clicks");

/** Chỉ những control này được bấm. Cố ý hẹp. */
const SAFE = /^(close details|open details|show details|hide details|collapse|expand|bot settings|settings|back|view bot settings|open computer|plugins|grok local)/i;
/** Không bao giờ bấm, dù khớp SAFE. */
const NEVER = /(send|gửi|delete|xoá|xóa|remove|sign out|log ?out|run|start|stop|new|create|tạo|attach|voice|record|clear|reset|archive|leave)/i;

const browser = await chromium.connectOverCDP(CDP);
let page = null, best = -1;
for (const p of browser.contexts()[0].pages()) {
  const n = await p.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
  if (n > best) { best = n; page = p; }
}
if (!page) { console.error("không tìm được renderer trên CDP — app có đang chạy không?"); process.exit(2); }

/** Chữ ký layout: hộp của mọi khối lớn có tên class ổn định. So hai chữ ký ra được "cái gì đã đổi". */
const SIGNATURE = () => {
  const out = {};
  for (const el of document.querySelectorAll("*")) {
    const cls = typeof el.className === "string" ? el.className : "";
    const name = cls.split(/\s+/).find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c));
    if (!name) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    // Khối đầu tiên mang mỗi tên là đủ: đây là chữ ký bố cục, không phải bản kiểm kê phần tử.
    if (!out[name]) out[name] = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  }
  return out;
};

/** Kiểm kê control: nhãn, vai trò, hộp, con trỏ chuột. */
const CONTROLS = () => {
  const out = [];
  for (const el of document.querySelectorAll('button,[role="button"],a,[role="tab"],[role="menuitem"],input,[contenteditable]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
    if (!label) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    out.push({
      label,
      tag: el.tagName.toLowerCase(),
      block: cls.split(/\s+/).find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c)) ?? "",
      box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      cursor: getComputedStyle(el).cursor,
    });
  }
  return out;
};

/**
 * Chỗ kéo được: tìm phần tử có con trỏ kéo, hoặc thuộc tính kéo/thanh chia.
 * Đây là câu trả lời cho "panel trái kéo thả đổi rộng được không" — không phải phỏng đoán.
 */
const DRAGGABLES = () => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const dragCursor = /(col|row|ew|ns|nwse|nesw)-resize|grab|move/.test(s.cursor);
    const role = el.getAttribute("role");
    const sep = role === "separator" || el.getAttribute("aria-orientation");
    const drag = el.getAttribute("draggable") === "true";
    if (!dragCursor && !sep && !drag) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    out.push({
      why: [dragCursor && `cursor:${s.cursor}`, sep && `role=${role ?? "?"}`, drag && "draggable"].filter(Boolean).join(" · "),
      block: cls.split(/\s+/).find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c)) ?? el.tagName.toLowerCase(),
      box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      label: el.getAttribute("aria-label") ?? "",
    });
  }
  return out;
};

/** Mọi transition/animation khai báo trên màn hình — thời lượng và đường cong thật. */
const MOTION = () => {
  const dur = new Map();
  const ease = new Map();
  const props = new Map();
  const anim = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  // Tách theo dấu phẩy NGOÀI ngoặc: `cubic-bezier(0.22, 1, 0.36, 1)` không được cắt làm bốn.
  const split = (v) => {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of v) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    if (s.transitionDuration && s.transitionDuration !== "0s") {
      split(s.transitionDuration).forEach((d) => bump(dur, d));
      split(s.transitionTimingFunction).forEach((e) => bump(ease, e));
      split(s.transitionProperty).forEach((p) => bump(props, p));
    }
    if (s.animationName && s.animationName !== "none") {
      split(s.animationName).forEach((n) => bump(anim, n));
      split(s.animationDuration).forEach((d) => bump(dur, d));
      split(s.animationTimingFunction).forEach((e) => bump(ease, e));
    }
  }
  const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ v: k, n: c }));
  return { duration: top(dur), easing: top(ease), property: top(props), keyframes: top(anim) };
};

const report = { at: new Date().toISOString(), viewport: await page.evaluate(() => `${innerWidth}x${innerHeight}`) };

report.controls = await page.evaluate(CONTROLS);
report.draggables = await page.evaluate(DRAGGABLES);
report.motion = await page.evaluate(MOTION);

console.log(`viewport ${report.viewport}`);
console.log(`\n── control (${report.controls.length}) ──`);
for (const c of report.controls) console.log(`  ${c.box.padEnd(22)} ${c.tag.padEnd(7)} ${c.block.padEnd(30)} "${c.label}"`);
console.log(`\n── chỗ kéo được / thanh chia (${report.draggables.length}) ──`);
if (!report.draggables.length) console.log("  KHÔNG có phần tử nào mang con trỏ kéo, role=separator hay draggable");
for (const d of report.draggables.slice(0, 12)) console.log(`  ${d.box.padEnd(22)} ${d.block.padEnd(30)} ${d.why} ${d.label && `"${d.label}"`}`);
console.log(`\n── motion ──`);
console.log(`  thời lượng: ${report.motion.duration.map((x) => `${x.v}(${x.n})`).join(" ")}`);
console.log(`  đường cong: ${report.motion.easing.map((x) => `${x.v}(${x.n})`).join(" ")}`);
console.log(`  property  : ${report.motion.property.map((x) => `${x.v}(${x.n})`).join(" ")}`);
console.log(`  keyframes : ${report.motion.keyframes.map((x) => `${x.v}(${x.n})`).join(" ") || "(không có)"}`);

// ── bấm thử, chỉ khi được yêu cầu ────────────────────────────────────────────
report.transitions = [];
if (PROBE) {
  const candidates = report.controls.filter((c) => SAFE.test(c.label) && !NEVER.test(c.label));
  console.log(`\n── bấm thử ${candidates.length}/${report.controls.length} control (danh sách an toàn) ──`);
  for (const c of candidates) {
    const before = await page.evaluate(SIGNATURE);
    const target = page.locator(`[aria-label="${c.label}"]`).first();
    if (!(await target.count())) { console.log(`  bỏ qua "${c.label}" — không tìm lại được`); continue; }
    try { await target.click({ timeout: 3000 }); } catch (e) { console.log(`  bỏ qua "${c.label}" — không bấm được`); continue; }

    /*
     * Thời lượng lấy từ CHÍNH event của trình duyệt (`transitionend` / `animationend`), không lấy
     * bằng cách chụp chữ ký từng khung.
     *
     * Bản đầu lấy mẫu 24 khung × 28ms — nhưng mỗi khung phải `evaluate` cả chữ ký layout qua CDP,
     * nên chi phí đo lấn vào kết quả và ra "0–1008ms" cho một chuyển động không chắc dài vậy. Số
     * đo bị chính phép đo làm sai thì tệ hơn không đo: nó vẫn ra một con số trông như thật.
     */
    await page.evaluate(() => {
      const w = window;
      w.__xray = [];
      const on = (ev) => w.__xray.push({
        kind: ev.type,
        prop: ev.propertyName ?? ev.animationName ?? "",
        ms: Math.round((ev.elapsedTime ?? 0) * 1000),
        block: (typeof ev.target?.className === "string" ? ev.target.className : "")
          .split(/\s+/).find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c)) ?? "",
      });
      w.__xrayOff = () => {
        document.removeEventListener("transitionend", on, true);
        document.removeEventListener("animationend", on, true);
      };
      document.addEventListener("transitionend", on, true);
      document.addEventListener("animationend", on, true);
    });
    await page.waitForTimeout(1500);
    const events = await page.evaluate(() => { const e = window.__xray ?? []; window.__xrayOff?.(); return e; });
    const after = await page.evaluate(SIGNATURE);
    const frames = [];
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k])
      .map((k) => ({ block: k, from: before[k] ?? "(không có)", to: after[k] ?? "(không có)" }));

    // Gộp theo (property, thời lượng): "width 200ms ×3" đọc được, còn 40 dòng rời thì không.
    const byKey = new Map();
    for (const ev of events) {
      const k = `${ev.prop} ${ev.ms}ms`;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    const motion = [...byKey.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`);
    report.transitions.push({ control: c.label, changed, motion, events: events.length });
    console.log(`  "${c.label}" → ${changed.length} khối đổi, ${events.length} event chuyển động`);
    if (motion.length) console.log(`      ${motion.slice(0, 6).join(" · ")}`);
    for (const ch of changed.slice(0, 4)) console.log(`      ${ch.block.padEnd(30)} ${ch.from}  →  ${ch.to}`);

    // Trả về trạng thái cũ: bấm lại, nếu không được thì Escape.
    try { await target.click({ timeout: 2000 }); } catch { await page.keyboard.press("Escape").catch(() => {}); }
    await page.waitForTimeout(600);
    const restored = await page.evaluate(SIGNATURE);
    const stillOff = changed.filter((ch) => restored[ch.block] !== before[ch.block]);
    if (stillOff.length) console.log(`      ! chưa về trạng thái cũ: ${stillOff.map((x) => x.block).join(", ")}`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n→ ${OUT}`);
// KHÔNG đóng browser: đó là app đang chạy của chủ máy.
process.exit(0);
