/**
 * Phát lại kịch bản B2 **trong app đang mở** — gõ vào khung soạn tin, tự chọn widget, tự duyệt thẻ,
 * rồi ghi lại đúng những gì MÀN HÌNH trả ra.
 *
 *   node services/grokbot-backend/scripts/app-replay-b2.mjs [--max N] [--bot "Tên bot"]
 *
 * Khác `e2e-replay-b2.mjs` ở một điểm quyết định: bài kia nói chuyện với CỔNG, nên nó biết backend
 * trả gì mà không biết renderer vẽ gì. Bài này đi qua đúng con đường người dùng đi — con trỏ, bàn
 * phím, và những gì hiện trên màn hình. Widget vẽ ra hay không, thẻ quyền hiện hay không, chỉ ở đây
 * mới thấy.
 *
 * ── Ba luật an toàn, vì kịch bản này là của NGƯỜI KHÁC ─────────────────────────────────────────
 *
 * 1. Chạy trên một bot MỚI do script tạo, không đụng bot thật của người dùng.
 * 2. Widget: chọn đúng đáp án app gốc đã chọn (kịch bản có ghi `responded`); không có thì chọn lựa
 *    chọn CUỐI, vốn gần như luôn là "Thôi" — chọn bừa một lựa chọn giữa có thể cài nhầm thứ gì đó.
 * 3. Thẻ xin quyền: duyệt, NHƯNG chặn lệnh phá hoại (`rm -rf`, `mkfs`, `dd`, `shutdown`…). Kịch bản
 *    này sinh từ máy khác; chạy mù mọi lệnh của nó trên hộp thật là cách hỏng việc nhanh nhất.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MAX = Number(argOf("--max", "0")) || Infinity;
const BOT = argOf("--bot", `E2E ${new Date().toISOString().slice(11, 16)}`);

const HERE = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(HERE, "..", ".data", "gateway-token.txt"), "utf8").trim();
/*
 * Gọi cổng, CHỊU ĐƯỢC một nhịp backend vắng mặt.
 *
 * `pnpm backend` chạy ở chế độ watch: sửa một file nguồn là bốn tiến trình nạp lại, và trong vài
 * giây đó mọi fetch trả ECONNREFUSED. Bản trước không bắt, nên một lượt chạy 40 phút chết ở case 7
 * vì tôi sửa `directory/index.ts` ở phiên làm việc song song. Mất cả lượt đo vì một nhịp nạp lại
 * là cái giá không đáng, và lỗi mạng thoáng qua thì ở đâu cũng có.
 *
 * Thử lại tối đa năm lần, giãn dần. Hết năm lần vẫn hỏng thì mới NÉM — im lặng nuốt lỗi ở đây sẽ
 * biến "backend chết hẳn" thành "mọi case đều im", đúng kiểu kết quả sai mà trông như dữ liệu.
 */
const gw = async (m, b = {}) => {
  let cuoi;
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:8788/gw/api/${m}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      return await r.json();
    } catch (e) {
      cuoi = e;
      await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
    }
  }
  throw cuoi;
};

