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
const DRAG = process.argv.includes("--drag");
const MENU = process.argv.includes("--menu");
const GROUPS = process.argv.includes("--groups");

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

/**
 * Nghe chính event của trình duyệt để lấy thời lượng chuyển động.
 *
 * Tách ra khỏi phần bấm thử vì cả ba phép dò (bấm · kéo · mở menu) đều cần đúng cách nghe này, và
 * bản đầu chép nó ba lần thì ba chỗ sẽ lệch nhau ngay lần sửa đầu tiên.
 */
const LISTEN = () => {
  const w = window;
  w.__xray = [];
  const on = (ev) => w.__xray.push({
    kind: ev.type,
    prop: ev.propertyName ?? ev.animationName ?? "",
    ms: Math.round((ev.elapsedTime ?? 0) * 1000),
    block: (typeof ev.target?.className === "string" ? ev.target.className : "")
      .split(" ").find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c)) ?? "",
  });
  w.__xrayOff = () => {
    document.removeEventListener("transitionend", on, true);
    document.removeEventListener("animationend", on, true);
  };
  document.addEventListener("transitionend", on, true);
  document.addEventListener("animationend", on, true);
};

const COLLECT = () => { const e = window.__xray ?? []; window.__xrayOff?.(); return e; };

/** Gộp event theo (property, thời lượng): "width 200ms ×3" đọc được, 40 dòng rời thì không. */
const fold = (events) => {
  const by = new Map();
  for (const ev of events) {
    const k = `${ev.prop} ${ev.ms}ms`;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`);
};

/**
 * Khối nào bị một thanh chia thay đổi kích thước.
 *
 * Không đoán theo tên class: tìm khối có cạnh sát thanh chia và cao gần bằng nó. Tên class là thứ
 * đổi mỗi lần hãng build lại; hình học thì không.
 */
/** Tâm ngang của một khối theo tên class — dùng để trả thanh chia về đúng chỗ cũ. */
const CENTER_OF = (name) => {
  const el = document.querySelector("." + name);
  const r = el?.getBoundingClientRect();
  return r ? Math.round(r.left + r.width / 2) : -1;
};

/** Mọi khối nằm sát một thanh chia — ứng viên cho "khối bị nó thay đổi". */
const NEIGHBOURS = (hbox) => {
  const out = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cls = typeof el.className === "string" ? el.className : "";
    const name = cls.split(" ").find((c) => /^sand-[a-z][a-z-]*(__[a-z-]+)?$/.test(c));
    if (!name || out.has(name)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < hbox.h * 0.6 || r.width < 24) continue;
    const d = Math.min(Math.abs(r.right - hbox.x), Math.abs(r.left - (hbox.x + hbox.w)));
    if (d > 16) continue;
    out.set(name, { name, w: Math.round(r.width) });
  }
  return [...out.values()];
};

const WIDTHS = (names) => {
  const o = {};
  for (const n of names) {
    const el = document.querySelector("." + n);
    o[n] = el ? Math.round(el.getBoundingClientRect().width) : -1;
  }
  return o;
};

/** Menu/popover đang mở: hộp và danh sách mục. Chỉ ĐỌC, không bấm gì bên trong. */
const MENU_ITEMS = () => {
  const root = document.querySelector('[role="menu"], [role="listbox"], [role="dialog"], .sand-menu, .sand-popover');
  if (!root) return null;
  const r = root.getBoundingClientRect();
  const items = [...root.querySelectorAll('[role="menuitem"], [role="option"], button')]
    .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim())
    .filter(Boolean).slice(0, 20);
  return { box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`, items };
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
    await page.evaluate(LISTEN);
    await page.waitForTimeout(1500);
    const events = await page.evaluate(COLLECT);
    const after = await page.evaluate(SIGNATURE);
    const frames = [];
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k])
      .map((k) => ({ block: k, from: before[k] ?? "(không có)", to: after[k] ?? "(không có)" }));

    const motion = fold(events);
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

// ── kéo thanh chia ───────────────────────────────────────────────────────────
/*
 * Ba điều học được từ bản đầu, mỗi cái là một lỗi thật trên app đang chạy của chủ máy:
 *
 * 1. Đừng đoán thanh chia thay đổi khối nào. Bản đầu lấy khối rộng nhất nằm sát nó, và ra `sand-chat`
 *    cho cả hai thanh — chat là phần co giãn còn lại, không phải panel người dùng đang kéo. Giờ đo:
 *    kéo một nhịp, xem khối nào đổi bề rộng, rồi lấy khối NHỎ nhất trong số đó.
 * 2. Đừng trả về theo bề rộng. Bề rộng là hệ quả; vị trí thanh chia là nguyên nhân. Bản đầu bù theo
 *    bề rộng của khối sai nên để lại app lệch 312px. Giờ ghi tâm thanh chia trước khi kéo và kéo về
 *    đúng toạ độ đó, có kiểm lại.
 * 3. Kiểm phần trả về TRƯỚC khi báo kết quả, và nếu không trả được thì nói ngay ở dòng đầu.
 */
