/**
 * Nhật ký nối thêm cho các bài e2e — một dòng mỗi lượt chạy, không ghi đè.
 *
 * Vì sao cần: ngày 2026-08-22 `e2e-app-full` đỏ một lần giữa hai lần xanh và **không truy được**
 * check nào đã hỏng — bản ghi của gate chỉ lưu pass/fail mức script, còn lượt xanh sau đã ghi đè
 * nó. Cùng ngày, `e2e-avatar-ui` lặp lại y hệt chuyện đó. Đây là cái bẫy đã làm mất bằng chứng vụ
 * sáu bot bị ẩn: **thứ duy nhất ghi lại chi tiết là stdout của đúng lượt đó**, mà stdout thì trôi.
 *
 * Nên mọi bài có `check()` đều gọi hàm này trước khi thoát. Nối thêm, không phải ảnh chụp: một
 * lượt đỏ phải còn dấu vết sau khi lượt xanh tiếp theo chạy xong.
 *
 * Không ghi nội dung hội thoại, không ghi token — file này nằm trong repo. Chỉ tên bước, đậu/hỏng,
 * và `detail` đã cắt ngắn.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(resolve(HERE, "..", "..", ".."), "docs", "parity-runs", "e2e-history.jsonl");

/**
 * Xoá giá trị bí mật khỏi `detail`.
 *
 * `detail` của một bước hỏng thường là body phản hồi — tiện khi chẩn đoán, nhưng file này nằm
 * trong repo, nên nó không được phép mang theo token. Một bước ĐẬU không ghi `detail` nên không
 * cần lo; chỉ cần bước hỏng là đủ để một giá trị đi vào git.
 *
 * Chỉ xoá giá trị, giữ lại khoá — biết "token sai" khác hẳn biết "không có trường token".
 */
export function redact(text) {
  return text
    .replace(/("(?:token|authorization|apiKey|secret|password)"\s*:\s*")[^"]*(")/gi, "$1<đã xoá>$2")
    .replace(/(Bearer)\s+[\w.\-]+/gi, "$1 <đã xoá>")
    .replace(/hal_[A-Za-z0-9_-]+/g, "hal_<đã xoá>");
}

/**
 * @param {string} script tên bài, ví dụ "e2e-avatar-ui.mjs"
 * @param {{name: string, pass: boolean, detail?: unknown, known?: boolean}[]} results
 * @param {Record<string, unknown>} [extra] số liệu thêm của riêng bài đó
 */
export function recordRun(script, results, extra = {}) {
  const failed = results.filter((r) => !r.pass && !r.known);
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `${JSON.stringify({
      at: new Date().toISOString(),
      script,
      pass: failed.length === 0,
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      ...extra,
      // Bước đậu chỉ cần tên; bước hỏng cần cả `detail`, vì đó là thứ duy nhất nói được vì sao.
      steps: results.map((r) => ({
        name: r.name,
        pass: Boolean(r.pass),
        ...(r.known ? { known: true } : {}),
        ...(!r.pass && r.detail != null ? { detail: redact(String(r.detail)).slice(0, 200) } : {}),
      })),
    })}\n`);
  } catch (e) {
    // Ghi log không được phép làm đỏ một lượt chạy vốn đã xanh.
    console.log(`(không ghi được e2e-history.jsonl: ${e instanceof Error ? e.message : e})`);
  }
}

/**
 * Ghi một lượt chạy mà ta CHỈ có stdout, không có mảng `results`.
 *
 * Dùng cho gate: nó chạy 63 script khác nhau, mỗi cái một kiểu in ra. Vá `recordRun` vào từng file
 * là 34 lần sửa và 34 lần có thể sai (đã sai một lần: `note` vs `detail`), lại không giúp gì cho
 * script viết sau này. Đọc stdout ở một chỗ thì phủ hết, kể cả bài chưa tồn tại.
 *
 * Chỉ giữ dòng thất bại và phần đuôi — không giữ cả stdout: có bài in ra vài nghìn dòng, và file
 * này nằm trong repo.
 */
export function recordScript(script, { phase, status, exitCode, stdout = "", args = [] }) {
  const lines = stdout.split(/\r?\n/);
  // Mỗi bài in một kiểu: "FAIL x", "not ok 3 - x", "  ✗ x", "failed:".
  const fails = lines.filter((l) => /^\s*(FAIL|not ok|✗|x )/.test(l)).slice(0, 25);
  const tail = lines.filter((l) => l.trim()).slice(-6);
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, `${JSON.stringify({
      at: new Date().toISOString(),
      script: args.length ? `${script} ${args.join(" ")}` : script,
      via: "gate",
      ...(phase ? { phase } : {}),
      pass: status === "pass",
      exitCode: exitCode ?? null,
      ...(fails.length ? { failLines: fails.map((l) => redact(l.trim()).slice(0, 200)) } : {}),
      tail: tail.map((l) => redact(l.trim()).slice(0, 160)),
    })}\n`);
  } catch (e) {
    console.log(`(không ghi được e2e-history.jsonl: ${e instanceof Error ? e.message : e})`);
  }
}

/** In lịch sử của một bài: `node scripts/run-history.mjs [tên-bài] [số-dòng]`. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { readFileSync } = await import("node:fs");
  const want = process.argv[2];
  const limit = Number(process.argv[3] ?? 20);
  let lines = [];
  try { lines = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean); } catch { /* chưa có */ }
  const rows = lines.map((l) => JSON.parse(l)).filter((r) => !want || r.script === want).slice(-limit);
  if (!rows.length) { console.log(want ? `chưa có lượt nào của ${want}` : "nhật ký còn trống"); process.exit(0); }
  /*
   * Hai dạng dòng, một bản in.
   *
   * Bài tự gọi `recordRun` ghi `steps[]`; gate gọi `recordScript` chỉ ghi `failLines`/`tail` vì nó
   * chỉ có stdout. Bản đầu giả định mọi dòng đều có `steps` và **vỡ ngay** ở dòng gate đầu tiên —
   * một công cụ đọc log mà tự chết thì cái log cũng vô dụng.
   */
  for (const r of rows) {
    const score = r.total != null ? `${r.passed}/${r.total}` : `exit ${r.exitCode ?? "?"}`;
    const via = r.via === "gate" ? ` [gate${r.phase ? ` ${r.phase}` : ""}]` : "";
    console.log(`${r.at}  ${String(r.script).padEnd(30)} ${r.pass ? "xanh" : "ĐỎ  "}  ${score}${via}`);
    for (const s of (r.steps ?? []).filter((x) => !x.pass)) {
      console.log(`    hỏng: ${s.name}${s.detail ? `  — ${s.detail}` : ""}`);
    }
    for (const l of r.failLines ?? []) console.log(`    ${l}`);
    // Bài chết vì ngoại lệ không in dòng "FAIL" nào — lúc đó phần đuôi là thứ duy nhất còn lại.
    if (!r.pass && !(r.failLines ?? []).length && !(r.steps ?? []).length) {
      for (const l of (r.tail ?? []).slice(-3)) console.log(`    … ${l}`);
    }
  }
  const red = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length} lượt, ${red} đỏ`);
}
