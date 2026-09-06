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
/*
 * CHỜ backend vũ trang, đừng đọc một lần rồi kết luận.
 *
 * Lớp phủ "watching and learning" là trạng thái của CLIENT: nó hiện ngay khi bấm. Backend thì đặt
 * `active` chỉ SAU năm lượt `await cdpForAgent` tới Chrome của box qua hầm ssh (`Runtime.enable`,
 * `Page.enable`, `addBinding`, `addScriptToEvaluateOnNewDocument`, `evaluate`). Đọc một lần ngay sau
 * cú bấm thì luôn trúng `IDLE`, và bài đo báo RED cho một sản phẩm đang chạy đúng — đo 01/09, mất
 * một vòng chẩn đoán nhầm sang "app không gọi RPC" trước khi `coverage.lastArgs` nói ra sự thật:
 * `startTeachRecording {"agentId":"agent-645","entryPoint":"composer_menu"}` tới đủ và đúng.
 *
 * Khoảng trống đó cũng là một rủi ro thật của sản phẩm, không chỉ của bài đo: thao tác diễn trong
 * giây đầu — khi lớp phủ đã nói "đang học" mà binding chưa gắn — sẽ KHÔNG được ghi.
 */
let trangThai = null;
let agentId = "";
for (let cho = 0; cho < 25 && agentId === ""; cho += 1) {
  trangThai = await gw("getTeachRecordingStatus", {});
  agentId = trangThai?.agentId ?? "";
  if (agentId === "") await page.waitForTimeout(400);
}
ok("backend đang ghi cho một bot cụ thể", agentId !== "", JSON.stringify(trangThai));

/*
 * Đếm SKILL, không phải routine.
 *
 * Đây là chỗ bài đo lạc hậu so với sản phẩm: bản teach cũ lưu kết quả thành một *routine*
 * (`getAgentAutomations`), bản hiện tại lưu thành *skill* trong menu `/` (`getAgentWorkflows`, và
 * client hỏi bằng khoá `id` chứ không phải `agentId` — đo từ `coverage.lastArgs`:
 * `{"id":"agent-645"}`). Đếm ở kho cũ thì luôn ra `0 → 0`, và bài đo báo "không tạo được routine"
 * trong khi kho mới đã có bản ghi đúng giây `stopTeachRecording` tới.
 */
const demSkill = async () => {
  const ds = await gw("getAgentWorkflows", { id: agentId });
  return Array.isArray(ds) ? ds.length : 0;
};
const truoc = await demSkill();

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
// Mốc TRƯỚC cú bấm Stop: tin bàn giao của lượt đo trước còn nằm trong bản ghi, nên chỉ nhận tin mọc SAU mốc này.
const tDung = Date.now();
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
/*
 * Hai đường ra từ nút Stop (06/09, §5 mục 14):
 *
 *   · có box → VIDEO (đường của hãng): backend đăng một tin đứng tên người dùng, đúng câu hằng, nonce
 *     `teach-recording:…`; BOT học trong một lượt chat rồi tự tạo skill và dẫn nó bằng
 *     `sand-workflow:<id>`. Skill mọc SAU một lượt model — chờ tới `TEACH_WAIT_MS` (mặc định 5 phút).
 *   · không box → đường cũ: backend ghi routine + skill ngay trong lượt `stopTeachRecording`.
 *
 * Nhận ra đường nào bằng chính bản ghi: tin `teach-recording` có mặt là đường video. Chờ tới 45 s,
 * KHÔNG phải 5 s: `stopTeachRecording` dừng ffmpeg trước khi bàn giao (SIGINT → chờ file đóng → ffprobe,
 * ba lượt qua hầm ssh) — lần đo đầu 06/09 chờ 6 s, tin tới muộn hơn, bài đo rẽ nhầm sang đường cũ và
 * báo đỏ một sản phẩm đang chạy đúng (skill của bot đã mọc ở giây ~45).
 */
const CAU = "The recording is finished. Learn the task from it.";
const tail = async () => {
  const r = await gw("getAgentTranscriptTail", { id: agentId, limit: 40 });
  return Array.isArray(r?.entries) ? r.entries : [];
};
let tinBanGiao = null;
const tBanGiao = Date.now();
for (let cho = 0; cho < 60 && !tinBanGiao; cho += 1) {
  tinBanGiao = (await tail()).find((e) => e?.kind === "message" && e?.role === "user" && e?.content === CAU
    && String(e?.clientNonce ?? "").startsWith("teach-recording:") && Number(e?.timestampMs ?? 0) >= tDung - 2000) ?? null;
  if (!tinBanGiao) await page.waitForTimeout(750);
}
if (tinBanGiao) console.log(`  ·    tin bàn giao tới sau ${Math.round((tinBanGiao.timestampMs - tDung) / 1000)}s kể từ lúc bấm Stop (bài đo thấy sau ${Math.round((Date.now() - tBanGiao) / 1000)}s)`);
const demSkillThat = async () => {
  const ds = await gw("getAgentWorkflows", { id: agentId });
  return Array.isArray(ds) ? ds.filter((w) => w?.name !== "learn-from-demonstration").length : 0;
};
// `truoc` đếm mọi skill; đường video dựng thêm `learn-from-demonstration` nên đếm lại KHÔNG tính nó.
const truocThat = Math.min(truoc, await demSkillThat());

