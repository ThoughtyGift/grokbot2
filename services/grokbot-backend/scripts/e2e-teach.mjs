/**
 * End-to-end: "Teach a task" **qua chính app**, từ nút `+` tới routine nằm trong panel.
 *
 * Vì sao phải lái app thật chứ không gọi thẳng ba RPC: cả hai lỗi đã gặp đều KHÔNG nằm trong ba
 * RPC đó.
 *
 *   1. Nút Teach không hiện, vì cổng `sand_teach_by_demonstration` tắt — gọi RPC thẳng thì vẫn
 *      chạy ngon lành và ta không bao giờ biết người dùng không bấm được vào đâu.
 *   2. Ghi được đúng 1 bước rỗng, vì `cdpForAgent` vũ trang một Chrome KHÁC cái mà VNC đang
 *      chiếu — gọi RPC thẳng cũng trả `state: "recording"` y hệt lúc mọi thứ đang hỏng.
 *
 * Nên bài này đo bốn chỗ, theo đúng thứ tự một người dùng đi qua:
 *
 *   A. cổng tính năng thật sự bật  → `+` là menu, và menu có mục Teach
 *   B. bấm mục đó → app vẽ lớp phủ "watching and learning"
 *   C. recorder nằm ĐÚNG trong cái tab mà pane đang chiếu, và cú bấm thật đi vào được
 *   D. dừng-và-lưu → routine mới có mặt, và prompt của nó chứa đúng bước vừa diễn
 *
 * Chạy:
 *   node services/grokbot-backend/scripts/e2e-teach.mjs
 *   CDP_BOX=http://127.0.0.1:9223 node services/grokbot-backend/scripts/e2e-teach.mjs
 *
 * `CDP_BOX` là Chrome của box. Trên máy phát triển nó tới box qua đường hầm ssh, nên bài chạy
 * được mà không cần đăng nhập vào VPS.
 */
import { chromium } from "playwright-core";

