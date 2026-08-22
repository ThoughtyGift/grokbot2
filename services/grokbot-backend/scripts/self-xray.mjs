/**
 * X-quang hệ thống **của mình** — sáu câu hỏi, mỗi câu một đáp số.
 *
 *   node scripts/self-xray.mjs           # báo cáo
 *   node scripts/self-xray.mjs --ci      # thoát khác 0 nếu có mục đỏ
 *
 * `x-ray.mjs` soi app của HÃNG. File này soi hệ của mình — đó là chặng
 * "SYSTEM X-RAY" trong [system-pipeline.md](../../../docs/plan/system-pipeline.md) T4, và trước hôm
 * nay nó là chặng 🟡: các mảnh đã có nhưng rời rạc, nên không ai chạy đủ cả sáu.
 *
 * Mỗi mục phải trả lời được "đỏ thì hỏng cái gì". Mục nào chỉ ra một con số mà không nói được điều
 * đó thì không thuộc đây.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordScript } from "./run-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, "..");
const REPO = resolve(BACKEND, "..", "..");
const CI = process.argv.includes("--ci");

/**
 * Ngân sách bundle FE.
 *
 * Hôm nay: 66 KB thô / 23 KB gzip (JS + CSS, đúng cách đo dưới đây — log Vite in riêng từng loại
 * nên đừng so số ở đó với số ở đây). Ngưỡng đặt cao hơn có chủ ý — ADR 0004 nói khi tới X4 thì thêm
 * React + hai thư viện, khoảng 45–55 KB gzip. Ngưỡng này để bắt lúc **phình ngoài dự tính**, không
 * phải để chặn việc đã được quyết. Chạm ngưỡng thì đọc lại ADR trước khi nâng số.
 */
const BUNDLE_MAX_GZIP_KB = 90;
const BUNDLE_MAX_RAW_KB = 320;

const results = [];
const add = (name, pass, detail, why) => {
  results.push({ name, pass, detail, why });
  console.log(`${pass ? "  ok  " : "  ĐỎ  "}${name.padEnd(26)}${detail}`);
  if (!pass && why) console.log(`      ↳ ${why}`);
};

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: opts.cwd ?? BACKEND, encoding: "utf8", shell: process.platform === "win32", ...opts });

console.log("── self-xray ──\n");

