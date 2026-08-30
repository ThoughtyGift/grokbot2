/**
 * Sổ máy — nhớ qua khởi động lại, và tên người dùng đặt không bị máy ghi đè.
 *
 *   npx tsx --test services/grokbot-backend/src/may-da-biet.test.ts
 *
 * ── Hai bài đầu là hai lỗi đã suýt xảy ra, không phải bài cho vui ───────────────────────────────
 *
 * MỘT — bảng Settings → Computer hỏi danh sách máy ĐÚNG MỘT LẦN lúc app khởi động rồi không thử
 * lại, còn daemon thì cắm vào sau đó vài giây. Nên nếu sổ chỉ biết "máy đang nối", bảng luôn nhận
 * mảng rỗng và trống suốt phiên dù máy chạy lệnh ngon lành. Đo được ngày 30/08; lần thử đầu của
 * tôi chạy được chỉ vì lúc ấy còn một máy giả nối sẵn từ trước.
 *
 * HAI — daemon gửi `hello` mỗi lần nối lại, và `hello` mang TÊN MÁY tự khai (`DESKTOP-7D2FJG8`).
 * Nếu tên người dùng đặt trong bảng dùng chung ô với tên ấy thì nó tự quay về sau vài giây, không
 * ai hiểu vì sao. Nên `tenNguoiDat` là trường riêng, và `nhoMay` phải giữ nó lại.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nhoMay, mayChoBang, datTen, datQuyen, quenHet } from "./may-da-biet.js";

const may = (id: string, label: string, seenAtMs = Date.now()) => ({ computerId: id, label, seenAtMs });

test("máy từng nối vẫn nằm trong danh sách khi đã rút — bảng hỏi lúc daemon chưa cắm", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8" });
  // Không máy nào đang nối: đúng khoảnh khắc app vừa mở.
  const ds = mayChoBang([]);
  assert.equal(ds.length, 1);
  assert.equal(ds[0].label, "DESKTOP-7D2FJG8");
});

test("tên người dùng đặt KHÔNG bị hello của máy ghi đè", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8" });
  assert.ok(datTen("m1", "Máy kế toán"));

  // Daemon nối lại — hello mang tên máy tự khai, y như lần đầu.
  nhoMay({ computerId: "m1", label: "DESKTOP-7D2FJG8" });

  const ds = mayChoBang([may("m1", "DESKTOP-7D2FJG8")]);
  assert.equal(ds[0].tenNguoiDat, "Máy kế toán", "tên người đặt phải sống qua hello");
  assert.equal(ds[0].label, "DESKTOP-7D2FJG8", "tên máy tự khai vẫn giữ nguyên bên cạnh");
});

test("đổi tên máy không biết thì trả null, không lặng lẽ thành công", () => {
  quenHet();
  assert.equal(datTen("khong-co", "Gì đó"), null);
  assert.equal(datQuyen("khong-co", "always"), null);
});

test("tên rỗng hoặc toàn khoảng trắng bị từ chối — renderer đọc .label.length không guard", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "PC" });
  assert.equal(datTen("m1", ""), null);
  assert.equal(datTen("m1", "   "), null);
  assert.equal(mayChoBang([])[0].tenNguoiDat, undefined, "không để lại tên hỏng");
});

test("đổi mức quyền ghi vào sổ và giữ nguyên tên người đặt", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "PC" });
  datTen("m1", "Máy kho");
  const m = datQuyen("m1", "always");
  assert.equal(m?.standing, "always");
  assert.equal(m?.tenNguoiDat, "Máy kho", "đổi quyền không được xoá tên");
});

test("máy đang nối thắng bản ghi cũ về giờ và tên máy, nhưng không thắng tên người đặt", () => {
  quenHet();
  nhoMay({ computerId: "m1", label: "Tên cũ" });
  datTen("m1", "Máy của tôi");
  const ds = mayChoBang([may("m1", "Tên mới", 9_999_999_999_999)]);
  assert.equal(ds[0].label, "Tên mới");
  assert.equal(ds[0].seenAtMs, 9_999_999_999_999);
  assert.equal(ds[0].tenNguoiDat, "Máy của tôi");
});

test("mới thấy trước — bảng xếp máy đang dùng lên đầu", () => {
  quenHet();
  nhoMay({ computerId: "cu", label: "Máy cũ" });
  const ds = mayChoBang([may("moi", "Máy mới", Date.now() + 60_000)]);
  assert.equal(ds[0].computerId, "moi");
  assert.equal(ds[1].computerId, "cu");
});
