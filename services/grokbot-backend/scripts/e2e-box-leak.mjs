/**
 * Thử rò trên box: bot của người A có đọc được file của người B không?
 *
 * Đây là bài kiểm **chốt chặng 5**, và nó được viết TRƯỚC khi sửa gì — cố ý. Hôm nay nó phải ĐỎ:
 * mặt dữ liệu đã tách theo `owner_id` trên 9 bảng, nhưng mặt máy thì chưa tách gì cả. Đo lại
 * 26/08/2026: `memory.ts` · `skills.ts` · `displays.ts` · `desktop.ts` · `teach.ts` nhắc tới chủ
 * sở hữu **0 lần**, và `boxCall(op, args)` không có tham số nào nói ai đang gọi.
 *
 * Có một con số đỏ làm mốc thì mới biết bản sửa có tác dụng thật hay chỉ trông có vẻ. Không có mốc
 * thì sau khi sửa, một bài xanh cũng không nói được gì — nó có thể vẫn xanh từ đầu.
 *
 * Bài này gọi thẳng `boxCall`, tức **đúng cửa mà công cụ của bot gọi**, chứ không mô phỏng. Nó không
 * cần model, nên chạy được cả khi hạn mức pool bằng 0.
 *
 *   npx tsx scripts/e2e-box-leak.mjs
 *
 * Đọc kết quả:
 *   RÒ      = đọc/ghi/liệt kê được đồ của người khác → đúng như hôm nay, đây là mốc
 *   KÍN     = bị từ chối → chặng 5 đã có tác dụng ở chỗ đó
 */
// `config.js` là chỗ duy nhất nạp `.env`, và `box-exec` chỉ đọc `process.env` — không nhập nó thì
// địa chỉ box rỗng và bài này báo "chưa cấu hình" trên một máy đã cấu hình đủ.
import "../src/config.js";
import { boxCall, boxConfigured } from "../src/box-exec.js";
import { runWithOwner } from "../src/request-context.js";
import { recordRun } from "./run-history.mjs";

const A = "auth0|nguoi-A";
const B = "auth0|nguoi-B";

/** Dấu riêng cho mỗi lượt chạy, để hai lượt không giẫm lên nhau và dọn được đúng đồ của mình. */
const stamp = process.argv.includes("--stamp")
  ? process.argv[process.argv.indexOf("--stamp") + 1]
  : String(process.hrtime.bigint()).slice(-8);

