/**
 * fe-find — truy ngược từ nhãn UI về hàm trong bundle đã minify.
 *
 * Bundle renderer là 1 dòng 5.7 MB: `grep -n` vô dụng (luôn trả "dòng 1"), và mở bằng editor
 * thì treo. Script này định vị theo BYTE OFFSET rồi cắt một cửa sổ quanh chỗ khớp, nên đọc
 * được phần logic sát nhãn mà không phải nạp cả file vào mắt.
 *
 *   node fe-find.mjs "Add trigger"             # tìm nhãn, liệt kê chunk + offset
 *   node fe-find.mjs "Add trigger" --ctx 1200  # nới cửa sổ
 *   node fe-find.mjs --identifier cOt          # tìm ĐỊNH NGHĨA hàm theo tên đã minify
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = join(
  process.env.LOCALAPPDATA,
  "Programs", "Grok Bot", "resources", "app", "dist",
);

// Chỉ những nơi code người viết có thể nằm. `deps/` là node_modules của hãng — 49 MB
// third-party, khớp ở đó gần như luôn là nhiễu, nên không quét.
const ROOTS = [
  ["renderer/assets", /\.(js|mjs|css)$/],
  ["electron-main", /\.cjs$/],
  ["electron-preload", /\.cjs$/],
  ["host", /\.cjs$/],
  ["node-agent-coordinator", /\.cjs$/],
  ["local-exec-daemon", /\.cjs$/],
];

const files = ROOTS.flatMap(([rel, re]) => {
  const dir = join(APP, rel);
  try {
    return readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ rel: `${rel}/${f}`, abs: join(dir, f) }))
      .filter(({ abs }) => statSync(abs).isFile());
  } catch {
    return [];
  }
});

const args = process.argv.slice(2);
const ctxIdx = args.indexOf("--ctx");
const ctx = ctxIdx === -1 ? 600 : Number(args[ctxIdx + 1]);
const idIdx = args.indexOf("--identifier");
const needle = idIdx !== -1 ? args[idIdx + 1] : args[0];
if (!needle) {
  console.error("cần một chuỗi để tìm");
  process.exit(2);
}

// Với --identifier ta muốn ĐỊNH NGHĨA hàm, không phải hàng trăm chỗ gọi nó.
const patterns = idIdx !== -1
  ? [`function ${needle}(`, `${needle}=function`, `${needle}=(`, `const ${needle}=`]
  : [needle];

const LIMIT = 12;
let total = 0;
for (const { rel, abs } of files) {
  const src = readFileSync(abs, "utf8");
  for (const pat of patterns) {
    let at = 0;
    for (;;) {
      const i = src.indexOf(pat, at);
      if (i === -1) break;
      at = i + pat.length;
      total++;
      const from = Math.max(0, i - Math.floor(ctx / 3));
      const to = Math.min(src.length, i + Math.ceil((ctx * 2) / 3));
      console.log(`\n-- ${rel} @ byte ${i}  (${pat})`);
      console.log(src.slice(from, to).replace(/\n/g, "\\n"));
      if (total >= LIMIT) {
        console.log(`\n... dung o ${LIMIT} khop. Thu hep chuoi tim de bot nhieu.`);
        process.exit(0);
      }
    }
  }
}
console.log(`\n${total} khop tren ${files.length} file duoc quet.`);
