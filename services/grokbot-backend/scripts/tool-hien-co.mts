/**
 * Xuất TOÀN BỘ tool bot đang có — lấy lúc CHẠY — kèm thứ mỗi nhóm phụ thuộc, và DÒ xem thứ đó còn
 * sống không.
 *
 *   npx tsx --env-file=.env services/grokbot-backend/scripts/tool-hien-co.mts
 *
 * Vì sao không grep tĩnh: nhóm `browser_*` và các tool box được nạp vào `TOOLS` bằng vòng lặp ở
 * mức module (`for (const name of BROWSER_TOOL_NAMES) TOOLS[name] = …`), nên bảng dựng bằng grep
 * thiếu đúng nhóm hay hỏng nhất — mà "thiếu trong bảng" trông y hệt "không tồn tại".
 *
 * Cột PHỤ THUỘC là phần đáng giá: một tool không tự hỏng, nó hỏng vì thứ nó dựa vào. Ngày 03/09
 * `browser_*` báo "fetch failed" không phải vì code sai mà vì hầm ssh tới cổng CDP đã chết — triệu
 * chứng lộ ra ở chỗ xa nhất khỏi nguyên nhân.
 *
 * Một chỗ KHÔNG được đọc trong tiến trình này: danh sách máy người dùng. Hàng đợi local-exec nằm
 * trong bộ nhớ TIẾN TRÌNH SERVER, nên `connectedMachines()` gọi từ script rời luôn trả rỗng và
 * script sẽ báo "không máy nào nối" cho một máy đang nối. Phải hỏi server đang chạy — và hỏi bằng
 * một tên máy KHÔNG tồn tại, vì nhánh 404 in ra danh sách máy mà không chạy lệnh nào.
 */
import { BROWSER_TOOL_NAMES, isBrowserConfigured } from "../src/browser.js";
import { boxHealth, boxConfigured } from "../src/box-exec.js";

const { TOOLS } = (await import("../src/runtime/tools.js")) as unknown as { TOOLS: Record<string, unknown> };

/** Nhóm theo NGUỒN HỎNG, không theo chức năng — vì đó là thứ quyết định cả nhóm sống hay chết cùng nhau. */
const NHOM: { ten: string; can: string; khop: (t: string) => boolean }[] = [
  { ten: "Trình duyệt bot lái", can: "CDP qua hầm ssh — GROKBOT2_BROWSER_CDP", khop: (t) => t.startsWith("browser_") },
  { ten: "Máy tính THẬT của người dùng", can: "app Grok Bot đang mở trên máy đó", khop: (t) => t.startsWith("local_") },
  { ten: "Box Linux — file & shell", can: "box daemon", khop: (t) => /^(read_file|edit_file|list_dir|glob_file|ripgrep|run_terminal|children_files|delete_file)/.test(t) },
  { ten: "Web", can: "mạng ra ngoài", khop: (t) => t === "web_search" || t === "web_fetch" },
  { ten: "MCP", can: "server MCP đã cấu hình", khop: (t) => t.includes("mcp") },
  { ten: "Trong backend — không phụ thuộc gì bên ngoài", can: "—", khop: () => true },
];

const ten = Object.keys(TOOLS).sort();
const daXep = new Set<string>();
console.log(`# TOOL BOT ĐANG CÓ — ${ten.length} cái\n`);
for (const n of NHOM) {
  const ds = ten.filter((t) => !daXep.has(t) && n.khop(t));
  ds.forEach((t) => daXep.add(t));
  if (!ds.length) continue;
  console.log(`## ${n.ten} — ${ds.length}${n.can === "—" ? "" : `  (cần: ${n.can})`}`);
  console.log(`   ${ds.join(", ")}\n`);
}

// ── phụ thuộc — sống hay chết NGAY BÂY GIỜ ─────────────────────────────────────────────────────
const BFF = process.env.GROKBOT2_BFF ?? "http://127.0.0.1:8788";
const cdp = process.env.GROKBOT2_BROWSER_CDP ?? "http://127.0.0.1:9224";

const thu = async (u: string, init?: RequestInit): Promise<{ ma: number; than: string }> => {
  try {
    const r = await fetch(u, { ...init, signal: AbortSignal.timeout(8000) });
    return { ma: r.status, than: (await r.text()).slice(0, 200) };
  } catch (e) {
    return { ma: 0, than: e instanceof Error ? e.message : String(e) };
  }
};

console.log("# PHỤ THUỘC — dò thật, ngay bây giờ\n");

const td = await thu(`${cdp}/json/version`);
console.log(`  trình duyệt bot  : ${td.ma === 200 ? "SỐNG" : `CHẾT (${td.than})`}  ${cdp}`);

/*
 * `boxHealth()` KHÔNG bao giờ ném — hỏng thì nó TRẢ VỀ chuỗi lỗi. Cùng họ với `callPool` trong
 * bảng bẫy: bọc try/catch quanh nó là bắt một thứ không tồn tại, và bản đầu của script này in
 * "SỐNG" đè lên đúng câu "KHÔNG tới được". Phải đọc CHUỖI.
 *
 * Và owner: box chạy chế độ tách người dùng, nên nó ghép `x-grokbot2-owner` → tài khoản OS. Sai
 * khoá owner thì câu trả lời là "pool exhausted" — nghe hệt một sự cố hạ tầng, thật ra là mình
 * hỏi nhầm tên. Đã dính thật ngày 03/09. `boxHealth()` tự lấy `currentOwner()` nên gọi qua nó
 * mới đúng khoá.
 */
const box = boxConfigured() ? await boxHealth() : "chưa cấu hình";
const boxSong = /\bOK\b/.test(box);
console.log(`  box              : ${boxSong ? "SỐNG" : "HỎNG"} — ${box.replace(/\n[\s\S]*/, "")}`);

// Tên máy không tồn tại ⇒ server trả 404 KÈM danh sách máy, và không chạy lệnh nào.
const may = await thu(`${BFF}/internal/ops/local-exec`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ kind: "ls", path: ".", may: "__probe__" }),
});
const dsMay = /Đang nối: (.*)"/.exec(may.than)?.[1];
console.log(`  máy người dùng   : ${may.ma === 404 ? `nối — ${dsMay ?? "?"}` : may.ma === 409 ? "KHÔNG máy nào nối (app chưa mở?)" : `không hỏi được server (${may.ma} ${may.than.slice(0, 80)})`}`);
console.log(`  backend :8788    : ${(await thu(`${BFF}/health`)).ma === 200 ? "SỐNG" : "CHẾT"}`);
console.log(`\n  isBrowserConfigured=${isBrowserConfigured()} · BROWSER_TOOL_NAMES=${BROWSER_TOOL_NAMES.length}`);

if (td.ma !== 200) {
  console.log(`\n⚠ Trình duyệt CHẾT ⇒ cả ${ten.filter((t) => t.startsWith("browser_")).length} tool nhóm 1 sẽ báo "fetch failed".`);
  console.log("  Lên lại hầm: powershell -File infra\\scripts\\box-tunnel.ps1");
}
