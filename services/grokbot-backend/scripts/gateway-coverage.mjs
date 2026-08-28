/**
 * Ta trả lời được bao nhiêu phần của cổng box mà client 0.29 thật sự gọi?
 *
 *   node services/grokbot-backend/scripts/gateway-coverage.mjs [--bundle <electron-main/main.cjs>]
 *
 * Đọc bảng `Xa("gateway",{methods:{…}})` ngay trong bundle client, đối chiếu với bảng lệnh trong
 * `packages/cursor-acl/src/commands.ts`, rồi in ra phần còn thiếu theo NHÓM.
 *
 * ── Vì sao có script này ────────────────────────────────────────────────────────────────────────
 *
 * Con số này từng được đếm bằng tay và sai hai lần trong cùng một ngày:
 *
 *   - đếm tool bằng `grep "^TOOLS\."` → 26, chạy thật → 63 (37 tool nạp động qua `availableTools()`)
 *   - đếm lệnh gateway bằng regex khoá thụt bốn dấu cách → bỏ sót 9 lệnh shared-room đăng ký bằng
 *     `Object.fromEntries(SHARED_ROOM_COMMANDS.map(…))`, tức báo thiếu 27 trong khi thật ra 18
 *
 * Nên script này KHÔNG regex bảng lệnh của ta: nó **import** ACL và đếm khoá thật của bản đồ lệnh.
 * Đếm bằng cách chạy, không đếm bằng cách đọc.
 *
 * ── Trả lời NO cũng là trả lời ──────────────────────────────────────────────────────────────────
 *
 * Một lệnh trả `{ok:false, reason:…}` được tính là ĐÃ trả lời. Cái đáng lo là 404 mềm: nút trong
 * app bấm không ra gì, không báo lỗi, không ai biết — đúng loại lỗi tốn nhiều giờ nhất để tìm.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const BUNDLE = argOf("--bundle", join(
  process.env.LOCALAPPDATA ?? "", "..", "Local", "Temp", "claude", "c--Users-admin-Desktop-grokbot2",
  "bf8880a4-255a-4cbd-8035-9251205cf105", "scratchpad", "asar029", "dist", "electron-main", "main.cjs",
));

if (!existsSync(BUNDLE)) {
  console.error(`Không thấy bundle client: ${BUNDLE}`);
  console.error("Giải nén trước:  npx @electron/asar extract \"<Grok Bot>/resources/app.asar\" <thư mục>");
  console.error("rồi trỏ tới đó:  --bundle <thư mục>/dist/electron-main/main.cjs");
  process.exit(2);
}

/** Cắt đúng thân `{…}` cân ngoặc bắt đầu từ vị trí một dấu `{`. */
function braced(text, open) {
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    if (text[j] === "{") depth += 1;
    else if (text[j] === "}") { depth -= 1; if (depth === 0) return text.slice(open, j + 1); }
  }
  return "";
}

const src = readFileSync(BUNDLE, "utf8");
const at = src.search(/Xa\("gateway",\{methods:\{/);
if (at < 0) { console.error('Không tìm thấy bảng Xa("gateway") — bundle có phải 0.29 không?'); process.exit(2); }
const body = braced(src, src.indexOf("{", src.indexOf("methods:", at)));
const vendor = [...new Set([...body.matchAll(/(?:^|[,{])([a-zA-Z][A-Za-z0-9_]*):v\(\)/g)].map((m) => m[1]))].sort();

// Bảng lệnh của TA: import thật, không regex — xem ghi chú đầu file.
const { buildCommands } = await import("../../../packages/cursor-acl/src/commands.ts");
const stub = new Proxy({}, { get: () => new Proxy(() => ({}), { get: () => () => ({}) }) });
let ours;
try {
  ours = new Set(Object.keys(buildCommands(stub)));
} catch (e) {
  console.error(`Không dựng được bảng lệnh: ${e.message}`);
  process.exit(2);
}

const missing = vendor.filter((n) => !ours.has(n));
const GROUPS = [
  [/BotTemplate|createAgentFromTemplate/, "mẫu bot"],
  [/VoiceCall/i, "gọi thoại"],
  [/Cookie/i, "cookie (nửa box)"],
  [/transcribeAudio/, "ghi âm → chữ"],
  [/Room/i, "phòng chia sẻ"],
];
const groupOf = (n) => GROUPS.find(([re]) => re.test(n))?.[1] ?? "khác";

const answered = vendor.length - missing.length;
console.log(`cổng box 0.29 : ${vendor.length} method`);
console.log(`ta trả lời    : ${answered} (${Math.round((answered / vendor.length) * 100)}%)`);
console.log(`404 mềm       : ${missing.length}`);
if (missing.length) {
  console.log("\nCòn thiếu — 404 mềm nghĩa là nút trong app bấm KHÔNG ra gì, không báo lỗi:");
  const by = new Map();
  for (const n of missing) by.set(groupOf(n), [...(by.get(groupOf(n)) ?? []), n]);
  for (const [g, names] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${g} (${names.length}): ${names.join(", ")}`);
  }
}
