/**
 * Thử rò trên box: bot của người A có với được đồ của người B không?
 *
 * Đây là bài kiểm **chốt chặng 5**, và nó được viết TRƯỚC khi sửa gì — cố ý. Mốc đo ngày 26/08, khi
 * mọi bot của mọi người còn chạy dưới cùng một tài khoản `box`: **0/7 chỗ kín**.
 *
 * Bài này gọi thẳng `boxCall`, tức **đúng cửa mà công cụ của bot gọi**, chứ không mô phỏng. Nó không
 * cần model, nên chạy được cả khi hạn mức pool bằng 0.
 *
 *   npx tsx scripts/e2e-box-leak.mjs         # nghiêm: còn rò thì thoát khác 0
 *   npx tsx scripts/e2e-box-leak.mjs --moc   # chỉ ghi mốc, không tính là hỏng
 *
 * Đọc kết quả:  RÒ = với được đồ của người khác   ·   KÍN = bị từ chối
 */
// `config.js` là chỗ duy nhất nạp `.env`, và `box-exec` chỉ đọc `process.env` — không nhập nó thì
// địa chỉ box rỗng và bài này báo "chưa cấu hình" trên một máy đã cấu hình đủ.
import "../src/config.js";
import { boxCall, boxConfigured } from "../src/box-exec.js";
import { runWithOwner } from "../src/request-context.js";
import { recordRun } from "./run-history.mjs";

const A = "auth0|nguoi-A";
const B = "auth0|nguoi-B";

/** Dấu riêng mỗi lượt, để hai lượt không giẫm lên nhau và dọn được đúng đồ của mình. */
const stamp = String(process.hrtime.bigint()).slice(-8);

