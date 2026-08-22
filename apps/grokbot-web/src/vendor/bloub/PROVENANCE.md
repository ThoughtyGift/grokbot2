# bloub — code của bên thứ ba, chép vào đây có chủ ý

| | |
|---|---|
| Nguồn | https://github.com/jeremy-prt/bloub |
| Commit ghim | `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749` (2026-08-17) |
| Phiên bản | 0.1.1 |
| Giấy phép | MIT — © 2026 Jérémy Perret ([LICENSE](LICENSE)) |
| Lấy về | 2026-08-22 |

## Đây là gì

Bản dựng lại bằng SVG của con bot x.ai: **một hình biến đổi qua nhiều trạng thái, đo lại từng
khung hình từ video tham chiếu**. Tác giả tự dựng từ video — không phải trích từ bundle của hãng.

Chỉ có `src/bot/*.ts` được chép: **thuần TypeScript, không phụ thuộc gì** (`vue` và `mediabunny`
trong `package.json` của họ chỉ phục vụ app demo và phần xuất GIF, không nằm trong lõi này).
Không chép component Vue, không chép asset.

## Vì sao nó có mặt ở đây

`docs/extracted/ui-design-spec.md` §"Phần thuộc hãng" liệt kê **ảnh avatar bot** là thứ **không
được dùng lại** — asset của Anysphere/x.ai, và [legal.md](../../../../docs/legal.md) cấm chép asset
của hãng vào sản phẩm. Cách thay tạm là chữ cái đầu tên trên nền màu: đúng luật, nhưng nhìn không
liên quan gì tới app gốc.

`bloub` giải quyết đúng chỗ đó, và giải quyết được vì nó là **một tác phẩm độc lập có giấy phép
MIT**, không phải asset của hãng được chép lại. Đây là ranh giới thật sự: cấm là cấm chép *của họ*,
không phải cấm trông giống.

Một điều vẫn phải tỉnh táo: MIT xử lý bản quyền **mã nguồn**. Hình con bot vẫn là thứ trông giống
dấu hiệu thương hiệu của x.ai — chuyện đó chỉ thành vấn đề nếu bản dựng này được **phân phối**, mà
[legal.md §3](../../../../docs/legal.md) đã cấm phân phối rồi. Dùng cá nhân/nghiên cứu thì không.

## Luật khi sửa

**Không sửa file trong thư mục này.** Cần đổi hành vi thì viết ở
[`../../avatar.ts`](../../avatar.ts) — nó là lớp bọc duy nhất. Giữ nguyên bản chép giúp việc nâng
lên commit mới sau này chỉ là chép đè, và giúp `git diff` nói thật rằng phần này không phải mình
viết.

Nâng cấp: chép lại `src/bot/*.ts` từ commit mới, cập nhật bảng trên, chạy `pnpm test:avatar-ui`.

## Đã bỏ gì

Bộ test của họ (`*.test.ts`) không chép — chúng chạy bằng `vitest`, mà workspace này không có.
Đổi lại, phần mình dùng được khoá bằng `apps/grokbot-web/src/avatar.test.ts`.
