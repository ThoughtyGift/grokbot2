/**
 * E2E "Share as template" trên client 0.43 local (CDP :9225), đúng luồng app gốc — đo bằng cách BẤM THẬT.
 *
 *   node services/grokbot-backend/scripts/e2e-chia-se-mau.mjs            # cổng từ GROKBOT2_CDP_PORT, mặc định 9225
 *
 * Bảy mốc, mỗi mốc GREEN/RED, tự dọn (xoá mẫu ở cuối qua chính menu Delete Template):
 *   1. menu header "Template actions" có "Share as template" (bot chưa có mẫu)
 *   2. bấm → client tự gửi câu `Create a template of yourself…` → bot đăng tiến độ + thẻ `bot-template-share` "Unpublished"
 *      với nút Publish / View Details (≤ 120 s, gồm một lượt model)
 *   3. bấm Publish → thẻ "Published" + Copy link; menu header đổi sang View template details / Update template / Delete Template
 *   4. bấm Update template → client gửi `Update the shared template of yourself.` → thẻ THỨ HAI "Unpublished" (bản 2)
 *   5. bấm Publish thẻ 2 → thẻ 2 "Published", thẻ 1 tự về "Unpublished" (client suy: version ≠ activeVersion)
 *   6. View Details mở hộp có Instructions · Routines · Integrations (đọc từ `toWireView`)
 *   7. Delete Template → xác nhận → cả hai thẻ "This template was deleted", menu về "Share as template"
 *
 * Vì sao bấm bằng `Input.dispatchMouseEvent` chứ không `el.click()`: menu Radix của client KHÔNG chọn mục khi nhận
 * `click()` tổng hợp (đo 05/09: menu vẫn mở, không gì gửi đi) — chỉ sự kiện trusted mới đi qua. Bẫy thứ hai: nút của
 * thẻ mang `title`, không `aria-label`, nên so khớp theo cả ba (`aria-label` · `title` · chữ).
 *
 * Bài đo này gửi HAI lượt model vào bot đang mở và để lại các thẻ trong bản ghi (như app gốc). Không chạy khi người
 * dùng đang chat.
 */
