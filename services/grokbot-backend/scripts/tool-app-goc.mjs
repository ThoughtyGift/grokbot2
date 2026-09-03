/**
 * Tool app GỐC đã THẬT SỰ gọi — đếm từ transcript trong cache client, không đoán từ enum.
 *
 *   node services/grokbot-backend/scripts/tool-app-goc.mjs [--dir <persistence>]
 *
 * Vì sao không đọc enum `ClientSideToolV2` (55 tên) trong `main.cjs`: đó là enum của Cursor IDE và
 * nó khai cả `go_to_definition`, `fix_lints`, `fetch_pull_request` — thứ chỉ có nghĩa trong trình
 * soạn mã. Kiểm lại thì renderer 0.30 **không chứa enum ấy một lần nào**: client không quyết định
 * danh sách tool, nó chỉ VẼ những `tool-call` máy chủ hãng gửi xuống. Nên "app gốc có tool gì" chỉ
 * trả lời được bằng chỗ ĐỌC — và chỗ đọc là transcript thật.
 *
 * Cùng một họ bẫy với `generation`/`is_fork`: tên nằm trong hợp đồng không nói ai dùng nó.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SRC = argOf("--dir", join(process.env.APPDATA ?? "", "Grok Bot", "sand-client-persistence"));

const PREFIX = String.fromCharCode(92, 92, 63, 92); // \\?\ — tên blob dài hơn MAX_PATH
const long = (p) => (process.platform === "win32" && !p.startsWith(PREFIX) ? PREFIX + p.replace(/\//g, String.fromCharCode(92)) : p);

function decodeName(stem) {
  const abc = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, acc = 0; const out = [];
  for (const ch of stem) {
    const v = abc.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Buffer.from(out).toString("utf8");
}

/** Đi khắp cây JSON, nhặt mọi node có kind==="tool-call". Shape lồng nhau nên không giả định độ sâu. */
function nhatToolCall(node, thu) {
  if (Array.isArray(node)) { for (const x of node) nhatToolCall(x, thu); return; }
  if (!node || typeof node !== "object") return;
  if (node.kind === "tool-call" && typeof node.name === "string") {
    const t = thu.get(node.name) ?? { n: 0, trangThai: new Set(), viDu: "" };
    t.n += 1;
    if (node.status) t.trangThai.add(String(node.status));
    if (!t.viDu && node.summary) t.viDu = String(node.summary).slice(0, 70);
    thu.set(node.name, t);
  }
  for (const v of Object.values(node)) nhatToolCall(v, thu);
}

let soFile = 0, soTranscript = 0;
const thu = new Map();
for (const f of readdirSync(long(SRC))) {
  if (!f.endsWith(".blob")) continue;
  const key = decodeName(f.slice(0, -5));
  if (!key?.includes("transcript")) continue;
  soFile += 1;
  try { nhatToolCall(JSON.parse(readFileSync(long(join(SRC, f)), "utf8")), thu); soTranscript += 1; }
  catch (e) { console.warn(`bỏ qua ${key}: ${e.message}`); }
}

const ds = [...thu.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`# TOOL APP GỐC ĐÃ GỌI THẬT — ${ds.length} tên, từ ${soTranscript}/${soFile} transcript\n`);
if (!ds.length) {
  console.log("(không có tool-call nào trong cache — cache có thể đã bị dọn, hoặc bot chưa chạy lượt nào)");
} else {
  for (const [ten, t] of ds) {
    console.log(`  ${String(t.n).padStart(4)}×  ${ten.padEnd(28)} ${[...t.trangThai].join("/")}  ${t.viDu}`);
  }
}
console.log(`\nJSON: ${JSON.stringify(ds.map(([t]) => t))}`);