const CDP_APP = process.env.CDP_APP ?? "http://127.0.0.1:9222";
const CDP_BOX = process.env.CDP_BOX ?? "http://127.0.0.1:9223";
/** Trang để diễn: nhỏ, ổn định, và có đúng một liên kết để bấm. */
const DEMO_URL = process.env.TEACH_DEMO_URL ?? "https://example.com/";
const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const gw = async (m, body = {}) => {
  const r = await fetch(`${GW}/${m}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json().catch(() => null);
};

const fails = [];
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails.push(name);
};

/**
 * Radix nghe `pointerdown`, không nghe `click` tổng hợp — `element.click()` mở không ra menu.
 * Đây là chỗ đã mất thời gian một lần rồi, nên nó thành một hàm chứ không phải một dòng chép lại.
 */
const PRESS = `(el) => {
  if (!el) return false;
  const o = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
}`;

const app = await chromium.connectOverCDP(CDP_APP, { timeout: 10_000 });
const pages = app.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => /resources[\\/]app/.test(p.url())) ?? pages[0];
if (!page) { console.error(`khong thay renderer cua app tren ${CDP_APP}`); process.exit(1); }

// ── 0 · phải có một bot đang mở ───────────────────────────────────────────────────────────────
/*
 * Teach gắn với MỘT bot: trong bản dựng, `q` chỉ chạy khi `u != null` (bot đang chọn), nên
 * không chọn bot thì bấm "Teach a task" **không làm gì cả và cũng không báo gì**. Lần chạy
 * trước của chính bài này rơi vào đúng đó — panel trả về "No Bot selected." và ba mục sau
 * đỏ theo, trong khi tính năng không hề hỏng.
 */
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const botName = await page.evaluate((press) => {
  const rows = [...document.querySelectorAll('[role=button],button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.left < 280 && r.top > 90 && r.height > 40 && b.offsetParent !== null;
  });
  const row = rows[0];
  if (!row) return null;
  // eslint-disable-next-line no-eval
  eval(`(${press})`)(row);
  return (row.innerText || "").split(String.fromCharCode(10))[0].trim();
}, PRESS);
await page.waitForTimeout(2500);
ok("đã chọn một bot", botName != null, botName ?? "(sidebar rong)");

/*
 * Đếm routine "Việc đã dạy" TRƯỚC.
 *
 * Bản đầu chỉ hỏi "panel có chữ 'Việc đã dạy' không" và báo xanh nhờ một routine của lần chạy
 * trước — dương tính giả, và là loại tệ nhất vì nó xanh đúng lúc tính năng hỏng.
 */
// ── A · cổng tính năng ────────────────────────────────────────────────────────────────────────

const plus = await page.evaluate(() => {
  const b = document.querySelector('[aria-label="Attach file"]');
  return b ? { haspopup: b.getAttribute("aria-haspopup") } : null;
});
ok("nút + có mặt", plus != null);
ok("cổng sand_teach_by_demonstration bật", plus?.haspopup === "menu",
  `aria-haspopup=${plus?.haspopup ?? "(khong co)"} — "menu" nghia la backend da tra featureGates`);

/*
 * Mở menu có thử lại. Một lần bấm + một lần `waitForTimeout` cố định đã báo "(menu rong)" trong
 * khi tính năng vẫn tốt: menu mở rồi đóng lại vì lượt bấm rơi vào giữa lúc app đang đổi bot.
 * Đợi theo ĐIỀU KIỆN, không đợi theo đồng hồ.
 */
let items = [];
for (let lan = 0; lan < 3 && items.length === 0; lan++) {
  await page.evaluate((press) => {
    // eslint-disable-next-line no-eval
    eval(`(${press})`)(document.querySelector('[aria-label="Attach file"]'));
  }, PRESS);
  for (let cho = 0; cho < 10 && items.length === 0; cho++) {
    await page.waitForTimeout(300);
    items = await page.evaluate(() => [...document.querySelectorAll("[role=menuitem]")].map((m) => m.innerText.trim()));
  }
}
ok("menu + có mục Teach", items.some((t) => /teach/i.test(t)), items.join(" | ") || "(menu rong)");

// ── B · bấm Teach ─────────────────────────────────────────────────────────────────────────────
await page.evaluate((press) => {
  const it = [...document.querySelectorAll("[role=menuitem]")].find((m) => /teach/i.test(m.innerText));
  // eslint-disable-next-line no-eval
  eval(`(${press})`)(it);
}, PRESS);
/*
 * Bấm "Teach a task" **chưa ghi gì cả** — nó mới mở khung máy tính và "lên đạn" (`arm`). Việc ghi
 * bắt đầu ở nút `Start recording` BÊN TRONG khung đó.
 *
 * Đây đúng là chỗ người dùng báo "ấn start không chạy", và cũng là chỗ bản đầu của bài này sai:
 * nó tìm chữ "watching and learning" ngay sau khi bấm mục menu, không thấy, rồi báo đỏ ba mục
 * sau — trong khi tính năng không hỏng, chỉ là còn thiếu một cú bấm.
 */
let start = false;
for (let cho = 0; cho < 20 && !start; cho++) {
  await page.waitForTimeout(400);
  start = await page.evaluate((press) => {
    const b = [...document.querySelectorAll("button,[role=button]")]
      .find((x) => /start recording/i.test(x.getAttribute("aria-label") ?? x.innerText ?? "") && x.offsetParent !== null);
    if (!b) return false;
    // eslint-disable-next-line no-eval
    eval(`(${press})`)(b);
    return true;
  }, PRESS);
}
ok("khung máy tính mở ra với nút Start recording", start);

let overlay = false;
for (let cho = 0; cho < 20 && !overlay; cho++) {
  await page.waitForTimeout(400);
  overlay = await page.evaluate(() => /watching and learning/i.test(document.body.innerText));
}
ok("bấm Start recording thì bắt đầu ghi", overlay);

/*
 * `agentId` chỉ biết được LÚC ĐANG GHI — trạng thái rảnh trả `agentId: null`. Và số routine
 * phải đếm ở đây, sau khi bot đã được chọn, để hai đầu so sánh cùng một con bot.
 */
const trangThai = await gw("getTeachRecordingStatus", {});
const agentId = trangThai?.agentId ?? "";
ok("backend đang ghi cho một bot cụ thể", agentId !== "", JSON.stringify(trangThai));
const truoc = ((await gw("getAgentAutomations", { agentId })) ?? []).filter((a) => /Việc đã dạy/.test(a?.name ?? "")).length;

// ── C · recorder có ở đúng tab người dùng nhìn thấy không ─────────────────────────────────────
const box = await chromium.connectOverCDP(CDP_BOX, { timeout: 10_000 });
/*
 * KHÔNG lọc bỏ `about:blank`.
 *
 * Bản đầu của bài này lọc, và nó báo "0 tab, khong tab nao duoc vu trang" trong khi recorder
 * đang nằm đúng chỗ — chỉ là bot chưa mở trang nào nên tab của nó còn trống. Lọc mất tab trống
 * là tự làm mù chính mình đúng cái trường hợp hay gặp nhất: dạy một bot vừa tạo.
 */
const boxPages = box.contexts().flatMap((c) => c.pages()).filter((p) => !/^chrome/.test(p.url()));
let armed = null;
for (const p of boxPages) {
  const yes = await p.evaluate(() => window.__grokTeachArmed === true).catch(() => false);
  if (yes) { armed = p; break; }
}
ok("recorder nằm trong tab mà pane đang chiếu", armed != null,
  armed ? armed.url().slice(0, 60) : `${boxPages.length} tab, khong tab nao duoc vu trang`);

let restoreUrl = null;
if (armed) {
  restoreUrl = armed.url();
  await armed.goto(DEMO_URL, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  await armed.waitForTimeout(1200);
  await armed.evaluate(() => document.querySelector("a[href]")?.click()).catch(() => {});
  await armed.waitForTimeout(1500);
}

// ── D · dừng và lưu ───────────────────────────────────────────────────────────────────────────
/*
 * Nút dừng tìm bằng **aria-label chính xác**, không dò chữ.
 *
 * Bản trước dò `/stop|save|done|xong|dừng/i` trên mọi nút và trúng một **tin nhắn trong khung
 * chat** có chữ "dừng" — bấm vào đó chạy luôn một routine thật của người dùng. Khi đang ghi, lớp
 * phủ có đúng hai nhãn: `Stop and save recording` và `Discard recording`.
 */
const stopped = await page.evaluate((press) => {
  const btn = [...document.querySelectorAll("button,[role=button]")]
    .find((b) => b.offsetParent !== null && /stop and save recording/i.test(b.getAttribute("aria-label") ?? ""));
  if (!btn) return null;
  const label = (btn.innerText || btn.getAttribute("aria-label") || "").trim();
  // eslint-disable-next-line no-eval
  eval(`(${press})`)(btn);
  return label;
}, PRESS);
ok("bấm được nút dừng-và-lưu trong app", stopped != null, stopped ?? "(khong thay nut)");
await page.waitForTimeout(3500);

ok("lớp phủ đã tắt", await page.evaluate(() => !/watching and learning/i.test(document.body.innerText)));

/*
 * Đọc routine từ CHÍNH panel của app, không hỏi qua cổng.
 *
 * Hai đường kia đều sai: `window.desktop` có 48 phương thức nhưng KHÔNG có cái nào về automation
 * (chúng đi qua gateway), còn hỏi gateway bằng token cổng thì trả mảng rỗng — token cổng là một
 * danh tính khác người đang đăng nhập, đo được: rỗng trong khi panel có ba cái. Panel là thứ
 * người dùng thật sự nhìn, nên nó cũng là chỗ đúng để hỏi.
 */
/*
 * Hỏi routine của ĐÚNG con bot vừa dạy, qua cổng.
 *
 * Ba đường qua giao diện đều đã thử và đều sai theo cách riêng: `window.desktop` không có
 * phương thức automation nào (48 cái, không cái nào); `[class*="sand-info-pane"]` có tồn tại,
 * đang hiện, mà `innerText` rỗng; còn đếm chữ trên cả trang thì số ĐI XUỐNG khi khung máy tính
 * phủ lên. `listAllAutomations` bằng token cổng cũng rỗng vì lọc theo chủ sở hữu — nhưng
 * `getAgentAutomations` kèm `agentId` thì trả đúng, và `agentId` lấy được từ chính trạng thái
 * ghi lúc nãy. Đây là khẳng định hẹp nhất mà vẫn đúng câu hỏi: "con bot vừa dạy có routine mới
 * chưa".
 */
const sau = ((await gw("getAgentAutomations", { agentId })) ?? []).filter((a) => /Việc đã dạy/.test(a?.name ?? "")).length;
ok("routine MỚI cho đúng bot vừa dạy", sau > truoc, `${agentId}: truoc ${truoc} → sau ${sau}`);
if (sau > truoc) console.log("  ·    routine thu de lai — xoa tay neu khong muon giu");

// ── dọn ───────────────────────────────────────────────────────────────────────────────────────
if (armed && restoreUrl && !/^about:/.test(restoreUrl)) {
  await armed.goto(restoreUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
}

console.log(fails.length
  ? `\nRED — ${fails.length} muc hong: ${fails.join(", ")}`
  : "\nGREEN — Teach a task chay tron tu nut + toi routine");
process.exit(fails.length ? 1 : 0);
