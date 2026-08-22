/**
 * Đo khoảng cách giao diện giữa app gốc (CDP :9222) và FE fallback (:5173) — bằng số, ở nhiều khổ
 * cửa sổ, không có ngưỡng đoán.
 *
 *   node scripts/ui-diff.mjs [--url http://localhost:5173] [--sizes 1920x1040,1440x900,1181x760]
 *
 * ── Vì sao bản này khác bản đầu ────────────────────────────────────────────────
 *
 * Bản đầu đi tìm phần tử theo *hình dạng*: "cái nào sát mép trái, rộng 250–500, cao hơn 80% màn
 * hình thì là sidebar". Nó chạy được đúng một lần, ở đúng một khổ cửa sổ. Khi app thu còn 1181px
 * thì sidebar của họ **thu gọn còn 88px** (rail icon) và mọi ngưỡng trượt hết — thước đo báo "app
 * không có sidebar, không có bubble" trong khi app đang hiển thị bình thường. Một thước đo sai kiểu
 * đó tệ hơn không có thước, vì nó vẫn in ra một con số trông như thật.
 *
 * Bản này neo vào **cấu trúc**, đọc từ chính DOM của họ: `[data-role="assistant"]`, `[role="log"]`,
 * `.sand-chat`, `.sand-agents-sidebar`, `.sand-chat-input-dock`, `.sand-info-pane`. Đây là tên vai
 * trò/khối, không phải class băm (`sand-1q8iv8g`) — chúng mô tả *cái gì*, nên không trượt theo khổ
 * cửa sổ. Đọc DOM của họ để đo không phải là copy code của họ: không dòng nào của họ vào sản phẩm.
 *
 * Mỗi khổ cửa sổ được ép bằng `Emulation.setDeviceMetricsOverride` cho **cả hai** phía, nên hai bên
 * luôn đo ở cùng kích thước. Override LUÔN được gỡ ở cuối, kể cả khi lỗi — bỏ sót một nhánh thoát
 * là để cửa sổ app của chủ máy kẹt ở kích thước giả.
 *
 * Con số này KHÔNG phải một gate: roadmap §2 S13 nói rõ FE fallback không đuổi parity. Nó trả lời
 * "còn cách bao xa" và "lần sửa vừa rồi tiến hay lùi".
 */
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const URL_FE = arg("--url", "http://localhost:5173");
const CDP = arg("--cdp", "http://127.0.0.1:9222");
const SIZES = arg("--sizes", "1920x1040,1440x900,1181x760")
  .split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { width: w, height: h }; });

import { ANCHORS } from "./ui-anchors.mjs";

/** Chạy trong trang. Trả `{ [tên vùng]: { prop: value } }`, hoặc `null` khi không có phần tử. */
const READ = (specs) => {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const out = {};
  for (const a of specs) {
    const el = document.querySelector(a.sel);
    if (!el) { out[a.name] = null; continue; }
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const v = {};
    for (const p of a.props) {
      if (p === "x") v.x = Math.round(r.left);
      else if (p === "w") v.w = Math.round(r.width);
      else if (p === "h") v.h = Math.round(r.height);
      else if (p === "bg") v.bg = s.backgroundColor;
      else if (p === "color") v.color = s.color;
      else if (p === "radius") v.radius = s.borderRadius;
      else if (p === "pad") v.pad = `${px(s.paddingTop)} ${px(s.paddingLeft)}`;
      else if (p === "font") v.font = `${px(s.fontSize)}/${px(s.lineHeight)}`;
    }
    out[a.name] = v;
  }
  return out;
};

/**
 * Màu nền người dùng THỰC SỰ nhìn thấy.
 *
 * `body` của app trong suốt và nền do một div bọc vẽ, nhưng div đó không nằm trên chuỗi
 * `firstElementChild` — bản đầu đi theo chuỗi đó nên báo `rgba(0,0,0,0)` và đếm nó thành một chênh
 * lệch, trong khi app rõ ràng nền đen. Thay bằng: phần tử phủ gần kín khung nhìn và có nền đục;
 * lấy cái sâu nhất, vì cái sâu nhất là cái đè lên trên.
 */
const PAINTED_BG = () => {
  const area = innerWidth * innerHeight;
  let found = getComputedStyle(document.body).backgroundColor;
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < area * 0.9) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") found = bg;
  }
  return found;
};