// ── 1. code chết ─────────────────────────────────────────────────────────────
{
  const r = run("npx", ["knip", "--no-progress", "--reporter", "json"], { cwd: REPO });
  let n = null, kinds = "", keys = [];
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    /*
     * File không ai import nằm trong TỪNG issue dưới cờ `files`, không nằm ở một khoá cấp cao.
     * Bản trước đọc `j.files` — khoá đó không tồn tại, nên mục này luôn báo "0 file không ai import"
     * kể cả khi knip đang liệt kê 114 file. Một phép đo luôn ra 0 thì tệ hơn không có phép đo.
     */
    /*
     * Chỉ tính code chết trong file ĐÃ VÀO GIT.
     *
     * Mốc này để so hai lượt chạy với nhau. Trên repo có hai phiên làm song song thì file nháp chưa
     * `git add` của người kia làm nó đỏ cho người này — hai lượt liền là đủ để luật "không lặp lại"
     * nổ, và thứ nó bảo "dừng tính năng, sửa cái sinh ra nó" lại là thứ mình không được chạm. Đo
     * trên code đã commit thì con số nói về repo, không nói về bàn làm việc của ai.
     *
     * KHÔNG im lặng bỏ qua: số phát hiện bị loại được in ra ngay dưới.
     */
    const tracked = new Set(
      execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 32 << 20 })
        .split("\n").filter(Boolean),
    );
    const isTracked = (f) => tracked.has(String(f).split("\\").join("/"));
    const untrackedHits = (j.issues ?? []).filter((i) => !isTracked(i.file));
    j.issues = (j.issues ?? []).filter((i) => isTracked(i.file));
    if (untrackedHits.length) {
      const names = [...new Set(untrackedHits.map((i) => String(i.file).split("/").pop()))];
      console.log(`      (bỏ qua ${untrackedHits.length} file chưa vào git: ${names.slice(0, 4).join(", ")})`);
    }
    const files = (j.issues ?? []).reduce((n, i) => n + (i.files?.length ?? 0), 0);
    const issues = (j.issues ?? []).reduce((acc, i) => {
      for (const k of ["exports", "types", "dependencies", "unlisted", "unresolved"]) {
        acc[k] = (acc[k] ?? 0) + (i[k]?.length ?? 0);
      }
      return acc;
    }, {});
    n = files + Object.values(issues).reduce((a, b) => a + b, 0);
    for (const f of j.files ?? []) keys.push(`${f}|file|`);
    for (const i of j.issues ?? []) {
      for (const k of ["exports", "types", "dependencies", "unlisted", "unresolved"]) {
        for (const x of i[k] ?? []) keys.push(`${i.file}|${k}|${x?.name ?? x}`);
      }
    }
    keys.sort();
    kinds = `${files} file không ai import` + Object.entries(issues).filter(([, v]) => v).map(([k, v]) => ` · ${v} ${k}`).join("");
  } catch {
    kinds = `knip không trả JSON đọc được (exit ${r.status})`;
  }
  /*
   * Ngưỡng là **KHÔNG TĂNG**, không phải 0.
   *
   * Repo này có hàng chục script chạy độc lập mà knip coi là "không ai import", nên đòi 0 là đòi
   * điều sai. Nhưng chỉ *in ra một con số* thì cũng vô nghĩa — không ai so tay giữa hai lượt chạy.
   * Nên mốc được ghi lại và mục này đỏ khi con số **tăng**. Giảm thì tự cập nhật mốc: dọn được code
   * chết là việc tốt, không cần ai bấm gì.
   */
  const baseFile = join(REPO, "docs", "state", "self-xray-baseline.json");
  let base = {};
  try { base = JSON.parse(readFileSync(baseFile, "utf8")); } catch { /* lượt đầu */ }
  const listFile = join(REPO, "docs", "state", "knip-findings.json");
  const prev = base.knip ?? null;
  const grew = n != null && prev != null && n > prev;

  /*
   * Vi sao luu ca DANH SACH chu khong chi mot con so: luot 2026-08-22 bao "126 -> 127" va khong
   * ai truy duoc cai +1 la gi, vi moc chi co mot con so nen khong co gi de tru. Mot phep do khong
   * chan doan duoc thi chi tao tieng on. Khoa theo `file|loai|ten` nen delta hien ra ngay.
   */
  let prevKeys = null;
  try { prevKeys = new Set(JSON.parse(readFileSync(listFile, "utf8")).keys ?? []); } catch { /* luot dau */ }
  const nowSet = new Set(keys);
  const added = prevKeys ? keys.filter((k) => !prevKeys.has(k)) : [];
  const gone = prevKeys ? [...prevKeys].filter((k) => !nowSet.has(k)) : [];
  const show = (list) => list.slice(0, 6).map((k) => {
    const [f, kind, name] = k.split("|");
    return `${f.split("/").pop()}:${name || kind}`;
  }).join(", ") + (list.length > 6 ? ` (+${list.length - 6})` : "");
  const delta = added.length || gone.length
    ? ` — thêm: ${added.length ? show(added) : "không"}${gone.length ? ` · bớt: ${show(gone)}` : ""}`
    : "";
  add("code chết (knip)", n != null && !grew,
      n != null
        ? `${n} phát hiện${prev == null ? " (ghi làm mốc)" : grew ? ` — TĂNG từ ${prev}` : ` (mốc ${prev})`} — ${kinds}${delta}`
        : kinds,
      grew ? "thêm code chết: hoặc dọn, hoặc nói rõ vì sao rồi cập nhật mốc" : "không đo được code chết thì mỗi lần refactor là dọn mù");
  if (n != null && !grew) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(baseFile), { recursive: true });
    if (prev == null || n < prev) {
      writeFileSync(baseFile, `${JSON.stringify({ ...base, knip: n, at: new Date().toISOString() }, null, 2)}
`);
      console.log(`      ↳ mốc mới: ${n}`);
    }
    // Danh sách cập nhật cả khi con số không đổi: cùng một tổng vẫn có thể đổi thành phần, và lần
    // sau chỉ so được nếu danh sách là của lượt xanh gần nhất.
    writeFileSync(listFile, `${JSON.stringify({ count: n, at: new Date().toISOString(), keys }, null, 2)}
`);
  }
}

