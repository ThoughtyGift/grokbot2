/**
 * Trang đích của link chia sẻ mẫu bot — `/bot/<shareId>`.
 *
 * Đo trên app gốc 0.43 (05/09): nút "Copy link" chép `shareUrl` mà backend trả, và link ấy trỏ về
 * `https://x.ai/bot/<shareId>` — một trang web tĩnh: avatar · "<tên> by <người tạo>" · mô tả · dòng miễn trừ
 * "created by a third-party user…" · nút **Add to Grok Bot** là thẻ `<a href="grokbot://app/v1/bot-template?id=…">`
 * · trang tự mở deep link khi nạp ("Opening Grok Bot…") · og:title/og:description để dán vào chat có thẻ xem trước.
 *
 * Bên ta `shareUrlOf()` (bot-templates.ts) đã trỏ về `<GROKBOT2_PUBLIC_SITE>/bot/<shareId>` — trang này là đầu bên kia
 * của link đó, cùng khung với trang tải (`site.ts`): **công khai, không qua `checkAuth`**, vì người nhận link là người
 * CHƯA có gì. Nó chỉ phơi những gì `getPublicBotTemplate` đã cho phép phơi (mẫu đã xuất bản, tầm nhìn public), và chỉ
 * phần hồ sơ — không có nội dung skill/routine/memory, chỉ có số đếm, đúng như hộp View Details của client.
 *
 * Deep link: `Si={schemes:["grokbot","sand"],authority:"app",path:"/v1/bot-template"}` trích từ `main-core.cjs` 0.43;
 * client nhận `?id=` rồi gọi `getPublicBotTemplate{shareId}` về backend của nó → hộp Import. Trên máy có cả app hãng
 * lẫn bản local, scheme `grokbot://` thuộc về bản **mở sau cùng** (đo 05/09: `HKCU\Software\Classes\grokbot` trỏ
 * `C:\cai043\Grok Bot.exe` sau khi mở bản 0.43 local) — không có cách nào từ trang web chọn được app nào sẽ mở.
 *
 * Mọi chuỗi từ kho (tên, mô tả, người tạo) đi qua `thoat()` trước khi vào HTML; script/style nội tuyến gắn nonce
 * và CSP chỉ cho đúng nonce ấy — trang này là chỗ duy nhất của backend in nội dung người dùng khác viết ra HTML.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { getPublicBotTemplate, SHARE_ID_RE, shareUrlOf, toWireView } from "./bot-templates.js";

/** `Si.path` + `Si.authority` của main-core 0.43 — scheme thứ nhất trong `Si.schemes`. */
export const deepLinkOf = (shareId: string): string => `grokbot://app/v1/bot-template?id=${encodeURIComponent(shareId)}`;

const thoat = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Mô tả cho thẻ og: một dòng, cắt ở ~160 ký tự như trang hãng ("…"). */
const tomTat = (s: string, max = 160): string => {
  const mot = s.replace(/\s+/g, " ").trim();
  return mot.length <= max ? mot : `${mot.slice(0, max - 1).trimEnd()}…`;
};

/** Màu avatar — 11 giá trị của bảng `EB` renderer 0.43, tô gần với app. */
const MAU: Record<string, string> = {
  black: "#2b2b2e", brown: "#8b5a2b", red: "#e5484d", orange: "#f76b15", yellow: "#f5d90a", green: "#30a46c",
  cyan: "#05a2c2", blue: "#3e63dd", violet: "#6e56cf", magenta: "#d6409f", gray: "#8b8d98",
};
/** Hình avatar — 18 giá trị của bảng `SB`, vẽ bằng border-radius/clip-path cho nhẹ (không cần ảnh). */
const HINH: Record<string, string> = {
  blob: "border-radius:60% 40% 55% 45% / 50% 60% 40% 50%", pebble: "border-radius:55% 45% 50% 50% / 45% 55% 45% 55%",
  bean: "border-radius:70% 30% 30% 70% / 60% 40% 60% 40%", egg: "border-radius:50% 50% 50% 50% / 60% 60% 40% 40%",
  squircle: "border-radius:30%", tablet: "border-radius:22%", capsule: "border-radius:50% / 30%", cylinder: "border-radius:50% / 18%",
  hex: "clip-path:polygon(25% 4%,75% 4%,98% 50%,75% 96%,25% 96%,2% 50%)", gem: "clip-path:polygon(50% 0,100% 36%,80% 100%,20% 100%,0 36%)",
  crystal: "clip-path:polygon(50% 0,90% 26%,80% 100%,20% 100%,10% 26%)", wedge: "clip-path:polygon(0 100%,100% 100%,100% 0)",
  shield: "clip-path:polygon(50% 0,100% 16%,92% 70%,50% 100%,8% 70%,0 16%)", dome: "border-radius:50% 50% 8% 8% / 100% 100% 8% 8%",
  arch: "border-radius:50% 50% 0 0 / 60% 60% 0 0", cloud: "border-radius:50% 50% 45% 45% / 55% 55% 45% 45%",
  teardrop: "border-radius:0 50% 50% 50%", leaf: "border-radius:0 50% 0 50%",
};

