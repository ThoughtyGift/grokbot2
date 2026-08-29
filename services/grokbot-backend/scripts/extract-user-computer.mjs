/**
 * Trích giao thức "máy tính của NGƯỜI DÙNG" (`GrokBotUserComputer`) từ `local-exec-daemon`.
 *
 *   node services/grokbot-backend/scripts/extract-user-computer.mjs [--daemon <main.cjs>]
 *
 * ── Vì sao bóc được, và vì sao đáng bóc ─────────────────────────────────────────────────────────
 *
 * Đây là tính năng cho bot chạy lệnh, đọc tệp và ĐIỀU KHIỂN CHUỘT/BÀN PHÍM trên máy Windows của
 * người dùng — thứ app gốc dùng để lái OBS, vì OBS cài trên máy đó chứ không phải trên box.
 *
 * Daemon là bản build đã minify, NHƯNG nó nhúng nguyên bộ mô tả protobuf ở dạng đọc được:
 *
 *     X.typeName = "aiserver.v1.GrokBotUserComputerRequestFrame";
 *     X.fields = l.util.newFieldList(() => [
 *       {no:1, name:"request_id", kind:"scalar", T:9},
 *       {no:2, name:"exec", kind:"message", T:CE, oneof:"frame"}, …
 *     ]);
 *
 * Tên kiểu của trường `message` là một BIẾN đã minify (`CE`), nên phải dựng bản đồ
 * `biến -> typeName` trước rồi mới giải được. Đó là lý do bài này không phải một câu grep.
 *
 * Đo 30/08 trên daemon 0.29 (`C:/cai029/.../local-exec-daemon/main.cjs`, 3,4 MB): 32 message
 * thuộc họ UserComputer, và 40 cặp `<tên>Args` -> `<tên>Result` trong sổ đăng ký thao tác.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const argv = process.argv.slice(2);
const arg = (t) => { const i = argv.indexOf(t); return i >= 0 ? argv[i + 1] : undefined; };
const chet = (m) => { console.error(`DỪNG: ${m}`); process.exit(1); };

const UNG_VIEN = [
  arg("--daemon"),
  "C:/cai029/resources/app/dist/local-exec-daemon/main.cjs",
  "C:/Program Files/Grok Bot/resources/app/dist/local-exec-daemon/main.cjs",
].filter(Boolean);
const duong = UNG_VIEN.find((p) => existsSync(p));
if (!duong) chet(`không thấy local-exec-daemon/main.cjs. Thử: ${UNG_VIEN.join(" | ")}`);
const s = readFileSync(duong, "utf8");

/** Số kiểu vô hướng của protobuf — chỉ những kiểu thực sự gặp, phần còn lại giữ nguyên số. */
const SCALAR = {
  1: "double", 2: "float", 3: "int64", 4: "uint64", 5: "int32", 6: "fixed64", 7: "fixed32",
  8: "bool", 9: "string", 12: "bytes", 13: "uint32", 14: "enum", 15: "sfixed32", 16: "sfixed64",
  17: "sint32", 18: "sint64",
};

// ── bản đồ biến đã minify -> typeName ───────────────────────────────────────────────────────────
const tenCua = new Map();
for (const m of s.matchAll(/([\w$]+)\.typeName\s*=\s*"([^"]+)"/g)) tenCua.set(m[1], m[2]);
if (!tenCua.size) chet("không thấy khai báo `.typeName=` nào — bundle này có phải daemon không?");

/** Cắt mảng field ngay sau `newFieldList(()=>[`, đếm ngoặc vuông để không đứt giữa chừng. */
function catMang(tu) {
  let sau = 0, i = tu, chuoi = null;
  for (; i < s.length; i += 1) {
    const c = s[i];
    if (chuoi) { if (c === "\\") i += 1; else if (c === chuoi) chuoi = null; continue; }
    if (c === '"' || c === "'" || c === "`") { chuoi = c; continue; }
    if (c === "[") sau += 1;
    else if (c === "]") { sau -= 1; if (!sau) return s.slice(tu, i + 1); }
  }
  return null;
}

