/**
 * X5.1 (FE) — danh sách routine trong panel Details, trên stack đang chạy thật.
 *
 *   node scripts/measure-routines-ui.mjs
 *
 * Bài này TẠO rồi XOÁ một routine trên bot đầu tiên. An toàn vì routine chỉ chạy theo lịch
 * `0 9 * * *` và bài kiểm xoá nó trong cùng lượt — nhưng vẫn dọn ở `finally`, kể cả khi giữa chừng
 * hỏng, để không để lại rác trong máy chủ máy.
 */
import { chromium } from "playwright-core";
import { recordRun } from "./run-history.mjs";

const API = process.env.GROKBOT2_API ?? "http://127.0.0.1:8788";
const WEB = process.env.GROKBOT2_WEB ?? "http://127.0.0.1:5173";
const tok = await fetch(`${API}/v1/session`).then((r) => r.json()).then((j) => j?.token).catch(() => null);
if (!tok) { console.error("không lấy được /v1/session"); process.exit(2); }
const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };

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
let agentId = null, made = null;

/*
 * Mở panel phải TRƯỚC khi đo.
 *
 * Bố cục được nhớ theo tài khoản (X2.3), và lượt `ui-diff` trước đã đồng bộ nó theo app — lúc đó
 * app đang đóng panel. Nên bài này chạy vào một FE có `.shell.no-pane`, danh sách routine nằm
 * trong DOM nhưng `display: none`, và Playwright chờ 30s rồi báo "element is not visible" — một
 * thông báo không hề nhắc tới nguyên nhân thật. Bài kiểm phải tự dựng trạng thái nó cần.
 */
await fetch(`${API}/v1/host/settings`, { method: "PATCH", headers: h, body: JSON.stringify({ paneOpen: true }) });

try {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".roster .bot", { timeout: 15_000 });
  await page.locator(".roster .bot").first().click();
  await page.waitForTimeout(1000);
  const picked = await page.evaluate(() => document.querySelector(".chat-head .identity .nm")?.textContent?.trim() ?? "");
  const agents = await fetch(`${API}/v1/agents?includeHidden=1`, { headers: h }).then((r) => r.json());
  agentId = agents.find((a) => a.name === picked)?.id;
  check("tìm được bot đang chọn", Boolean(agentId), `${picked} → ${agentId}`);

  const before = await page.evaluate(() => document.querySelectorAll("li.routine").length);
  made = (await fetch(`${API}/v1/agents/${agentId}/routines`, {
    method: "POST", headers: h,
    body: JSON.stringify({ name: "ĐO THỬ — xoá ngay", prompt: "không làm gì", schedule: "0 9 * * *" }),
  }).then((r) => r.json())).routines.at(-1);
  check("tạo được routine qua API", Boolean(made?.id), made?.id);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".roster .bot", { timeout: 15_000 });
  await page.locator(".roster .bot").first().click();
  await page.waitForTimeout(1200);

  const shown = await page.evaluate(() => [...document.querySelectorAll("li.routine")].map((li) => ({
    id: li.dataset.routine,
    name: li.querySelector(".nm")?.textContent?.trim(),
    when: li.querySelector(".when")?.textContent?.trim(),
    on: li.querySelector("input")?.checked,
    off: li.classList.contains("off"),
  })));
  check("routine hiện ra trong panel", shown.length === before + 1, `${before} → ${shown.length}`);
  const row = shown.find((r) => r.id === made.id);
  check("hiện câu tả lịch do backend sinh, không hiện cron thô",
    row?.when === made.scheduleText && row.when !== made.schedule, `${row?.when}`);
  check("routine mới bật sẵn", row?.on === true && row?.off === false, JSON.stringify(row));

  await page.locator(`li.routine[data-routine="${made.id}"] input`).click();
  await page.waitForTimeout(700);
  const afterToggle = await fetch(`${API}/v1/agents/${agentId}/routines`, { headers: h }).then((r) => r.json());
  check("tắt trên UI thì backend cũng tắt",
    afterToggle.routines.find((r) => r.id === made.id)?.isEnabled === false, "isEnabled=false");
  const dimmed = await page.evaluate((id) => document.querySelector(`li.routine[data-routine="${id}"]`)?.classList.contains("off"), made.id);
  check("routine tắt thì mờ đi chứ không biến mất", dimmed === true, `off=${dimmed}`);

  page.once("dialog", (d) => d.accept());
  await page.locator(`li.routine[data-routine="${made.id}"] [data-act=routine-del]`).click();
  await page.waitForTimeout(800);
  const afterDel = await fetch(`${API}/v1/agents/${agentId}/routines`, { headers: h }).then((r) => r.json());
  check("xoá trên UI thì backend cũng xoá", !afterDel.routines.some((r) => r.id === made.id), `${afterDel.routines.length} còn lại`);
  made = null;
} finally {
  if (agentId && made?.id) {
    await fetch(`${API}/v1/agents/${agentId}/routines/${made.id}`, { method: "DELETE", headers: h }).catch(() => {});
    console.log("  (đã dọn routine thử vì bài kiểm dừng giữa chừng)");
  }
  await browser.close().catch(() => {});
}

console.log(`\n${pass} pass, ${fail} fail`);
recordRun("measure-routines-ui.mjs", results);
process.exit(fail ? 1 : 0);
