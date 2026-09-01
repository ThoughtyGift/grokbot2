/**
 * E2E Reply trên app local: bấm Reply trong giao diện → gửi → xem khối trích dẫn vẽ ra CÁI GÌ.
 *
 * Khác `doc-quote.mjs` (chỉ đọc DOM có sẵn): bài này đi trọn đường của người dùng, nên nó đo được
 * ba chỗ mà đọc DOM không đo được — nút Reply có bấm được không, pill trong khung soạn có hiện
 * trước khi gửi không, và tin MỚI gửi ra có mang khối trích dẫn không.
 *
 * Guard "đã mở đúng bot" dùng `data-active="true"` — thuộc tính app THẬT SỰ đặt (đo 01/09). Hai bản
 * guard trước (`"<tên> 's screen"`, `aria-selected`) đều sai và đều im lặng.
 *
 * Chỉ chạm bot `Reply-thu` do bài đo tạo ra.
 */
const CDP = "http://127.0.0.1:9222";
const BOT = process.argv[2] ?? "agent-866";
const CHU = `e2e reply ${new Date().toTimeString().slice(0, 8)}`;

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
const ds = await (await fetch(`${CDP}/json/list`)).json();
const p = ds.find((x) => x.type === "page" && /renderer|index\.html/.test(x.url ?? "")) ?? ds[0];
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok));
let id = 0;
const cho = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && cho.has(m.id)) { cho.get(m.id)(m); cho.delete(m.id); }
});
const goi = (m, params = {}) => new Promise((ok) => { const n = (id += 1); cho.set(n, ok); ws.send(JSON.stringify({ id: n, method: m, params })); });
const val = async (e) => {
  const r = await goi("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  // Một biểu thức ném ra thì `value` là undefined, `JSON.parse` ngã ở dòng khác và thông báo chỉ
  // đường sang chuyện khác — đúng cái bẫy §7. Nói ra ngay tại chỗ.
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(`biểu thức lỗi: ${ex.exception?.description ?? ex.text}`);
  return r.result?.result?.value;
};
const jsn = async (e) => JSON.parse((await val(e)) ?? "null");
const bam = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await goi("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const dung = (m) => { console.log(`KHÔNG ĐO ĐƯỢC: ${m}`); process.exit(1); };

// ── 1 · mở đúng bot ────────────────────────────────────────────────────────────────────────────
const toa = await jsn(`(() => {
  const el = document.querySelector('[data-agent-id="${BOT}"]');
  if (!el) return JSON.stringify({ loi: "bot không có trong sidebar đã render" });
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`);
if (toa?.loi) dung(toa.loi);

let dangMo = "";
for (let i = 0; i < 6; i += 1) {
  await bam(toa.x, toa.y);
  await nghi(1800);
  dangMo = await val(`(document.querySelector('[data-agent-id][data-active="true"]')?.getAttribute("data-agent-id") ?? "")`);
  if (dangMo === BOT) break;
}
if (dangMo !== BOT) dung(`hàng đang mở là "${dangMo || "(không có)"}", không phải ${BOT}`);
console.log(`① đã mở ${BOT}`);

// ── 2 · tìm một tin để trả lời, hover cho thanh công cụ hiện ────────────────────────────────────
/*
 * Hàng transcript là `[data-row-key]` — đo 01/09 bằng cách đếm mọi thuộc tính data-* trên trang
 * (14 hàng). Hai lần trước tôi tự dựng tiêu chí "phần tử nhiều chữ" và bắt sai cả hai lần: một lần
 * vào hàng sidebar, một lần vào panel PHẢI ("Routines are recurring tasks…").
 *
 * Nhãn nút là `"Reply to <tên bot> message"`, KHÔNG phải "Reply" — nên khớp chính xác "reply" trượt.
 * Đo bằng cách hover từng hàng rồi so danh sách nhãn nút trước/sau: hàng của bot mọc ra ba nút
 * ("Add reaction", "Reply to … message", "More message actions"), hàng của người dùng mọc ra 0.
 */
const hang = await jsn(`JSON.stringify([...document.querySelectorAll("[data-row-key]")].map((el, i) => {
  const r = el.getBoundingClientRect();
  return { i, h: Math.round(r.height), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    chu: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 50) };
}).filter((h) => h.h > 20 && h.chu.length > 8))`);
if (!hang?.length) dung("không thấy hàng [data-row-key] nào có nội dung");

let oReply = null;
let tinDaChon = "";
for (const h of [...hang].reverse().slice(0, 5)) {
  await goi("Input.dispatchMouseEvent", { type: "mouseMoved", x: h.x, y: h.y });
  await nghi(1400);
  const o = await jsn(`(() => {
    const nut = [...document.querySelectorAll("button,[role=button]")]
      .filter((b) => /^reply to .+ message$/i.test((b.getAttribute("aria-label") || "").trim()))
      .filter((b) => b.getBoundingClientRect().width > 0);
    if (nut.length === 0) return "null";
    const r = nut[nut.length - 1].getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      nhan: nut[nut.length - 1].getAttribute("aria-label") });
  })()`);
  if (o) { oReply = o; tinDaChon = h.chu; break; }
}
if (!oReply) dung(`hover 5 hàng cuối, không hàng nào mọc ra nút "Reply to … message"`);
console.log(`② tin sẽ trả lời: "${tinDaChon}"  · nút: "${oReply.nhan}"`);
await bam(oReply.x, oReply.y);
await nghi(1500);

// ── 3 · pill phải hiện TRONG khung soạn trước khi gửi ──────────────────────────────────────────
const truoc = await jsn(`(() => {
  const pill = document.querySelector('[class*="sand-prompt-reply-pill"]');
  return JSON.stringify({
    coPill: !!pill,
    chuTrongPill: pill ? (pill.textContent || "").trim().slice(0, 80) : "",
    coDeleted: (document.body.innerText || "").includes("(deleted)"),
  });
})()`);
console.log(`③ trước khi gửi: pill=${truoc.coPill} · "${truoc.chuTrongPill}" · (deleted)=${truoc.coDeleted}`);
if (!truoc.coPill) dung("bấm Reply rồi mà khung soạn không có pill — nút không nhận cú bấm");

// ── 4 · gửi ───────────────────────────────────────────────────────────────────────────────────
await val(`(() => { const el = document.querySelector('[contenteditable="true"]'); if (el) el.focus(); return 1; })()`);
await goi("Input.insertText", { text: CHU });
await nghi(700);
for (const t of ["keyDown", "keyUp"]) await goi("Input.dispatchKeyEvent", { type: t, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
console.log(`④ đã gửi: "${CHU}"`);

// ── 5 · tin mới phải mang khối trích dẫn ──────────────────────────────────────────────────────
for (let i = 1; i <= 10; i += 1) {
  await nghi(4000);
  const kq = await jsn(`(() => {
    const khoi = [...document.querySelectorAll('[class*="sand-reply-quote"]')]
      .filter((el) => !el.className.includes("__"))
      .map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 90));
    const t = document.body.innerText || "";
    return JSON.stringify({ soKhoi: khoi.length, khoi, daThayTinMinhGui: t.includes(${JSON.stringify(CHU)}), coDeleted: t.includes("(deleted)") });
  })()`);
  if (kq.daThayTinMinhGui) {
    console.log(`\n⑤ tin đã lên màn hình (sau ${i * 4}s)`);
    console.log(`   (deleted) trên màn hình : ${kq.coDeleted}`);
    console.log(`   số khối trích dẫn       : ${kq.soKhoi}`);
    kq.khoi.forEach((k, n) => console.log(`     [${n}] ${k}`));
    process.exit(0);
  }
}
dung("tin gửi rồi mà 40s sau chưa thấy trên màn hình");
