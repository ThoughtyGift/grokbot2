/**
 * Đo trạng thái hệ thống trong MỘT lượt — nguồn số cho `docs/TRANG-THAI.md`.
 *
 *   node services/grokbot-backend/scripts/trang-thai.mjs
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * Trạng thái đang nằm ở ba tài liệu (`bang-theo-doi.md` 1245 dòng, `system-xray.md` 561,
 * `con-thieu-so-voi-0-30.md` 107), đo vào ba ngày khác nhau cuối tháng 8. Ba nguồn sự thật thì
 * luôn có ít nhất hai cái sai, và không ai biết cái nào — chính `bang-theo-doi.md` đã phải tự ghi
 * "bản trước ghi ngày 25–26/08 và đã lệch khá xa".
 *
 * Nên tách phần ĐO ra khỏi phần VIẾT: script này in số, tài liệu kể chuyện. Số cũ sai thì chạy lại
 * một lệnh, không phải sửa tay ba file.
 *
 * Chỉ đọc: không gọi lệnh nào đổi trạng thái, không cần app đang mở. Phần nào không đo được thì
 * nói thẳng là không đo được, chứ không bỏ trống cho người đọc tự suy.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const doc = (p) => readFileSync(join(REPO, p), "utf8");
const jsonCua = (p) => JSON.parse(doc(p));

const ra = [];
const in_ = (s = "") => { ra.push(s); console.log(s); };

// ── 1. Lệnh gateway: hợp đồng vs bảng của mình ──────────────────────────────────────────────────
const hd = jsonCua("docs/extracted/gateway-commands.json");
const tenHopDong = hd.commands.map((c) => c.name);
const nguon = doc("packages/cursor-acl/src/commands.ts");
const coHandler = new Set([...nguon.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));
const thieu = tenHopDong.filter((t) => !coHandler.has(t));

in_(`## Lệnh gateway (hợp đồng ${hd.appVersion})`);
in_(`hợp đồng: ${tenHopDong.length} · backend có handler: ${coHandler.size} · THIẾU: ${thieu.length}`);

// Lệnh thiếu nào bị cờ tính năng chắn — nếu tìm được bundle đang cài.
const CAI = process.env.GROKBOT2_CLIENT_DIR ?? "C:/cai029";
const mainCjs = join(CAI, "resources/app/dist/electron-main/main.cjs");
const rendDir = join(CAI, "resources/app/dist/renderer/assets");
let main = "", rend = "";
try {
  main = readFileSync(mainCjs, "utf8");
  const f = readdirSync(rendDir).find((x) => /^index-.*\.js$/.test(x));
  if (f) rend = readFileSync(join(rendDir, f), "utf8");
} catch { /* không có bản cài ở đây — phần dưới sẽ nói rõ */ }

if (main) {
  const co = (ten) => {
    const m = main.match(new RegExp(ten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\{client:!\\d,default:(!\\d)\\}"));
    return m ? (m[1] === "!0" ? "BẬT" : "TẮT") : "?";
  };
  in_("");
  in_("cờ tính năng ở client:");
  for (const c of ["grok_bot_multiplayer", "sand_voice_call", "sand_multi_machine_local_exec", "sand_share_bot", "sand_channels", "agent_prompted_cookie_sync"]) {
    in_(`  ${c.padEnd(32)} ${co(c)}`);
  }
  in_("");
  in_("lệnh còn thiếu — client có gọi được không:");
  for (const t of thieu) {
    const r = rend ? rend.split(t).length - 1 : -1;
    const m = main.split(t).length - 1;
    const ghi = r === 0 && m === 0 ? "KHÔNG có trong bundle 0.29 (chỉ ở hợp đồng 0.30)"
      : r > 0 ? `renderer nhắc ${r}×` : `chỉ main nhắc ${m}×`;
    in_(`  ${t.padEnd(34)} ${ghi}`);
  }
} else {
  in_(`\n(không đọc được bundle ở ${CAI} — bỏ phần cờ tính năng; đặt GROKBOT2_CLIENT_DIR để đo)`);
}

// ── 2. Client thực sự gọi gì, và có gì 404 không ────────────────────────────────────────────────
in_("");
in_("## Client thực sự gọi gì");
const cp = "services/grokbot-backend/.data/coverage.json";
if (existsSync(join(REPO, cp))) {
  const cov = jsonCua(cp);
  const goi = Object.keys(cov.calls ?? {});
  const la = Object.entries(cov.unknownPaths ?? {}).filter(([k]) => !/not-a-real-route|favicon/.test(k));
  in_(`đã gọi ${goi.length} lệnh · đường KHÔNG có handler: ${la.length}`);
  for (const [k, v] of la) in_(`  ${v.n}× ${k} → ${v.answered}`);
  const top = Object.entries(cov.calls ?? {}).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  in_("gọi nhiều nhất: " + top.map(([k, v]) => `${k} ${v.n}×`).join(" · "));
} else {
  in_("(chưa có coverage.json — chạy app một lượt rồi đo lại)");
}

// ── 3. Test và kích thước ───────────────────────────────────────────────────────────────────────
in_("");
in_("## Mã và test");
const dem = (thuMuc, loc) => {
  let n = 0;
  const di = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) di(p); else if (loc(e.name)) n++;
    }
  };
  di(join(REPO, thuMuc));
  return n;
};
in_(`file test: ${dem("services/grokbot-backend/src", (n) => n.endsWith(".test.ts"))} · file nguồn: ${dem("services/grokbot-backend/src", (n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))}`);
in_("(số bài test: chạy `npx tsx --test \"services/grokbot-backend/src/**/*.test.ts\"`)");

// ── 4. Parity ───────────────────────────────────────────────────────────────────────────────────
in_("");
in_("## Parity với app gốc");
try {
  const ds = readdirSync(join(REPO, "docs/parity-runs")).filter((f) => /^app-replay-.*\.md$/.test(f)).sort();
  in_(`bản ghi lượt phát lại: ${ds.length} · mới nhất: ${ds[ds.length - 1] ?? "(chưa có)"}`);
} catch { in_("(chưa có docs/parity-runs)"); }
try {
  const ph = jsonCua("docs/parity-runs/phase-current.json");
  in_(`phase hiện tại: ${ph.phase} · lần gate gần nhất: ${ph.lastGatePass ? "ĐẠT" : "chưa đạt"}`);
} catch { /* không bắt buộc */ }