// ── CDP ────────────────────────────────────────────────────────────────────────────────────────
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((t) => t.type === "page");
if (!page) { console.error("app không mở (CDP 9222)"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;
const clickAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
await new Promise((r) => ws.addEventListener("open", r));

/**
 * Toạ độ giữa một phần tử, tìm theo selector hoặc theo CHỮ.
 *
 * Tìm theo chữ đi qua TreeWalker trên text node, KHÔNG quét `.innerText` của mọi phần tử: bản đầu
 * làm thế và treo hẳn — mỗi lần đọc `innerText` ép trình duyệt tính lại layout, nhân với vài nghìn
 * phần tử thì lượt đo không bao giờ về. Đo được: script đứng im hơn mười phút ở đúng dòng đó.
 */
const boxOf = (sel) => js(
  "(() => { const el = document.querySelector(" + JSON.stringify(sel) + ");"
  + " if (!el) return null; const r = el.getBoundingClientRect();"
  + " return (r.width || r.height) ? { x: r.x + r.width/2, y: r.y + r.height/2 } : null; })()",
);

/*
 * Nối chuỗi thẳng, KHÔNG lồng template.
 *
 * Bản đầu viết `${JSON.stringify(...)}` bên trong một template literal đã bị escape một lớp, nên
 * thứ chạy trong trình duyệt là chuỗi `"${JSON.stringify(...)}"` — một literal, không phải tên bot.
 * Hàm tìm chạy trơn tru và luôn trả `null`, còn script thì báo "không thấy trong sidebar" trong khi
 * tên bot nằm ngay đó. Loại lỗi im lặng nhất: không ném, không log, chỉ trả sai.
 */
/*
 * Kéo vào khung nhìn TRƯỚC khi đọc toạ độ, và bỏ qua thứ vẫn nằm ngoài.
 *
 * `getBoundingClientRect` trả toạ độ cho cả phần tử đã cuộn khuất, và `Input.dispatchMouseEvent`
 * bắn ra ngoài viewport thì không trúng gì cả — im lặng, không lỗi. Sidebar hôm nay có 16 bot, bot
 * vừa tạo nằm dưới nếp gấp, nên script "bấm" vào một toạ độ âm rồi tưởng đã mở đúng bot: lượt 20:47
 * gõ cả case 1 vào bot của lượt trước.
 */
const boxOfText = (text) => js(
  "(() => { const want = " + JSON.stringify(String(text).toLowerCase()) + ";"
  + " const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);"
  + " for (let n = w.nextNode(); n; n = w.nextNode()) {"
  + "   if (!n.nodeValue || !n.nodeValue.toLowerCase().includes(want)) continue;"
  + "   let el = n.parentElement;"
  + "   while (el && !(el.getBoundingClientRect().width || el.getBoundingClientRect().height)) el = el.parentElement;"
  + "   if (!el) continue;"
  + "   el.scrollIntoView({ block: \"center\" });"
  + "   const r = el.getBoundingClientRect();"
  + "   if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;"
  + "   return { x: r.x + r.width/2, y: r.y + r.height/2 };"
  + " } return null; })()",
);

const screenText = () => js("document.body.innerText");

// ── dựng bot mới rồi chọn nó trong sidebar ─────────────────────────────────────────────────────
const bot = (await gw("createAgent", { name: BOT })).agent;
console.log(`bot thử: ${BOT} (${bot.id})`);
/*
 * Chờ ĐIỀU KIỆN, không chờ một mốc thời gian.
 *
 * Bản đầu ngủ 2,5s rồi tìm — và trượt, vì roster đi xuống app qua SSE chứ không đồng bộ với lệnh
 * tạo. Một con số ngủ cố định luôn sai theo một trong hai hướng: quá ngắn thì trượt, quá dài thì
 * mỗi lần chạy đắt thêm mà không mua được gì.
 */
/*
 * Bấm vào hàng bot rồi **XÁC NHẬN đã mở đúng bot** — không bấm xong là tin.
 *
 * Lượt 20:47 ngày 28/08: script bấm, rồi gõ cả case 1 vào **E2E 20-09**, tức bot của lượt TRƯỚC.
 * Bản ghi của bot mục tiêu đứng ở 0 entry, và vì mỗi case có hạn cứng 900s, cả lượt chạy sẽ mất
 * gần sáu tiếng để phát hiện ra mình đang đo nhầm con bot. Monitor bắt được `case 1/23 — CHẠM HẠN
 * CỨNG` và đó là toàn bộ dấu hiệu.
 *
 * Bằng chứng rẻ và chắc: khung soạn tin của app luôn ghi `Message <tên bot>` — nó là chính cái nhãn
 * app dùng để nói cho người dùng biết họ đang gõ cho ai. Kiểm nó, và bấm lại nếu chưa đúng.
 *
 * Cùng loài với ba lỗi khác hôm nay: làm một hành động rồi giả định nó có tác dụng. Ở đây cái giá
 * là một phép đo sai trông y như một phép đo chậm.
 */
/*
 * Bot nào đang mở — đo bằng nhãn panel phải `"<tên bot>'s screen"`.
 *
 * Bản đầu kiểm `"Message <tên bot>"` vì bản dựng của hãng vẽ thế trong khung soạn tin. Đo trên app
 * của ta: chuỗi đó KHÔNG có trong `innerText` (placeholder là aria-label `"Prompt"`), nên phép kiểm
 * luôn sai và guard chặn cả những lần bấm đúng. Nhãn `'s screen` thì có thật, đo được.
 */
const daMoDungBot = async () => {
  const t = (await screenText()) ?? "";
  return t.includes(`${BOT}'s screen`);
};

let moDuoc = false;
for (let lan = 0; lan < 6 && !moDuoc; lan += 1) {
  let row = null;
  for (let i = 0; i < 15 && !row; i += 1) { row = await boxOfText(BOT); if (!row) await wait(1000); }
  if (!row) { await wait(1000); continue; }
  await clickAt(row.x, row.y);
  for (let i = 0; i < 6 && !moDuoc; i += 1) { await wait(1000); moDuoc = await daMoDungBot(); }
}
if (!moDuoc) {
  console.error(`không mở được "${BOT}" sau 6 lần bấm — màn hình không ghi "${BOT}'s screen".`);
  console.error("Dừng ở đây thay vì gõ vào một bot không biết là con nào: một phép đo sai tệ hơn không đo.");
  ws.close(); process.exit(1);
}
await wait(1000);

// ── kịch bản ───────────────────────────────────────────────────────────────────────────────────
const data = JSON.parse(await readFile("docs/extracted/kich-ban-b2.json", "utf8"));
const sc = data.scenarios.find((s) => s.bot === "Test Clone");
const cases = sc.cases.filter((c) => String(c.input ?? "").trim());

/*
 * Bong bóng này có phải câu TRẢ LỜI không, hay là một lời từ chối?
 *
 * ── Vì sao cần, và vì sao nó phải DỪNG cả lượt ──────────────────────────────────────────────────
 *
 * Lượt 21:11 ngày 28/08 báo "23 case, trả lời 23, im 0" — một kết quả hoàn hảo cho một lượt mà model
 * chưa chạy lấy một lần. Khoá pool đã hết hạn mức, và mỗi case nhận đúng một bong bóng:
 *
 *     "You've hit your limit · resets 10:40pm (Asia/Saigon)"
 *
 * Phép đo lúc đó là "bản ghi có dài thêm không", nên nó chấm 23/23. Đây là lần thứ BA trong một
 * ngày tôi đo nhầm thứ, mỗi lần một lớp vỏ mới: đầu tiên là độ dài chuỗi trên màn hình, rồi là toạ
 * độ một cú bấm không tới nơi, giờ là số entry. Cùng một sai lầm — đo cái DỄ ĐO thay vì cái cần đo.
 *
 * Backend không giúp được ở đây: pool trả câu báo hạn mức như một câu trả lời bình thường, không
 * mang tiền tố `[grokbot2] Pool error:` nào, nên không có cờ nào để đọc. Chỉ còn cách nhận mặt chữ.
 *
 * Và gặp rồi thì DỪNG, không đi tiếp: 23 case cùng một lời từ chối không phải dữ liệu xấu, nó là
 * KHÔNG dữ liệu, và để nó chạy hết rồi ghi ra một file báo cáo là tự dựng bằng chứng giả.
 */
const KHONG_PHAI_TRA_LOI = [
  /\[grokbot2\] Pool error:/i,
  /\[grokbot2\] Chưa có key/i,
  /\[grokbot2\] Pool trả về rỗng/i,
  /hit your limit/i,
  /rate.?limit/i,
  /quota/i,
];
const loiCuaLuot = async () => {
  const tr = await gw("getAgentTranscript", { agentId: bot.id, id: bot.id });
  const rows = tr?.transcript ?? tr?.entries ?? (Array.isArray(tr) ? tr : []);
  const cuoi = [...rows].reverse().find((e) => e?.message?.type === "text");
  const noiDung = String(cuoi?.message?.content ?? "");
  const hit = KHONG_PHAI_TRA_LOI.find((re) => re.test(noiDung));
  return hit ? noiDung.replace(/\s+/g, " ").slice(0, 160) : null;
};

/** Lệnh KHÔNG được duyệt mù — kịch bản này sinh từ máy khác. */
const NGUY_HIEM = /\brm\s+-rf|\bmkfs|\bdd\s+if=|shutdown|reboot|:\(\)\{|\bformat\b|>\s*\/dev\/sd/i;

const report = ["# Phát lại kịch bản B2 **trong app** (gõ tay qua CDP)", "",
  `> Chạy ${new Date().toISOString()} · bot thử \`${BOT}\` · nguồn kich-ban-b2.json`,
  "> Widget: chọn đúng đáp án app gốc đã chọn; không có thì chọn lựa chọn cuối (\"Thôi\").",
  "> Thẻ quyền: duyệt, trừ lệnh phá hoại — xem `NGUY_HIEM` trong script.", ""];
let nWidget = 0, nPerm = 0, nSkip = 0, nHetGio = 0, nTraLoi = 0, nIm = 0, done = 0;
/** Chữ ký các widget đã bấm — transcript giữ cả thẻ của lượt trước. */
const daBam = new Set();

for (const [i, c] of cases.entries()) {
  if (done >= MAX) break;
  done += 1;
  const before = (await screenText()) ?? "";

  const box = await boxOf('[contenteditable="true"]');
  if (!box) { console.error("mất khung soạn tin"); break; }
  await clickAt(box.x, box.y);
  await wait(300);
  await send("Input.insertText", { text: c.input });
  await wait(300);
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

  /*
   * Chờ LƯỢT XONG, không chờ hết một cái đồng hồ tôi tự đặt.
   *
   * Bản trước đặt 240s mỗi case rồi bắn prompt kế tiếp. Ở turn.ts một prompt mới **huỷ lượt đang
   * chạy** ("Abort whatever was still running for this bot before replacing it"), nên hết giờ
   * không phải là bỏ qua — là GIẾT. Đọc lại transcript thật của lượt chạy 28/08: case 9, 10, 18
   * không có lấy một entry nào, kể cả tool-call. Chúng không im; chúng bị case sau đạp chết.
   *
   * Và cái làm tôi không thấy: script đo bằng cách so độ dài `document.body.innerText`. Dòng
   * trạng thái "is working" đổi cũng làm chuỗi dài ra, nên bốn case bị chấm điểm sai — case 8 và
   * 23 bị gọi là TRỐNG dù có trả lời (case 8 còn ra đúng widget kịch bản mong), case 10 bị gọi là
   * "có trả lời" dù không có gì. Màn hình là thứ dễ đo nhất và cũng dễ sai nhất.
   *
   * Nên chuyển sang hỏi BACKEND: lượt xong khi transcript đã dài ra và không entry nào còn
   * `streaming`. Hạn cứng chỉ còn là lưới an toàn cho lượt treo, không phải nhịp làm việc.
   */
  const HAN_CUNG = 900_000;
  const deadline = Date.now() + HAN_CUNG;
  /*
   * Đo bằng ĐỘ DÀI CHỮ, không chỉ bằng số entry — và đây là lần thứ tư cùng một lỗi trong ngày.
   *
   * `sendPrompt` đẩy tin người dùng VÀ một bong bóng rỗng vào bản ghi ngay lập tức; đó là cách
   * stream hoạt động. Nên ngay sau khi gõ Enter, số entry đã là 2. Nếu model trả lời bằng chữ
   * thuần, không gọi tool nào, bong bóng được điền TẠI CHỖ và số entry đứng nguyên — `n > truoc`
   * không bao giờ đúng, và case treo tới hết hạn cứng 900s.
   *
   * Các lượt Opus trước thoát được chỉ vì chúng gọi tool, làm số entry tăng. Phép đo ấy đúng do
   * MAY, không do đúng — và cái may đó tan ngay khi đổi sang gemini-3.7-flash (đo 22:08–22:14:
   * case 1 có câu trả lời đầy đủ từ phút đầu, script vẫn ngồi chờ).
   *
   * Nên đo cả hai: entry mới HOẶC chữ dài thêm. Một lượt kết thúc là khi không còn gì stream và
   * có thêm nội dung so với lúc bắt đầu.
   */
  const demEntry = async () => {
    const tr = await gw("getAgentTranscript", { agentId: bot.id, id: bot.id });
    const rows = tr?.transcript ?? tr?.entries ?? (Array.isArray(tr) ? tr : []);
    const len = rows.reduce((a, e) => a + String(e?.message?.content ?? e?.content ?? e?.result ?? "").length, 0);
    return { n: rows.length, len, dangChay: rows.some((e) => e?.streaming === true) };
  };
  const truoc = await demEntry();
  let widgetPrompt = null, permTargets = [], last = "", stable = 0;
  let thuLai = 0;   // số lần bấm lại một thẻ báo "didn't go through"
  let xong = false;   // lượt kết thúc thật, hay chạm hạn cứng?
  while (Date.now() < deadline) {
    await wait(3000);

    /*
     * Thẻ xin quyền — app có HAI loại, và bản đầu chỉ biết một.
     *
     *   per-tool : một lệnh cụ thể, nút "Allow" / "Allow once"
     *   cấp app  : "Allow Grok Bot and all Bots to run commands on your local computer?"
     *              với ba nút "Always allow" / "Allow once" / "Never"
     *
     * Luôn chọn **"Allow once"**, không bao giờ "Always allow": nút kia ghi một cài đặt ĐỨNG LẠI
     * (`localToolPermission`) của người dùng, và một lượt chạy thử không có quyền đổi thiết lập máy
     * của họ để tự cho mình đỡ phải bấm.
     *
     * Thẻ cũng có thể báo "Your answer didn't go through" — đo được khi backend đang tranh cổng.
     * Gặp câu đó thì bấm lại, chứ đừng coi như đã duyệt xong.
     */
    const perm = await js(`(() => {
      const btns = [...document.querySelectorAll("button")];
      const pick = btns.find(x => /^allow once$/i.test((x.innerText||"").trim()))
                || btns.find(x => /^(allow|cho phép)$/i.test((x.innerText||"").trim()));
      if (!pick) return null;
      const card = pick.closest('[class*="message-card"]') || pick.closest('[role="alert"]') || pick.parentElement?.parentElement;
      const r = pick.getBoundingClientRect();
      const txt = (card?.innerText || "").slice(0, 400);
      return { x: r.x + r.width/2, y: r.y + r.height/2, target: txt, retry: /didn't go through|không gửi được/i.test(txt) };
    })()`);
    if (perm) {
      if (NGUY_HIEM.test(perm.target)) {
        nSkip += 1;
        permTargets.push(`BỎ QUA (nguy hiểm): ${perm.target.replace(/\s+/g, " ").slice(0, 90)}`);
        // Không bấm gì — nhưng cũng đừng quay vòng mãi trên cùng một thẻ.
        await wait(3000);
      } else if (perm.retry && ++thuLai > 3) {
        /*
         * Bỏ cuộc sau ba lần — thẻ này KHÔNG bao giờ nhận được câu trả lời, và giờ đã biết vì sao.
         *
         * Renderer chuyển `ask.action` xuống IPC main khi bấm "Allow once", và main validate nó.
         * Backend của ta dựng ask thiếu đúng trường đó, nên main ném "must be local tool action,
         * got undefined", lời hứa vỡ, và thẻ hiện "Your answer didn't go through" — câu đổ lỗi cho
         * đường truyền trong khi lỗi nằm ở dữ liệu ta gửi. Xem `PermMsg` trong conversation/types.ts.
         *
         * Đã vá. Giữ lối thoát này lại vì một thẻ không bấm được KHÔNG được phép giết cả lượt chạy:
         * ghi lại rồi đi tiếp vẫn đúng hơn là quay vòng cho tới hết giờ.
         */
        const x = await js("(() => { const b = [...document.querySelectorAll('button')]"
          + ".find(e => /^(×|✕|close|dismiss)$/i.test((e.innerText||'').trim()) || e.getAttribute('aria-label') === 'Close');"
          + " if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
        if (x) await clickAt(x.x, x.y);
        permTargets.push("BỎ QUA: thẻ quyền không nhận trả lời sau 3 lần bấm");
        nSkip += 1; thuLai = 0;
        await wait(2000);
      } else {
        await clickAt(perm.x, perm.y);
        if (!perm.retry) { nPerm += 1; thuLai = 0; permTargets.push(perm.target.replace(/\s+/g, " ").slice(0, 90)); }
      }
      stable = 0; continue;
    }

    /*
     * Widget — lấy cái CUỐI CÙNG, và chỉ bấm MỘT LẦN cho mỗi widget.
     *
     * Bản đầu dùng `querySelector` (cái ĐẦU TIÊN trong DOM) và không nhớ đã bấm gì. Transcript giữ
     * cả widget của những lượt trước, nên nó bám vào một widget cũ và bấm mãi: lần chạy thử 3 case
     * ghi `widget 240` — tức 240 cú bấm vào cùng một thẻ, trong khi cả ba case đều TRỐNG vì vòng
     * lặp không bao giờ thoát ra để chờ câu trả lời thật.
     *
     * Hai điều sửa nó: lấy phần tử cuối (widget mới nhất), và ghi nhớ chữ ký của thẻ đã bấm.
     */
    const w = await js(`(() => {
      const all = [...document.querySelectorAll(".sand-widget--choices")];
      const f = all[all.length - 1];
      if (!f) return null;
      const opts = [...f.querySelectorAll(".sand-widget__options button")].map(b => (b.innerText||"").replace(/\\s+/g," ").trim());
      const head = f.closest('[class*="message-card"]')?.innerText?.split("\\n")[0] ?? "";
      return { head, opts, sig: head + "|" + opts.join(",") };
    })()`);
    // `daBam` giữ chữ ký các thẻ đã bấm: transcript không xoá widget cũ, nên thiếu nó là bấm mãi.
    if (w && w.opts.length && !daBam.has(w.sig)) {
      const want = (c.expected.find((e) => e.kind === "widget" && e.responded) || {}).responded ?? "";
      let idx = w.opts.length - 1;                                   // mặc định: lựa chọn cuối
      if (want) {
        const k = want.toLowerCase();
        const hit = w.opts.findIndex((o) => k.includes(o.replace(/^[A-Z]\s+/, "").toLowerCase()) || o.toLowerCase().includes(k.slice(0, 14)));
        if (hit >= 0) idx = hit;
      }
      const ob = await js(
        "(() => { const all = [...document.querySelectorAll('.sand-widget--choices')];"
        + " const f = all[all.length - 1]; if (!f) return null;"
        + " const b = [...f.querySelectorAll('.sand-widget__options button')][" + idx + "];"
        + " if (!b) return null; const r = b.getBoundingClientRect();"
        + " return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()",
      );
      if (ob) {
        await clickAt(ob.x, ob.y);
        daBam.add(w.sig);
        nWidget += 1;
        widgetPrompt = `${w.head} → chọn "${w.opts[idx]}"`;
        stable = 0; continue;
      }
    }

    last = (await screenText()) ?? "";
    /*
     * Hai nhịp đứng yên liên tiếp mới tính là xong: một lần đọc trúng khe giữa hai entry thì
     * `dangChay` tạm false trong khi lượt vẫn còn.
     */
    const d = await demEntry();
    if (!d.dangChay && (d.n > truoc.n || d.len > truoc.len)) { stable += 1; if (stable >= 2) { xong = true; break; } } else stable = 0;
  }

  const sau = await demEntry();
  const themEntry = Math.max(sau.n - truoc.n, sau.len > truoc.len ? 1 : 0);
  const grown = (last.length > before.length ? last.slice(before.length) : "").replace(/\n{2,}/g, "\n").trim();
  /*
   * Kết cục đo bằng số entry backend ghi được, không bằng chuỗi trên màn hình. Đây là chỗ bản
   * trước sai bốn case: chữ trên màn hình dài ra không có nghĩa là bot đã nói gì.
   */
  const ketCuc = themEntry > 0 ? `có trả lời (${themEntry} entry)` : (xong ? "IM — không entry nào" : "CHẠM HẠN CỨNG");
  if (themEntry > 0) nTraLoi += 1; else if (!xong) nHetGio += 1; else nIm += 1;
  console.log(`  case ${i + 1}/${cases.length}${widgetPrompt ? " [widget]" : ""}${permTargets.length ? " [thẻ]" : ""} — ${ketCuc}`);

  // Model có thật sự chạy không? Nếu không, dừng NGAY — xem `KHONG_PHAI_TRA_LOI`.
  const loi = await loiCuaLuot();
  if (loi) {
    console.error(`
✋ DỪNG ở case ${i + 1}: model không chạy, bot chỉ trả lời:`);
    console.error(`   ${loi}`);
    console.error("   Lượt chạy này KHÔNG có giá trị đo. Không ghi báo cáo.");
    ws.close(); process.exit(3);
  }
  report.push(`### ${i + 1}. ⟵ ${c.input.replace(/\s+/g, " ").slice(0, 160)}`, "");
  if (widgetPrompt) report.push(`- **widget**: ${widgetPrompt}`);
  for (const p of permTargets) report.push(`- **thẻ quyền**: ${p}`);
  report.push("", "```", (grown || `(${ketCuc})`).slice(0, 1200), "```", "");
}

report.push("---", "", `**Tổng:** ${done} case · widget đã chọn ${nWidget} · trả lời ${nTraLoi} · im ${nIm} · chạm hạn ${nHetGio} · thẻ quyền ${nPerm} · bỏ qua ${nSkip}`);
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
await mkdir("docs/parity-runs", { recursive: true });
const out = `docs/parity-runs/app-replay-${stamp}.md`;
await writeFile(out, report.join("\n"), "utf8");
console.log(`\nđã ghi ${out}`);
console.log(`tổng: ${done} case, widget ${nWidget}, trả lời ${nTraLoi}, im ${nIm}, chạm hạn ${nHetGio}, bỏ qua ${nSkip}`);
ws.close();
process.exit(0);
