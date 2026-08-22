/**
 * Reaction — route `/v1` và UI hover, trên một bot dùng-một-lần.
 *
 * Reaction không phải tính năng mình nghĩ ra: `reactToMessage` là một trong 120 lệnh `/gw` của
 * hãng, backend đã lưu toggle trên entry từ lâu, và app gốc hiện một `div[role=toolbar]` khi hover
 * bubble (đo qua CDP 2026-08-22: ba nút `Add reaction` / `Reply` / `More`). Thiếu đúng một mắt:
 * đường để FE của mình *đặt* được. Bài này đo mắt đó, cả hai chiều `/v1` ↔ `/gw`.
 *
 *   node scripts/e2e-reaction.mjs [--url http://localhost:5173] [--no-ui]
 */
import { chromium } from "playwright-core";
import { gwHeaders } from "./gw-auth.mjs";
import { recordRun } from "./run-history.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:8788");
const URL_FE = arg("--url", "http://localhost:5173");
const WITH_UI = !process.argv.includes("--no-ui");

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

const token = (await fetch(`${BASE}/v1/session`).then((r) => r.json()).catch(() => ({}))).token;
if (!token) { console.error("không mint được token /v1/session — backend có chạy không?"); process.exit(1); }
const nh = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const created = await fetch(`${BASE}/v1/agents`, { method: "POST", headers: nh, body: JSON.stringify({ name: "Reaction Probe" }) })
  .then((r) => r.json()).catch(() => null);
const agentId = created?.agent?.id;
if (!agentId) { console.error("không tạo được bot thử"); process.exit(1); }

const transcript = () => fetch(`${BASE}/v1/agents/${agentId}/transcript?limit=100`, { headers: nh }).then((r) => r.json());
const react = (entryId, emoji) =>
  fetch(`${BASE}/v1/agents/${agentId}/entries/${encodeURIComponent(entryId)}/reactions`, {
    method: "POST", headers: nh, body: JSON.stringify({ emoji }),
  });

