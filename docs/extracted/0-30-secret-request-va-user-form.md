# `secret-request` và `user-form` — hình dạng đầy đủ, trích từ 0.30

> Trích 2026-08-29 từ `asar030` (0.30.0). Đây là bản **đính chính** một kết luận cũ.

## Kết luận cũ sai ở đâu

`services/grokbot-backend/src/runtime/turn.ts` (khối `submitUserForm`) viết:

> *"shape từng ô (`formRequest.fields[]`) KHÔNG trích được — renderer chỉ đọc `formRequest.title`
> và `fields.length`"*

Sai. Shape đầy đủ **có trong gói**, chỉ không nằm ở chỗ phiên trước tìm: renderer chia thẻ thành
**chunk nạp trễ**, mỗi loại thẻ một file. Tìm trong `index-*.js` thì chỉ gặp phần khung; thân thẻ
nằm ở `view-*.js` riêng.

```
cards/send-message/secret-request/view.tsx  ->  view-VDAfAAIc.js   (7,2 KB)
cards/send-message/user-form/view.tsx       ->  view-rSaOPpy4.js   (11,8 KB)
```

Bài học lặp lại lần thứ hai (lần đầu: nhãn nằm trong danh mục băm i18n): **không thấy trong bundle
chính không có nghĩa là không có trong gói.** Đường nguồn `.tsx` còn nguyên trong bản đồ nạp trễ,
nên tra theo tên thư mục thẻ là ra ngay.

## Bộ phân biệt — sổ đăng ký, không phải suy diễn

```js
ben = ["text","attachment","widget","cursor-agent","secret-request","user-form","email-draft",
       "slack-draft","permission-request","connector","connectors","listener-connect",
       "bot-template-share","auto-review-approval","local-tool-permission",
       "virtual-card-approval","cookie-origin-approval"]
xen = new Map([["event", …], ["send-message", new Set(ben)], …])
```

`entry.kind === "send-message"` nhận 17 giá trị `message.type`. Hai cái ta cần là **`secret-request`**
và **`user-form`** — cùng khuôn với `local-tool-permission`, thẻ ta đã biết chắc chạy được.

## `secret-request`

```ts
entry.kind = "send-message"
entry.message = {
  type: "secret-request",
  secretRequest: {
    label: string,          // BẮT BUỘC — renderer đọc `.label.length` không guard
    description?: string,   // `description != null` mới vẽ dòng phụ
  },
}
entry.secretProvided?: boolean   // true -> vẽ thẻ "đã lưu", không vẽ ô nhập
```

Thẻ: ô `type="password"`, `autoComplete="off"`, placeholder chính là `label`. Nút gửi bật khi
`value.trim().length > 0 && !đang gửi && !isProvided && agentId != null`.

```
submitSecret({ entryId, value, agentId })
```

## `user-form`

```ts
entry.kind = "send-message"
entry.message = {
  type: "user-form",
  formRequest: {
    title: string,            // BẮT BUỘC — `.title.length` không guard
    instruction?: string,
    fields: Field[],          // BẮT BUỘC — `.fields.length` không guard
    liveHost?: string,        // hoặc `domain`; dùng dựng origin `https://<host>/`
    domain?: string,
  },
}
entry.formResolution?: "sending" | "submitted" | "fill_failed" | "escalated"
```

`formResolution != null` → vẽ thẻ đã xong, không vẽ form nữa.

### `Field`

```ts
{ id: string, label: string, type?: FieldType, placeholder?: string,
  required?: boolean, secret?: boolean, options?: { value: string, label: string }[] }
```

Ánh xạ `type` → thuộc tính `<input>`, nguyên văn hàm `qe(n, e)`:

| `type` | input | `name` | `autoComplete` | `inputMode` |
|---|---|---|---|---|
| `email` | email | `username` nếu form có ô password/otp, ngược lại `email` | như `name` | email |
| `tel` | tel | `field.id` | tel | tel |
| `password` | password | `password` | current-password | |
| `otp` | text | `one-time-code` | one-time-code | numeric |
| `number` | number | `field.id` | off | numeric |
| `date` | date | `field.id` | off | |
| *(mặc định)* | text | `field.id` | on | |

Hai nhánh mặc định đáng chú ý:

- `field.secret === true` → password. Và nếu `"${id} ${label}"` tách từ ra có chữ thuộc
  `{password, passwd, pwd, passcode}` thì `name="password"`, `autoComplete="current-password"`;
  không thì `name=field.id`, `autoComplete="off"`.
- Ngược lại, nếu `/user|login|account/i` khớp `"${id} ${label}"` → `name="username"`,
  `autoComplete="username"`.

Nghĩa là hãng **cố ý** để trình duyệt tự điền nhận ra form đăng nhập. Ai đặt `id`/`label` tuỳ tiện
thì mất tính năng đó chứ không hỏng gì.

`options` có → vẽ `<select>` với `<option value label>`.

### Nút và lệnh

```
submitUserForm ({ entryId, values: Record<string,string>, agentId, platform? })
dismissUserForm({ entryId, mode: "dismissed" | "escalated", agentId, platform? })
```

Ô bắt buộc chưa điền thì chặn gửi: `field.required === true && (values[field.id] ?? "").trim().length === 0`.

## Còn một mảnh chưa đúng trong ghi chú cũ

Ghi chú cũ nói *"cờ `sand_user_form` của hãng mặc định TẮT (tính năng ship ở dạng ngủ)"*. Quét toàn
bộ 326 file renderer của 0.30: **không có cờ nào tên như vậy**. Ngược lại, tính năng nối đủ —

- trạng thái bot: `request_user_form` → *"Waiting for you"*, biểu tượng đồng hồ cát;
- tóm tắt thanh bên: `case "user_form": return e.title`, `case "secret_request": return e.label`;
- theo dõi lượt: `turnLeftUnresolvedForm()` biến một lượt `success` thành
  `{outcome:"error", errorType:"action_required", errorCode:"user_form"}`;
- phục hồi: `resume_after_user_form_failed`, `resume_after_secret_submission_failed`.

Chỗ này tôi **chưa đo được** ở 0.29 (bản ta chạy), chỉ đo ở 0.30. Nên câu đúng là: *cờ ấy không có
ở 0.30*, chứ không phải *"phiên trước nói sai hoàn toàn"*.

## Việc còn phải làm

Nhận thì đã có (`submitSecret`/`submitUserForm`/`dismissUserForm` đều nhận đúng schema). Thiếu là
chiều **PHÁT**: chưa chỗ nào trong backend đặt `message.type = "secret-request"` hay `"user-form"`.

Kèm theo đó là hai tool cho model — `request_user_form` (tên lấy từ bảng trạng thái của client) và
một tool xin bí mật — cùng đường đỗ lượt / mở khoá đã có sẵn cho widget.
