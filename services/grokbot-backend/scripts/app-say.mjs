/**
 * app-say.mjs "<câu>" [chờ giây] — gõ một câu vào khung soạn tin của app ĐANG MỞ, gửi, rồi in ra
 * những gì bot trả lời trong giao diện.
 *
 * Khác mọi bài E2E khác của repo: chúng nói chuyện với cổng, còn cái này gõ vào đúng ô người dùng
 * gõ và đọc lại đúng thứ hiện trên màn hình. Đó là chỗ duy nhất thấy được renderer làm gì với câu
 * trả lời — thẻ, widget, khối mermaid, hay chỉ chữ.
 */
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("app không mở"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.addEventListener("open", r));

const text = process.argv[2];
const waitSec = Number(process.argv[3] ?? 90);

// Bấm vào ô soạn tin (contenteditable của ProseMirror, không phải <input>) rồi gõ như người.
const box = await evalJs(`(() => {
  const el = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
if (!box) { console.error("không thấy khung soạn tin"); ws.close(); process.exit(1); }
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}
await wait(400);
await send("Input.insertText", { text });
await wait(400);
for (const type of ["keyDown", "keyUp"]) {
  await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}
console.log(`⟵ đã gõ: ${text}`);

/** Chữ đang hiện trong khung hội thoại, cắt phần đuôi mới. */
const transcript = () => evalJs(`document.body.innerText`);
const before = (await transcript()) ?? "";
let last = before, stable = 0;
for (let i = 0; i < waitSec / 3; i += 1) {
  await wait(3000);
  const now = (await transcript()) ?? "";
  if (now === last && now.length > before.length) { stable += 1; if (stable >= 3) break; } else stable = 0;
  last = now;
}
const grown = last.length > before.length ? last.slice(before.length) : "(màn hình không đổi)";
console.log("\n⟶ MÀN HÌNH TRẢ RA:");
console.log(grown.replace(/\n{3,}/g, "\n\n").trim().slice(0, 1800));
ws.close();
process.exit(0);