/** Một `{no:…,name:…}` thành object đọc được. `T` là biến thì giải sang typeName. */
function docField(t) {
  const no = /no:\s*(\d+)/.exec(t);
  const ten = /name:\s*"([^"]+)"/.exec(t);
  if (!no || !ten) return null;
  const kind = (/kind:\s*"(\w+)"/.exec(t) ?? [])[1] ?? "?";
  const rawT = (/[,{]\s*T:\s*([\w$]+)/.exec(t) ?? [])[1];
  let kieu = rawT;
  if (kind === "scalar" || kind === "enum") kieu = SCALAR[Number(rawT)] ?? rawT;
  else if (rawT) kieu = tenCua.get(rawT) ?? `?${rawT}`;
  const oneof = (/oneof:\s*"(\w+)"/.exec(t) ?? [])[1];
  return {
    no: Number(no[1]),
    name: ten[1],
    kind,
    ...(kieu ? { type: kieu } : {}),
    ...(oneof ? { oneof } : {}),
    ...(/repeated:\s*!0/.test(t) ? { repeated: true } : {}),
    ...(/opt:\s*!0/.test(t) ? { optional: true } : {}),
  };
}

const messages = {};
for (const m of s.matchAll(/([\w$]+)\.fields\s*=\s*[\w$.]+\.newFieldList\(\(\)\s*=>\s*\[/g)) {
  const bien = m[1];
  const ten = tenCua.get(bien);
  if (!ten) continue;
  const mang = catMang(m.index + m[0].length - 1);
  if (!mang) continue;
  // Tách theo `},{` ở mức ngoài cùng là đủ: field entry không lồng object nào khác.
  const fields = mang.slice(1, -1).split(/\}\s*,\s*\{/).map((x) => docField(`{${x.replace(/^\{|\}$/g, "")}}`)).filter(Boolean);
  if (fields.length) messages[ten] = fields;
}

// ── sổ đăng ký thao tác: `<tên>Args` -> `<tên>Result` ───────────────────────────────────────────
const thaoTac = {};
for (const m of s.matchAll(/\([\w$]+,\s*[\w$]+\("(\w+Args)"\),\s*[\w$]+\("(\w+)"\)\)/g)) thaoTac[m[1]] = m[2];

// ── ánh xạ thao tác -> hành động của thẻ quyền (hàm `describeLocalExec`) ────────────────────────
//
// Đọc thẳng từ switch trong daemon. Đây là chỗ nối vào `LocalToolAction` của ta, và nó khớp y hệt.
const quyen = {};
const iSw = s.indexOf("describeLocalExec");
if (iSw > 0) {
  const than = s.slice(Math.max(0, iSw - 1200), iSw);
  let hienTai = [];
  for (const m of than.matchAll(/case"(\w+)":|action:"([a-z-]+)"/g)) {
    if (m[1]) hienTai.push(m[1]);
    else if (m[2]) { for (const c of hienTai) quyen[c] = m[2]; hienTai = []; }
  }
}

const hop = Object.keys(messages).filter((t) => /UserComputer|LocalTool/.test(t)).sort();
const out = {
  extractedFrom: duong,
  note: "Giao thức cho bot chạy lệnh / đọc tệp / điều khiển chuột-bàn phím trên MÁY NGƯỜI DÙNG. "
    + "Bóc từ bộ mô tả protobuf nhúng trong daemon; tên kiểu message giải qua bản đồ biến->typeName.",
  soMessage: Object.keys(messages).length,
  messagesUserComputer: Object.fromEntries(hop.map((t) => [t, messages[t]])),
  thaoTac,
  quyenCuaThaoTac: quyen,
};
const ra = join(REPO, "docs", "extracted", "user-computer-proto.json");
writeFileSync(ra, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(`daemon: ${duong}`);
console.log(`message đọc được: ${out.soMessage} (họ UserComputer: ${hop.length})`);
console.log(`thao tác: ${Object.keys(thaoTac).length} cặp Args→Result`);
console.log(`ánh xạ quyền: ${Object.keys(quyen).length} thao tác`);
console.log(`đã ghi ${ra}`);
