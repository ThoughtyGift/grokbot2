/**
 * Rà soát `docs/` — link chết, file mồ côi, file thiếu trong mục lục.
 *
 *   node scripts/docs-check.mjs        # báo cáo
 *   node scripts/docs-check.mjs --ci   # thoát khác 0 nếu có link chết
 *
 * Vì sao cần: `docs/` có 140 file và vừa được gom vào thư mục con. Một link chết trong tài liệu
 * không làm build đỏ, không làm test đỏ — nó chỉ làm người đọc lần sau mất mười phút. Nên phải có
 * thứ kiểm được bằng máy, chạy lại được sau mỗi lần sắp xếp lại.
 *
 * Ba loại vấn đề, ba mức độ khác nhau:
 *   · **link chết** — sai chắc chắn, phải sửa.
 *   · **mồ côi** — không file nào trỏ tới; có thể là tài liệu đã chết, có thể là đang thiếu chỗ dẫn vào.
 *   · **thiếu trong mục lục** — có tồn tại nhưng `docs/README.md` không nhắc, nên coi như không có.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOCS = join(REPO, "docs");
const INDEX = join(DOCS, "README.md");
const CI = process.argv.includes("--ci");
/**
 * `--mermaid`: kiểm sơ đồ có PARSE được, không chỉ trông giống sơ đồ.
 *
 * Tắt theo mặc định vì nó cần mở trình duyệt và tải mermaid từ CDN — phần còn lại của bộ kiểm là
 * node thuần, chạy trong một giây, và nên giữ như vậy. Bật khi vừa sửa/thêm sơ đồ.
 */
const MERMAID = process.argv.includes("--mermaid");

/** Thư mục do MÁY ghi: không đòi mục lục cho từng file, chỉ cần mục lục nhắc tới thư mục. */
const MACHINE_DIRS = new Set(["parity-runs", "extracted", "api"]);

/**
 * Thư mục KHÔNG phải tài liệu của mình — bỏ qua hẳn.
 *
 * `_latest-asar` là bundle giải nén của hãng (16 MB). Nó nằm dưới `docs/extracted/` vì tiện cho
 * việc đo, nhưng quét nó thì bộ rà soát đếm cả file của người khác. Từ 31/08 nó đã vào
 * `.gitignore` — xem `docs/legal.md` về lý do nó không được vào repo.
 */
const KHONG_PHAI_TAI_LIEU = new Set(["_latest-asar"]);

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (KHONG_PHAI_TAI_LIEU.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

const all = walk(DOCS);
const docs = all.filter((p) => extname(p) === ".md");
const rel = (p) => relative(REPO, p).replace(/\\/g, "/");

// ── 1. link chết ──────────────────────────────────────────────────────────────
const LINK = /\]\(([^)\s#]+)(#[^)]*)?\)/g;
const dead = [];
const linkedTo = new Set();
/**
 * Bỏ khối code và code inline trước khi tìm link.
 *
 * Không bỏ thì `](...)` trong một đoạn regex hay một ví dụ code cũng bị tính là link — lượt chạy
 * đầu báo 6 link chết, trong đó 3 là `url`, `...` và một regex mật khẩu. Một bộ rà soát hay báo
 * động giả thì lần sau không ai đọc nó nữa.
 */
/**
 * Link "còn sống trên đĩa" chưa đủ: một file chưa `git add` vẫn `statSync` được ở máy này mà mất
 * hẳn ở clone mới. Đúng lỗi đó đã xảy ra — `docs/ROADMAP.md` (bản roadmap cũ, chưa tracked) che
 * link `../ROADMAP.md` nên bộ rà soát báo xanh, còn bảy script đo (`self-xray`, `docs-check`,
 * `x-ray`, ...) thì `package.json` gọi mà git không có. Nên kiểm cả tính **tracked**.
 */
const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 32 << 20 })
    .split("\n").filter(Boolean),
);
const untracked = [];