/**
 * Sidebar của họ có hai trạng thái: mở rộng, và thu gọn thành rail icon (~88px). FE của mình chỉ
 * có một. So bề rộng khi hai bên đang ở hai trạng thái khác nhau thì con số vô nghĩa — và nó còn
 * kéo theo cả cột chat, transcript, composer lệch theo, biến một khác biệt thành năm.
 */
const SIDEBAR_STATE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return "không có";
  return el.getBoundingClientRect().width < 140 ? "rail (thu gọn)" : "mở rộng";
};

/** Những vai trò tin nhắn thật sự có trong hội thoại đang mở — để phân biệt "thiếu" với "không có dữ liệu". */
const MSG_ROLES = () => [...new Set(
  [...document.querySelectorAll("[data-role]")].map((e) => e.getAttribute("data-role")),
)].join(",") || "(không có)";

const browser = await chromium.connectOverCDP(CDP);

// Renderer là trang có nhiều chữ nhất — `pages()[0]` từng rơi vào một target gần như rỗng.
let appPage = null, bestText = -1;
for (const pg of browser.contexts()[0].pages()) {
  const n = await pg.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
  if (n > bestText) { bestText = n; appPage = pg; }
}
if (!appPage) { console.error("không tìm được renderer trên CDP :9222 — app có đang chạy không?"); process.exit(2); }

const hasMsg = () => appPage.evaluate(() => Boolean(document.querySelector('[data-role="assistant"]')));

