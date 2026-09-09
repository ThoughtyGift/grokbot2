/**
 * Bảng theo dõi box — trả lời một câu hỏi, không phải vẽ mọi thứ đo được.
 *
 * Câu đó là: **cấp thêm được mấy bot nữa, và cái gì đang chặn.** Mọi thứ khác trên trang tồn tại để
 * chống lại câu trả lời đó khi nó sai: từng màn hình một, từng hồ sơ Chrome một, để khi số "còn 14
 * bot" trông lạ thì thấy ngay ai đang ăn RAM.
 *
 * Không đặt ở tiến trình ops (`:8791`) vì đó là cửa công khai cho webhook Slack/GitHub. Đặt ở BFF:
 * nó chỉ nghe trên 127.0.0.1 và đã có cổng xác thực.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkAuth, noteAuth, expectedToken } from "./auth-gate.js";
import { boxSnapshot, COST_PER_BOT_MB, PROFILE_MB, type BoxSnapshot } from "./box-resources.js";
import { desktopHeldBy } from "./desktop.js";
import { desktopRecordingState } from "./desktop-record.js";
import { docManifest } from "./update-feed.js";
import { docSo, soDoiMayPath, tinhDoiMay, type TinhDoiMay } from "./so-doi-may.js";

const esc = (s: unknown): string => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const mb = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);

/**
 * Trang chỉ đọc, và cố ý như vậy ở bản đầu.
 *
 * Một nút "thu hồi màn hình này" là nút giết tiến trình của phần mềm khác trên cùng box — trên box
 * này có sáu Chrome không thuộc grokbot2, ăn 6 GB. Bảng phải chứng minh nó nhận diện đúng chủ trước
 * khi được phép bấm bất cứ thứ gì.
 */
export interface AdminPayload extends BoxSnapshot {
  desktop: { heldBy: string | null; recording: string | null };
  cost: { perBotMb: number; profileMb: number };
  doiMay: TinhDoiMay & { tu: number; banDangPhat: string };
}

async function payload(): Promise<AdminPayload> {
  const snap = await boxSnapshot();
  const rec = desktopRecordingState();
  /*
   * Bản đang phát đọc từ ĐÚNG kênh mà launcher hỏi (`traLoiLauncher` dùng cùng biểu thức này) —
   * một nguồn sự thật. Tính ra một con số khác cho cùng ý nghĩa là bẫy §7 *"hai nguồn cho MỘT số
   * phiên bản"*, đã trả giá ngày 06/09 bằng 106 MB tải lại mỗi 24 h.
   */
  const so = docSo(soDoiMayPath());
  const banDangPhat = docManifest()[process.env.GROKBOT2_LAUNCHER_KENH ?? "stable"]?.version ?? "";
  return {
    ...snap,
    desktop: { heldBy: desktopHeldBy(), recording: rec.state === "recording" ? rec.agentId : null },
    cost: { perBotMb: COST_PER_BOT_MB, profileMb: PROFILE_MB },
    doiMay: { ...tinhDoiMay(so, banDangPhat), tu: so.tu, banDangPhat },
  };
}

const bar = (pct: number, tone: string): string =>
  `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;background:${tone}"></i></div>`;

