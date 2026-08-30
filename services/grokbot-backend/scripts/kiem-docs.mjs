/**
 * Sức khoẻ thư mục `docs/` — link gãy, tài liệu mồ côi, chỗ đang phình.
 *
 *   node services/grokbot-backend/scripts/kiem-docs.mjs           # báo cáo
 *   node services/grokbot-backend/scripts/kiem-docs.mjs --link    # chỉ link gãy (dùng trong CI)
 *
 * ── Vì sao có bài này ───────────────────────────────────────────────────────────────────────────
 *
 * 31/08 dọn `docs/`: 224 → 145 file. Việc dọn tự nó sinh ra 19 link gãy, và không có cách nào biết
 * ngoài quét — sửa xong quét lại mới về 0. Lần sau ai dọn cũng gặp đúng vậy, nên đóng gói lại.
 *
 * Ba con số, ba ý nghĩa khác nhau — đừng trộn:
 *
 *   · LINK GÃY   luôn là lỗi. Sửa hoặc xoá dòng.
 *   · MỒ CÔI     là ỨNG VIÊN xoá, không phải án tử. Tài liệu vào-cửa (README) mồ côi là bình
 *                thường, và bản ghi đo trong `parity-runs/` thì mồ côi là ĐÚNG BẢN CHẤT — không ai
 *                đi link tới từng lượt đo. Script chỉ xếp loại; người quyết.
 *   · PHÌNH      một mục chiếm gần nửa tài liệu thường là dấu hiệu nội dung bị nhét sai chỗ. Đo
 *                được 31/08: mục "Cửa cấp token" chiếm 567/1.249 dòng và bên trong là nhật ký của
 *                cả bốn chặng khác.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const CHI_LINK = process.argv.includes("--link");

/** Không quét: bundle của hãng (16 MB, và không phải tài liệu của mình). */
const BO_QUA = new Set(["node_modules", ".git", "_latest-asar", ".data", "dist", ".turbo"]);

const duyet = (goc, loc = () => true) => {
  const ra = [];
  const di = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (BO_QUA.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (loc(e.name)) ra.push(p);
    }
  };
  if (existsSync(join(REPO, goc))) di(join(REPO, goc));
  return ra;
};

// ── 1. Link gãy ─────────────────────────────────────────────────────────────────────────────────
const gay = [];
for (const p of [...duyet("docs", (n) => n.endsWith(".md")), join(REPO, "CLAUDE.md"), join(REPO, "README.md")]) {
  if (!existsSync(p)) continue;
  const s = readFileSync(p, "utf8");
  for (const m of s.matchAll(/\]\(([^)#][^)]*\.md)\)/g)) {
    const t = m[1];
    if (t.startsWith("http")) continue;
    if (!existsSync(normalize(join(dirname(p), t)))) {
      gay.push(`${relative(REPO, p).replace(/\\/g, "/")} → ${t}`);
    }
  }
}
console.log(`link .md gãy: ${gay.length}`);
for (const g of gay) console.log(`  ${g}`);
if (CHI_LINK) process.exit(gay.length ? 1 : 0);

// ── 2. Mồ côi ───────────────────────────────────────────────────────────────────────────────────
// "Được trỏ tới" = tên file xuất hiện ở một nguồn KHÁC chính nó. Thô nhưng đủ: một tài liệu không
// ai gọi tên thì cũng không ai tìm ra.
let chu = "";
for (const f of [
  ...duyet("docs", (n) => n.endsWith(".md")),
  ...duyet("services", (n) => /\.(ts|mjs|md)$/.test(n)),
  ...duyet("packages", (n) => /\.(ts|md)$/.test(n)),
  ...duyet("infra", (n) => /\.(mjs|md|ps1|cmd)$/.test(n)),
  join(REPO, "CLAUDE.md"), join(REPO, "README.md"), join(REPO, "ROADMAP.md"),
]) {
  try { chu += readFileSync(f, "utf8"); } catch { /* vừa bị xoá */ }
}

const moCoi = [];
for (const p of duyet("docs")) {
  const ten = p.split(/[\\/]/).pop();
  const tuThan = readFileSync(p, "utf8").split(ten).length - 1;
  if (chu.split(ten).length - 1 - tuThan > 0) continue;
  moCoi.push({ r: relative(join(REPO, "docs"), p).replace(/\\/g, "/"), kb: Math.round(statSync(p).size / 1024) });
}
// Bản ghi đo mồ côi là đúng bản chất — tách riêng để đừng ai đọc nhầm thành việc phải làm.
const banGhi = moCoi.filter((x) => x.r.startsWith("parity-runs/"));
const thatSu = moCoi.filter((x) => !x.r.startsWith("parity-runs/"));
console.log(`\nmồ côi: ${thatSu.length} tài liệu (+ ${banGhi.length} bản ghi đo, mồ côi là đúng)`);
for (const x of thatSu.sort((a, b) => b.kb - a.kb)) console.log(`  ${String(x.kb).padStart(4)}K  ${x.r}`);

// ── 3. Chỗ đang phình ───────────────────────────────────────────────────────────────────────────
console.log("\ntài liệu dài nhất, và mục lớn nhất trong đó:");
const dai = duyet("docs", (n) => n.endsWith(".md"))
  .map((p) => ({ p, dong: readFileSync(p, "utf8").split("\n").length }))
  .sort((a, b) => b.dong - a.dong).slice(0, 5);
for (const { p, dong } of dai) {
  const L = readFileSync(p, "utf8").split("\n");
  const moc = L.map((l, i) => [i, l]).filter(([, l]) => String(l).startsWith("## "));
  let to = { ten: "(không mục)", n: 0 };
  for (let k = 0; k < moc.length; k++) {
    const n = (k + 1 < moc.length ? moc[k + 1][0] : L.length) - moc[k][0];
    if (n > to.n) to = { ten: String(moc[k][1]).slice(0, 46), n };
  }
  const phan = dong ? Math.round((to.n / dong) * 100) : 0;
  const canh = phan >= 35 ? "  ← một mục chiếm gần nửa: xem nội dung có bị nhét sai chỗ không" : "";
  console.log(`  ${String(dong).padStart(5)} dòng  ${relative(REPO, p).replace(/\\/g, "/")}`);
  console.log(`         mục lớn nhất ${phan}% — ${to.ten}${canh}`);
}