// Phải có hội thoại đang mở mới đo được bubble. Bấm một row bot — chỉ đổi chỗ đang xem, không ghi.
if (!(await hasMsg())) {
  const row = await appPage.evaluate(() => {
    const r = document.querySelector(".sand-agents-list__rows")?.firstElementChild;
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  if (row) { await appPage.mouse.click(row.x, row.y); await appPage.waitForTimeout(2500); }
}
if (!(await hasMsg())) {
  console.error("app không có hội thoại nào đang mở — mở một bot có tin nhắn rồi chạy lại.");
  console.error("(nếu sidebar trống: Ctrl+R trong app — bản sao roster của client hãng thi thoảng rỗng)");
  process.exit(2);
}

const cdp = await appPage.context().newCDPSession(appPage);
let overridden = false;
const clearOverride = async () => {
  if (!overridden) return;
  overridden = false;
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
};
process.on("exit", () => {
  if (overridden) console.log("\n! override kích thước có thể còn sót — khởi động lại app nếu cửa sổ hiển thị lạ");
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { void clearOverride().then(() => process.exit(130)); });
}

const own = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const webPage = await own.newPage({ viewport: SIZES[0] });

let totalSame = 0, totalDiff = 0, totalMissing = 0, totalNa = 0;
const perSize = [];

try {
  await webPage.goto(URL_FE, { waitUntil: "domcontentloaded" });
  await webPage.waitForSelector(".roster .bot", { timeout: 15_000 });
  // Mở bot nhiều chữ nhất, để chắc chắn có bubble để đo.
  const rows = await webPage.locator(".roster .bot").count();
  let best = 0, bestLen = -1;
  for (let i = 0; i < rows; i++) {
    const n = (await webPage.locator(".roster .bot").nth(i).innerText()).length;
    if (n > bestLen) { bestLen = n; best = i; }
  }
  await webPage.locator(".roster .bot").nth(best).click();
  await webPage.waitForSelector(".bubble.agent", { timeout: 10_000 }).catch(() => {});

  const appSpec = ANCHORS.map((a) => ({ name: a.name, sel: a.app, props: a.props }));
  const webSpec = ANCHORS.map((a) => ({ name: a.name, sel: a.web, props: a.props }));

  for (const size of SIZES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
    overridden = true;
    await webPage.setViewportSize(size);
    // Cả hai bên cần một nhịp để layout lại.
    await appPage.waitForTimeout(1200);
    await webPage.waitForTimeout(800);

    const app = await appPage.evaluate(READ, appSpec);
    const web = await webPage.evaluate(READ, webSpec);
    app.shell = { ...app.shell, bg: await appPage.evaluate(PAINTED_BG) };
    web.shell = { ...web.shell, bg: await webPage.evaluate(PAINTED_BG) };

    const appBar = await appPage.evaluate(SIDEBAR_STATE, ".sand-agents-sidebar");
    const webBar = await webPage.evaluate(SIDEBAR_STATE, ".sidebar");
    const barMismatch = appBar !== webBar;
    const appRoles = await appPage.evaluate(MSG_ROLES);

    /*
     * Bề rộng của bốn vùng này là HỆ QUẢ của trạng thái sidebar, không phải lựa chọn thiết kế
     * riêng. Khi hai bên đang ở hai trạng thái khác nhau thì so chúng là đếm một khác biệt thành
     * năm — nên đánh dấu "không so được" và nói rõ lý do, chứ không lặng lẽ bỏ qua.
     */
    const CASCADES = new Set(["sidebar", "roster", "cột chat", "transcript", "composer", "bubble bot"]);
    const CASCADE_PROPS = new Set(["x", "w"]);

    console.log(`\n== ${size.width}x${size.height} ${"=".repeat(56)}`);
    console.log(`   sidebar: app ${appBar} · FE ${webBar}${barMismatch ? "   <- khác trạng thái" : ""}`);
    console.log(`   vai trò tin trong hội thoại app đang mở: ${appRoles}`);
    console.log(`   ${"vùng".padEnd(16)}${"thuộc tính".padEnd(10)}${"app gốc".padEnd(26)}FE :5173`);
    console.log(`   ${"-".repeat(72)}`);
    let same = 0, diff = 0, missing = 0, na = 0;
    for (const a of ANCHORS) {
      const A = app[a.name], W = web[a.name];
      if (!A || !W) {
        // "Không có tin của người dùng trong hội thoại này" khác hẳn "FE thiếu vùng này".
        const noData = !A && a.app.includes("data-role") && !appRoles.includes(a.app.replace(/.*"(.*)".*/, "$1"));
        if (noData) {
          na++;
          console.log(` - ${a.name.padEnd(16)}${"—".padEnd(10)}không so được: hội thoại app đang mở không có loại tin này`);
        } else {
          missing++;
          const who = !A && !W ? "cả hai đều không có" : !A ? "app KHÔNG có vùng này" : "FE KHÔNG có vùng này";
          console.log(` x ${a.name.padEnd(16)}${"—".padEnd(10)}${who}`);
        }
        continue;
      }
      for (const p of a.props) {
        if (barMismatch && CASCADES.has(a.name) && CASCADE_PROPS.has(p)) {
          na++;
          console.log(` - ${a.name.padEnd(16)}${p.padEnd(10)}${String(A[p]).padEnd(26)}${String(W[p])}   (hệ quả trạng thái sidebar)`);
          continue;
        }
        const av = String(A[p]), wv = String(W[p]);
        if (av === wv) { same++; continue; }
        diff++;
        console.log(` ! ${a.name.padEnd(16)}${p.padEnd(10)}${av.padEnd(26)}${wv}`);
      }
    }
    console.log(`   ${"-".repeat(72)}`);
    console.log(`   khớp ${same}, lệch ${diff}, thiếu hẳn ${missing} vùng, ${na} mục không so được`);
    perSize.push({ size: `${size.width}x${size.height}`, same, diff, missing, na });
    totalSame += same; totalDiff += diff; totalMissing += missing; totalNa += na;
  }
} finally {
  await clearOverride();
  await own.close().catch(() => {});
  // KHÔNG đóng `browser`: nó là app đang chạy của chủ máy.
}

console.log(`\n${"=".repeat(76)}`);
for (const r of perSize) console.log(`  ${r.size.padEnd(12)} khớp ${String(r.same).padEnd(4)} lệch ${String(r.diff).padEnd(4)} thiếu ${String(r.missing).padEnd(3)} không so được ${r.na}`);
const pct = totalSame + totalDiff ? Math.round((totalSame / (totalSame + totalDiff)) * 100) : 0;
console.log(`  TỔNG        khớp ${totalSame}/${totalSame + totalDiff} (${pct}%), ${totalMissing} vùng thiếu hẳn, ${totalNa} mục không so được`);
console.log('\nĐây là số đo, không phải điểm số: một vùng "thiếu hẳn" nặng hơn nhiều so với một thuộc tính lệch.');
process.exit(0);