report.drags = [];
if (DRAG) {
  console.log("");
  console.log(`── kéo thanh chia (${report.draggables.length}) ──`);
  for (const d of report.draggables) {
    const [pos, size] = d.box.split(" ");
    const [hx] = pos.split(",").map(Number);
    const [hw, hh] = size.split("x").map(Number);
    const cy = Math.round(hh / 2);
    const x0 = await page.evaluate(CENTER_OF, d.block);
    if (x0 < 0) { console.log(`  bỏ qua ${d.block} — không tìm lại được`); continue; }

    const cands = await page.evaluate(NEIGHBOURS, { x: hx, w: hw, h: hh });
    const w0 = Object.fromEntries(cands.map((c) => [c.name, c.w]));

    const panelGuess = cands.slice().sort((a, b) => a.w - b.w)[0]?.name ?? null;
    await page.evaluate(LISTEN);
    await page.mouse.move(x0, cy);
    await page.mouse.down();
    /*
     * Dò tới ngưỡng rồi DỪNG, không kéo vượt.
     *
     * Bản trước kéo cứng ±820px. Panel Details có ngưỡng nhỏ nhất 280px, và kéo quá ngưỡng thì nó
     * KHÔNG kẹp lại mà đóng hẳn — thanh chia biến mất, nên phần trả về không còn gì để kéo và app
     * của chủ máy nằm lại ở trạng thái sai. Giờ đi từng bước 60px và dừng ngay khi bề rộng thôi
     * đổi: đó chính là ngưỡng, và không bao giờ phải vượt qua nó để biết nó ở đâu.
     */
    const step = 60, maxSteps = 8;
    const samples = [];
    let held = null;
    for (const dir of [-1, 1]) {
      let last = null, everChanged = false;
      for (let k = 1; k <= maxSteps; k++) {
        await page.mouse.move(x0 + dir * step * k, cy, { steps: 3 });
        const w = await page.evaluate(WIDTHS, cands.map((c) => c.name));
        samples.push({ dx: dir * step * k, w });
        held = w;
        const key = panelGuess ? w[panelGuess] : JSON.stringify(w);
        /*
         * Chỉ dừng khi ĐÃ đổi rồi mới thôi đổi. Sidebar có VÙNG CHẾT: kéo tới ~+240px mới nhảy từ
         * 63 lên 302 — nó ở chế độ rail và snap sang mở, không tăng dần. Luật "hai lần bằng nhau
         * thì dừng" của bản trước dừng ngay trong vùng chết rồi kết luận "thanh chia bị vô hiệu".
         */
        if (last !== null && key === last) { if (everChanged) break; } else if (last !== null) everChanged = true;
        last = key;
      }
      await page.mouse.move(x0, cy, { steps: 4 });  // về giữa trước khi dò hướng kia
    }
    // đo riêng: bề rộng lúc còn giữ chuột so với sau khi nhả — đó là câu "đi theo tay hay không"
    await page.mouse.up();
    await page.waitForTimeout(400);
    const events = await page.evaluate(COLLECT);
    const afterUp = await page.evaluate(WIDTHS, cands.map((c) => c.name));

    // khối nào thật sự đổi, và trong đó khối nhỏ nhất là panel đang bị kéo
    const moved = cands.filter((c) => new Set(samples.map((s) => s.w[c.name])).size > 1
      || afterUp[c.name] !== w0[c.name]);
    const panel = moved.slice().sort((a, b) => a.w - b.w)[0] ?? null;

    // trả về: kéo thanh chia về đúng toạ độ cũ, kiểm lại tối đa 5 lần
    // Panel có thể đã đóng hẳn thay vì kẹp lại — mở lại trước khi nói tới chuyện trả về.
    if ((await page.evaluate(CENTER_OF, d.block)) < 0) {
      for (const l of ["View Bot settings", "Open details", "Show details"]) {
        const opener = page.locator(`[aria-label="${l}"]`).first();
        if (await opener.count()) { await opener.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); break; }
      }
      console.log(`      (thanh chia đã biến mất — panel đóng hẳn; đã mở lại để trả về)`);
    }
    let back = await page.evaluate(CENTER_OF, d.block);
    /*
     * Nhắm có bù sai số, không nhắm thẳng vào đích.
     *
     * Panel Details đặt thanh chia lệch một hằng số so với con trỏ lúc nhả (đo được: 5px). Vòng
     * trước luôn nhắm đúng `x0` rồi luôn hạ xuống `x0 + 5`, thấy "không nhích được nữa" nên dừng —
     * và mỗi lượt chạy lại trôi thêm 5px. Giờ mỗi lần hạ sai bao nhiêu thì trừ vào lần nhắm sau.
     */
    let aim = x0;
    for (let i = 0; i < 8 && Math.abs(back - x0) > 2; i++) {
      await page.mouse.move(back, cy);
      await page.mouse.down();
      await page.mouse.move(aim, cy, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const now = await page.evaluate(CENTER_OF, d.block);
      const nextAim = aim - (now - x0);
      if (now === back && nextAim === aim) break;   // đã ở mắt snap gần nhất, bù cũng không đổi
      back = now; aim = nextAim;
    }
    const ok = Math.abs(back - x0) <= 2;

    const widths = panel ? samples.map((s) => s.w[panel.name]).filter((w) => w > 0) : [];
    const live = panel ? new Set(widths).size > 1 : false;
    const row = {
      handle: d.block,
      panel: panel?.name ?? null,
      alsoChanges: moved.filter((m) => m.name !== panel?.name).map((m) => m.name),
      w0: panel ? w0[panel.name] : null,
      range: widths.length ? [Math.min(...widths), Math.max(...widths)] : null,
      followsCursor: live,
      committedOnRelease: panel ? held[panel.name] !== afterUp[panel.name] : null,
      motion: fold(events),
      restoredTo: back, x0, ok,
    };
    report.drags.push(row);
    console.log(`  ${d.block}${ok ? "" : "   ! CHƯA TRẢ VỀ ĐƯỢC"}`);
    if (!panel) { console.log("      không khối nào đổi bề rộng — thanh chia này có thể đang bị vô hiệu"); continue; }
    console.log(`      kéo ${panel.name}: ${row.w0}px · giới hạn ${row.range[0]}–${row.range[1]}px`);
    console.log(`      ${live ? "đi theo tay ngay" : "chỉ đổi khi nhả chuột"}${row.committedOnRelease ? " · còn chỉnh lại lúc nhả" : ""} · kéo theo: ${row.alsoChanges.join(", ") || "(không)"}`);
    if (row.motion.length) console.log(`      chuyển động: ${row.motion.slice(0, 4).join(" · ")}`);
    console.log(`      thanh chia về x=${back} (cũ ${x0}) ${ok ? "" : `— LỆCH ${back - x0}px, cần kéo tay lại`}`);
  }
}

