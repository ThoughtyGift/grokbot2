/**
 * Trích hợp đồng host từ client 0.29/0.30 — đường dẫn HTTP và tên kênh SSE.
 *
 *   node services/grokbot-backend/scripts/extract-host-0-30.mjs --dist <thư mục dist đã giải nén>
 *   node services/grokbot-backend/scripts/extract-host-0-30.mjs --asar "C:/Program Files/Grok Bot/resources/app.asar"
 *
 * ── Vì sao phải viết lại thay vì chạy bộ trích cũ ───────────────────────────────────────────────
 *
 * `box-host-contract.json` bóc từ `dist/host/host-main.cjs` của 0.20 — 13 MB chứa cả bộ định tuyến
 * của host. Từ 0.29 hãng **bỏ hẳn** thư mục đó: host chạy trên máy của họ, không đóng gói nữa. Nên
 * không còn bộ định tuyến nào để đọc, và mọi thứ suy ra từ nó (mã trạng thái từng nhánh, chữ trong
 * thân 401) là thứ 0.30 không nói gì cả.
 *
 * Cái CÒN đọc được, và cũng là cái thật sự ràng buộc ta: những đường dẫn client GỌI, và những tên
 * kênh client CHẤP NHẬN. Ta chính là host, nên phần còn lại là lựa chọn của ta chứ không phải hợp
 * đồng — miễn là đúng đường và đúng tên.
 *
 * ── Vì sao nhóm `auth` không tái trích được, và vì sao thế là đủ ────────────────────────────────
 *
 * Đo trong `node-agent-coordinator`: client ánh xạ mã trạng thái sang lỗi và DỪNG ở đó —
 * `case 401: return D.Unauthenticated`, `t===401||t===403 -> "access_denied"`. Không chỗ nào đọc
 * thân phản hồi 401. Ba chuỗi trong `auth401` của 0.20 là lời của HOST, không phải thứ client kiểm.
 * Nên bài chấm `auth` giữ nguyên hợp đồng 0.20 là đúng, không phải bỏ sót: cái đáng chấm là
 * ĐƯỜNG NÀO trả 401, và đường thì bảng dưới đây có.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const argv = process.argv.slice(2);
const arg = (t) => { const i = argv.indexOf(t); return i >= 0 ? argv[i + 1] : undefined; };

const chet = (m) => { console.error(`DỪNG: ${m}`); process.exit(1); };

/** Thư mục `dist` của bundle. `--asar` thì giải nén ra thư mục TẠM — không bao giờ ra thư mục hiện tại. */
async function timDist() {
  const dist = arg("--dist");
  if (dist) {
    if (!existsSync(dist)) chet(`không thấy --dist ${dist}`);
    return dist;
  }
  const asar = arg("--asar") ?? "C:/Program Files/Grok Bot/resources/app.asar";
  if (!existsSync(asar)) {
    chet(`không thấy app.asar ở "${asar}". Đưa --dist <thư mục đã giải nén> hoặc --asar <đường dẫn>.`);
  }
  // `extractAll` nhận thư mục đích. KHÔNG dùng `extractFile`: nó ghi ra CWD, và đúng cái đó đã đè
  // mất `package.json` gốc của repo một lần rồi.
  const mod = await import("@electron/asar").catch(() => chet("thiếu @electron/asar — cài rồi chạy lại, hoặc dùng --dist"));
  const ra = mkdtempSync(join(tmpdir(), "grokbot-asar-"));
  mod.extractAll(asar, ra);
  const d = join(ra, "dist");
  if (!existsSync(d)) chet(`giải nén xong nhưng không có thư mục dist trong ${ra}`);
  console.log(`giải nén ${asar} -> ${ra}`);
  return d;
}