// ── 2. kích thước code (ngưỡng refactor T5.1) ───────────────────────────────
{
  const r = run("node", ["scripts/code-size.mjs", "--json"]);
  let big = null, long = null, keys2 = [];
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    big = j.files.length;
    long = j.functions.length;
    keys2 = [
      ...(j.issues ?? []).flatMap((i) => (i.files ?? []).map((f) => `${f.name ?? f}|file`)),
      ...j.functions.map((f) => `${f.file ?? f.path}:${f.name}|fn`),
    ].sort();
  } catch { /* để null, báo đỏ bên dưới */ }

  /*
   * Ngưỡng là KHÔNG TĂNG, giống knip. Đặt 0 là đòi điều sai: `buildCommands` 351 dòng là bảng
   * 120 lệnh của hãng, tách nó ra không làm nó dễ đọc hơn. Nhưng THÊM một file 800 dòng nữa thì
   * phải có người nói vì sao.
   */
  const baseFile2 = join(REPO, "docs", "state", "self-xray-baseline.json");
  let base2 = {};
  try { base2 = JSON.parse(readFileSync(baseFile2, "utf8")); } catch { /* lượt đầu */ }
  const prevBig = base2.bigFiles ?? null;
  const prevLong = base2.longFns ?? null;
  const grew2 = (prevBig != null && big > prevBig) || (prevLong != null && long > prevLong);

  /*
   * Lưu cả DANH SÁCH, cùng lý do như mục knip: hai lượt liền báo "15 → 16" mà không nói hàm nào,
   * nên phải đi ngược git log để loại trừ. Khoá theo `file:hàm` thì delta hiện ra ngay dòng báo.
   */
  const listFile2 = join(REPO, "docs", "state", "code-size-findings.json");
  let prevKeys2 = null;
  try { prevKeys2 = new Set(JSON.parse(readFileSync(listFile2, "utf8")).keys ?? []); } catch { /* luot dau */ }
  const nowSet2 = new Set(keys2);
  const added2 = prevKeys2 ? keys2.filter((k) => !prevKeys2.has(k)) : [];
  const gone2 = prevKeys2 ? [...prevKeys2].filter((k) => !nowSet2.has(k)) : [];
  const show2 = (l) => l.slice(0, 5).map((k) => k.split("/").pop()).join(", ") + (l.length > 5 ? ` (+${l.length - 5})` : "");
  const delta2 = added2.length || gone2.length
    ? ` — thêm: ${added2.length ? show2(added2) : "không"}${gone2.length ? ` · bớt: ${show2(gone2)}` : ""}`
    : "";
  add("kích thước code", big != null && !grew2,
      big == null ? "không đọc được code-size.mjs"
        : `${big} file > 800 dòng · ${long} hàm > 50 dòng`
          + (prevBig == null ? " (ghi làm mốc)" : grew2 ? ` — TĂNG từ ${prevBig}/${prevLong}` : ` (mốc ${prevBig}/${prevLong})`) + delta2,
      grew2 ? "thêm file/hàm quá dài: tách, hoặc nói rõ vì sao rồi cập nhật mốc"
            : "không đo được thì 'file quá dài' chỉ là cảm giác");
  /*
   * Ghi danh sách cả ở lượt ĐẦU (chưa có gì để trừ) chứ không chỉ lượt xanh: nếu đợi xanh mới ghi
   * thì một mục đang đỏ sẽ đỏ mãi mà không bao giờ nêu được tên — đúng tình trạng của lượt
   * 2026-08-22, phải truy `git log` bằng tay mới ra `checkAuth`.
   */
  if (big != null && (!grew2 || prevKeys2 == null)) {
    const { writeFileSync: w2, mkdirSync: mk2 } = await import("node:fs");
    mk2(dirname(baseFile2), { recursive: true });
    if (prevBig == null || big < prevBig || long < prevLong) {
      w2(baseFile2, `${JSON.stringify({ ...base2, bigFiles: big, longFns: long, at: new Date().toISOString() }, null, 2)}\n`);
      console.log(`      mốc mới: ${big} file / ${long} hàm`);
    }
    // Danh sách ghi cả khi con số không đổi, để lượt sau còn cái mà trừ.
    w2(listFile2, `${JSON.stringify({ files: big, functions: long, at: new Date().toISOString(), keys: keys2 }, null, 2)}\n`);
  }

}