const CSS = `
:root{--ink:#e8e6e1;--ink-dim:#9a978f;--ink-faint:#6b6862;--bg:#0b0b0c;--bg-2:#121214;--line:#26262a;--hot:#ff6a3d;--cool:#7dd3c0;
--sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);min-height:100vh;display:grid;place-items:center;padding:32px 16px}
main{width:100%;max-width:440px;text-align:center}
.avatar{width:104px;height:104px;margin:0 auto 22px;box-shadow:0 18px 44px -18px rgba(0,0,0,.9)}
h1{font-size:26px;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em;text-wrap:balance}
.by{color:var(--ink-dim);margin:0 0 18px}.by b{color:var(--ink);font-weight:500}
.desc{color:var(--ink);text-align:left;background:var(--bg-2);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto}
.counts{display:flex;justify-content:center;gap:14px;color:var(--ink-dim);font-size:13px;margin:0 0 22px;font-variant-numeric:tabular-nums}
.counts b{color:var(--ink);font-weight:600}
.warn{font-size:12.5px;color:var(--ink-faint);margin:0 0 18px;text-wrap:balance}.warn a{color:var(--ink-dim)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 26px;border-radius:999px;background:var(--hot);color:#160b07;font-weight:600;text-decoration:none;transition:transform .12s,filter .12s}
.btn:hover{filter:brightness(1.06)}.btn:active{transform:scale(.98)}.btn:focus-visible{outline:2px solid var(--cool);outline-offset:3px}
.open{color:var(--ink-dim);font-size:13px;margin:14px 0 0;min-height:1.4em}
.dl{margin:26px 0 0;font-size:13px;color:var(--ink-faint)}.dl a{color:var(--cool)}
.code{font:12px var(--mono);color:var(--ink-faint);margin-top:34px;overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.btn{transition:none}}
`;

interface HoSoTrang {
  shareId: string; name: string; creatorName: string; description: string; avatarShape: string; avatarColor: string;
  skills: number; routines: number; plugins: number; memory: number;
}

