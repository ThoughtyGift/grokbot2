# `pnpm phase:gate` đỏ ở `verify-client-patch`

**Triệu chứng.**

```
FAIL attach-upload-observable: 1 unpatched occurrence(s) still present — re-run --apply
1 problem(s).
RED F6. Do not start F7.
```

Không phải hồi quy code. Bộ patch trong repo đã có thêm một patch mới mà **bản cài đặt chưa được áp**.

## Xác nhận

```bash
node infra/scripts/patch-client.mjs --status
```

So `patch set    : N — <danh sách>` với dòng `recorded : <thời điểm>`. Nếu `recorded` **cũ hơn** lúc
patch mới được thêm vào `infra/patches/index.mjs` thì đúng ca này.

## Sửa

Đóng app, rồi:

```bash
node infra/scripts/patch-client.mjs --dry-run   # mọi patch phải khớp và parse được
node infra/scripts/patch-client.mjs --apply
node infra/scripts/patch-client.mjs --verify
```

Mở lại app (`pnpm dev:app`) rồi chạy lại gate.

## Vì sao

`--verify` so **bộ patch hiện tại trong repo** với **bản cài đặt**. Thêm patch vào repo là bản cài
đặt lập tức lạc hậu — và đó là hành vi đúng: gate phải đỏ khi thứ đang chạy không còn là thứ repo
mô tả.

## Phòng

Thêm patch thì áp luôn. Đừng để bộ patch và bản cài đặt lệch nhau qua đêm — sáng sau nhìn gate đỏ
sẽ mất thời gian nghi oan cho code.