// ── mở menu trên tin nhắn ────────────────────────────────────────────────────
/*
 * Chỉ mở và ĐỌC. Không bấm mục nào bên trong: menu này chứa cả những hành động không hoàn tác được,
 * và câu hỏi cần trả lời chỉ là "có những mục gì, hộp nằm đâu, mở ra bằng chuyển động nào".
 */
report.menus = [];
if (MENU) {
  console.log("");
  console.log("── menu trên tin nhắn ──");
  for (const label of ["More message actions", "Add reaction"]) {
    const btn = page.locator(`[aria-label="${label}"]`).last();
    if (!(await btn.count())) { console.log(`  không thấy "${label}"`); continue; }
    const before = await page.evaluate(SIGNATURE);
    await page.evaluate(LISTEN);
    /*
     * Phải HOVER thật trước khi bấm. Nút hover-actions có mặt trong DOM ngay từ đầu — kiểm kê thấy
     * nó — nhưng chỉ nhận chuột khi con trỏ đang ở trong tin nhắn, nên `click()` thẳng thì hết giờ.
     */
    const bb = await btn.boundingBox();
    if (!bb) { console.log(`  không lấy được hộp của "${label}"`); continue; }
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(250);
    try { await btn.click({ timeout: 3000, force: true }); } catch { console.log(`  không bấm được "${label}"`); continue; }
    await page.waitForTimeout(700);
    const events = await page.evaluate(COLLECT);
    const menu = await page.evaluate(MENU_ITEMS);
    const row = { opener: label, box: menu?.box ?? null, items: menu?.items ?? [], motion: fold(events) };
    report.menus.push(row);
    console.log(`  "${label}" → ${menu ? `${menu.box}, ${menu.items.length} mục` : "KHÔNG thấy menu/popover nào mở ra"}`);
    if (menu?.items.length) console.log(`      ${menu.items.join(" · ")}`);
    if (row.motion.length) console.log(`      chuyển động: ${row.motion.slice(0, 4).join(" · ")}`);

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    const after = await page.evaluate(SIGNATURE);
    const left = Object.keys(after).filter((k) => after[k] !== before[k]);
    row.closed = left.length === 0;
    if (left.length) console.log(`      ! Escape chưa đóng hết: ${left.slice(0, 4).join(", ")}`);
  }
}

// ── gập nhóm trong sidebar ───────────────────────────────────────────────────
/*
 * Đầu nhóm chỉ tồn tại khi sidebar đang MỞ. Chủ máy để nó ở chế độ rail, nên phép dò phải tự mở,
 * đo, rồi trả về rail — cùng cách nhắm-có-bù-sai-số như phần kéo thanh chia, vì đây cũng là app thật.
 */
