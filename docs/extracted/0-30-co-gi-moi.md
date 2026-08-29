# 0.30 có gì mới so với 0.29

> Trích 2026-08-29 bằng cách so hai bản `app.asar` đã giải nén (`asar029` ↔ `asar030`).
> Người dùng tự bấm cập nhật; bản vá của ta ở `C:\cai029` vẫn là 0.29 và còn nguyên.
>
> Cách đo: so **bảng lệnh gateway** (khai báo `name:{args,reply}`) và so **catalog i18n**
> (`"hash":[...]`). Cả hai đều là dữ liệu trong bundle, không phải suy đoán. Chunk renderer chính
> lớn thêm 26.827 byte; cấu trúc `dist/` không đổi.

## Lệnh gateway: 121 → 122

```
+ resolveVirtualCardApproval     thẻ ảo — xem §1
+ getBotTemplateExportPolicy     chính sách xuất mẫu bot — xem §2
- isAgentNetworkEnabled          cổng bật đồ thị mạng bot, đã BỎ
```

Việc bỏ `isAgentNetworkEnabled` đáng chú ý: 0.29 dùng nó để bật/tắt màn hình đồ thị bot. Bỏ cổng
thường có nghĩa tính năng đã ra chính thức, nhưng **chưa kiểm chứng** — chỉ đo được là cổng biến mất.

## §1 · Thẻ ảo / thanh toán (Stripe Link) — cụm lớn nhất

```
"Virtual card approval"                    "Approve a card for <merchantName>"
"<purchase> · <amount>"   "Total"          "breakdown"
"Charged via Link. Card details never enter this chat."
"Approved. Finish authorizing on the Stripe Link page that just opened."
"Declined. Nothing was authorized."
"The <amount> card for <0> could not be created."
"Your Link account isn't connected. Reconnect it in Settings, then ask again."
```

Bot **tiêu tiền được**, qua một thẻ ảo cấp theo từng merchant, và người dùng duyệt bằng một thẻ
trong hội thoại (`resolveVirtualCardApproval`). Chi tiết thẻ không đi qua chat.

## §2 · Chợ mẫu bot (Marketplace)

```
"Marketplace" · "Featured" · "Bot categories" · "Marketplace content"
"Agents your teammates shared. Add one to keep it in your sidebar; the rest stay here."
"Teammates will see the full history of this agent, including past conversations,
 and can send it messages."
"Playbooks it can run" · "Tools it can use" · "Facts it already knows"
"How this Bot should work" · "Context" · "instructions" · "skills" · "memories"
```

0.29 đã có `publishBotTemplate`/`setBotTemplateVisibility`; 0.30 dựng hẳn mặt tiền cho nó, kèm trang
chi tiết bot phơi ra playbook / tool / ký ức. Câu cảnh báo về lịch sử hội thoại là điều đáng đọc kỹ
nếu ta làm tính năng này: chia sẻ một bot là chia sẻ **toàn bộ** hội thoại cũ của nó.

## §3 · Routine kích bằng webhook

```
"The address an outside service sends its request to. Each request runs this routine once.
 It is the \"POST to\" field"
"Authorization header"
"A secret the sender includes so Grok Bot knows the request really came from them."
"Jobs that run on their own"
```

Khớp đúng `getAutomationWebhookCredential` — một trong 8 lệnh ta chưa phục vụ. 0.30 cho thấy nó dùng
để làm gì: mỗi routine có một URL + một header bí mật, dịch vụ ngoài POST vào là routine chạy một lần.

## §4 · Nhập cookie Chrome

```
"Cookie approvals" · "sites" · "Allow" · "Allowed"
"Copies from Chrome on your computer. Allow once is this import only.
 Always allow skips this prompt next time for the same site."
"Copy your Chrome logins to Grok Bot's computer so it can use the sites you are signed in to."
```

Chính là `injectChromeCookies` trong danh sách hoãn của ta. 0.30 làm rõ mô hình duyệt: **theo từng
site**, không phải một lần cho tất cả.

## §5 · Quản lý app Slack (~25 chuỗi)

Cài / gỡ / cập nhật app Slack theo từng workspace, kèm đủ nhánh lỗi: admin từ chối, thiếu quyền
app-management, chạm trần app của gói Slack, app do một bản cài Cursor khác sở hữu, rate limit.

## §6 · Settings viết lại + đo mức dùng

```
"Spend limit" · "Cumulative Spend" · "Current cycle" · "Previous cycle" · "Personal Usage"
"Allow extra usage beyond your plan, billed as you go." · "End your free trial early."
"Require a hardware security key, like a YubiKey, for sensitive actions."
"Send Grok Bot's internet traffic through this desktop instead of its own computer."
"Wipe Grok Bot's computer and start it fresh, which removes the files on it."
"Choose how closely Grok Bot checks its own risky actions before it runs them."
"Choose which AI model Grok Bot thinks with."
```

## Câu xác nhận mô hình hai mặt phẳng

```
"Allow Grok Bot to run tasks on THIS computer, not only on ITS OWN computer."
"See and manage the computers Grok Bot can work on."
```

Hãng tự phân biệt bằng đúng hai chữ: **this computer** (máy người dùng, do `local-exec-daemon` chạy)
và **its own computer** (box). Trước đó tôi suy ra điều này từ mã; đây là câu của chính họ.

Đo sống trên máy này lúc 02:20 xác nhận nốt vế đầu:

```
PID 40788  Grok Bot.exe  C:\cai029\resources\app\dist\local-exec-daemon\main.cjs
```

Daemon chạy như tiến trình con của app desktop, mã lấy từ thư mục app đã cài. `downloadArtifact` và
`fetchArtifact` đều **0 lần** trong bundle — nên **box KHÔNG thể tự cài daemon lên một máy chưa có
app**; nó đi kèm bộ cài, do người cài.