const PORT = Number(process.env.GROKBOT2_CDP_PORT ?? 9225);
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json().catch(() => null);
const page = pages?.find((p) => p.type === "page" && /index\.html/.test(p.url));
if (!page) { console.error(`RED  không có client trên CDP :${PORT} — mở bằng infra\\scripts\\start-app-043.cmd`); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const cho = new Map();
const goi = (method, params = {}) => new Promise((res, rej) => { const n = ++id; cho.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && cho.has(m.id)) { const { res, rej } = cho.get(m.id); cho.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => {
  const r = await goi("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS ném: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
/** Bấm THẬT vào phần tử nhìn thấy cuối cùng khớp regex (aria-label · title · chữ) trong `sel`. */
async function bam(re, sel) {
  /*
   * Ba lớp bảo vệ, mỗi lớp trả giá một lần (05/09):
   *   1. transcript cuộn MƯỢT → đo rect ngay sau scrollIntoView là đo giữa lúc trôi;
   *   2. hàng ảo hoá đo sai chiều cao thẻ mới → hàng kế ĐÈ lên nút vài giây (elementFromPoint ra <p> của hàng sau);
   *      chờ tới khi điểm bấm trúng đúng nút rồi mới bấm, lay cuộn để ép đo lại;
   *   3. so khớp gộp aria-label · title · chữ, lấy phần tử NHÌN THẤY cuối cùng.
   */
  const rect = await ev(`(async function(){
    const sl = ms => new Promise(r => setTimeout(r, ms));
    const re = new RegExp(${JSON.stringify(re)});
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .filter(e => re.test([e.getAttribute("aria-label"), e.getAttribute("title"), e.innerText || e.textContent].filter(Boolean).join(" | ")));
    const vis = els.map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.height > 0);
    if (!vis.length) return null;
    const el = vis[vis.length - 1].e;
    let sc = el.parentElement;
    while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    el.scrollIntoView({ block: "center" }); await sl(700);
    // Hàng ảo hoá ĐO SAI chiều cao thẻ vừa mọc: hàng sau đè lên chân thẻ vài giây rồi mới xếp lại (đo 05/09:
    // elementFromPoint ra <p> của hàng kế, không phải composer). Chờ tới khi điểm bấm trúng nút, lay nhẹ cuộn để ép đo lại.
    for (let i = 0; i < 15; i++) {
      const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { x, y, lan: i };
      if (sc && sc !== document.body) { sc.scrollBy({ top: -60, behavior: "instant" }); await sl(150); sc.scrollBy({ top: 60, behavior: "instant" }); }
      await sl(700);
    }
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, lan: 4, mu: true };
  })()`);
  if (!rect) throw new Error(`không thấy "${re}" trong ${sel}`);
  await goi("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await goi("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await goi("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
}
const go = async (key) => {
  const k = key === "Escape" ? 27 : 13;
  await goi("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k });
  await goi("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k });
};
const menu = async () => {
  await bam("^Template actions$", "button");
  await sl(700);
  return ev(`[...document.querySelectorAll("[role=menuitem]")].map(e => (e.textContent || "").trim())`);
};
/*
 * Transcript của client ẢO HOÁ hàng: thẻ cũ trôi khỏi DOM khi thẻ mới mọc, nên KHÔNG đếm thẻ để biết "có thẻ mới" (đo
 * 05/09: lần chạy hai RED ở mốc 2 dù thẻ mới đã hiện đúng). Nhận thẻ mới bằng `data-row-key` của hàng chứa nó.
 */
// …và DOM của hàng ảo hoá KHÔNG theo thứ tự nhìn thấy (hàng absolute, translateY) → xếp theo toạ độ màn hình.
const the = () => ev(`[...document.querySelectorAll(".sand-bot-template-share-card-wrap")].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y).map(c => ({
  key: c.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null,
  text: c.textContent.trim().slice(0, 40),
  published: /Published/.test(c.textContent) && !/Unpublished/.test(c.textContent),
  deleted: /was deleted/.test(c.textContent),
  buttons: [...c.querySelectorAll("button")].map(b => (b.getAttribute("aria-label") || b.title || b.textContent || "").trim()),
}))`);
const choDen = async (dk, ms, buoc = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await dk()) return true; await sl(buoc); } return false; };
/**
 * Chờ lượt bot XONG: số hàng transcript đứng yên 4 s. Bấm Publish ngay khi thẻ vừa mọc là bấm vào một trang còn
 * đang trôi — câu chốt của bot đến sau thẻ vài giây và đẩy nút đi (đo 05/09: lần chạy đầu RED ở mốc 3 đúng vì thế).
 */
const choLuotXong = async () => {
  const dem = () => ev(`document.querySelectorAll("[data-row-key]").length`);
  let truoc = await dem(), yen = 0;
  while (yen < 4000) { await sl(1000); const n = await dem(); if (n === truoc) yen += 1000; else { yen = 0; truoc = n; } }
};
/** Bấm Publish trên thẻ cuối; thử lại một lần nếu 8 s sau vẫn chưa đổi trạng thái. */
const bamPublish = async (dk) => {
  for (let lan = 0; lan < 2; lan++) {
    await bam("Publish", ".sand-bot-template-share-card-wrap button");
    if (await choDen(dk, 8_000, 1000)) return true;
  }
  return false;
};
const ketQua = [];
const moc = (ten, ok, ghi = "") => { ketQua.push(ok); console.log(`${ok ? "GREEN" : "RED  "} ${ten}${ghi ? " — " + ghi : ""}`); if (!ok) throw new Error("dừng ở mốc đỏ"); };

try {
  const khoa0 = (await the()).at(-1)?.key ?? null;
  // 1
  const m1 = await menu();
  moc("1 menu có Share as template", m1.includes("Share as template"), m1.join(" · "));
  // 2
  await bam("Share as template", "[role=menuitem]");
  const co2 = await choDen(async () => { const c = (await the()).at(-1); return c != null && c.key !== khoa0 && !c.published; }, 120_000, 2000);
  const t2 = (await the()).at(-1);
  moc("2 thẻ Unpublished + Publish/View Details", co2 && t2.buttons.some((b) => /Publish/.test(b)) && t2.buttons.some((b) => /View/.test(b)), JSON.stringify(t2));
  // 3
  await choLuotXong();
  const co3 = await bamPublish(async () => (await the()).at(-1).published);
  const m3 = await menu(); await go("Escape");
  moc("3 Publish → Published + Copy link; menu Update/Delete", co3 && (await the()).at(-1).buttons.some((b) => /Copy/.test(b)) && m3.includes("Update template") && m3.includes("Delete Template"), m3.join(" · "));
  // 4
  const khoa3 = (await the()).at(-1)?.key ?? null;
  await menu(); await bam("Update template", "[role=menuitem]");
  const co4 = await choDen(async () => { const c = (await the()).at(-1); return c != null && c.key !== khoa3 && !c.published; }, 120_000, 2000);
  moc("4 Update template → thẻ 2 Unpublished", co4 && !(await the()).at(-1).published, JSON.stringify((await the()).at(-1)?.text));
  // 5
  await choLuotXong();
  const co5 = await bamPublish(async () => { const c = await the(); return c.at(-1).published && (c.length < 2 || !c.at(-2).published); });
  moc("5 Publish bản 2 → thẻ 2 Published, thẻ 1 về Unpublished", co5, JSON.stringify((await the()).slice(-2).map((c) => c.published)));
  // 6
  await bam("View", ".sand-bot-template-share-card-wrap button");
  const co6 = await choDen(() => ev(`!!document.querySelector("[role=dialog]")`), 10_000, 500);
  await sl(1200);
  const hop = co6 ? await ev(`document.querySelector("[role=dialog]").textContent`) : "";
  await go("Escape");
  moc("6 View Details có Instructions · Routines · Integrations", co6 && /Instructions/.test(hop) && /Routines/.test(hop) && /Integrations/.test(hop), hop.slice(0, 80));
  // 7
  await sl(500); await menu(); await bam("Delete Template", "[role=menuitem]");
  await choDen(() => ev(`!!document.querySelector("[role=dialog],[role=alertdialog]")`), 5_000, 300);
  await bam("Delete template", "[role=dialog] button,[role=alertdialog] button");
  const co7 = await choDen(async () => (await the()).slice(-2).every((c) => c.deleted), 10_000);
  const m7 = await menu(); await go("Escape");
  moc("7 Delete → hai thẻ deleted, menu về Share as template", co7 && m7.includes("Share as template") && !m7.includes("Delete Template"), m7.join(" · "));
} catch (e) {
  if (!/mốc đỏ/.test(String(e))) console.log("RED  ", e instanceof Error ? e.message : String(e));
} finally {
  const xanh = ketQua.filter(Boolean).length;
  console.log(`\n${xanh}/7 GREEN`);
  ws.close();
  process.exit(xanh === 7 ? 0 : 1);
}