// ── 3. ranh giới tầng ────────────────────────────────────────────────────────
{
  const r = run("npx", ["tsx", "--test", "src/boundaries.test.ts"]);
  const pass = r.status === 0;
  const m = /# pass (\d+)/.exec(r.stdout ?? "");
  add("ranh giới tầng", pass, pass ? `${m?.[1] ?? "?"} luật đạt` : "có module nhập ngược tầng",
      "domain nhập ngược lên transport là bước đầu của một khối bùi nhùi");
}

// ── 4. ngân sách bundle FE ───────────────────────────────────────────────────
{
  const dist = join(REPO, "apps", "grokbot-web", "dist", "assets");
  if (!existsSync(dist)) {
    add("ngân sách bundle", false, "chưa build FE — chạy `pnpm -C apps/grokbot-web build`",
        "không có số thì ngưỡng vô nghĩa");
  } else {
    const { gzipSync } = await import("node:zlib");
    /*
     * Chỉ đếm file mà `index.html` THẬT SỰ nạp — Vite đặt tên theo hash, nên `assets/` có thể còn
     * bản build cũ, và một ngân sách tính cả rác sẽ báo phình khi chẳng có gì phình.
     *
     * Ghi lại một chỗ tôi đã hiểu sai: 66 KB **không** phải do rác. Log của Vite in JS và CSS
     * riêng (51 KB + 15 KB) còn ngân sách ở đây tính tổng — tôi đem 51 so với 66 rồi tưởng có 15 KB
     * rác. Lọc theo `index.html` vẫn đúng về nguyên tắc, nhưng nó không phải lý do con số là 66.
     */
    const html = readFileSync(join(REPO, "apps", "grokbot-web", "dist", "index.html"), "utf8");
    const used = [...html.matchAll(/(?:src|href)="\/?assets\/([^"]+)"/g)].map((m) => m[1]);
    let raw = 0, gz = 0;
    for (const f of used) {
      const p = join(dist, f);
      if (!existsSync(p)) continue;
      const buf = readFileSync(p);
      raw += statSync(p).size;
      gz += gzipSync(buf).length;
    }
    const stale = readdirSync(dist).length - used.length;
    const rawKb = Math.round(raw / 1024), gzKb = Math.round(gz / 1024);
    const pass = gzKb <= BUNDLE_MAX_GZIP_KB && rawKb <= BUNDLE_MAX_RAW_KB;
    add("ngân sách bundle", pass,
        `${rawKb} KB thô / ${gzKb} KB gzip (ngưỡng ${BUNDLE_MAX_RAW_KB}/${BUNDLE_MAX_GZIP_KB})`
        + (stale > 0 ? ` · bỏ qua ${stale} file build cũ` : ""),
        "vượt ngưỡng: đọc ADR 0004 trước khi nâng số");
  }
}