const steps = [];
const check = (name, ok, detail = "") => {
  // `pass`, không phải `ok`: `recordRun` đọc đúng tên đó, và đặt sai thì mọi bước vào nhật ký là hỏng.
  steps.push({ name, pass: ok, ...(ok ? {} : { detail }) });
  console.log(`  ${ok ? "KÍN " : "RÒ  "} ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Chạy một lệnh box "dưới danh nghĩa" một chủ sở hữu — y như một request thật. */
const as = (owner, op, args) => runWithOwner(owner, () => boxCall(op, args));

/**
 * Lấy phần chữ mà một lệnh box trả về.
 *
 * `exec` trả về `{stdout, stderr, exitCode…}`, `read` trả về chuỗi. Đem thẳng object đi so sánh thì
 * được `"[object Object]"` — và **hai lượt chạy khác nhau vẫn cho ra cùng chuỗi đó**. Bài này suýt
 * đậu bước "hai tài khoản khác nhau" bằng cách so hai `[object Object]`: đúng kết quả hôm nay, nhưng
 * sau khi tách xong nó sẽ **vẫn báo rò**, vì phép so chưa bao giờ nhìn vào dữ liệu thật.
 */
const text = (r) => {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") return String(r.stdout ?? r.content ?? r.text ?? JSON.stringify(r));
  return String(r);
};

/**
 * Chạy một phép thử rò, phân biệt **box từ chối** với **bài kiểm tự vỡ**.
 *
 * Lần chạy trước cho thấy vì sao chỗ này cần: một lỗi `text is not defined` của chính bài kiểm rơi
 * vào `catch`, được đọc là "bị từ chối", và bài **tự xanh lên 4/6**. Một bài kiểm xanh vì nó hỏng là
 * kiểu hỏng đắt nhất — nó nói dối đúng vào lúc người ta tin nó nhất.
 *
 * Nên: lỗi mang tên `BoxUnavailable`, hoặc lời nhắn của daemon, mới là "từ chối". Còn lại là bài
 * kiểm sai, và nó phải nổ chứ không được tính điểm.
 */
const attempt = async (fn) => {
  try {
    return { refused: false, out: text(await fn()) };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const fromBox = e?.name === "BoxUnavailable" || /denied|permission|forbidden|EACCES|box/i.test(msg);
    if (!fromBox) throw new Error(`bài kiểm tự vỡ, không phải box từ chối: ${msg}`);
    return { refused: true, out: `TỪ CHỐI: ${msg}` };
  }
};

const SECRET = `bi-mat-cua-A-${stamp}`;
const PATH_A = `/home/box/workspace/.thu-ro-${stamp}.txt`;

if (!boxConfigured()) {
  console.error("box chưa cấu hình — đặt GROKBOT2_BOX_EXEC_URL rồi chạy lại");
  process.exit(2);
}

console.log(`\n── thử rò giữa hai người dùng trên cùng một box (dấu ${stamp}) ──\n`);

try {
  // ── A tạo một file riêng ─────────────────────────────────────────────────────
  await as(A, "write", { path: PATH_A, content: SECRET });
  console.log(`  (A đã ghi ${PATH_A})\n`);

  // ── B thử đọc ───────────────────────────────────────────────────────────────
  const rd = await attempt(() => as(B, "read", { path: PATH_A }));
  check("B KHÔNG đọc được file của A", !rd.out.includes(SECRET),
        rd.out.includes(SECRET) ? "đọc ra đúng nội dung bí mật" : rd.out.slice(0, 70));

  // ── B thử liệt kê thư mục của A ─────────────────────────────────────────────
  const ls = await attempt(() => as(B, "list", { path: "/home/box/workspace" }));
  const sawIt = ls.out.includes(`.thu-ro-${stamp}`);
  check("B KHÔNG thấy file của A khi liệt kê thư mục", !sawIt,
        sawIt ? "tên file hiện trong danh sách" : ls.out.slice(0, 70));

  // ── B thử chạy lệnh shell đọc ───────────────────────────────────────────────
  const sh = await attempt(() => as(B, "exec", { command: `cat ${PATH_A}` }));
  check("B KHÔNG cat được file của A", !sh.out.includes(SECRET),
        sh.out.includes(SECRET) ? "cat ra đúng nội dung bí mật" : sh.out.slice(0, 70));

  // ── B thử GHI ĐÈ file của A — nặng hơn đọc trộm ─────────────────────────────
  const wr = await attempt(() => as(B, "write", { path: PATH_A, content: "B-da-ghi-de" }));
  const overwrote = !wr.refused
    && (await attempt(() => as(A, "read", { path: PATH_A }))).out.includes("B-da-ghi-de");
  check("B KHÔNG ghi đè được file của A", !overwrote,
        overwrote ? "nội dung của A đã bị thay" : wr.out.slice(0, 70));

  // ── hai người có chung một hồ sơ Chrome không ───────────────────────────────
  // Đây là chỗ sắc nhất: chung hồ sơ nghĩa là chung COOKIE, tức bot của B duyệt web
  // bằng phiên đăng nhập của A. Không phải "đọc trộm dữ liệu" mà là "dùng luôn danh tính".
  const pr = await attempt(() => as(B, "exec", { command: "ls -d /home/*/.config/grok-chrome-* 2>/dev/null | head -5" }));
  const profiles = pr.out.trim();
  const oneProfile = !pr.refused && profiles !== "" && profiles.split("\n").filter(Boolean).length <= 1;
  check("mỗi người một hồ sơ Chrome riêng", !oneProfile,
        oneProfile ? `chỉ có một hồ sơ dùng chung: ${profiles.split("\n")[0]}` : profiles.slice(0, 70));

  // ── hai người có chạy dưới hai tài khoản hệ điều hành khác nhau không ───────
  const whoA = (await attempt(() => as(A, "exec", { command: "id -un" }))).out.trim();
  const whoB = (await attempt(() => as(B, "exec", { command: "id -un" }))).out.trim();
  check("A và B chạy dưới hai tài khoản hệ điều hành khác nhau", whoA !== whoB,
        whoA === whoB ? `cả hai đều là "${whoA}"` : `${whoA} ≠ ${whoB}`);
} finally {
  // Dọn: xoá dấu của chính lượt này, dù bài đỏ hay xanh.
  try { await as(A, "remove", { path: PATH_A }); } catch { /* đã không tạo được thì thôi */ }
}

const kin = steps.filter((s) => s.pass).length;
console.log(`\n  ${kin}/${steps.length} chỗ đã kín\n`);
if (kin < steps.length) {
  console.log("  Đỏ là ĐÚNG cho tới khi chặng 5 xong — đây là mốc để so.");
  console.log("  Kế hoạch: docs/plan/per-user-on-one-box.md\n");
}

recordRun("e2e-box-leak.mjs", steps);

/*
 * Mặc định là NGHIÊM: còn chỗ rò thì thoát khác 0.
 *
 * Hôm nay chạy phải kèm `--moc`, vì đỏ là đúng — chặng 5 chưa làm. Nhưng nếu để nó luôn thoát 0 thì
 * sau khi tách xong, bài này **không bao giờ đỏ lại được**: một bài kiểm không hỏng được là một bài
 * kiểm không kiểm gì. Cờ `--moc` nói rõ "lượt này chỉ để ghi mốc", và nó phải được gõ ra chứ không
 * phải là mặc định im lặng.
 */
if (process.argv.includes("--moc")) {
  console.log("  (--moc: ghi mốc, không tính là hỏng)\n");
  process.exit(0);
}
process.exit(kin === steps.length ? 0 : 1);
