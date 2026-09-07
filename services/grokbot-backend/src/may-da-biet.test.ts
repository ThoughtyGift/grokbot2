/**
 * Sổ máy — nhớ qua khởi động lại, tên người dùng đặt không bị máy ghi đè, và **máy của ai thì chỉ
 * người đó thấy**.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/may-da-biet.test.ts"
 *
 * ── Bài này từng GHI VÀO SỔ THẬT của người dùng ────────────────────────────────────────────────
 *
 * Dòng `nhoMay({computerId:"cu", label:"Máy cũ"})` ở cuối file, cộng với một hằng số đường dẫn ghim
 * `../.data/may-da-biet.json` trong `may-da-biet.ts`, đủ để một lượt chạy bộ test vẽ thêm một máy
 * tên **"Máy cũ"** vào bảng Settings → Computer của người dùng — đo 07/09, hàng rác mang đúng dấu
 * thời gian của lượt chạy 764/764. Cùng họ với bẫy §7 "bộ test xoá kho thật", ngược chiều: đây là
 * GHI, nên không có gì trông như hỏng.
 *
 * Nên `GROKBOT2_MAY_DA_BIET_FILE` được đặt **vô điều kiện** ngay dưới đây, TRƯỚC khi module được
 * nạp, và trỏ vào `mkdtemp` của riêng bài này. Không `??=` theo env của runner: env runner chỉ là
 * lưới che `.data` thật, không phải hàng rào giữa các bài — `node --test` chạy các file SONG SONG
 * và `dataDir()` dưới `NODE_TEST_CONTEXT` là MỘT thư mục dùng chung (§7).
 *
 * ── Ba bài đầu là ba lỗi đã xảy ra thật ────────────────────────────────────────────────────────
 *
 * MỘT — bảng Settings → Computer hỏi danh sách máy ĐÚNG MỘT LẦN lúc app khởi động rồi không thử
 * lại, còn daemon thì cắm vào sau đó vài giây. Nên nếu sổ chỉ biết "máy đang nối", bảng luôn nhận
 * mảng rỗng và trống suốt phiên dù máy chạy lệnh ngon lành. Đo được ngày 30/08.
 *
 * HAI — daemon gửi `hello` mỗi lần nối lại, và `hello` mang TÊN MÁY tự khai (`DESKTOP-7D2FJG8`).
 * Nếu tên người dùng đặt trong bảng dùng chung ô với tên ấy thì nó tự quay về sau vài giây, không
 * ai hiểu vì sao. Nên `tenNguoiDat` là trường riêng, và `nhoMay` phải giữ nó lại.
 *
 * BA — sổ không có trường CHỦ cho tới 07/09, nên nó là một sổ toàn cục: bảng của người B vẽ máy
 * Windows của người A, và `datTen` của B đổi được tên máy của A. Bốn bài cuối ghim chuyện đó.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GROKBOT2_MAY_DA_BIET_FILE = join(mkdtempSync(join(tmpdir(), "gb2-may-")), "may-da-biet.json");

import { test } from "node:test";
import assert from "node:assert/strict";
import { nhoMay, mayChoBang, datTen, datQuyen, quenHet } from "./may-da-biet.js";

const A = "auth0|nguoi-A";
const B = "auth0|nguoi-B";

const may = (id: string, label: string, seenAtMs = Date.now(), owner = A) =>
  ({ computerId: id, label, seenAtMs, owner });

test("máy từng nối vẫn nằm trong danh sách khi đã rút — bảng hỏi lúc daemon chưa cắm", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8", owner: A });
  // Không máy nào đang nối: đúng khoảnh khắc app vừa mở.
  const ds = mayChoBang([], A);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].label, "DESKTOP-7D2FJG8");
});

test("tên người dùng đặt KHÔNG bị hello của máy ghi đè", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8", owner: A });
  assert.ok(datTen("m1", "Máy kế toán", A));

  // Daemon nối lại — hello mang tên máy tự khai, y như lần đầu.
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8", owner: A });

  const ds = mayChoBang([may("m1", "DESKTOP-7D2FJG8")], A);
  assert.equal(ds[0].tenNguoiDat, "Máy kế toán", "tên người đặt phải sống qua hello");
  assert.equal(ds[0].label, "DESKTOP-7D2FJG8", "tên máy tự khai vẫn giữ nguyên bên cạnh");
});

test("đổi tên máy không biết thì trả null, không lặng lẽ thành công", () => {
  quenHet();
  assert.equal(datTen("khong-co", "Gì đó", A), null);
  assert.equal(datQuyen("khong-co", "always", A), null);
});

test("tên rỗng hoặc toàn khoảng trắng bị từ chối — renderer đọc .label.length không guard", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "PC", owner: A });
  assert.equal(datTen("m1", "", A), null);
  assert.equal(datTen("m1", "   ", A), null);
  assert.equal(mayChoBang([], A)[0].tenNguoiDat, undefined, "không để lại tên hỏng");
});

test("đổi mức quyền ghi vào sổ và giữ nguyên tên người đặt", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "PC", owner: A });
  datTen("m1", "Máy kho", A);
  const m = datQuyen("m1", "always", A);
  assert.equal(m?.standing, "always");
  assert.equal(m?.tenNguoiDat, "Máy kho", "đổi quyền không được xoá tên");
});

test("máy đang nối thắng bản ghi cũ về giờ và tên máy, nhưng không thắng tên người đặt", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "Tên cũ", owner: A });
  datTen("m1", "Máy của tôi", A);
  const ds = mayChoBang([may("m1", "Tên mới", 9_999_999_999_999)], A);
  assert.equal(ds[0].label, "Tên mới");
  assert.equal(ds[0].seenAtMs, 9_999_999_999_999);
  assert.equal(ds[0].tenNguoiDat, "Máy của tôi");
});

test("mới thấy trước — bảng xếp máy đang dùng lên đầu", () => {
  quenHet();
  nhoMay({ computerId: "cu", label: "Máy cũ", owner: A });
  const ds = mayChoBang([may("moi", "Máy mới", Date.now() + 60_000)], A);
  assert.equal(ds[0].computerId, "moi");
  assert.equal(ds[1].computerId, "cu");
});

// ── Cô lập theo người dùng ─────────────────────────────────────────────────────────────────────

test("bảng của người B KHÔNG có máy của người A — cả máy đã tắt lẫn máy đang nối", () => {
  quenHet();
  nhoMay({ computerId: "cua-A", label: "DESKTOP-7D2FJG8", owner: A });
  nhoMay({ computerId: "cua-B", label: "LAPTOP-B", owner: B });

  const bangB = mayChoBang([may("cua-A", "DESKTOP-7D2FJG8", Date.now(), A)], B);
  assert.deepEqual(bangB.map((m) => m.computerId), ["cua-B"],
    "máy đang nối của A vẫn không được lọt vào bảng của B");

  const bangA = mayChoBang([], A);
  assert.deepEqual(bangA.map((m) => m.computerId), ["cua-A"]);
});

test("B đổi tên / đổi quyền máy của A thì trả null, và sổ của A không suy suyển", () => {
  quenHet();
  nhoMay({ computerId: "cua-A", label: "DESKTOP-7D2FJG8", owner: A });

  assert.equal(datTen("cua-A", "Máy của B", B), null, "không được đổi tên máy người khác");
  assert.equal(datQuyen("cua-A", "always", B), null, "không được đổi mức quyền máy người khác");

  const ds = mayChoBang([], A);
  assert.equal(ds[0].label, "DESKTOP-7D2FJG8");
  assert.equal(ds[0].tenNguoiDat, undefined);
  assert.equal(ds[0].standing, undefined);
});

test("câu từ chối của máy người khác giống HỆT câu của máy không tồn tại", () => {
  quenHet();
  nhoMay({ computerId: "cua-A", label: "PC-A", owner: A });
  // Cùng một `null`: một câu lỗi khác đi là xác nhận với người hỏi rằng id ấy có thật ở đâu đó
  // (cùng luật với cửa `?k=` của trang tải — token sai thì rơi về gói công khai, không trả 403).
  assert.equal(datTen("cua-A", "X", B), datTen("khong-ton-tai", "X", B));
});

test("cùng một computerId đổi chủ thì KHÔNG mang tên người trước sang", () => {
  quenHet();
  // Máy bán lại / cài lại Windows giữ nguyên id, nhưng người dùng là người khác.
  nhoMay({ computerId: "m1", label: "PC", owner: A });
  datTen("m1", "Máy kế toán của A", A);

  nhoMay({ computerId: "m1", label: "PC", owner: B });

  assert.equal(mayChoBang([], A).length, 0, "A không còn thấy máy đã sang tay");
  assert.equal(mayChoBang([], B)[0].tenNguoiDat, undefined, "B không thừa hưởng tên của A");
});
