/**
 * X2 — kiểm hành vi kéo panel của FE `:5173` so với hành vi ĐO ĐƯỢC ở app gốc.
 *
 *   node scripts/measure-web-resize.mjs
 *
 * Vì sao là `measure-` chứ không phải `e2e-`: bài này cần cả stack đang chạy thật (backend :8788 +
 * Vite :5173), giống `ui-diff` và `x-ray`, chứ không tự dựng backend riêng như các bài `e2e-`.
 *
 * Mỗi ca DỰNG TRẠNG THÁI TRƯỚC bằng PATCH rồi tải lại trang. Bản đầu chỉ kéo những delta cố định
 * từ trạng thái đang có, và khi bố cục đã được nhớ thì các ca "rail" không bao giờ chạy tới — bài
 * kiểm vẫn xanh mà không kiểm gì cả.
 *
 * Ngưỡng đối chiếu (đo ở app gốc, `x-ray --drag`):
 *   sidebar  rail 88 · vùng chết ~200px rồi snap · kẹp 400
 *   panel    280–480 · kéo quá mức tối thiểu thì ĐÓNG hẳn
 */
import { chromium } from "playwright-core";
import { recordRun } from "./run-history.mjs";

const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";

const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error(`không lấy được /v1/session từ ${API} — backend có chạy không?`); process.exit(2); }
const hdr = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
const setUi = (ui) => fetch(`${API}/v1/host/settings`, { method: "PATCH", headers: hdr, body: JSON.stringify(ui) });

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
await page.addInitScript((t) => {
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", "host@local");
}, tok);

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const state = () => page.evaluate(() => {
  const w = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? Math.round(r.width) : -1; };
  return {
    sidebar: w(".sidebar"),
    rail: document.querySelector(".sidebar")?.classList.contains("rail") ?? null,
    pane: document.querySelector(".shell")?.classList.contains("no-pane") ? 0 : w(".computer"),
    item: w(".roster .bot"),
  };
});

const setup = async (ui) => {
  await setUi(ui);
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grip-sidebar", { timeout: 15_000 });
  await page.waitForTimeout(700);
};
const drag = async (sel, dx) => {
  const bb = await page.locator(sel).boundingBox();
  if (!bb) return false;
  await page.mouse.move(bb.x + bb.width / 2, 520);
  await page.mouse.down();
  for (const k of [0.2, 0.45, 0.7, 1]) await page.mouse.move(bb.x + bb.width / 2 + dx * k, 520, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return true;
};

try {
  await setup({ sidebarWidth: 300, sidebarCollapsed: false, paneWidth: 400, paneOpen: true });
  check("dựng được trạng thái đầu (300 / 400)", (await state()).sidebar === 300, JSON.stringify(await state()));

  await drag(".grip-sidebar", 50);
  check("đang mở: kéo +50 thì đi theo tay → 350", (await state()).sidebar === 350, JSON.stringify(await state()));

  await setup({ sidebarWidth: 300, sidebarCollapsed: false });
  await drag(".grip-sidebar", 300);
  check("kẹp mép trên 400px", (await state()).sidebar === 400, JSON.stringify(await state()));

  await setup({ sidebarWidth: 300, sidebarCollapsed: false });
  await drag(".grip-sidebar", -150);
  let st = await state();
  check("kéo xuống dưới 200 thì GẬP về rail 88, không co tiếp", st.rail === true && st.sidebar === 88, JSON.stringify(st));

  await setup({ sidebarCollapsed: true });
  await drag(".grip-sidebar", 120);
  st = await state();
  check("VÙNG CHẾT: đang rail, kéo +120 thì không đổi gì", st.rail === true && st.sidebar === 88, JSON.stringify(st));

  await setup({ sidebarCollapsed: true });
  await drag(".grip-sidebar", 260);
  st = await state();
  check("qua ngưỡng 200 thì SNAP sang mở", st.rail === false && st.sidebar >= 200, JSON.stringify(st));

  await setup({ sidebarCollapsed: true });
  st = await state();
  check("rail: hàng bot 54x54 như app gốc", st.item === 54, `hàng rộng ${st.item}px`);

  await setup({ paneWidth: 400, paneOpen: true, sidebarCollapsed: false, sidebarWidth: 300 });
  await drag(".grip-pane", -60);
  check("panel phải: kéo sang trái là rộng thêm → 460", (await state()).pane === 460, JSON.stringify(await state()));

  await setup({ paneWidth: 400, paneOpen: true });
  await drag(".grip-pane", 300);
  check("kéo panel quá mức tối thiểu thì ĐÓNG hẳn", (await state()).pane === 0, JSON.stringify(await state()));

  await setup({ sidebarWidth: 320, sidebarCollapsed: false, paneWidth: 430, paneOpen: true });
  await drag(".grip-sidebar", 30);
  await page.waitForTimeout(900);            // chờ nhịp gộp 400ms của saveUi
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".grip-sidebar", { timeout: 15_000 });
  await page.waitForTimeout(700);
  st = await state();
  check("mở lại thì nhớ bố cục (350 / 430)", st.sidebar === 350 && st.pane === 430, JSON.stringify(st));
} finally {
  await browser.close().catch(() => {});
}

console.log(`\n${pass} pass, ${fail} fail`);
recordRun("measure-web-resize.mjs", results);
process.exit(fail ? 1 : 0);