const stripCode = (t) => t
  .replace(/^```[\s\S]*?^```/gm, "")
  .replace(/`[^`\n]*`/g, "");

for (const p of docs) {
  const text = stripCode(readFileSync(p, "utf8"));
  for (const m of text.matchAll(LINK)) {
    const target = m[1];
    // Bỏ mọi URI có scheme, không chỉ http/mailto. Transcript app gốc đầy `grokbot://app/…` và
    // `sand-workflow:…` — đó là deep-link của client, không phải đường dẫn file. Lượt chạy trước
    // báo 20 "link chết" mà 20 đều là chúng; một bộ rà soát báo động giả thì lần sau không ai đọc.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const abs = resolve(dirname(p), target);
    try {
      statSync(abs);
      linkedTo.add(abs);
      if (!tracked.has(rel(abs))) untracked.push({ from: rel(p), target: rel(abs) });
    } catch {
      dead.push({ from: rel(p), target });
    }
  }
}

// Tài liệu cũng được trỏ tới từ code và từ CLAUDE.md/ROADMAP — quét cả những chỗ đó.
const CODE_EXT = new Set([".ts", ".mts", ".mjs", ".js", ".ps1", ".json", ".yaml", ".yml", ".md"]);
const SKIP = new Set(["node_modules", ".git", "dist", ".data", ".turbo", "docs"]);
const codeFiles = [];
const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) scan(p);
    else if (CODE_EXT.has(extname(p))) codeFiles.push(p);
  }
};
scan(REPO);
const codeBlob = codeFiles.map((p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } }).join("\n");

