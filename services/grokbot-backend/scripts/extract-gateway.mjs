/**
 * Trích bảng lệnh gateway của client.
 *
 *   node extract-gateway.mjs <thư-mục-asar-đã-giải-nén> [thư-mục-ra]
 *
 * ── Nguồn, và hai lần tôi lấy nhầm ──────────────────────────────────────────────────────────────
 *
 * Bảng thật nằm trong `dist/electron-main/main.cjs`, khai báo:
 *
 *     dl("gateway",{methods:{ getTranscript:C().noArgs, getAgentTranscript:C().args(Ar), … }})
 *
 * **Lần hỏng thứ nhất:** bản trước neo vào hằng `SAND_GATEWAY_COMMANDS`. Hằng đó không còn tồn tại
 * — không có ở 0.29, không có ở 0.30. Script hỏng lặng lẽ từ đó, và `gateway-commands.json` trong
 * repo vẫn là bảng **0.20** (120 lệnh) suốt hai phiên bản. Gate contract vẫn báo PASS, vì nó chấm ta
 * so với chính cái file cũ ấy: một extractor hỏng im lặng nguy hiểm hơn không có extractor, vì nó
 * vẫn phát ra một con số trông y như đo được.
 *
 * **Lần hỏng thứ hai (của tôi, hôm nay):** tôi thay bằng bảng `{args:"…",reply:"…"}` bên renderer.
 * Nó chạy, ra 122 lệnh, và guard "ít hơn 100 thì báo lỗi" cho qua. Nhưng đó là một tập CON — diff
 * với bảng cũ cho thấy `getAgentTranscript`, `getHostSettings`, `uploadAttachment` "biến mất", những
 * lệnh app gọi mỗi ngày. Con số hợp lý là cách một phép đo sai sống sót lâu nhất.
 *
 * Nên: neo vào bảng THẬT, và kiểm bằng những lệnh không thể vắng mặt thay vì bằng một ngưỡng đếm.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
// Đối số 3: thư mục ra (file `gateway-commands.json`), HOẶC đường dẫn file `.json` — để trích bản 0.43 ra
// FILE RIÊNG (`gateway-commands-0-43.json`) mà không ghi đè bảng 0.30 đang là hợp đồng gốc.
const ra = process.argv[3] ?? ".";
const outFile = ra.endsWith(".json") ? ra : join(ra, "gateway-commands.json");
if (!root || !existsSync(root)) { console.error("cần <thư-mục-asar-đã-giải-nén>"); process.exit(1); }

/*
 * 0.43 tách `main.cjs` thành vỏ 12 KB → `main-app.cjs` / `main-core.cjs`; bảng lệnh nằm trong `main-app.cjs`.
 * Chọn file theo NỘI DUNG (có mỏ neo) chứ không theo tên — 0.29/0.30 vẫn là `main.cjs`.
 */
const ungVien = ["main.cjs", "main-app.cjs"].map((f) => join(root, "dist", "electron-main", f)).filter(existsSync);
if (!ungVien.length) { console.error(`không thấy dist/electron-main/main*.cjs dưới ${root}`); process.exit(1); }
const main = ungVien.find((f) => readFileSync(f, "utf8").includes('("gateway",{methods:{')) ?? ungVien[0];
const src = readFileSync(main, "utf8");

/*
 * Neo bỏ TÊN HÀM. `dl` là tên đã minify: 0.30 gọi `dl("gateway",…)`, 0.29 gọi tên khác, và bản sau
 * sẽ lại khác nữa. Phần bền là chuỗi literal `"gateway"` cùng hình dạng `{methods:{` ngay sau nó —
 * đúng luật số 1 của `extract-contract.mjs`: neo vào chuỗi, đừng neo vào tên đã minify.
 */
/*
 * Duyệt MỌI chỗ khớp, chọn bảng có đủ xương sống — đừng lấy chỗ đầu tiên.
 *
 * 0.29 có một chỗ khác cũng khớp `("gateway",{methods:{` nhưng là bảng của thứ khác; lấy chỗ đầu
 * tiên thì ra một bảng không có `getAgentTranscript` nào. Guard xương sống bên dưới bắt được, và
 * đây là cách sửa đúng: chọn theo NỘI DUNG, không theo thứ tự xuất hiện.
 */
const XUONG_SONG = ["getAgentTranscript", "getHostSettings", "setHostSettings", "sendPrompt",
                    "listAgents", "createAgent", "uploadAttachment", "readAttachmentImage"];

/** Cắt đúng object `methods` bằng cách cân ngoặc, không đoán độ dài. */
function bangTai(at) {
  const open = src.indexOf("{methods:", at) + "{methods:".length;
  let depth = 0, end = open;
  for (; end < src.length; end += 1) {
    if (src[end] === "{") depth += 1;
    else if (src[end] === "}") { depth -= 1; if (depth === 0) break; }
  }
  const table = src.slice(open, end + 1);
  return [...new Map(
    // Tên helper cũng bị minify — 0.29 dùng `v()`, 0.30 dùng `C()`. Khớp mọi định danh.
    [...table.matchAll(/([a-zA-Z][a-zA-Z0-9]*):\w+\(\)\.(noArgs|args)/g)]
      .map((m) => [m[1], { name: m[1], takesBody: m[2] === "args" }]),
  ).values()];
}

const moNeo = [...src.matchAll(/\("gateway",\{methods:\{/g)].map((m) => m.index);
if (moNeo.length === 0) { console.error('không thấy mỏ neo ("gateway",{methods:{ — bảng lại đổi hình dạng'); process.exit(2); }

let commands = [];
for (const at of moNeo) {
  const c = bangTai(at);
  if (XUONG_SONG.every((n) => c.some((x) => x.name === n))) { commands = c; break; }
  if (c.length > commands.length) commands = c;
}
commands.sort((a, b) => a.name.localeCompare(b.name));

/*
 * Kiểm bằng lệnh KHÔNG THỂ vắng mặt, không bằng ngưỡng đếm.
 *
 * Một ngưỡng ("ít nhất 100 lệnh") cho qua đúng cái lỗi hôm nay: 122 lệnh của một tập con nghe rất
 * hợp lý. Mấy lệnh dưới đây là xương sống — thiếu bất kỳ cái nào nghĩa là ta đang đọc nhầm bảng.
 */
const thieu = XUONG_SONG.filter((n) => !commands.some((c) => c.name === n));
if (thieu.length) {
  console.error(`đọc nhầm bảng: thiếu lệnh xương sống ${thieu.join(", ")} — KHÔNG ghi đè`);
  process.exit(3);
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
writeFileSync(outFile, `${JSON.stringify({
  // Đường dẫn TƯƠNG ĐỐI trong cây app — bản 0.30 từng ghi đường tuyệt đối vào scratchpad của một phiên đã mất.
  source: main.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/"),
  appVersion: version,
  note: 'Bảng `dl("gateway",{methods:{…}})` trong electron-main — thứ client thật sự gọi.',
  counts: { commands: commands.length, withBody: commands.filter((c) => c.takesBody).length },
  commands,
}, null, 2)}\n`);
console.log(`${version}: ${commands.length} lệnh, ${commands.filter((c) => c.takesBody).length} có body`);