/** Trang đích khi mẫu có thật và công khai. */
function trangMau(h: HoSoTrang, nonce: string): string {
  const link = deepLinkOf(h.shareId);
  const tieuDe = `${h.name} by ${h.creatorName}`;
  const mo = tomTat(h.description || `Mẫu bot ${h.name}.`);
  const dem = [[h.skills, "skills"], [h.routines, "routines"], [h.plugins, "plugins"], [h.memory, "memories"]] as const;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${thoat(tieuDe)}</title>
<meta name="description" content="${thoat(mo)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${thoat(tieuDe)}">
<meta property="og:description" content="${thoat(mo)}">
<meta property="og:url" content="${thoat(shareUrlOf(h.shareId))}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${thoat(tieuDe)}">
<meta name="twitter:description" content="${thoat(mo)}">
<meta name="robots" content="noindex">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main>
  <div class="avatar" role="img" aria-label="Avatar ${thoat(h.name)}" style="background:${MAU[h.avatarColor] ?? MAU.blue};${HINH[h.avatarShape] ?? HINH.blob}"></div>
  <h1>${thoat(h.name)}</h1>
  <p class="by">by <b>${thoat(h.creatorName)}</b></p>
  ${h.description ? `<div class="desc">${thoat(h.description)}</div>` : ""}
  <p class="counts">${dem.filter(([n]) => n > 0).map(([n, t]) => `<span><b>${n}</b> ${t}</span>`).join("") || "<span>Chỉ hồ sơ, chưa có skill hay routine kèm theo</span>"}</p>
  <p class="warn">Bot này do một người dùng khác tạo, không phải do cinAI. Nó có thể thay bạn hành động trong Grok Bot.
  Bấm "Thêm vào Grok Bot" là bạn nhận trách nhiệm cho việc đó.</p>
  <a class="btn" id="mo" href="${thoat(link)}" rel="noopener">Thêm vào Grok Bot</a>
  <p class="open" id="trangthai" aria-live="polite"></p>
  <p class="dl">Chưa có Grok Bot? <a href="../download/windows">Tải bản Windows</a> rồi mở lại trang này.</p>
  <p class="code">${thoat(h.shareId)}</p>
</main>
<script nonce="${nonce}">
(function(){
  var a=document.getElementById("mo"),t=document.getElementById("trangthai");
  function mo(){t.textContent="Đang mở Grok Bot… Nếu không có gì hiện ra, bấm nút ở trên hoặc tải app.";}
  a.addEventListener("click",function(){mo();});
  setTimeout(function(){mo();try{window.location.href=a.href;}catch(e){}},600);
})();
</script>
</body>
</html>`;
}

/** Trang 404 — nói được ba lý do thật (chưa xuất bản · đã xoá · để riêng) mà không lộ lý do nào đúng. */
function trangKhongCo(nonce: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Không tìm thấy mẫu bot</title><meta name="robots" content="noindex">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main>
  <div class="avatar" style="background:var(--bg-2);border:1px dashed var(--line);${HINH.blob}"></div>
  <h1>Không tìm thấy mẫu bot này</h1>
  <p class="by">Link có thể đã bị người tạo gỡ, chưa được xuất bản, hoặc chỉ chia sẻ trong nhóm.</p>
  <p class="dl"><a href="../">Về trang tải Grok Bot</a></p>
</main>
</body>
</html>`;
}

/** Dựng trang cho một `shareId`; `null` nếu không có mẫu công khai nào mang id ấy. */
export function botLandingHtml(shareId: string, nonce = randomBytes(12).toString("base64")): { code: 200 | 404; html: string } {
  const pub = SHARE_ID_RE.test(shareId) ? getPublicBotTemplate(shareId) : null;
  if (!pub) return { code: 404, html: trangKhongCo(nonce) };
  const v = toWireView(pub.template);
  return {
    code: 200,
    html: trangMau({
      shareId: v.shareId, name: v.name, creatorName: v.creatorName, description: v.description,
      avatarShape: v.avatarShape, avatarColor: v.avatarColor,
      skills: v.skills.length, routines: v.routines.length, plugins: v.plugins.length, memory: v.memory.length,
    }, nonce),
  };
}

/**
 * `/bot/<shareId>` → trang đích. `/bot` trần và mọi đường khác trả `false` để router đi tiếp.
 * Không đọc gì từ đường dẫn ngoài đúng một đoạn id, và id chỉ đi vào kho sau khi qua `SHARE_ID_RE`.
 */
export function handleBotSite(url: string, req: IncomingMessage, res: ServerResponse): boolean {
  const path = url.split("?")[0];
  const m = /^\/bot\/([^/]+)(\/?)$/.exec(path);
  if (!m) return false;
  /*
   * Dạng chuẩn KHÔNG có gạch chéo cuối. Trang dùng link tương đối `../download/windows` để sống được sau mọi tiền tố
   * nginx (`/agent/bot/<id>` → `/agent/download/windows`); có gạch chéo cuối thì `..` chỉ bỏ được đoạn rỗng và link
   * rơi vào `/agent/bot/download/windows` → 404. Đo 06/09 bằng chính bài đo VPS. 301 về dạng chuẩn thay vì vẽ trang sai.
   */
  if (m[2]) {
    // Location TƯƠNG ĐỐI: `/bot/<id>` tuyệt đối sẽ mất tiền tố `/agent` vì `proxy_redirect` của nginx chỉ viết lại URL tuyệt đối.
    res.writeHead(301, { location: `../${encodeURIComponent(m[1])}` });
    res.end();
    return true;
  }
  const nonce = randomBytes(12).toString("base64");
  const { code, html } = botLandingHtml(decodeURIComponent(m[1]), nonce);
  res.writeHead(code, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  res.end(req.method === "HEAD" ? undefined : html);
  return true;
}