// ── 2. mồ côi ─────────────────────────────────────────────────────────────────
const orphans = docs.filter((p) => {
  if (p === INDEX) return false;
  if (linkedTo.has(p)) return false;
  return !codeBlob.includes(rel(p)) && !codeBlob.includes(rel(p).replace(/^docs\//, ""));
});

// ── 3. thiếu trong mục lục ────────────────────────────────────────────────────
let indexText = "";
try { indexText = readFileSync(INDEX, "utf8"); } catch { /* chưa có mục lục */ }

/**
 * "Được liệt kê" = có tên trong `docs/README.md` **hoặc** trong README của thư mục chứa nó.
 *
 * Luật ban đầu chỉ chấp nhận mục lục gốc, và nó lập tức sai với `adr/`: mỗi ADR mới sẽ phải ghi
 * tên ở hai chỗ, nên chỗ thứ hai chắc chắn sẽ bị quên. README của từng thư mục là mục lục cấp
 * dưới — GitHub cũng hiện nó khi mở thư mục, nên nó là điểm vào thật, không phải hình thức.
 */
const folderIndex = (p) => {
  const own = join(dirname(p), "README.md");
  if (own === p) return "";
  try { return readFileSync(own, "utf8"); } catch { return ""; }
};
const missing = docs.filter((p) => {
  if (p === INDEX) return false;
  const r = rel(p).replace(/^docs\//, "");
  if (MACHINE_DIRS.has(r.split("/")[0])) return false;
  if (indexText.includes(r)) return false;
  // Trong README thư mục thì link là tương đối, nên so bằng TÊN FILE.
  return !folderIndex(p).includes(basename(p));
});

// ── báo cáo ───────────────────────────────────────────────────────────────────
console.log(`docs: ${all.length} file (${docs.length} markdown)`);
const byDir = new Map();
for (const p of all) {
  const d = rel(p).replace(/^docs\//, "").split("/").slice(0, -1).join("/") || ".";
  byDir.set(d, (byDir.get(d) ?? 0) + 1);
}
for (const [d, n] of [...byDir.entries()].sort()) console.log(`  ${d.padEnd(16)} ${n}`);

console.log(`\n── link chết (${dead.length}) ──`);
for (const d of dead) console.log(`  ${d.from}  →  ${d.target}`);
if (!dead.length) console.log("  (không có)");

console.log(`\n── link tới file chưa vào git (${untracked.length}) ──`);
for (const u of untracked) console.log(`  ${u.from}  →  ${u.target}`);
if (!untracked.length) console.log("  (không có)");

console.log(`\n── mồ côi: không file nào trỏ tới (${orphans.length}) ──`);
for (const p of orphans) console.log(`  ${rel(p)}`);
if (!orphans.length) console.log("  (không có)");

console.log(`\n── thiếu trong docs/README.md (${missing.length}) ──`);
for (const p of missing) console.log(`  ${rel(p)}`);
if (!missing.length) console.log("  (không có)");

/*
 * ── chỗ đang phình ────────────────────────────────────────────────────────────
 *
 * Không phải lỗi, là GỢI Ý. Một mục chiếm gần nửa tài liệu thường nghĩa là nội dung bị nhét sai
 * chỗ chứ không phải mục đó quan trọng gấp đôi phần còn lại.
 *
 * Đo được 31/08: `bang-theo-doi.md` dài 1.249 dòng, trong đó một mục tên "Cửa cấp token" chiếm 567
 * dòng (45%) — và bên trong nó là nhật ký của cả bốn chặng khác, mỗi chặng lẽ ra là một mục riêng.
 * Không ai phát hiện được điều đó khi đọc tuần tự; chỉ đo mới thấy.
 *
 * Bản ghi đo và transcript thì ĐÚNG là một khối dài (`chat-goc-0.29.md` có một mục chiếm 67%, và
 * nó nên như vậy) — nên chúng bị loại khỏi phần này thay vì bị cảnh báo mỗi lượt.
 */
const NGUONG_PHINH = 0.35;
const khongXetPhinh = /^docs\/(parity-runs|extracted|history)\//;
const phinh = [];
for (const p of docs) {
  const r = rel(p);
  if (khongXetPhinh.test(r)) continue;
  const L = readFileSync(p, "utf8").split("\n");
  if (L.length < 200) continue;
  const moc = L.map((l, i) => [i, l]).filter(([, l]) => l.startsWith("## "));
  let to = { ten: "", n: 0 };
  for (let k = 0; k < moc.length; k++) {
    const n = (k + 1 < moc.length ? moc[k + 1][0] : L.length) - moc[k][0];
    if (n > to.n) to = { ten: moc[k][1].slice(0, 50), n };
  }
  if (to.n / L.length >= NGUONG_PHINH) phinh.push({ r, dong: L.length, phan: Math.round((to.n / L.length) * 100), ten: to.ten });
}
console.log(`\n── một mục chiếm ≥${Math.round(NGUONG_PHINH * 100)}% tài liệu (${phinh.length}) ──`);
for (const x of phinh) console.log(`  ${x.r} — ${x.dong} dòng, mục lớn nhất ${x.phan}%: ${x.ten}`);
if (!phinh.length) console.log("  (không có)");

// ── 4. sơ đồ mermaid ─────────────────────────────────────────────────────────
let mermaidBad = 0;
if (MERMAID) {
  // Docs ở đây dùng CRLF nên fence phải nhận cả CR. Bản đầu đòi đúng LF nên tìm được 0 sơ đồ
  // và im lặng "đạt" — một phép kiểm luôn đạt vì không tìm thấy gì thì tệ hơn không có.
  const FENCE = /```mermaid\r?\n([\s\S]*?)```/g;
  const found = [];
  for (const p of docs) {
    for (const m of readFileSync(p, "utf8").matchAll(FENCE)) found.push({ file: rel(p), src: m[1] });
  }
  console.log(`
── sơ đồ mermaid (${found.length}) ──`);
  if (!found.length) console.log("  (không có sơ đồ nào)");
  else {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
    const page = await browser.newPage();
    await page.setContent('<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"; window.__m = m; window.__ready = true;</script>');
    const ready = await page.waitForFunction(() => window.__ready === true, { timeout: 20_000 }).then(() => true).catch(() => false);
    if (!ready) {
      // Nói rõ là KHÔNG kiểm được, đừng để im lặng thành "đạt".
      console.log("  KHÔNG kiểm được — không tải được mermaid (offline?)");
    } else {
      for (const f of found) {
        const r = await page.evaluate(async (src) => {
          try { await window.__m.parse(src); return "ok"; } catch (e) { return String(e?.message ?? e).slice(0, 200); }
        }, f.src);
        console.log(`  ${r === "ok" ? "ok  " : "LỖI"} ${f.file}${r === "ok" ? "" : ` — ${r}`}`);
        if (r !== "ok") mermaidBad++;
      }
    }
    await browser.close().catch(() => {});
  }
}

if (CI && (dead.length || untracked.length || mermaidBad)) {
  const why = [
    dead.length && `${dead.length} link chết`,
    untracked.length && `${untracked.length} link tới file chưa vào git`,
    mermaidBad && `${mermaidBad} sơ đồ không parse được`,
  ].filter(Boolean).join(" · ");
  console.error(`\n${why} — sửa trườc khi commit`);
  process.exit(1);
}