let browser = null;
try {
  // Một entry để react lên. Không cần chờ model trả lời: chỉ cần transcript có entry.
  await gw("addMessageToAgent", { id: agentId, message: "tin để react" }).catch(() => null);
  let entries = (await transcript()).entries ?? [];
  if (!entries.length) {
    // Đường `/gw` trên có thể tên khác tuỳ build — rơi về gửi một turn thật.
    await fetch(`${BASE}/v1/agents/${agentId}/turns`, {
      method: "POST", headers: nh, body: JSON.stringify({ content: "tin để react", clientNonce: `re-${agentId}` }),
    }).catch(() => null);
    for (let i = 0; i < 20 && !entries.length; i++) {
      await new Promise((r) => setTimeout(r, 400));
      entries = (await transcript()).entries ?? [];
    }
  }
  check("có entry để react", entries.length > 0, `${entries.length} entry`);
  const entryId = entries[0]?.id;

  // ── route ──────────────────────────────────────────────────────────────────
  const noAuth = await fetch(`${BASE}/v1/agents/${agentId}/entries/${entryId}/reactions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji: "👍" }),
  });
  check("không bearer -> 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const add = await react(entryId, "👍");
  const added = await add.json().catch(() => ({}));
  check("POST reaction -> 200", add.status === 200, `HTTP ${add.status}`);
  check("trả về entry đã đổi, không phải {}", added?.id === entryId, JSON.stringify(added).slice(0, 120));
  check("reaction có trong entry, ghi là của mình",
    (added.reactions ?? []).some((r) => r.emoji === "👍" && r.by === "me"), JSON.stringify(added.reactions));

  const reread = (await transcript()).entries.find((e) => e.id === entryId);
  check("transcript đọc lại vẫn có reaction", (reread?.reactions ?? []).some((r) => r.emoji === "👍"));

  const second = await react(entryId, "🎉").then((r) => r.json());
  check("emoji thứ hai cộng thêm, không thay thế", (second.reactions ?? []).length === 2, JSON.stringify(second.reactions));

  // Toggle: gửi lại đúng emoji đó là bỏ — cùng ngữ nghĩa lệnh của hãng.
  const off = await react(entryId, "👍").then((r) => r.json());
  check("gửi lại cùng emoji là bỏ nó (toggle)",
    !(off.reactions ?? []).some((r) => r.emoji === "👍") && (off.reactions ?? []).some((r) => r.emoji === "🎉"),
    JSON.stringify(off.reactions));

  // Đầu vào xấu chặn ở biên.
  const empty = await react(entryId, "");
  check("emoji rỗng -> 400", empty.status === 400, `HTTP ${empty.status}`);
  const long = await react(entryId, "x".repeat(40));
  check("chuỗi dài -> 400", long.status === 400, `HTTP ${long.status}`);
  const noEntry = await react("entry-không-có", "👍");
  check("entry không tồn tại -> 404", noEntry.status === 404, `HTTP ${noEntry.status}`);
  const noAgent = await fetch(`${BASE}/v1/agents/agent-999999/entries/${entryId}/reactions`, {
    method: "POST", headers: nh, body: JSON.stringify({ emoji: "👍" }),
  });
  check("bot không tồn tại -> 404", noAgent.status === 404, `HTTP ${noAgent.status}`);

  // ── UI ─────────────────────────────────────────────────────────────────────
  if (WITH_UI) {
    browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(URL_FE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".roster .bot", { timeout: 15_000 });
    await page.locator(".roster .bot", { hasText: "Reaction Probe" }).first().click();
    /*
     * Chờ transcript ĐÃ đổi sang bot này, không chỉ chờ "có bubble nào đó".
     * Bấm row xong thì DOM vẫn còn transcript của bot trước trong khoảng một nhịp fetch, nên
     * `waitForSelector(".bubble")` khớp ngay với bubble của bot cũ — bài test đọc sai bubble và
     * tệ hơn là có thể bấm reaction lên hội thoại thật của chủ máy.
     */
    await page.waitForFunction(
      (n) => document.querySelector(".chat-head h1")?.textContent?.trim() === n,
      "Reaction Probe",
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      (t) => [...document.querySelectorAll(".transcript .bubble")].some((b) => b.innerText.includes(t)),
      "tin để react",
      { timeout: 10_000 },
    );

    const bubble = page.locator(".transcript .bubble", { hasText: "tin để react" }).first();
    // Bug từng có thật: nhánh bot `return` sớm nên bubble chỉ còn tên bot. Assert nội dung.
    check("bubble có nội dung, không chỉ có tên", (await bubble.innerText()).includes("tin để react"),
      JSON.stringify(await bubble.innerText()));

    const bar = bubble.locator(".msg-actions");
    check("thanh action ẩn khi không hover", await bar.evaluate((n) => getComputedStyle(n).opacity) === "0");
    await bubble.hover();
    await page.waitForTimeout(300);
    check("hover hiện thanh action", await bar.evaluate((n) => getComputedStyle(n).opacity) === "1");
    check("thanh là role=toolbar có nhãn mang entry id",
      String(await bar.getAttribute("aria-label")).includes(entryId), await bar.getAttribute("aria-label"));

    await bar.locator(".act").click();
    check("bấm mở menu emoji", await bubble.locator(".react-menu").isVisible());
    check("menu có 8 emoji", await bubble.locator(".react-menu button").count() === 8);

    await bubble.locator(".react-menu button").first().click();
    await page.waitForTimeout(800);
    const chip = bubble.locator(".react-chip").first();
    check("bấm emoji tạo chip trên bubble", await chip.count() > 0);
    check("chip của mình được đánh dấu", (await chip.getAttribute("class") ?? "").includes("mine"));

    const stored = (await transcript()).entries.find((e) => e.id === entryId);
    check("UI ghi thật xuống backend", (stored?.reactions ?? []).length >= 2, JSON.stringify(stored?.reactions));

    // Bấm chip là bỏ.
    const nBefore = await bubble.locator(".react-chip").count();
    await chip.click();
    await page.waitForTimeout(800);
    check("bấm chip bỏ reaction", await bubble.locator(".react-chip").count() === nBefore - 1);
  }
} catch (e) {
  fail++;
  /*
   * Đẩy vào `results` chứ không chỉ tăng biến đếm.
   * Bản đầu chỉ `fail++`, nên một lượt chết giữa chừng được nhật ký ghi là "xanh 9/9" trong khi
   * console in "9 pass, 1 fail" — đúng loại nhật ký nói dối mà nó sinh ra để chống.
   */
  results.push({ name: "bài chạy dở dang", pass: false, detail: e instanceof Error ? e.message : String(e) });
  console.log(`  FAIL bài chạy dở dang — ${e instanceof Error ? e.message : e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await fetch(`${BASE}/v1/agents/${agentId}`, { method: "DELETE", headers: nh }).catch(() => {});
  console.log(`\ndọn ${agentId}`);
}

console.log(`${pass} pass, ${fail} fail`);
recordRun("e2e-reaction.mjs", results);
process.exit(fail ? 1 : 0);
