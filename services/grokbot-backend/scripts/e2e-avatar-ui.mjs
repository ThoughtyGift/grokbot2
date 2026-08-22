/**
 * Gate B for the avatar picker — the modal driven in a real browser, not the routes asserted again.
 *
 * `e2e-avatar.mjs` already proves the three `/v1` routes and the two directions of the shared
 * store. What it cannot prove is the part a person actually touches: that clicking the avatar opens
 * the picker, that a colour turns into a stored image, and that the row then shows the picture
 * instead of initials. The last one is the branch most likely to rot silently, because `<img>`
 * cannot send a bearer token — the FE fetches the bytes and holds an object URL, and if that path
 * breaks the UI falls back to initials and *looks* fine.
 *
 *   node scripts/e2e-avatar-ui.mjs [--url http://localhost:5173]
 *
 * Works on a throwaway bot it creates and deletes, so it never touches a bot of yours.
 */
import { chromium } from "playwright-core";
import { gwHeaders } from "./gw-auth.mjs";
import { recordRun } from "./run-history.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const URL_FE = arg("--url", "http://localhost:5173");
const BASE = arg("--base", "http://localhost:8788");

let pass = 0, fail = 0;
/** Giữ lại từng bước, không chỉ đếm — `recordRun` cần tên bước để một lượt đỏ còn dấu vết. */
const results = [];
const check = (name, ok, note) => {
  results.push({ name, pass: Boolean(ok), detail: note });
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${note ? `  — ${note}` : ""}`); }
};

const gw = (m, b) =>
  fetch(`${BASE}/gw/api/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b ?? {}) })
    .then((r) => r.json()).catch(() => null);

const created = await gw("createAgent", { name: "Picker Probe" });
const agentId = created?.agent?.id;
if (!agentId) { console.error("không tạo được bot thử — backend có đang chạy không?"); process.exit(1); }

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // Không chờ "networkidle": FE giữ một stream SSE mở suốt, nên trạng thái đó không bao giờ tới.
  await page.goto(URL_FE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".roster .bot", { timeout: 15_000 });

  // Chọn đúng con bot thử, không phải con đang được chọn sẵn.
  const row = page.locator(".roster .bot", { hasText: "Picker Probe" }).first();
  check("bot thử hiện trong roster", await row.count() > 0);
  await row.click();
  await page.waitForFunction(
    (n) => document.querySelector(".chat-head h1")?.textContent?.trim() === n,
    "Picker Probe",
    { timeout: 10_000 },
  );

  // Mặc định không còn là chữ cái đầu tên mà là mặt bot dựng bằng SVG (lõi bloub, MIT).
  check("chưa có ảnh ⇒ mặt bot suy từ id",
    await page.locator(".chat-head .avatar-btn span.avatar.face svg path").count() >= 3);

  // ── mở bộ chọn ─────────────────────────────────────────────────────────────
  await page.locator(".chat-head .avatar-btn").click();
  const modal = page.locator(".modal-back .modal");
  check("bấm avatar mở bộ chọn", await modal.isVisible());
  check("bộ chọn có 12 màu", await page.locator(".modal .swatch").count() === 12);
  check("bộ chọn có 8 hình", await page.locator(".modal .shapes .shape").count() === 8);
  check("bộ chọn có 16 biểu cảm", await page.locator(".modal .faces .shape").count() === 16);
  check("mỗi ô hình vẽ được mặt bot", await page.locator(".modal .shapes .shape svg").count() === 8);
  check("bộ chọn có nút nạp ảnh và nút về mặc định",
    await page.locator(".modal .up input[type=file]").count() === 1 && await page.locator(".modal [data-act=reset]").count() === 1);

  // Escape phải đóng được — một modal chỉ đóng bằng chuột là một cái bẫy bàn phím.
  await page.keyboard.press("Escape");
  check("Escape đóng bộ chọn", await page.locator(".modal-back").count() === 0);

  // ── chọn một màu ───────────────────────────────────────────────────────────
  await page.locator(".chat-head .avatar-btn").click();
  // Bấm màu chỉ đổi xem trước; ghi chỉ xảy ra khi bấm Lưu.
  await page.locator(".modal .swatch").nth(3).click();
  check("bấm màu chưa ghi gì", (await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: gwHeaders() })).status === 404);
  await page.locator(".modal [data-act=save]").click();
  await page.waitForSelector(".modal-back", { state: "detached", timeout: 10_000 });

  // Đây là phần dễ mục lặng lẽ: `<img>` không gửi được bearer, nên FE phải tự fetch rồi giữ
  // object URL. Hỏng đường đó thì UI lặng lẽ quay về initials và trông vẫn bình thường.
  await page.waitForSelector(".chat-head .avatar-btn img.avatar", { timeout: 10_000 });
  const src = await page.locator(".chat-head .avatar-btn img.avatar").getAttribute("src");
  check("header đổi sang ảnh thật", String(src).startsWith("blob:"), src ?? "(không có src)");
  const drawn = await page.locator(".chat-head .avatar-btn img.avatar").evaluate((n) => n.naturalWidth);
  check("ảnh vẽ được, không phải khung vỡ", drawn === 256, `naturalWidth=${drawn}`);
  check("row trong roster cũng đổi sang ảnh",
    await page.locator(".roster .bot", { hasText: "Picker Probe" }).first().locator("img.avatar").count() === 1);

  const stored = await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: gwHeaders() });
  check("ảnh đã lưu, app gốc đọc được", stored.status === 200 && String(stored.headers.get("content-type")) === "image/png",
    `HTTP ${stored.status} ${stored.headers.get("content-type")}`);

  // ── về mặc định ────────────────────────────────────────────────────────────
  await page.locator(".chat-head .avatar-btn").click();
  await page.locator(".modal [data-act=reset]").click();
  await page.waitForSelector(".chat-head .avatar-btn span.avatar.face", { timeout: 10_000 });
  check("về mặc định ⇒ quay lại mặt suy từ id", await page.locator(".chat-head .avatar-btn img.avatar").count() === 0);
  const after = await fetch(`${BASE}/gw/avatars/${agentId}`, { headers: gwHeaders() });
  check("chỗ lưu cũng trống lại", after.status === 404, `HTTP ${after.status}`);
} catch (e) {
  fail++;
  /*
   * Đẩy vào `results` chứ không chỉ tăng biến đếm.
   * Bản đầu chỉ `fail++`, nên một lượt chết giữa chừng được nhật ký ghi là "xanh 9/9" trong khi
   * console in "9 pass, 1 fail" — đúng loại nhật ký nói dối mà nó sinh ra để chống.
   */
  results.push({ name: "bài chạy dở dang", pass: false, detail: e instanceof Error ? e.message : String(e) });
  console.log(`  FAIL bài chạy dở dang — ${e instanceof Error ? e.message : e}`);
  await page.screenshot({ path: ".data/avatar-ui-fail.png" }).catch(() => {});
} finally {
  await browser.close().catch(() => {});
  await gw("deleteAgents", { ids: [agentId] });
  console.log(`\ndọn ${agentId}`);
}

console.log(`${pass} pass, ${fail} fail`);
recordRun("e2e-avatar-ui.mjs", results);
process.exit(fail ? 1 : 0);
