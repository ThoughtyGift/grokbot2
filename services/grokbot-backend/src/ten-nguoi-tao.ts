/**
 * Tên hiển thị CÔNG KHAI của người tạo, suy từ `authId`.
 *
 * **Vì sao là một module riêng**: `bot-templates.ts` kéo `chat/state.js` + `directory/index.js`, nên
 * một bài đo cho phép suy tên không nạp được nó. Cùng lối với `chi-duong-ngoai-goc.ts`,
 * `tran-luot.ts`, `so-doi-may.ts` — bài đo chạy được TRƯỚC khi nối dây (bảng theo dõi §7).
 *
 * **Vì sao mặc định là KHÔNG suy được.** Bản trước (`bot-templates.ts:485`, tới 10/09) cắt tiền tố
 * rồi `split("@")[0]`. Với `local|ai@đó.vn` nó ra `ai` — đúng. Với `cinapi|<24 ký tự>` thì **không
 * có `@` để cắt**, nên `split` trả về cả chuỗi và id THÔ đi thẳng ra trang công khai. Đo trên SẢN
 * XUẤT 10/09, sau khi 12 bot đổi chủ sang `cinapi|<id>`: id ấy xuất hiện **4 lần trên mỗi trang
 * `/bot/<shareId>`**, trên cả 10 trang, không cần đăng nhập — `<title>`, `og:title`, và `<p class="by">`.
 *
 * Cái sai KHÔNG phải "thiếu một nhánh `cinapi|`". Cái sai là **hướng của nhánh mặc định**: hàm viết
 * cho một hình dạng id, và mọi hình dạng khác đi thẳng ra dây. Vá bằng cách thêm nhánh `cinapi|`
 * thì hình dạng THỨ BA (ngày mai) lại lọt y hệt. Nên luật ở đây là:
 *
 *   **mặc định ẩn danh; nhận diện là việc của các NHÁNH; hướng hỏng phải là "che quá tay".**
 *
 * Đúng một họ với `che()` trong `infra/vps/xoa-danh-tinh-cu.py` — hàm ấy xử `local|` rất kỹ rồi
 * `return` nguyên `cinapi|`, và lượt tổng dượt bắt được (bảng theo dõi §7). Lần này cùng lỗi ấy nằm
 * trong mã đang phát ra Internet, nên nó không có ai tổng dượt hộ.
 *
 * **Hàm này là LƯỚI AN TOÀN, không phải cơ chế đặt tên.** Tên đúng của một người là hồ sơ người tạo
 * (`setCreatorProfile` trong `marketplace.ts`); `creatorProfileOf` chỉ rơi về đây khi hồ sơ trống.
 * Nên "ẩn danh" hiện ra trên thẻ Marketplace là lời nhắc đặt hồ sơ, không phải một cái tên đề xuất.
 */

/** Thứ hiện ra khi không suy được một cái tên NGƯỜI từ tài khoản. Một hằng số: bài đo so BẰNG. */
export const TEN_AN_DANH = "ẩn danh";

/** Trần độ dài tên suy ra — một thẻ Marketplace không phải chỗ để dựng chuỗi dài tuỳ ý. */
export const TRAN_TEN = 64;

/** Có ít nhất một CHỮ (mọi bảng chữ cái, nên tên tiếng Việt có dấu qua được). */
const CO_CHU = /\p{L}/u;

/**
 * `local|nguoi-a@vi-du.vn` → `nguoi-a`. Mọi thứ khác → `TEN_AN_DANH`.
 *
 * Chỉ MỘT hình dạng được nhận: một địa chỉ thư trông có thật (có phần trước `@` mang chữ, và phần
 * miền có dấu chấm ở giữa). Một id mờ — hex, uuid, số — không bao giờ đi ra được, kể cả hình dạng
 * chưa ai thấy, vì nhánh cuối là hằng số chứ không phải đầu vào.
 */
export function ownerDisplayNameOf(authId: string): string {
  // KHÔNG `(authId ?? "").trim()`: `ownerAuthId` đọc lên từ JSON trên đĩa nên nó là `any` đội lốt
  // `string`, và hàm này nằm trên đường vẽ trang CÔNG KHAI — một lần ném ở đây là một trang 500.
  // Bài đo bắt đúng chỗ này ngay lượt chạy đầu, trước khi nối dây.
  const s = typeof authId === "string" ? authId.trim() : "";
  if (s === "") return TEN_AN_DANH;

  const sauTienTo = s.includes("|") ? s.slice(s.indexOf("|") + 1) : s;
  const vt = sauTienTo.indexOf("@");
  if (vt <= 0) return TEN_AN_DANH;                       // không có phần trước @ ⇒ không phải tên người

  const ten = sauTienTo.slice(0, vt).trim();
  const mien = sauTienTo.slice(vt + 1).trim();
  // Miền phải có dấu chấm Ở GIỮA: `a@b` hay `a@.vn` hay `a@vn.` không phải địa chỉ thư.
  const cham = mien.indexOf(".");
  if (cham <= 0 || cham === mien.length - 1) return TEN_AN_DANH;
  if (!CO_CHU.test(ten)) return TEN_AN_DANH;             // `123@x.vn` không phải một cái tên

  return ten.length > TRAN_TEN ? ten.slice(0, TRAN_TEN) : ten;
}