report.groups = null;
if (GROUPS) {
  console.log("");
  console.log("── gập nhóm trong sidebar ──");
  const handle = "sand-sidebar-resize-handle";
  const x0 = await page.evaluate(CENTER_OF, handle);
  const railed = (await page.evaluate(WIDTHS, ["sand-agents-list__rows"]))["sand-agents-list__rows"] < 120;
  if (railed) {
    // vượt vùng chết ~200px thì nó snap sang mở
    await page.mouse.move(x0, 520);
    await page.mouse.down();
    await page.mouse.move(x0 + 300, 520, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    console.log(`  (sidebar đang ở rail — đã mở tạm để đo, sẽ trả về)`);
  }

  /*
   * Kiểm kê luôn trong lúc sidebar đang mở. Bản kiểm kê ở đầu script chạy với sidebar ở RAIL, nên
   * nó không có đầu/đáy sidebar ở dạng mở — mà đó chính là thứ X1 phải dựng. Đo lúc đang mở thì
   * khỏi phải mở lần thứ hai.
   */
  report.expandedControls = (await page.evaluate(CONTROLS))
    .filter((c) => c.box.split(",")[0] < "400" && /sidebar|agents|account|search|new/i.test(`${c.block} ${c.label}`));
  console.log(`  kiểm kê lúc MỞ: ${report.expandedControls.length} control ở dải sidebar`);
  for (const c of report.expandedControls.slice(0, 14)) {
    console.log(`      ${c.box.padEnd(20)} ${c.tag.padEnd(6)} ${c.block.padEnd(32)} "${c.label}"`);
  }

  const heads = await page.evaluate(() => [...document.querySelectorAll("*")].flatMap((el) => {
    const cls = typeof el.className === "string" ? el.className : "";
    const name = cls.split(" ").find((c) => /^sand-agents-(section|group)[a-z_-]*$/.test(c));
    if (!name) return [];
    const r = el.getBoundingClientRect();
    if (r.width < 20) return [];
    return [{
      block: name, tag: el.tagName.toLowerCase(),
      label: el.getAttribute("aria-label") || el.textContent?.trim()?.slice(0, 30) || "",
      box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      expanded: el.getAttribute("aria-expanded"),
    }];
  }));
  console.log(`  tìm thấy ${heads.length} phần tử nhóm:`);
  for (const h of heads.slice(0, 8)) console.log(`      ${h.box.padEnd(20)} ${h.tag.padEnd(6)} ${h.block.padEnd(30)} aria-expanded=${h.expanded} "${h.label}"`);

  const clickable = heads.find((h) => h.expanded !== null) ?? heads.find((h) => h.tag === "button");
  const rows = [];
  if (!clickable) console.log("  không có phần tử nhóm nào bấm được — có thể bản này không cho gập");
  else {
    const before = await page.evaluate(SIGNATURE);
    await page.evaluate(LISTEN);
    const loc = page.locator(`.${clickable.block}`).first();
    await loc.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    const events = await page.evaluate(COLLECT);
    const after = await page.evaluate(SIGNATURE);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k]).map((k) => ({ block: k, from: before[k] ?? "(không có)", to: after[k] ?? "(không có)" }));
    rows.push({ opener: clickable.block, changed, motion: fold(events) });
    console.log(`  bấm "${clickable.label || clickable.block}" → ${changed.length} khối đổi`);
    for (const c of changed.slice(0, 5)) console.log(`      ${c.block.padEnd(30)} ${c.from}  →  ${c.to}`);
    if (rows[0].motion.length) console.log(`      chuyển động: ${rows[0].motion.slice(0, 5).join(" · ")}`);
    await loc.click({ timeout: 3000 }).catch(() => {});   // gập lại như cũ
    await page.waitForTimeout(600);
  }

  let back = await page.evaluate(CENTER_OF, handle);
  if (railed) {
    let aim = x0;
    for (let i = 0; i < 8 && Math.abs(back - x0) > 2; i++) {
      await page.mouse.move(back, 520);
      await page.mouse.down();
      await page.mouse.move(aim, 520, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const now = await page.evaluate(CENTER_OF, handle);
      const nextAim = aim - (now - x0);
      if (now === back && nextAim === aim) break;
      back = now; aim = nextAim;
    }
  }
  const ok = Math.abs(back - x0) <= 2;
  report.groups = { heads, probes: rows, restoredTo: back, x0, ok };
  console.log(`  sidebar về x=${back} (cũ ${x0}) ${ok ? "" : "— LỆCH, cần kéo tay lại"}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n→ ${OUT}`);
// KHÔNG đóng browser: đó là app đang chạy của chủ máy.
process.exit(0);
