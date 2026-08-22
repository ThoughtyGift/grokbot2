# App boot nhưng bản patch như không có tác dụng

**Triệu chứng.** `--apply` báo xong, app mở được, nhưng thứ vừa patch không có hiệu lực (ví dụ ảnh
theo đường dẫn ổ đĩa vẫn lỗi).

## Xác nhận

```bash
node infra/scripts/patch-client.mjs --status
```

Nhìn dòng `boots from`. Nguy hiểm là khi **cả hai** cùng tồn tại:

```
boots from   : resources/app (patched)
vendor asar  : CÒN NGUYÊN ở resources/app.asar     <- sai
```

`app.asar` thắng thứ tự nạp, nên app boot bằng **bản của hãng** trong khi bản patch nằm cạnh, vô
tác dụng. `--verify` là bộ kiểm đáng tin hơn `--status`:

```bash
node infra/scripts/patch-client.mjs --verify
```

## Sửa

Đóng app rồi:

```bash
node infra/scripts/patch-client.mjs --apply
node infra/scripts/patch-client.mjs --verify
```

Không đóng app thì `--apply` sẽ từ chối, và đó là cố ý.

## Vì sao

Bản `--apply` đầu tiên copy `resources/app` **trước** khi đổi tên `app.asar`. Windows nhả mmap của
tệp vài giây sau khi tiến trình chết, nên `EBUSY` ở bước đổi tên để lại **cả hai** cây.

Đã sửa ba tầng trong `infra/scripts/patch-client.mjs`: kiểm tiến trình trước khi làm, copy sang
`app.new` rồi đổi tên có thử lại rồi mới swap, và hoàn lại `app.asar` nếu swap thất bại.

## Phòng

`infra/scripts/run.ps1` chạy `--verify` trước khi mở app và **từ chối mở** nếu patch không nguyên.
Nên hãy mở app bằng `pnpm dev:app`, đừng mở bằng shortcut Desktop.
