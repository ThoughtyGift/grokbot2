/**
 * Đo kích thước file và hàm — đầu vào cho ngưỡng refactor (T5).
 *
 *   node scripts/code-size.mjs            # báo cáo
 *   node scripts/code-size.mjs --json     # cho self-xray
 *
 * ── Bốn bản, và vì sao ────────────────────────────────────────────────────────
 *
 * Phép đo này tự nó cần được kiểm. Ba bản đầu đều in ra "một con số" trông như thật:
 *
 *   1. đo khoảng cách tới khai báo kế tiếp   → 93 hàm dài, trong đó `killTree` 321 dòng (vô lý)
 *   2. khớp ngoặc, tìm `{` trong 2 dòng đầu  → 13 hàm, nhưng MẤT `handleNative` 384 dòng
 *                                              (chữ ký nhiều dòng thì 2 dòng đầu chưa có `{`)
 *   3. nới thành 10 dòng                     → `handleNative` về, nhưng arrow MỘT BIỂU THỨC
 *                                              (`const seqOf = (e) => (...)`) lại bắt `{` của code
 *                                              phía sau, ra `seqOf` 133 dòng
 *   4. bản này: phân biệt đúng bản chất — arrow một biểu thức **kết bằng `;` ở độ sâu ngoặc 0
 *      trước khi có `{`**. Không còn tinh chỉnh hằng số lookahead.
 *
 * Đây không phải parser. Nó là bộ đếm ngoặc, và nó bỏ chuỗi/comment trước khi đếm. Đủ cho một
 * ngưỡng, không đủ để dựa vào cho việc gì khác.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const JSON_OUT = process.argv.includes("--json");

export const LIMIT_FILE = 800;
export const LIMIT_FN = 50;

const SKIP = new Set(["node_modules", "dist", ".data", ".turbo", ".git", "vendor"]);
const EXT = new Set([".ts", ".mts", ".mjs", ".js"]);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(p)) && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
};

const files = ["apps", "packages", "services", "infra"]
  .flatMap((r) => { try { return walk(join(REPO, r)); } catch { return []; } });

const DECL = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/;

/** Bỏ chuỗi và comment dòng để không đếm ngoặc bên trong chúng. */
const clean = (line) => line
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  .split("//")[0];

const rel = (p) => relative(REPO, p).replace(/\\/g, "/");
const longFns = [];
const bigFiles = [];

for (const p of files) {
  const lines = readFileSync(p, "utf8").split("\n");
  if (lines.length > LIMIT_FILE) bigFiles.push({ lines: lines.length, file: rel(p) });

  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    const name = m[1] ?? m[2];

    /*
     * Tìm dòng mở thân hàm. Vừa đi vừa theo dõi độ sâu ngoặc TRÒN: gặp `;` ở độ sâu 0 mà chưa
     * thấy `{` nghĩa là hàm một biểu thức — đó là chỗ ba bản trước đều sai.
     */
    let body = -1;
    let paren = 0;
    for (let k = i; k < Math.min(i + 12, lines.length); k++) {
      const s = clean(lines[k]);
      for (const ch of s) {
        if (ch === "(") paren++;
        else if (ch === ")") paren--;
        else if (ch === "{") { body = k; break; }
        else if (ch === ";" && paren <= 0) { body = -2; break; }
      }
      if (body !== -1) break;
    }
    if (body < 0) continue;

    let depth = 0;
    let j = body;
    for (; j < lines.length && j < body + 1200; j++) {
      const s = clean(lines[j]);
      depth += (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length;
      if (depth <= 0) break;
    }
    const n = j - i + 1;
    if (n > LIMIT_FN) longFns.push({ lines: n, name, file: rel(p), at: i + 1 });
    i = Math.max(j, i);
  }
}

bigFiles.sort((a, b) => b.lines - a.lines);
longFns.sort((a, b) => b.lines - a.lines);

if (JSON_OUT) {
  console.log(JSON.stringify({ sources: files.length, files: bigFiles, functions: longFns }));
} else {
  console.log(`${files.length} file nguồn (bỏ test, bỏ vendor)`);
  console.log(`\nfile > ${LIMIT_FILE} dòng: ${bigFiles.length}`);
  for (const f of bigFiles) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
  console.log(`\nhàm > ${LIMIT_FN} dòng: ${longFns.length}`);
  for (const f of longFns) console.log(`  ${String(f.lines).padStart(4)}  ${f.name.padEnd(24)} ${f.file}:${f.at}`);
}
