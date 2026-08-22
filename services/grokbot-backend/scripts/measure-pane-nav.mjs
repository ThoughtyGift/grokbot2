/**
 * X3 — stack điều hướng panel phải: `details` ⇄ `settings`.
 *
 *   node scripts/measure-pane-nav.mjs
 *
 * Đối chiếu với số đo ở app gốc: `__back` + `__subpage-title`, ra/vào **240ms**, `Edit Bot avatar`
 * **64×64**. Toggle Notifications phải ĐI TỚI BACKEND, không chỉ đổi hình — nên bài này đọc lại
 * `/v1/agents` để xác nhận, chứ không tin cái checkbox.
 */
import { chromium } from "playwright-core";
import { recordRun } from "./run-history.mjs";

const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";
const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error("không lấy được /v1/session"); process.exit(2); }
const hdr = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
const agents = () => fetch(`${API}/v1/agents?includeHidden=1`, { headers: hdr }).then((r) => r.json());

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
await page.addInitScript((t) => {
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", "host@local");
}, tok);

try {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".roster .bot", { timeout: 15_000 });
  await page.locator(".roster .bot").first().click();
  await page.waitForTimeout(800);

  const shown = () => page.evaluate(() => {
    const nav = document.querySelector(".pane-nav");
    const vis = (q) => {
      const el = document.querySelector(q);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { opacity: Number(cs.opacity).toFixed(2), transform: cs.transform, dur: cs.transitionDuration };
    };
    return { page: nav?.getAttribute("data-page"), details: vis(".pane-page.details"), settings: vis(".pane-page.settings") };
  });

  let st = await shown();
  check("mở ra là trang details", st.page === "details" && st.settings.opacity === "0.00", JSON.stringify(st.page));
  check("thời lượng ra/vào 240ms như app gốc", st.settings.dur.startsWith("0.24"), st.settings.dur);

  await page.locator(".chat-head .identity").click();
  await page.waitForTimeout(500);
  st = await shown();
  check("bấm nút danh tính thì đẩy vào trang settings",
    st.page === "settings" && st.settings.opacity === "1.00" && st.details.opacity === "0.00", JSON.stringify(st.page));

  const geo = await page.evaluate(() => {
    const b = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "(không có)"; };
    return {
      avatar: b(".avatar-trigger"),
      back: b('[aria-label="Back to details"]'),
      title: document.querySelector(".subpage-title")?.textContent?.trim() ?? null,
      fields: [...document.querySelectorAll("[data-field]")].map((e) => e.getAttribute("data-field")),
    };
  });
  check("Edit Bot avatar 64×64 như app gốc", geo.avatar === "64x64", geo.avatar);
  check("có nút Back to details + tiêu đề trang con", geo.back !== "(không có)" && geo.title === "Bot settings", `${geo.back} · ${geo.title}`);
  check("có ba trường: name · description · notifications",
    geo.fields.join(",") === "name,description,notifications", geo.fields.join(","));

  /*
   * Đọc đúng bot ĐANG CHỌN, không lấy bot đầu danh sách API.
   *
   * Bản đầu lấy `agents()[0]` và báo FAIL "true → true": sidebar đã gom nhóm nên bot đầu trong
   * sidebar không phải bot đầu trong API, nên bài kiểm đang soi một con bot khác con bot vừa bị
   * đổi. Một bài kiểm đo sai đối tượng thì cái nó báo — dù đỏ hay xanh — đều không có nghĩa.
   */
  const picked = await page.evaluate(() => document.querySelector(".chat-head .identity .nm")?.textContent?.trim() ?? "");
  const before = (await agents()).find((a) => a.name === picked);
  if (!before) { check("tìm được bot đang chọn trong API", false, `không thấy "${picked}"`); throw new Error("stop"); }
  const id = before.id;
  const was = before.notificationsEnabled;
  await page.locator('[data-field="notifications"]').click();
  await page.waitForTimeout(900);
  const after = (await agents()).find((a) => a.id === id);
  check("toggle Notifications ghi xuống backend", after.notificationsEnabled === !was, `${was} → ${after.notificationsEnabled}`);
  await page.locator('[data-field="notifications"]').click();   // trả lại như cũ
  await page.waitForTimeout(700);
  const back = (await agents()).find((a) => a.id === id);
  check("bấm lại thì trả về trạng thái cũ", back.notificationsEnabled === was, String(back.notificationsEnabled));

  await page.locator('[aria-label="Back to details"]').click();
  await page.waitForTimeout(500);
  st = await shown();
  check("Back to details thì pop ra", st.page === "details" && st.details.opacity === "1.00", JSON.stringify(st.page));

  const ghosts = await page.evaluate(() => document.querySelectorAll(".chat-head .ghost, #gb2-logout").length);
  check("toolbar không còn nút kiểu cũ, không còn nút đăng xuất nổi", ghosts === 0, `còn ${ghosts}`);
} finally {
  await browser.close().catch(() => {});
}
console.log(`\n${pass} pass, ${fail} fail`);
recordRun("measure-pane-nav.mjs", results);
process.exit(fail ? 1 : 0);
