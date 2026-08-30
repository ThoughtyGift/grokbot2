/**
 * Nạp trạng thái dự án vào đầu mỗi phiên — bằng thứ KHÔNG BAO GIỜ quá to.
 *
 * Claude Code nạp stdout của hook `SessionStart` vào ngữ cảnh. Ở đây in ra ba thứ rẻ và luôn đúng:
 * commit gần nhất, cây làm việc có gì đang dở, và §1 của bảng theo dõi.
 *
 * ── Vì sao có file này ──────────────────────────────────────────────────────────────────────────
 *
 * Đo ngày 31/08/2026: hai ngày làm việc năng suất nhất của dự án (28 commit — local-exec đa máy,
 * bảng Computer, kênh cookie-origin-approval, ba lệnh ảnh 0.30, dọn 79 file tài liệu) để lại **0
 * dòng ký ức**. Truy ra thì cơ chế bàn giao phiên không thiếu, nó VỠ, và vỡ theo cách im lặng nhất:
 *
 *   · bộ ghi đọc transcript bằng `readFile()` — nguyên file vào một chuỗi;
 *   · transcript của dự án này đã **631 MB**, trong khi trần chuỗi của V8 là 512 MB
 *     (`Cannot create a string longer than 0x1fffffe8 characters`);
 *   · nó ném, nuốt lỗi, và để lại file bàn giao đúng bằng template rỗng (504 byte);
 *   · bộ đọc thấy template thì bỏ qua — nên phiên sau không nhận gì.
 *
 * Bằng chứng đối chứng, cùng thư mục cùng ngày: file của một dự án KHÁC nặng 6.770 byte và nạp
 * bình thường. Cơ chế ấy chạy tốt — chỉ chết riêng ở đây, vì ở đây transcript to.
 *
 * Nên hook này cố ý **không đọc transcript**. `git log` và một trăm dòng markdown thì không có
 * đường nào phình tới 512 MB.
 *
 * ── Đừng để nó tự phình ────────────────────────────────────────────────────────────────────────
 *
 * Mỗi ký tự in ra đây là ký tự trừ vào ngân sách ngữ cảnh của MỌI phiên. Nên chỉ §1 của bảng theo
 * dõi, không phải cả bảng: phần còn lại vẫn ở đó, đọc khi cần.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chay = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", timeout: 8000 }).trim();
  } catch {
    // Không có git, hoặc repo lạ. Hook không được làm hỏng việc mở phiên vì một thứ trang trí.
    return "";
  }
};

const ra = [];

const log = chay("git", ["log", "-6", "--format=%h %s"]);
if (log) ra.push(`## 6 commit gần nhất\n\n\`\`\`\n${log}\n\`\`\``);

const branch = chay("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = chay("git", ["status", "--short"]);
if (branch) {
  const dong = dirty ? dirty.split("\n").length : 0;
  ra.push(`Nhánh **${branch}** · cây làm việc: ${dong ? `${dong} file đang dở` : "sạch"}`);
}

/*
 * §1 của bảng theo dõi — cắt tại tiêu đề §2.
 *
 * Cắt theo TIÊU ĐỀ chứ không theo số dòng: cắt theo dòng thì lần nào ai đó thêm một đoạn vào §1 là
 * hook lại nuốt mất nửa câu, và không ai nhận ra vì nó vẫn "chạy".
 */
try {
  const bang = readFileSync(join(REPO, "docs", "state", "bang-theo-doi.md"), "utf8");
  const dau = bang.indexOf("## 1 ·");
  const cuoi = bang.indexOf("## 2 ·", dau + 1);
  if (dau >= 0 && cuoi > dau) {
    ra.push(bang.slice(dau, cuoi).trim());
    ra.push("*Đầy đủ (việc còn lại, bẫy đã trả giá): `docs/state/bang-theo-doi.md`. Đo lại: `node services/grokbot-backend/scripts/trang-thai.mjs`.*");
  }
} catch {
  // Bảng bị đổi tên hay xoá — nói ra, đừng im lặng bỏ qua, vì im lặng chính là cách cơ chế cũ hỏng.
  ra.push("⚠ Không đọc được `docs/state/bang-theo-doi.md` — trạng thái dự án KHÔNG được nạp phiên này.");
}

if (ra.length) console.log(ra.join("\n\n"));