const steps = [];
const check = (name, ok, detail = "") => {
  // `pass`, không phải `ok`: `recordRun` đọc đúng tên đó.
  steps.push({ name, pass: ok, ...(ok ? {} : { detail }) });
  console.log(`  ${ok ? "KÍN " : "RÒ  "} ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Chạy một lệnh box "dưới danh nghĩa" một chủ sở hữu — y như một request thật. */
const as = (owner, op, args) => runWithOwner(owner, () => boxCall(op, args));

/**
 * Lấy phần chữ mà một lệnh box trả về.
 *
 * `exec` trả `{stdout, stderr, exitCode…}`, `read` trả chuỗi. Đem thẳng object đi so sánh thì được
 * `"[object Object]"` — và **hai lượt khác nhau vẫn cho cùng chuỗi đó**. Bài này từng suýt đậu bước
 * "hai tài khoản khác nhau" bằng cách so hai `[object Object]`: đúng kết quả hôm đó, nhưng sau khi
 * tách xong nó sẽ **vẫn báo rò**, vì phép so chưa bao giờ nhìn vào dữ liệu thật.
 */
const text = (r) => {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") return String(r.stdout ?? r.content ?? r.text ?? JSON.stringify(r));
  return String(r);
};

/**
 * Chạy một phép thử, phân biệt **box từ chối** với **bài kiểm tự vỡ**.
 *
 * Vì sao cần: một lỗi `text is not defined` của chính bài kiểm từng rơi vào `catch`, được đọc là "bị
 * từ chối", và bài **tự xanh lên 4/6**. Một bài kiểm xanh vì nó hỏng là kiểu hỏng đắt nhất — nó nói
 * dối đúng vào lúc người ta tin nó nhất.
 */
const attempt = async (fn) => {
  try {
    return { refused: false, out: text(await fn()) };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const fromBox = e?.name === "BoxUnavailable"
      || /denied|permission|forbidden|EACCES|escapes root|no such file|not found/i.test(msg);
    if (!fromBox) throw new Error(`bài kiểm tự vỡ, không phải box từ chối: ${msg}`);
    return { refused: true, out: `TỪ CHỐI: ${msg}` };
  }
};

const SECRET = `bi-mat-cua-A-${stamp}`;
/*
 * Đường TƯƠNG ĐỐI, đúng như công cụ của bot dùng.
 *
 * Bản đầu ghi cứng `/home/box/workspace/…`. Nó chạy được khi mọi người dùng chung một gốc, nhưng sau
 * khi tách thì chính bài kiểm bị chặn vì "đi ra ngoài gốc" — nó đang đo một đường mà không bot nào
 * gọi. Tương đối thì mỗi người rơi vào gốc của mình, và đó mới là câu cần đo.
 */
const NAME_A = `.thu-ro-${stamp}.txt`;

if (!boxConfigured()) {
  console.error("box chưa cấu hình — đặt GROKBOT2_BOX_EXEC_URL rồi chạy lại");
  process.exit(2);
}

console.log(`\n── thử rò giữa hai người dùng trên cùng một box (dấu ${stamp}) ──\n`);

let rootA = "";
try {
  // ── A tạo một file riêng, rồi xem hai người đứng ở đâu ──────────────────────
  await as(A, "write", { path: NAME_A, content: SECRET });
  rootA = text(await as(A, "exec", { command: "pwd" })).trim();
  const rootB = text(await as(B, "exec", { command: "pwd" })).trim();
  const absA = `${rootA}/${NAME_A}`;
  console.log(`  (A ghi ${absA})`);
  console.log(`  (gốc A: ${rootA || "?"} · gốc B: ${rootB || "?"})\n`);

  check("A và B KHÔNG dùng chung thư mục gốc", Boolean(rootA) && rootA !== rootB,
        rootA === rootB ? `cả hai đều là ${rootA}` : "");

  // ── B thử đọc bằng đường tuyệt đối của A ───────────────────────────────────
  const rd = await attempt(() => as(B, "read", { path: absA }));
  check("B KHÔNG đọc được file của A", !rd.out.includes(SECRET),
        rd.out.includes(SECRET) ? "đọc ra đúng nội dung bí mật" : rd.out.slice(0, 60));

  // ── B thử liệt kê thư mục của A ────────────────────────────────────────────
  const ls = await attempt(() => as(B, "list", { path: rootA }));
  const sawIt = ls.out.includes(NAME_A);
  check("B KHÔNG thấy file của A khi liệt kê", !sawIt, sawIt ? "tên file hiện trong danh sách" : ls.out.slice(0, 60));

  // ── B thử shell ────────────────────────────────────────────────────────────
  const sh = await attempt(() => as(B, "exec", { command: `cat ${absA}` }));
  check("B KHÔNG cat được file của A", !sh.out.includes(SECRET),
        sh.out.includes(SECRET) ? "cat ra đúng nội dung bí mật" : sh.out.slice(0, 60));

  // ── B thử GHI ĐÈ — nặng hơn đọc trộm ───────────────────────────────────────
  const wr = await attempt(() => as(B, "write", { path: absA, content: "B-da-ghi-de" }));
  const overwrote = !wr.refused
    && (await attempt(() => as(A, "read", { path: NAME_A }))).out.includes("B-da-ghi-de");
  check("B KHÔNG ghi đè được file của A", !overwrote,
        overwrote ? "nội dung của A đã bị thay" : wr.out.slice(0, 60));

  // ── hồ sơ Chrome: chung hồ sơ là chung COOKIE ──────────────────────────────
  // Chỗ sắc nhất: không phải "đọc trộm dữ liệu" mà là "dùng luôn danh tính" — nếu A đăng nhập một
  // trang trong trình duyệt của bot mình thì bot của B duyệt web với tư cách A.
  const pr = await attempt(() => as(B, "exec", { command: "ls -d /home/*/.config/grok-chrome-* 2>/dev/null | head -5" }));
  const profiles = pr.out.trim();
  const oneProfile = !pr.refused && profiles !== "" && profiles.split("\n").filter(Boolean).length <= 1;
  check("mỗi người một hồ sơ Chrome riêng", !oneProfile,
        oneProfile ? `chỉ có một hồ sơ dùng chung: ${profiles.split("\n")[0]}` : profiles.slice(0, 60) || "không thấy hồ sơ nào");

  // ── hai tài khoản hệ điều hành khác nhau ───────────────────────────────────
  const whoA = (await attempt(() => as(A, "exec", { command: "id -un" }))).out.trim();
  const whoB = (await attempt(() => as(B, "exec", { command: "id -un" }))).out.trim();
  check("A và B chạy dưới hai tài khoản hệ điều hành khác nhau", Boolean(whoA) && whoA !== whoB,
        whoA === whoB ? `cả hai đều là "${whoA}"` : `${whoA} ≠ ${whoB}`);
} finally {
  try { await as(A, "remove", { path: NAME_A }); } catch { /* không tạo được thì thôi */ }
}

const kin = steps.filter((s) => s.pass).length;
console.log(`\n  ${kin}/${steps.length} chỗ đã kín\n`);
recordRun("e2e-box-leak.mjs", steps);

/*
 * Mặc định NGHIÊM: còn rò thì thoát khác 0.
 *
 * Cờ `--moc` nói rõ "lượt này chỉ để ghi mốc", và nó phải được gõ ra chứ không phải mặc định im
 * lặng — một bài kiểm không hỏng được là một bài kiểm không kiểm gì.
 */
if (process.argv.includes("--moc")) {
  console.log("  (--moc: ghi mốc, không tính là hỏng)\n");
  process.exit(0);
}
process.exit(kin === steps.length ? 0 : 1);