const doc = (dist, ten) => {
  const p = join(dist, ten, "main.cjs");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

/**
 * Cắt một object literal quanh vị trí đã biết, rồi đọc nó.
 *
 * Không dùng regex một phát: object này lồng chuỗi có dấu ngoặc, nên phải đếm ngoặc. Và khoá trong
 * bundle nửa có nháy nửa không, nên thêm một bước vá khoá trước khi parse.
 */
function docObject(s, viTri) {
  let dau = viTri;
  while (dau >= 0 && s[dau] !== "{") dau -= 1;
  if (dau < 0) return null;
  let sau = 0, i = dau, trongChuoi = null;
  for (; i < s.length; i += 1) {
    const c = s[i];
    if (trongChuoi) { if (c === "\\") i += 1; else if (c === trongChuoi) trongChuoi = null; continue; }
    if (c === '"' || c === "'" || c === "`") { trongChuoi = c; continue; }
    if (c === "{") sau += 1;
    else if (c === "}") { sau -= 1; if (!sau) break; }
  }
  const tho = s.slice(dau, i + 1);
  const vaKhoa = tho
    .replace(/\.\.\.\w+\s*,?/g, "")                       // bỏ spread, giải riêng
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, "}");
  try { return JSON.parse(vaKhoa); } catch { return null; }
}

const dist = await timDist();
const coordinator = doc(dist, "node-agent-coordinator");
const daemon = doc(dist, "local-exec-daemon");
const main = doc(dist, "electron-main");
if (!coordinator) chet("không đọc được dist/node-agent-coordinator/main.cjs — bundle này có phải 0.29+ không?");

// ── kênh SSE ────────────────────────────────────────────────────────────────────────────────────
//
// Bảng nằm ở dạng `{...kw, transcript:"transcript", agents:"agents", …}` với `kw` là bảng bí danh
// `{"agents-workflow":"workflows", …}`. Neo vào `transcript:"transcript"` vì đó là cặp duy nhất
// chắc chắn có và chắc chắn thuộc bảng chính — cùng cái neo bộ trích 0.20 đã dùng.
const neoKenh = coordinator.search(/transcript\s*:\s*"transcript"/);
if (neoKenh < 0) chet('không thấy neo `transcript:"transcript"` — bảng kênh đã đổi hình dạng');
const bangChinh = docObject(coordinator, neoKenh);
if (!bangChinh) chet("thấy neo nhưng không đọc nổi bảng kênh");

const neoAlias = coordinator.search(/"agents-workflow"\s*:\s*"workflows"/);
const bangAlias = neoAlias >= 0 ? docObject(coordinator, neoAlias) : {};

// Bí danh là cặp khoá≠giá trị; kênh thật là tập các GIÁ TRỊ.
const aliases = { ...bangAlias };
for (const [k, v] of Object.entries(bangChinh)) if (k !== v) aliases[k] = v;
const channels = [...new Set([...Object.values(bangChinh), ...Object.values(aliases)])].sort();

