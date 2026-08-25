/**
 * Chuyển dữ liệu của danh tính desktop cũ sang một tài khoản có thật.
 *
 * Vì sao cần: trước khi có đăng nhập thật, app desktop dùng chung một danh tính vô danh
 * `auth0|grokbot2-user`, và **mọi** bot, hội thoại, routine đều mang tên nó. Từ khi `/auth/poll`
 * đòi đăng nhập (GROKBOT2_AUTH=enforce), app nhận token của **tài khoản vừa đăng nhập** — một
 * chủ sở hữu khác. Dữ liệu vẫn nguyên vẹn trong sổ, nhưng app không còn thấy nó, và điều đó trông
 * y hệt "mất sạch bot".
 *
 * Đây là việc **cố ý, chạy một lần**, không phải thứ tự động chạy lúc đăng nhập: nó viết lại chủ
 * sở hữu của hàng nghìn dòng dữ liệu thật, và đó là quyết định của người dùng chứ không phải của
 * một nhánh `if` nào đó.
 *
 *   node scripts/adopt-legacy-owner.mjs                        # chỉ xem, không đổi gì
 *   node scripts/adopt-legacy-owner.mjs --to ban@vi.du --yes   # đổi thật, có sao lưu trước
 *
 * **Dừng backend trước khi chạy với `--yes`.** Sổ mở ở chế độ WAL cho một người ghi tại một thời
 * điểm; backend đang chạy thì lệnh ghi ở đây báo bận chứ không âm thầm hỏng — nhưng dừng nó trước
 * thì đỡ phải thử lại.
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.GROKBOT2_SQLITE_FILE ?? join(HERE, "..", ".data", "grokbot.sqlite");

/** Danh tính vô danh mà app desktop dùng trước khi có đăng nhập — xem DEFAULT_USER trong auth.ts. */
const LEGACY = "auth0|grokbot2-user";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const wants = (name) => process.argv.includes(name);

if (!existsSync(DB_FILE)) {
  console.error(`không thấy sổ: ${DB_FILE}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);

/** Bảng nào có cột chủ sở hữu — hỏi sổ, không chép tay, để thêm bảng mới không phải sửa file này. */
const ownedTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  .map((t) => t.name)
  .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === "owner_id"));

const counts = ownedTables
  .map((t) => ({
    table: t,
    n: db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE owner_id = ?`).get(LEGACY).n,
  }))
  .filter((r) => r.n > 0);

const total = counts.reduce((a, r) => a + r.n, 0);

console.log(`sổ   : ${DB_FILE}`);
console.log(`nguồn: ${LEGACY}`);
if (!total) {
  console.log("\nkhông có dòng nào thuộc danh tính cũ — không có gì để chuyển.");
  process.exit(0);
}
console.log(`\n${total} dòng đang thuộc danh tính cũ:`);
for (const r of counts) console.log(`  ${r.table.padEnd(20)} ${r.n}`);

const toEmail = (arg("--to") ?? "").trim().toLowerCase();
if (!toEmail) {
  const who = db.prepare("SELECT email FROM users WHERE password_hash IS NOT NULL").all().map((r) => r.email);
  console.log(`\nTài khoản nhận được (đã đặt mật khẩu): ${who.join(", ") || "(chưa có ai — hãy đăng ký trước)"}`);
  console.log("\nChạy khô. Để đổi thật:");
  console.log(`  node scripts/adopt-legacy-owner.mjs --to <email> --yes`);
  process.exit(0);
}

const target = db.prepare("SELECT auth_id, email FROM users WHERE email = ? AND password_hash IS NOT NULL").get(toEmail);
if (!target) {
  console.error(`\nkhông có tài khoản "${toEmail}" đã đặt mật khẩu — hãy đăng nhập được bằng nó trước đã.`);
  process.exit(1);
}
if (target.auth_id === LEGACY) {
  console.error("\ntài khoản đích chính là danh tính cũ — không có gì để chuyển.");
  process.exit(1);
}

console.log(`\nđích : ${target.auth_id}  (${target.email})`);

if (!wants("--yes")) {
  console.log("\nChạy khô — chưa đổi gì. Thêm --yes để ghi thật.");
  process.exit(0);
}

// Sao lưu trước khi chạm vào dữ liệu thật. Ngày 25/08 một lượt ghi đã cắt sổ từ 2.036 tin xuống 6,
// và thứ cứu được nó là một bản sao — không phải sự cẩn thận.
const backup = `${DB_FILE}.truoc-adopt-${new Date().toISOString().slice(0, 10)}`;
copyFileSync(DB_FILE, backup);
console.log(`\nđã sao lưu: ${backup}`);

// Một giao dịch cho cả chín bảng: chuyển nửa chừng thì bot thuộc người này còn hội thoại thuộc
// người kia, và đó là hỏng theo kiểu khó thấy nhất.
db.exec("BEGIN IMMEDIATE");
try {
  for (const r of counts) {
    const info = db.prepare(`UPDATE ${r.table} SET owner_id = ? WHERE owner_id = ?`).run(target.auth_id, LEGACY);
    console.log(`  ${r.table.padEnd(20)} ${info.changes} dòng`);
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`\nkhông đổi được — đã hoàn tác toàn bộ: ${e.message}`);
  console.error("Nếu báo bận: backend đang giữ sổ. Dừng nó rồi chạy lại.");
  process.exit(1);
}

console.log(`\nxong — ${total} dòng nay thuộc ${target.email}. Khởi động lại backend rồi đăng nhập bằng tài khoản đó.`);