// ── 5. trôi hợp đồng client ──────────────────────────────────────────────────
{
  const r = run("node", ["scripts/extract-contract.mjs", "--check"]);
  add("hợp đồng client", r.status === 0,
      r.status === 0 ? "khớp bản đã trích" : "lệch so với bundle hãng",
      "hãng đổi tên lệnh/kênh mà mình không biết thì client im lặng hỏng");
}

// ── 6. spec /v1 khớp hợp đồng ────────────────────────────────────────────────
{
  const r = run("node", ["scripts/gen-openapi.mjs", "--check"]);
  // `--check` in ra đúng một dòng, nên không cần tách dòng.
  const line = (r.stdout ?? "").trim();
  add("spec /v1", r.status === 0, r.status === 0 ? line : "spec lệch — chạy `pnpm api:gen`",
      "thêm route mà quên sinh lại spec thì tài liệu API nói sai, và không ai biết");
}

// ── 7. docs ──────────────────────────────────────────────────────────────────
{
  const r = run("node", ["scripts/docs-check.mjs", "--ci"]);
  const dead = /link chết \((\d+)\)/.exec(r.stdout ?? "")?.[1] ?? "?";
  const orphan = /mồ côi[^(]*\((\d+)\)/.exec(r.stdout ?? "")?.[1] ?? "?";
  add("docs", r.status === 0, `${dead} link chết · ${orphan} mồ côi`,
      "tài liệu sai không làm build đỏ — nó chỉ làm người sau mất buổi sáng");
}

// ── 8. nhật ký e2e ───────────────────────────────────────────────────────────
{
  const log = join(REPO, "docs", "parity-runs", "e2e-history.jsonl");
  let rows = [];
  try { rows = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* chưa có */ }
  const last20 = rows.slice(-20);
  const red = last20.filter((r) => !r.pass).length;
  add("nhật ký e2e", rows.length > 0,
      rows.length ? `${rows.length} lượt đã ghi, ${red}/${last20.length} lượt gần nhất đỏ` : "chưa có lượt nào",
      "không có nhật ký thì một lượt đỏ giữa hai lượt xanh sẽ mất dấu");
}

// ── 9. cùng một mục đỏ hai lượt liền (T5.4) ─────────────────────────────────
{
  /*
   * T5.4: `self-xray` đỏ hai lượt liên tiếp ở CÙNG một mục thì dừng tính năng, refactor trước.
   * Đọc lại chính nhật ký của mình — `recordScript` đã ghi từng lượt, nên luật này kiểm được chứ
   * không phải chỉ viết ra rồi quên.
   */
  const log = join(REPO, "docs", "parity-runs", "e2e-history.jsonl");
  let mine = [];
  try {
    mine = readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l)).filter((r) => r.script === "self-xray.mjs");
  } catch { /* chưa có */ }
  const nameOf = (line) => line.replace(/^FAIL\s+/, "").split(" — ")[0].trim();
  const lastTwo = mine.slice(-2).map((r) => new Set((r.failLines ?? []).map(nameOf)));
  const repeated = lastTwo.length === 2 ? [...lastTwo[0]].filter((n) => lastTwo[1].has(n)) : [];
  add("không lặp lại", repeated.length === 0,
      mine.length < 2 ? `chỉ có ${mine.length} lượt trước — chưa đủ để xét`
        : repeated.length ? `LẶP: ${repeated.join(", ")}` : "hai lượt trước không đỏ cùng chỗ",
      "cùng một mục đỏ hai lượt liền: dừng tính năng, sửa cái sinh ra nó");
}

// ── tổng ─────────────────────────────────────────────────────────────────────
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} mục xanh`);
if (bad.length) console.log(`đỏ: ${bad.map((r) => r.name).join(", ")}`);

recordScript("self-xray.mjs", {
  status: bad.length ? "fail" : "pass",
  exitCode: bad.length ? 1 : 0,
  stdout: results.map((r) => `${r.pass ? "ok" : "FAIL"} ${r.name} — ${r.detail}`).join("\n"),
});

if (CI && bad.length) process.exit(1);