/** CSS của trang — hằng, nên nằm ngoài hàm dựng trang; trộn vào thì `page` dài gấp ba mà không thêm gì. */
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#151b23;--line:#232b36;--ink:#e6edf3;--dim:#7d8590;--hot:#ff7b72;--ok:#3fb950;--warn:#d29922;--acc:#58a6ff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:22px}
  h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
  .when{color:var(--dim);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;margin-left:auto}
  .hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:26px;align-items:center}
  .big{font:600 68px/0.9 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:-.03em}
  .big small{display:block;font:600 12px/1.6 ui-sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-top:8px}
  .why{color:var(--dim)}
  .why b{color:var(--ink);font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:14px 0 26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .card h2{margin:0 0 10px;font:600 11px/1 ui-sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
  .num{font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace}
  .sub{color:var(--dim);font-size:12px;margin-top:4px}
  .bar{height:6px;background:#0b0f14;border-radius:99px;overflow:hidden;margin-top:10px}
  .bar i{display:block;height:100%;border-radius:99px}
  table{width:100%;border-collapse:collapse;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
  caption{text-align:left;font:600 11px/1 ui-sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);padding:0 0 10px}
  th{text-align:left;font:600 11px ui-sans-serif;letter-spacing:.06em;color:var(--dim);padding:0 10px 8px;border-bottom:1px solid var(--line)}
  td{padding:7px 10px;border-bottom:1px solid #1b222c;vertical-align:top}
  td.n,th.n{text-align:right}
  td.s{color:var(--dim);font-size:12px}
  td.k{color:var(--acc)}
  tr.dim td{opacity:.55}
  .hot{color:var(--hot)}
  .tag{margin-left:7px;padding:1px 6px;border-radius:99px;background:#1f6feb22;border:1px solid #1f6feb55;color:var(--acc);font:600 10px ui-sans-serif;letter-spacing:.05em}
  .note{margin:22px 0 0;padding:14px 16px;background:#161b22;border-left:3px solid var(--warn);border-radius:0 8px 8px 0;color:var(--dim);font-size:13px}
  .note b{color:var(--ink)}
  section{margin-bottom:26px}
  .err{background:#3d1417;border:1px solid #6e2329;color:#ffb4ab;padding:12px 16px;border-radius:8px}
</style>
`;

/** Một hàng cho mỗi màn hình. Hàng mờ đi = màn hình trống. */
function displayRows(p: AdminPayload): string {
  return p.displays.map((d) => `<tr class="${d.idle ? "dim" : ""}">
    <td class="k">${esc(d.display)}${d.profiles.some((x) => /grok/i.test(x)) ? '<span class="tag">của mình</span>' : ""}</td>
    <td class="n">${mb(d.rssMb)}</td>
    <td class="n s">${d.xvfbMb || ""}</td>
    <td class="n s">${d.chromeMb || ""}</td>
    <td class="n s">${d.vncMb || ""}</td>
    <td class="n s">${d.procs}</td>
    <td class="s">${esc(d.geometry ?? "")}${d.vncPort ? ` · vnc ${d.vncPort}` : ""}</td>
    <td class="s">${d.idle ? "trống" : esc(d.profiles.map((x) => x.split("/").pop()).join(", "))}</td>
  </tr>`).join("");
}

/** Mười hồ sơ Chrome nặng nhất — đủ để thấy ai đang ăn RAM, không đủ để thành một bãi chữ. */
function profileRows(p: AdminPayload): string {
  return p.chromeProfiles.slice(0, 10).map((c, i) => `<tr>
    <td class="n">${mb(c.rssMb)}</td>
    <td class="n s">${c.procs}</td>
    <td class="k s">${esc(c.display ?? "—")}</td>
    <td class="s ${i === 0 ? "hot" : ""}">${esc(c.profile)}</td>
  </tr>`).join("");
}

/**
 * Bốn thẻ tóm tắt: RAM · đĩa · phần của mình · màn hình dùng chung.
 *
 * Tách vì đây là chỗ duy nhất trong trang có **ngưỡng màu** — đỏ/vàng/xanh theo phần trăm. Ngưỡng
 * lẫn trong một khối HTML 80 dòng thì không ai thấy để sửa.
 */
function cards(p: AdminPayload): string {
  const ramPct = p.ram.totalMb ? ((p.ram.totalMb - p.ram.availableMb) / p.ram.totalMb) * 100 : 0;
  const ours = p.displays.filter((d) => d.profiles.some((x) => /grok/i.test(x)));
  const oursMb = ours.reduce((s, d) => s + d.rssMb, 0);
  return `<div class="grid">
  <div class="card">
    <h2>RAM</h2>
    <div class="num">${mb(p.ram.availableMb)}<span class="sub"> khả dụng / ${mb(p.ram.totalMb)}</span></div>
    ${bar(ramPct, ramPct > 85 ? "var(--hot)" : ramPct > 70 ? "var(--warn)" : "var(--ok)")}
    <div class="sub">đang dùng ${mb(p.ram.usedMb)} · free ${mb(p.ram.freeMb)}</div>
  </div>
  <div class="card">
    <h2>Đĩa ${esc(p.disk.mount)}</h2>
    <div class="num">${mb(p.disk.freeMb)}<span class="sub"> trống / ${mb(p.disk.totalMb)}</span></div>
    ${bar(p.disk.usedPct, p.disk.usedPct > 90 ? "var(--hot)" : p.disk.usedPct > 80 ? "var(--warn)" : "var(--ok)")}
    <div class="sub">đã dùng ${p.disk.usedPct}%</div>
  </div>
  <div class="card">
    <h2>Của grokbot2</h2>
    <div class="num">${mb(oursMb)}</div>
    <div class="sub">${ours.length} màn hình · phần còn lại là phần mềm khác trên cùng box</div>
  </div>
  <div class="card">
    <h2>Màn hình dùng chung</h2>
    <div class="num">${p.desktop.heldBy ? esc(p.desktop.heldBy) : "trống"}</div>
    <div class="sub">${p.desktop.recording ? `đang ghi bài dạy cho ${esc(p.desktop.recording)}` : "không ai đang ghi"}</div>
  </div>
  ${poolCard(p)}
  ${doiMayCard(p)}
</div>
`;
}

/**
 * Thẻ "tài khoản box": dải `gb2u*` đã cấp / tổng. Đây là trần chặn SỚM hơn RAM (§7 bảng theo dõi:
 * người thứ N+1 thấy mọi tool box hỏng cùng lúc), nên nó đứng cạnh RAM/đĩa chứ không nằm ở log router.
 * Router cũ chưa có `GET /pool` thì thẻ nói thẳng là chưa hỏi được, không vẽ số 0 giả.
 */
function poolCard(p: AdminPayload): string {
  const q = p.pool;
  if (!q) return `<div class="card">
    <h2>Tài khoản box</h2>
    <div class="num">—</div>
    <div class="sub">router chưa trả lời <code>GET /pool</code> — bản router cũ, hoặc box chưa nối</div>
  </div>`;
  const pct = q.size ? (q.used / q.size) * 100 : 0;
  return `<div class="card">
    <h2>Tài khoản box</h2>
    <div class="num">${q.free}<span class="sub"> còn trống / ${q.size}</span></div>
    ${bar(pct, q.free <= 2 ? "var(--hot)" : pct > 70 ? "var(--warn)" : "var(--ok)")}
    <div class="sub">đã cấp ${q.used} · ${q.owners} người trong sổ${q.perUser ? "" : " · tách người dùng đang TẮT"}</div>
  </div>`;
}

/**
 * Thẻ "đội máy": bao nhiêu máy NGOÀI KIA đã lên bản đang phát.
 *
 * Nó ở trang này vì nó là **cổng** cho mọi tính năng phụ thuộc client — 09/09 câu *"bao giờ đặt
 * `GROKBOT2_CHECKOUT_URL`"* chỉ trả lời được bằng con số này, và lúc ấy backend không biết nó, nên
 * tôi phải dựng lại đội máy bằng tay từ log nginx (log xoay, và lẫn phép dò của chính tôi).
 *
 * Sổ trắng thì thẻ nói **thẳng là chưa có gì**, không vẽ `0/0` như một kết luận: sổ mới bật thì
 * "0 máy" và "chưa ai hỏi feed từ khi bật sổ" là hai chuyện khác nhau, và số `khongPhaiLauncher`
 * là thứ phân biệt được chúng — có hàng phép dò mà 0 hàng launcher thì bộ ghi đang chạy đúng.
 */
function doiMayCard(p: AdminPayload): string {
  const d = p.doiMay;
  const tu = new Date(d.tu).toISOString().slice(0, 10);
  if (!d.tong) return `<div class="card">
    <h2>Đội máy</h2>
    <div class="num">—</div>
    <div class="sub">chưa launcher nào hỏi feed từ ${tu}${d.khongPhaiLauncher ? ` · ${d.khongPhaiLauncher} hàng không phải launcher (phép dò, trình duyệt) ⇒ sổ đang ghi` : " · sổ còn trắng hẳn"}</div>
  </div>`;
  const pct = (d.daToi / d.tong) * 100;
  return `<div class="card">
    <h2>Đội máy</h2>
    <div class="num">${d.daToi}<span class="sub"> / ${d.tong} máy ở bản đang phát</span></div>
    ${bar(pct, d.daToi === 0 ? "var(--hot)" : pct < 100 ? "var(--warn)" : "var(--ok)")}
    <div class="sub">${d.banDangPhat ? `<code>${esc(d.banDangPhat)}</code>` : "manifest chưa có bản nào"} · sổ từ ${tu}${d.khongPhaiLauncher ? ` · ${d.khongPhaiLauncher} hàng phép dò (không tính)` : ""}</div>
  </div>`;
}

/** Từng máy một — vì "0/4" mà không kể tên thì không quyết được việc gì. */
function doiMayRows(p: AdminPayload): string {
  const { may, banDangPhat } = p.doiMay;
  return may
    .map((m) => {
      const toi = banDangPhat !== "" && m.ver === banDangPhat;
      return `<tr>
      <td>${esc(m.ua)}</td>
      <td><code>${esc(m.ver)}</code></td>
      <td>${new Date(m.cuoi).toISOString().replace("T", " ").slice(0, 16)}</td>
      <td class="n">${m.ma}</td>
      <td>${toi ? '<span style="color:var(--ok)">đã tới</span>' : '<span style="color:var(--warn)">chưa</span>'}</td>
    </tr>`;
    })
    .join("\n");
}

/**
 * Vì sao trang này không có nút nào.
 *
 * Để cuối trang và tách riêng vì nó là một **quyết định**, không phải dữ liệu: sáu Chrome trên box
 * không thuộc grokbot2, nên một nút "thu hồi" ở đây là nút giết tiến trình của phần mềm khác.
 */
function whyReadOnly(p: AdminPayload): string {
  const idle = p.displays.filter((d) => d.idle);
  return `<p class="note">
  <b>Trang này chỉ đọc.</b> Không có nút thu hồi, và đó là cố ý: sáu trong số các Chrome trên box
  này không thuộc grokbot2 (${mb(p.chromeProfiles.filter((c) => !/grok/i.test(c.profile)).reduce((s, c) => s + c.rssMb, 0))}),
  nên một nút "giết" ở đây là nút giết tiến trình của người khác. Bảng phải chứng minh nó nhận
  đúng chủ trước đã.
  ${idle.length ? `Hiện có ${idle.length} màn hình trống: ${idle.map((d) => esc(d.display)).join(", ")}.` : ""}
</p>
`;
}

function page(p: AdminPayload): string {
  const bind = p.headroom.limit === "ram" ? "RAM" : "đĩa";

  const rows = displayRows(p);
  const profs = profileRows(p);

  return `<!doctype html><meta charset="utf-8"><title>box · grokbot2</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${STYLE}<div class="wrap">
<header>
  <h1>Box · sức chứa</h1>
  <span class="when">${p.ok ? new Date(p.atMs).toISOString().replace("T", " ").slice(0, 19) : "không đọc được"} · tự làm mới 15s</span>
</header>

${p.ok ? "" : `<div class="err">Không đọc được box: ${esc(p.error ?? "không rõ")}</div>`}

<div class="hero">
  <div class="big">${p.headroom.bots}<small>bot cấp thêm được</small></div>
  <div class="why">
    <b>${bind}</b> đang là chỗ chặn.
    Theo RAM: <b>${p.headroom.byRamBots}</b> bot · theo đĩa: <b>${p.headroom.byDiskBots}</b> bot.
    <div class="sub">Tính theo ${mb(p.cost.perBotMb)} RAM và ${mb(p.cost.profileMb)} đĩa cho mỗi màn hình riêng, chừa lại 1 GB.</div>
  </div>
</div>

${cards(p)}
<section>
  <table>
    <caption>Từng màn hình</caption>
    <tr><th>display</th><th class="n">tổng</th><th class="n">xvfb MB</th><th class="n">chrome MB</th><th class="n">vnc MB</th><th class="n">tiến trình</th><th>khung</th><th>hồ sơ</th></tr>
    ${rows || '<tr><td colspan="8" class="s">không thấy màn hình nào</td></tr>'}
  </table>
</section>

<section>
  <table>
    <caption>Hồ sơ Chrome, nặng nhất trước</caption>
    <tr><th class="n">RAM</th><th class="n">tiến trình</th><th>display</th><th>hồ sơ</th></tr>
    ${profs || '<tr><td colspan="4" class="s">không thấy Chrome nào</td></tr>'}
  </table>
</section>

<section>
  <table>
    <caption>Đội máy — bản mỗi máy khai ở lượt hỏi feed GẦN NHẤT</caption>
    <tr><th>dấu vết máy</th><th>bản khai</th><th>hỏi lần cuối (UTC)</th><th class="n">mã</th><th>bản đang phát</th></tr>
    ${doiMayRows(p) || `<tr><td colspan="5" class="s">chưa launcher nào hỏi feed từ khi sổ bật${p.doiMay.khongPhaiLauncher ? ` — nhưng sổ CÓ ${p.doiMay.khongPhaiLauncher} hàng không phải launcher, nên bộ ghi đang chạy` : ""}</td></tr>`}
  </table>
</section>

${whyReadOnly(p)}</div>
<script>setTimeout(function(){location.reload()},15000)</script>`;
}

/**
 * Cho phép `?token=` trên riêng khu /admin.
 *
 * Trình duyệt không gửi được `Authorization` khi người ta chỉ dán một địa chỉ, nên ở chế độ
 * `enforce` trang này sẽ 401 cho đúng người cần nó nhất. Máy chủ chỉ nghe 127.0.0.1 nên bí mật
 * không ra khỏi máy; nó vẫn nằm trong lịch sử trình duyệt, và đó là cái giá đã biết.
 */
const allowed = (url: string, headers: Record<string, unknown>): boolean => {
  const verdict = checkAuth(url, headers);
  noteAuth(url, verdict);
  if (verdict.allow) return true;
  const token = new URL(url, "http://x").searchParams.get("token") ?? "";
  return token !== "" && token === expectedToken();
};

/** Trả về true nếu đã xử lý. Gọi trước router /gw. */
export async function handleAdmin(
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const path = url.split("?")[0];
  if (path !== "/admin" && path !== "/admin/api/resources") return false;

  const headers = req.headers as unknown as Record<string, unknown>;
  if (!allowed(url, headers)) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("cần token: /admin?token=<nội dung services/grokbot-backend/.data/gateway-token.txt>");
    return true;
  }

  const p = await payload();
  if (path === "/admin/api/resources") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(p));
    return true;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page(p));
  return true;
}