// ── đường dẫn HTTP ──────────────────────────────────────────────────────────────────────────────
//
// Lọc bỏ đường của HỆ ĐIỀU HÀNH: các nhị phân này có `/usr/lib`, `/private/etc/hosts`… lẫn trong
// mã dò môi trường, và chúng không phải route.
const RAC = /^\/(usr|etc|tmp|var|proc|dev|bin|sbin|opt|home|root|lib|lib64|System|Library|private|node_modules|Users)\b/;
const duongDan = (s) => {
  if (!s) return [];
  const set = new Set();
  for (const m of s.matchAll(/["'`](\/[a-z0-9][a-z0-9/_.-]{2,60})["'`]/gi)) {
    const p = m[1];
    if (RAC.test(p) || /\.(js|cjs|mjs|ts|json|png|svg|css|node|zip)$/.test(p)) continue;
    set.add(p);
  }
  return [...set].sort();
};

/**
 * Đường nào trong đám trên thật sự là ROUTE CỦA BOX — tức thứ backend ta phải phục vụ.
 *
 * Phân loại là một phán đoán, nên mỗi dòng kèm bằng chứng đọc được trong bundle. Không có nó thì
 * lần sau ai đó lại phải bóc lại từ đầu để biết vì sao `/cancel` không nằm trong danh sách.
 */
const BOX_ROUTES = [
  { path: "/api", box: true, bang: "tiền tố lệnh gateway — `/api/<tên lệnh>`" },
  { path: "/events", box: true, bang: "luồng SSE" },
  { path: "/health", box: true, bang: "thăm dò sức khoẻ" },
  { path: "/webauthn/requests", box: true, bang: 'hằng số `ly="/webauthn/requests"` cạnh bộ đọc khung ceremony' },
  { path: "/webauthn/responses", box: true, bang: 'hằng số `dy="/webauthn/responses"`' },
  { path: "/cookie-origin-approval/requests", box: true, bang: 'hằng số `yp=` cạnh "Chrome cookie approval could not be completed on this computer." — MỚI ở 0.29' },
  { path: "/cookie-origin-approval/responses", box: true, bang: "hằng số `gp=`, cùng cặp với trên" },
  { path: "/local-exec/requests", box: true, bang: "trong local-exec-daemon; đường hầm ngược về box" },
  { path: "/local-exec/responses", box: true, bang: "cùng cặp" },
  { path: "/cancel", box: false, bang: 'máy chủ loopback OAuth của chính client: `bE="/cancel"` cạnh "OAuth login superseded by a newer attempt" và content-type text/html' },
  { path: "/oauth/return", box: false, bang: "cũng là loopback OAuth trên máy người dùng" },
  { path: "/vnc.html", box: false, bang: "trang của máy chủ VNC trên box, không phải gateway của ta" },
  { path: "/mcps", box: false, bang: "nội bộ local-exec-daemon" },
  { path: "/mcps/", box: false, bang: "cùng cái trên, dạng có gạch cuối khi ghép chuỗi" },
  { path: "/properties", box: false, bang: "nội bộ local-exec-daemon" },
  { path: "/dup", box: false, bang: "nội bộ local-exec-daemon, không phải route HTTP" },
  {
    path: "/sand-box/local-exec-connection",
    box: false,
    bang: "tiền tố `/sand-box/` là MÁY CHỦ CỦA HÃNG, không phải box — cùng họ với "
      + "`/sand-box/local-exec-daemon-credential` trong electron-main, nơi client xin giấy phép cho daemon",
  },
];

/** Tập đường thật sự xuất hiện trong bundle này — để bảng phân loại không hứa thứ đã biến mất. */
const coThat = new Set([...duongDan(coordinator), ...duongDan(daemon)]);

const contract = {
  extractedFrom: "dist/{node-agent-coordinator,local-exec-daemon,electron-main}/main.cjs",
  appVersion: JSON.parse(readFileSync(join(dist, "..", "package.json"), "utf8")).version ?? "?",
  note: "Host không còn được đóng gói từ 0.29. Đây là hợp đồng PHÍA GỌI: đường client gọi và tên kênh client nhận.",
  anchors: { channels: 'transcript:"transcript"', aliases: '"agents-workflow":"workflows"' },
  channels,
  channelAliases: aliases,
  // Chỉ những đường CÓ THẬT trong bundle này mới được liệt kê: bảng phân loại ở trên là kiến thức
  // cố định, còn phiên bản thì đổi. Một đường biến mất (như `/prepare-upgrade` của 0.20) phải biến
  // mất khỏi đây luôn, chứ không nằm lại thành một lời hứa đã hết hạn.
  boxRoutes: BOX_ROUTES.filter((r) => coThat.has(r.path)),
  boxRoutesKhongPhaiCuaTa: BOX_ROUTES.filter((r) => !r.box && coThat.has(r.path)),
  duongLa: [...coThat].filter((p) => !BOX_ROUTES.some((r) => r.path === p)).sort(),
  paths: {
    coordinator: duongDan(coordinator),
    localExecDaemon: duongDan(daemon),
    electronMain: duongDan(main),
  },
  auth: {
    khongTaiTrichDuoc: true,
    lyDo: "client ánh xạ 401/403 sang lỗi bằng MÃ TRẠNG THÁI (case 401: D.Unauthenticated) và không đọc thân; chuỗi trong auth401 của 0.20 là lời của host, không phải thứ client kiểm.",
  },
};

const ra = join(REPO, "docs", "extracted", "host-contract-0-30.json");
writeFileSync(ra, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
console.log(`\nphiên bản: ${contract.appVersion}`);
console.log(`kênh: ${channels.length} · bí danh: ${Object.keys(aliases).length}`);
console.log(`đường dẫn: coordinator ${contract.paths.coordinator.length} · daemon ${contract.paths.localExecDaemon.length} · main ${contract.paths.electronMain.length}`);
console.log(`route của box: ${contract.boxRoutes.filter((r) => r.box).length} · không phải của ta: ${contract.boxRoutesKhongPhaiCuaTa.length}`);
if (contract.duongLa.length) console.log(`đường CHƯA PHÂN LOẠI (đọc rồi thêm vào BOX_ROUTES): ${contract.duongLa.join(", ")}`);
console.log(`đã ghi ${ra}`);