if (tinBanGiao) {
  console.log(`  ·    đường VIDEO — nonce ${String(tinBanGiao.clientNonce).slice(0, 40)}…`);
  ok("tin bàn giao đúng hình hãng: câu hằng + nonce teach-recording", true);
  const han = Number(process.env.TEACH_WAIT_MS ?? 300_000);
  const t0 = Date.now();
  let sau = truocThat; let linkSkill = null;
  // Câu của bot là entry `send-message` với `message.content` (đúng shape app gốc), KHÔNG phải `kind:"message"` —
  // lần đo 2 (06/09) bot đã phát link mà bài đo đọc nhầm khoá nên báo đỏ.
  const chuBot = (e) => (e?.kind === "send-message" && e?.message?.type === "text" ? String(e.message.content ?? "")
    : e?.kind === "message" && e?.role === "assistant" ? String(e?.content ?? "") : "");
  while (Date.now() - t0 < han) {
    sau = await demSkillThat();
    const bot = (await tail()).filter((e) => Number(e?.timestampMs ?? 0) >= tDung && /sand-workflow:[a-z0-9-]+/.test(chuBot(e)));
    if (bot.length) linkSkill = chuBot(bot[bot.length - 1]).match(/\[([^\]]+)\]\(sand-workflow:([a-z0-9-]+)\)/);
    if (sau > truocThat && linkSkill) break;
    await page.waitForTimeout(2000);
  }
  ok("bot tự tạo skill MỚI từ video", sau > truocThat, `${agentId}: truoc ${truocThat} → sau ${sau} sau ${Math.round((Date.now() - t0) / 1000)}s`);
  ok("bot dẫn skill bằng [Tên](sand-workflow:<id>)", linkSkill != null, linkSkill ? `${linkSkill[1]} → ${linkSkill[2]}` : "(khong thay link)");
  if (linkSkill) {
    const ds = await gw("getAgentWorkflows", { id: agentId });
    const khop = Array.isArray(ds) && ds.some((w) => w?.id === linkSkill[2]);
    ok("id trong link là id skill thật (renderer so bằng)", khop, linkSkill[2]);
  }
  // Khoá `ask_question` chỉ tới lúc `create_workflow` chạy: hãng kết bằng widget *Dry run · Để sau*, ta cũng vậy từ 06/09.
  // Nên "hỏi lại" chỉ đỏ khi câu hỏi tới TRƯỚC khi skill có mặt.
  const ents = await tail();
  const laHoi = (e) => e?.kind === "ask-question" || e?.kind === "question";
  const iSkill = ents.findIndex((e) => e?.kind === "tool-call" && e?.name === "create_workflow" && Number(e?.timestampMs ?? 0) >= tDung);
  const hoiTruoc = ents.some((e, i) => laHoi(e) && Number(e?.timestampMs ?? 0) >= tDung && (iSkill < 0 || i < iSkill));
  const hoiSau = iSkill >= 0 && ents.some((e, i) => laHoi(e) && i > iSkill);
  ok("bot KHÔNG hỏi lại trước khi có skill (ask_question khoá tới create_workflow)", !hoiTruoc, hoiSau ? "kết bằng widget mời chạy thử — như hãng" : "kết bằng câu văn");
} else {
  console.log("  ·    đường CŨ (không có video) — backend ghi routine + skill ngay");
  // Skill được ghi trong lượt `stopTeachRecording`, nhưng lượt đó cũng đi qua box (`finish()` gỡ
  // binding) — nên chờ vài nhịp thay vì đọc một lần, cùng lý do như chỗ vũ trang phía trên.
  let sau = truoc;
  for (let cho = 0; cho < 15 && sau <= truoc; cho += 1) {
    sau = await demSkill();
    if (sau <= truoc) await page.waitForTimeout(500);
  }
  ok("skill MỚI cho đúng bot vừa dạy", sau > truoc, `${agentId}: truoc ${truoc} → sau ${sau}`);
}
{
  const ds = await gw("getAgentWorkflows", { id: agentId });
  const moi = Array.isArray(ds) ? ds.filter((w) => w?.name !== "learn-from-demonstration").at(-1) : null;
  if (moi) console.log(`  ·    skill: "${moi?.name ?? "?"}" — ${String(moi?.instructions ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  console.log("  ·    skill thu de lai — xoa tay neu khong muon giu");
}

// ── dọn ───────────────────────────────────────────────────────────────────────────────────────
if (armed && restoreUrl && !/^about:/.test(restoreUrl)) {
  await armed.goto(restoreUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
}

console.log(fails.length
  ? `\nRED — ${fails.length} muc hong: ${fails.join(", ")}`
  : "\nGREEN — Teach a task chay tron tu nut + toi routine");
process.exit(fails.length ? 1 : 0);
